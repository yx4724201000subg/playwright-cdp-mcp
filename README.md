# Playwright MCP — Dynamic CDP Sessions Fork

A [Model Context Protocol](https://modelcontextprotocol.io) server that provides browser automation capabilities using [Playwright](https://playwright.dev). This fork adds a per-call `browserSession` argument so **one MCP server can control multiple CDP endpoints simultaneously** — something upstream `@playwright/mcp` does not support.

> **Why?** Upstream takes a single static CDP endpoint at server startup. That breaks down the moment one long-running MCP server must drive several browsers (e.g. parallel agent workers, multi-account automation, cross-browser testing).

```json
{ "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" } }
{ "browserSession": { "id": "chrome-a" } }
```

---

## For Users

Two install paths: published npm package (fastest), or clone this repo (full source).

### Option A — Use the published npm package (recommended)

```bash
npx @dingmenghua/playwright-mcp-cdp-session@latest
```

MCP client config (drop into VS Code / Cursor / Claude Desktop / Codex / Goose / …):

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "npx",
      "args": ["-y", "@dingmenghua/playwright-mcp-cdp-session@latest"]
    }
  }
}
```

Codex CLI:

```bash
codex mcp add playwright-cdp -- npx -y @dingmenghua/playwright-mcp-cdp-session@latest
```

This package is a drop-in replacement for `@playwright/mcp`, so any MCP-compatible client works.

### Option B — Clone this repo

```bash
git clone https://github.com/yx4724201000subg/playwright-cdp-mcp.git
cd playwright-cdp-mcp
npm install
```

`npm install` automatically:

1. Installs the vendored playwright subtree's devDependencies (esbuild, ws, zod, …).
2. Regenerates injected script sources.
3. Builds `lib/utilsBundle.js` + `lib/coreBundle.js` via esbuild (~30 s).

After that point the MCP server at your local clone:

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "node",
      "args": ["/absolute/path/to/playwright-cdp-mcp/cli.js"]
    }
  }
}
```

### Dynamic CDP mode (default)

When the server is started **without** `--cdp-endpoint`, `--endpoint`, `--extension`, `--browser`, or `--executable-path`, it enters **dynamic CDP mode**: no local browser is launched; every tool call must select a CDP endpoint via `browserSession`.

First call for a session — must include `cdpEndpoint`:

```json
{ "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" } }
```

Later calls — reuse by id only:

```json
{ "browserSession": { "id": "chrome-a" } }
```

If a tool call omits `browserSession` while in dynamic CDP mode, the call fails with an explicit error telling the client to provide `browserSession.id` and `browserSession.cdpEndpoint`.

### Legacy local-browser mode (opt-in)

Pass `--browser=chrome` or `--executable-path` to make the server launch a local Chrome/Chromium like upstream `@playwright/mcp`. `browserSession` is then optional.

### Starting browsers with CDP

Each Chromium browser must be started with a distinct remote debugging port:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-a
google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-b
```

Then use `http://localhost:9222` / `http://localhost:9223` in `browserSession.cdpEndpoint`. Only Chromium-family browsers support CDP; Firefox and WebKit are not supported in this mode.

### Tool call examples

```json
{ "name": "browser_navigate", "arguments": {
    "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" },
    "url": "https://example.com"
} }

{ "name": "browser_navigate", "arguments": {
    "browserSession": { "id": "chrome-b", "cdpEndpoint": "http://localhost:9223" },
    "url": "https://playwright.dev"
} }

{ "name": "browser_snapshot",  "arguments": { "browserSession": { "id": "chrome-a" } } }
{ "name": "browser_click",     "arguments": { "browserSession": { "id": "chrome-b" }, "element": "Search", "ref": "e3" } }
```

Internally the MCP server keeps a map from session id to CDP browser/context. Each session has its own current tab state, so calls for different CDP endpoints do not overwrite each other.

> **📖 Full setup, agent prompt guidance, OpenAI Agents SDK integration, and validation scripts: [docs/dynamic-cdp-sessions.md](docs/dynamic-cdp-sessions.md)**

---

## For Developers

This fork vendors the entire Playwright monorepo via `git subtree` into [`playwright/`](playwright/) and edits the MCP TypeScript sources directly. **No string-replacement patches against published bundles** — every change lives as TypeScript source.

### Repo layout

