#!/usr/bin/env node
/**
 * Postinstall setup for the vendored playwright subtree.
 *
 * Runs the minimum steps required to materialize `coreBundle.js` and
 * `utilsBundle.js` from the in-repo source so that `cli.js` / `index.js`
 * can load them:
 *
 *   1. `npm install` inside `playwright/` (esbuild, ws, zod, …).
 *   2. `node playwright/utils/generate_injected.js` (writes
 *      `packages/playwright-core/src/generated/*Source.ts`).
 *   3. `node scripts/build-pw-core.js` (esbuild → lib/).
 *
 * No string-replacement patches against published bundles — every change
 * lives as TypeScript source under `playwright/packages/playwright-core/src/`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PW_ROOT = path.join(ROOT, 'playwright');

function run(cmd, args, cwd, label) {
  console.log(`[postinstall] ${label}`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0)
    throw new Error(`[postinstall] ${label} failed with exit code ${result.status}`);
}

function main() {
  if (!fs.existsSync(PW_ROOT)) {
    console.warn(`[postinstall] ${PW_ROOT} not found — skipping (subtree absent).`);
    return;
  }

  const libMarker = path.join(PW_ROOT, 'packages', 'playwright-core', 'lib', 'coreBundle.js');
  if (fs.existsSync(libMarker)) {
    console.log('[postinstall] lib/coreBundle.js already present — skipping build.');
    return;
  }

  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], PW_ROOT, 'install playwright subtree deps');
  run('node', ['utils/generate_injected.js'], PW_ROOT, 'generate injected script sources');
  run('node', [path.join(ROOT, 'scripts', 'build-pw-core.js')], ROOT, 'build coreBundle/utilsBundle');

  console.log('[postinstall] done.');
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
