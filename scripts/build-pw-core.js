#!/usr/bin/env node
/**
 * Build only the bundles this fork actually needs from the vendored
 * playwright monorepo:
 *   - packages/playwright-core/lib/utilsBundle.js
 *   - packages/playwright-core/lib/coreBundle.js
 *
 * It reuses the official esbuild configuration from
 * `playwright-src/utils/build/build.js` (the dynamic-import→require plugin,
 * the vendored-import rewriter, and utilsBundleMapping) but skips the rest
 * of the upstream build pipeline (vite bundles, web packages, codegen, …).
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const PW_ROOT = path.join(ROOT, 'playwright-src');
const PW_CORE = path.join(PW_ROOT, 'packages', 'playwright-core');
const PW_CORE_SRC = path.join(PW_CORE, 'src');
const PW_CORE_LIB = path.join(PW_CORE, 'lib');

if (!fs.existsSync(PW_ROOT)) {
  console.error(`[build:pw] playwright-src/ not found at ${PW_ROOT}`);
  console.error(`[build:pw] Run: git clone --depth=1 https://github.com/microsoft/playwright.git ${PW_ROOT}`);
  process.exit(1);
}

const { MAPPING: VENDORED_MAPPING, VENDORED_PACKAGES } =
  require(path.join(PW_ROOT, 'utils', 'build', 'utilsBundleMapping'));

const VENDORED_INVERSE_NAMED = {};
for (const [pkg, def] of Object.entries(VENDORED_MAPPING)) {
  VENDORED_INVERSE_NAMED[pkg] = {};
  if (def.named) {
    for (const [srcName, key] of Object.entries(def.named))
      VENDORED_INVERSE_NAMED[pkg][srcName] = key;
  }
}

const VENDORED_PKG_RE = new RegExp(
    '^import\\s+(' +
    '\\{[^}]*\\}|' +
    '\\*\\s+as\\s+\\w+|' +
    '\\w+(?:\\s*,\\s*\\{[^}]*\\})?' +
    ')\\s+from\\s+\'(' +
    [...VENDORED_PACKAGES].map(p => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') +
    ')\';?',
    'gm'
);

function utilsBundleSpecifier(filePath) {
  const coreSrcMarker = `${path.sep}playwright-core${path.sep}src${path.sep}`;
  const idx = filePath.indexOf(coreSrcMarker);
  if (idx === -1)
    return "'playwright-core/lib/utilsBundle'";
  const coreSrcRoot = filePath.slice(0, idx + coreSrcMarker.length - 1);
  let rel = path.relative(path.dirname(filePath), path.join(coreSrcRoot, 'utilsBundle'));
  rel = rel.split(path.sep).join('/');
  if (!rel.startsWith('.'))
    rel = './' + rel;
  return `'${rel}'`;
}

function parseClause(clause) {
  const out = {};
  if (clause.startsWith('{')) {
    out.named = parseNamedList(clause);
    return out;
  }
  if (clause.startsWith('*')) {
    out.namespace = clause.match(/\*\s+as\s+(\w+)/)[1];
    return out;
  }
  const m = clause.match(/^(\w+)(?:\s*,\s*(\{[^}]*\}))?$/);
  if (!m)
    return null;
  out.default = m[1];
  if (m[2])
    out.named = parseNamedList(m[2]);
  return out;
}

function parseNamedList(braced) {
  const inner = braced.replace(/^\s*\{|\}\s*$/g, '').trim();
  if (!inner)
    return [];
  return inner
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.replace(/^type\s+/, ''))
      .map(spec => {
        const m = spec.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        if (!m)
          return null;
        return { src: m[1], alias: m[2] || m[1] };
      })
      .filter(Boolean);
}

function rewriteVendoredImports(filePath, contents) {
  const bundleSpec = utilsBundleSpecifier(filePath);
  return contents.replace(VENDORED_PKG_RE, (full, clause, pkg) => {
    const def = VENDORED_MAPPING[pkg];
    const parsed = parseClause(clause);
    if (!parsed)
      return full;
    const lines = [];
    if (parsed.default && def.default)
      lines.push(`const ${parsed.default} = require(${bundleSpec}).${def.default};`);
    if (parsed.namespace && def.namespace)
      lines.push(`const ${parsed.namespace} = require(${bundleSpec}).${def.namespace};`);
    if (parsed.named && def.named) {
      const renames = parsed.named.map(({ src, alias }) => {
        const key = def.named[src];
        if (!key)
          return null;
        return key === alias ? key : `${key}: ${alias}`;
      }).filter(Boolean);
      if (renames.length)
        lines.push(`const { ${renames.join(', ')} } = require(${bundleSpec});`);
    }
    return lines.length ? lines.join('\n') : full;
  });
}

const dynamicImportToRequirePlugin = {
  name: 'dynamic-import-to-require',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async args => {
      let contents = await fs.promises.readFile(args.path, 'utf8');
      const isPlaywrightSrc = args.path.includes(`${path.sep}playwright${path.sep}src${path.sep}`);
      const hasAlias = isPlaywrightSrc && (contents.includes("'@isomorphic/") || contents.includes("'@utils/"));
      let hasVendored = false;
      for (const pkg of VENDORED_PACKAGES) {
        if (contents.includes(`'${pkg}'`)) { hasVendored = true; break; }
      }
      if (!hasAlias && !hasVendored)
        return undefined;
      if (hasVendored)
        contents = rewriteVendoredImports(args.path, contents);
      if (hasAlias) {
        contents = contents.replace(
            /import\s*\{([^}]*)\}\s*from\s*'@isomorphic\/[^']+';?/g,
            (_, names) => `const {${names}} = require('playwright-core/lib/coreBundle').iso;`
        );
        contents = contents.replace(
            /import\s*\{([^}]*)\}\s*from\s*'@utils\/[^']+';?/g,
            (_, names) => `const {${names}} = require('playwright-core/lib/coreBundle').utils;`
        );
      }
      return { contents, loader: 'ts' };
    });
  }
};

const externalizeUtilsBundlePlugin = {
  name: 'externalize-utilsBundle',
  setup: build => build.onResolve({ filter: /utilsBundle/ },
      () => ({ path: './utilsBundle', external: true })),
};

async function main() {
  fs.mkdirSync(PW_CORE_LIB, { recursive: true });

  const nodePaths = [
    path.join(PW_ROOT, 'node_modules'),
    path.join(ROOT, 'node_modules'),
  ].filter(p => fs.existsSync(p));

  console.log('[build:pw] bundling utilsBundle.js …');
  await esbuild.build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    absWorkingDir: PW_ROOT,
    nodePaths,
    entryPoints: [path.join(PW_CORE_SRC, 'utilsBundle.ts')],
    outfile: path.join(PW_CORE_LIB, 'utilsBundle.js'),
    external: ['fsevents', 'express', '@anthropic-ai/sdk'],
    alias: {
      'raw-body': path.join(PW_ROOT, 'utils', 'build', 'raw-body.ts'),
    },
    logOverride: { 'direct-eval': 'silent' },
  });

  console.log('[build:pw] bundling coreBundle.js …');
  await esbuild.build({
    bundle: true,
    platform: 'node',
    format: 'cjs',
    absWorkingDir: PW_ROOT,
    nodePaths,
    entryPoints: [path.join(PW_CORE_SRC, 'coreBundle.ts')],
    outfile: path.join(PW_CORE_LIB, 'coreBundle.js'),
    external: [
      '../../api.json',
      './help.json',
      'electron',
      'electron/*',
      'chromium-bidi',
      'chromium-bidi/*',
      'mitt',
    ],
    plugins: [externalizeUtilsBundlePlugin, dynamicImportToRequirePlugin],
    logOverride: { 'direct-eval': 'silent' },
  });

  const coreBundleStat = fs.statSync(path.join(PW_CORE_LIB, 'coreBundle.js'));
  const utilsBundleStat = fs.statSync(path.join(PW_CORE_LIB, 'utilsBundle.js'));
  console.log(`[build:pw] done. coreBundle.js ${(coreBundleStat.size / 1024).toFixed(0)} KB, utilsBundle.js ${(utilsBundleStat.size / 1024).toFixed(0)} KB`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