```
playwright-cdp-mcp/
├── playwright/                                 ← microsoft/playwright via git subtree
│   └── packages/playwright-core/src/tools/
│       ├── backend/browserBackend.ts           ← per-id _browserSessions map + lazy CDP resolver
│       ├── mcp/
│       │   ├── config.d.ts                     ← browser.explicitBrowser flag
│       │   ├── config.ts                       ← populate explicitBrowser from CLI
│       │   ├── index.ts                        ← createConnection skips local launch in dynamic CDP mode
│       │   └── program.ts                      ← CLI factory skips local launch in dynamic CDP mode
│       └── utils/mcp/tool.ts                   ← adds browserSession to every tool's input schema
├── scripts/
│   ├── build-pw-core.js                        ← esbuild pipeline → lib/utilsBundle.js + lib/coreBundle.js
│   ├── postinstall.js                          ← runs on `npm install`: subtree deps + generate_injected + build
│   ├── direct-mcp-multi-cdp-check.mjs          ← end-to-end multi-CDP validation
│   └── agent-sdk-cdp-session-check.mjs         ← OpenAI Agents SDK validation
├── cli.js                                      ← require('./playwright/.../lib/utilsBundle' + 'coreBundle')
├── index.js                                    ← programmatic API (createConnection)
└── update-readme.js                            ← reads the local bundle for tool metadata
```

### First-time setup

Already covered under "Option B — Clone this repo": `git clone` + `npm install`. The `postinstall` hook handles everything.

### Rebuilding after editing TS source

```bash
npm run build:pw        # esbuild → lib/utilsBundle.js + lib/coreBundle.js (seconds)
node cli.js --help      # smoke test
node scripts/direct-mcp-multi-cdp-check.mjs   # end-to-end multi-CDP test → DIRECT_MULTI_CDP_OK
```

Want watch mode? See `scripts/build-pw-core.js` — it uses esbuild directly, so wrapping it with `esbuild.context()` for incremental rebuilds is straightforward.

### What this fork changes vs upstream

Six TypeScript files under `playwright/packages/playwright-core/src/tools/`:

| File | Change |
|---|---|
| `utils/mcp/tool.ts` | Adds the optional `browserSession` property to every tool's input schema. |
| `mcp/config.d.ts` | Declares `browser.explicitBrowser` on the `Config` type. |
| `mcp/config.ts` | Populates `explicitBrowser` from `cliOptions.browser`. |
| `backend/browserBackend.ts` | Adds a per-id `_browserSessions` map + `_contextForBrowserSession()` resolver; the default context is now optional and lazily supplied via `browserSession.cdpEndpoint`. |
| `mcp/index.ts` | `createConnection` no longer launches a local browser when in dynamic CDP mode. |
| `mcp/program.ts` | CLI factory skips local browser launch in dynamic CDP mode; tolerates undefined `browserContext` on dispose. |

To see the exact diff against the pinned upstream commit:

```bash
git log --oneline -- playwright/packages/playwright-core/src/tools
git show <commit> -- playwright/packages/playwright-core/src/tools/backend/browserBackend.ts
```

### Upgrading the playwright subtree

```bash
# 1. Fetch upstream into the subtree (use --squash to avoid pulling full history)
git subtree pull --prefix=playwright https://github.com/microsoft/playwright.git <commit-or-tag>

# 2. If conflicts arise in the 6 files above, resolve them manually.
#    The fork's changes are concentrated and well-commented.

# 3. Rebuild and verify
npm install                                          # re-runs postinstall → rebuild
node scripts/direct-mcp-multi-cdp-check.mjs          # should print DIRECT_MULTI_CDP_OK
```

If the upstream changed MCP code significantly, expect to spend a few minutes re-applying the six edits. Each file has clear `dynamic CDP` markers in its diff.

### Running tests

```bash
npm run lint                                   # updates README tool listings from the bundle
node scripts/direct-mcp-multi-cdp-check.mjs    # 4 CDP browsers, session isolation check
OPENAI_API_KEY=... node scripts/agent-sdk-cdp-session-check.mjs   # OpenAI Agents SDK path
```

The Playwright monorepo inside `playwright/` has its own test suites (`npm --prefix playwright test-mcp`); this fork does not run those by default.

### Publishing a new npm version

The published `@dingmenghua/playwright-mcp-cdp-session` package wraps `cli.js` + `index.js` + the built bundles. Before publishing:

```bash
npm install                 # ensure lib/ is up to date
npm pack --dry-run          # inspect tarball contents
npm version                 # bump version (npm doesn't allow overwriting published versions)
npm publish --access public
```

After publishing, verify from a clean directory:

```bash
tmpdir=$(mktemp -d) && cd "$tmpdir"
npm init -y
npm install @dingmenghua/playwright-mcp-cdp-session@latest
./node_modules/.bin/playwright-mcp-cdp --help
```

---

## About this fork

- **Upstream:** [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — full server options, configuration file schema, tools, Docker setup, programmatic usage.
- **Subtree source:** [microsoft/playwright](https://github.com/microsoft/playwright) pinned at the commit listed in `playwright/.git` (`9ec5d7fd` at time of writing).
- **Published npm package:** [`@dingmenghua/playwright-mcp-cdp-session`](https://www.npmjs.com/package/@dingmenghua/playwright-mcp-cdp-session)

## Security

Playwright MCP is **not** a security boundary. See [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) for guidance on securing your deployment.
