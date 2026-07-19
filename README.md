# Playwright MCP — Dynamic CDP Sessions Fork

A [Model Context Protocol](https://modelcontextprotocol.io) server that provides browser automation capabilities using [Playwright](https://playwright.dev). This fork adds a per-call `browserSession` argument so **one MCP server can control multiple CDP endpoints simultaneously** — something upstream `@playwright/mcp` does not support.

> **Why?** Upstream takes a single static CDP endpoint at server startup. That breaks down the moment one long-running MCP server must drive several browsers (e.g. parallel agent workers, multi-account automation, cross-browser testing).

```json
{ "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" } }
{ "browserSession": { "id": "chrome-a" } }
```

Each session can also tunnel through a SOCKS5/SOCKS4/HTTP proxy — handy when the CDP browser is reachable only via a bastion host:

```json
{ "browserSession": {
    "id": "remote-a",
    "cdpEndpoint": "http://10.0.0.5:9222",
    "proxy": { "server": "socks5://user:pass@bastion.example.com:1080" }
} }
```

---

## For Users

Clone and install — that's it:

```bash
git clone https://github.com/yx4724201000subg/playwright-cdp-mcp.git
cd playwright-cdp-mcp
npm install
```

`npm install` automatically:

1. Installs the vendored playwright subtree's devDependencies (esbuild, ws, zod, …).
2. Regenerates injected script sources.
3. Builds `lib/utilsBundle.js` + `lib/coreBundle.js` via esbuild (~30 s).

Then point your MCP client at the local CLI:

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

Works with any MCP-compatible client (VS Code, Cursor, Claude Desktop, Codex, Goose, …). Refer to your client's MCP documentation for where to place the config above.

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

### Per-session proxy

Each session can independently tunnel its CDP traffic through a proxy. Supported schemes: `socks5`, `socks5h`, `socks4`, `socks4a`, `http`, `https`. Credentials may live in the URL or in `username`/`password`.

```json
{ "browserSession": {
    "id": "remote-a",
    "cdpEndpoint": "http://10.0.0.5:9222",
    "proxy": { "server": "socks5://user:pass@bastion.example.com:1080" }
} }
{ "browserSession": { "id": "remote-a" } }
```

Both the HTTP `/json/version` probe and the WebSocket upgrade go through the proxy. This is implemented natively on top of Playwright's existing `createProxyAgent` — no new dependencies, no local TCP forwarder hack.

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

Files under `playwright/packages/playwright-core/src/`:

| File | Change |
|---|---|
| `tools/utils/mcp/tool.ts` | Adds the optional `browserSession` property (with `id` / `cdpEndpoint` / `proxy`) to every tool's input schema. |
| `tools/mcp/config.d.ts` | Declares `browser.explicitBrowser` on the `Config` type. |
| `tools/mcp/config.ts` | Populates `explicitBrowser` from `cliOptions.browser`. |
| `tools/backend/browserBackend.ts` | Adds a per-id `_browserSessions` map + `_contextForBrowserSession()` resolver; passes `browserSession.proxy` through to `connectOverCDP`. |
| `tools/mcp/index.ts` | `createConnection` no longer launches a local browser when in dynamic CDP mode. |
| `tools/mcp/program.ts` | CLI factory skips local browser launch in dynamic CDP mode; tolerates undefined `browserContext` on dispose. |
| `server/transport.ts` | `WebSocketTransportOptions` gains an optional `agent` field, used for the underlying `ws` upgrade. |
| `server/chromium/chromium.ts` | `_connectOverCDPInternal` + `urlToWSEndpoint` consult `options.proxy` via `createProxyAgent` and thread the agent through both the HTTP probe and the WebSocket transport. |
| `server/browserType.ts` | `connectOverCDP` base signature accepts a `proxy` option. |
| `client/browserType.ts` | `_connectOverCDP` forwards `params.proxy` through the channel. |
| `types/types.d.ts` | Public `ConnectOverCDPOptions` declares the new `proxy` field. |
| `utils/network.ts` (in `packages/utils`) | `HTTPRequestParams` gains an optional `agent` field; `httpRequest` prefers it over `proxy-from-env`. |

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

---

## About this fork

- **Upstream:** [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) — full server options, configuration file schema, tools, Docker setup, programmatic usage.
- **Subtree source:** [microsoft/playwright](https://github.com/microsoft/playwright) pinned at the commit listed in `playwright/.git` (`9ec5d7fd` at time of writing).

## Security

Playwright MCP is **not** a security boundary. See [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) for guidance on securing your deployment.
