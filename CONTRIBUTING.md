# Contributing

This is a fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) that adds dynamic CDP session support. Contributions are welcome.

## Repo layout

This fork vendors the Playwright monorepo via `git subtree` into `playwright/`. Source changes live as TypeScript under `playwright/packages/playwright-core/src/tools/` — **no string-replacement patches** against published bundles.

```
playwright-cdp-mcp/
├── playwright/                              ← microsoft/playwright via git subtree
│   └── packages/playwright-core/src/tools/  ← fork edits MCP sources here
├── scripts/
│   ├── build-pw-core.js                     ← esbuild → lib/utilsBundle.js + lib/coreBundle.js
│   └── postinstall.js                       ← runs on `npm install`
├── cli.js                                   ← CLI entry point
├── index.js                                 ← programmatic API entry point
└── docs/                                    ← documentation
```

## First-time setup

```bash
git clone https://github.com/yx4724201000subg/playwright-cdp-mdp.git
cd playwright-cdp-mcp
npm install      # postinstall auto-builds the bundles
```

## Making a change

1. Edit TypeScript under `playwright/packages/playwright-core/src/tools/`.
2. Rebuild:

   ```bash
   npm run build:pw
   ```

3. Verify:

   ```bash
   node cli.js --help
   node scripts/direct-mcp-multi-cdp-check.mjs    # → DIRECT_MULTI_CDP_OK
   npm run lint
   ```

4. Commit both the TS source changes and any `package.json` / `cli.js` / `index.js` updates. The `playwright/**/lib/` directories are gitignored — no build artifacts get committed.

### What the fork changes vs upstream

Files under `playwright/packages/playwright-core/src/`:

- `tools/utils/mcp/tool.ts` — adds `browserSession` (with `id` / `cdpEndpoint` / `proxy`) to every tool's input schema.
- `tools/mcp/config.d.ts` — declares `browser.explicitBrowser`.
- `tools/mcp/config.ts` — populates `explicitBrowser` from `cliOptions.browser`.
- `tools/backend/browserBackend.ts` — per-id `_browserSessions` map + lazy CDP resolver; passes `browserSession.proxy` through to `connectOverCDP`.
- `tools/mcp/index.ts` — `createConnection` skips local launch in dynamic CDP mode.
- `tools/mcp/program.ts` — CLI factory skips local launch in dynamic CDP mode.
- `server/transport.ts` — `WebSocketTransportOptions` accepts an optional `agent` (for SOCKS/HTTP proxies).
- `server/chromium/chromium.ts` — `_connectOverCDPInternal` and `urlToWSEndpoint` consult `options.proxy` via `createProxyAgent`.
- `server/browserType.ts` — `connectOverCDP` base signature accepts `proxy`.
- `client/browserType.ts` — `_connectOverCDP` forwards `params.proxy` through the channel.
- `types/types.d.ts` — public `ConnectOverCDPOptions` declares the new `proxy` field.
- `utils/network.ts` (in `packages/utils`) — `HTTPRequestParams` gains an optional `agent` field.

Keep these edits minimal and well-commented so they are easy to re-apply when upgrading the subtree.

## Upgrading the playwright subtree

```bash
# 1. Fetch upstream into the subtree
git subtree pull --prefix=playwright https://github.com/microsoft/playwright.git <commit-or-tag>

# 2. Resolve conflicts in the 6 files above.

# 3. Rebuild and verify
npm install
node scripts/direct-mcp-multi-cdp-check.mjs
```

## Commit messages

Follow [Semantic Commit Messages](https://www.conventionalcommits.org/en/v1.0.0/):

```
label(namespace): title

description

footer
```

Labels: `fix`, `feat`, `docs`, `test`, `devops`, `chore`.

Examples:

```
feat(cdp): support per-call browserSession.cdpEndpoint
fix(build): resolve esbuild alias for raw-body
docs(readme): clarify dynamic CDP mode
```

Do not add `Co-Authored-By` agents or "Generated with" lines in commit messages.

## Sending a pull request

All submissions require review via GitHub pull requests. Keep your PR diff small and readable; split into multiple PRs when sensible.

## License

Apache-2.0. This project is a fork of Microsoft's `@playwright/mcp` and retains the upstream license.
