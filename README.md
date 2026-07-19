# Playwright MCP — Dynamic CDP Sessions Fork

A [Model Context Protocol](https://modelcontextprotocol.io) server that provides browser automation capabilities using [Playwright](https://playwright.dev). This fork is published as [`@dingmenghua/playwright-mcp-cdp-session`](https://www.npmjs.com/package/@dingmenghua/playwright-mcp-cdp-session) and adds a per-call `browserSession` argument so one MCP server can control multiple CDP endpoints simultaneously.

> **📖 For full setup, examples, and validation scripts, see [Dynamic CDP Browser Sessions](docs/dynamic-cdp-sessions.md).** That document is the primary reference for this fork.

## Quick start

```bash
npx @dingmenghua/playwright-mcp-cdp-session@latest
```

By default (no `--cdp-endpoint`/`--endpoint`/`--extension`, and no explicit `--browser`/`--executable-path`) the server starts in **dynamic CDP mode**: it does not launch a local browser and waits for `browserSession.cdpEndpoint` in each tool call. Pass `--browser=chrome` (or `--executable-path`) to opt into the legacy local-browser launch flow.

First call for a session must include `cdpEndpoint`; later calls reuse the session by id:

```json
{ "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" } }
{ "browserSession": { "id": "chrome-a" } }
```

## Development

This fork edits the Playwright MCP source directly instead of patching the
published bundle. The vendored Playwright monorepo lives in
`playwright-src/` (a shallow clone pinned to the commit that matches
`playwright-core` in `package.json`). It is `.gitignore`d — every clone needs
to materialize it locally:

```bash
# 1. Clone this repo, then fetch the pinned Playwright commit:
git clone https://github.com/yx4724201000subg/playwright-cdp-mcp.git
cd playwright-cdp-mcp
mkdir -p playwright-src
git -C playwright-src init
git -C playwright-src remote add origin https://github.com/microsoft/playwright.git
git -C playwright-src fetch --depth=1 origin 9ec5d7fdb786c81ee5a4c642d8e19e7488a1fa84
git -C playwright-src checkout FETCH_HEAD

# 2. Install dependencies (this repo + playwright monorepo devDeps):
npm install --no-audit --no-fund --ignore-scripts
npm install --no-audit --no-fund --ignore-scripts --prefix playwright-src

# 3. Regenerate injected script sources, then build the bundles:
node playwright-src/utils/generate_injected.js
npm run build:pw
```

Source edits go into `playwright-src/packages/playwright-core/src/` directly
(no string-replacement patches). `npm run build:pw` rebuilds only
`utilsBundle.js` + `coreBundle.js` via esbuild — the two bundles this fork
actually ships. `index.js` and `cli.js` load those bundles via relative paths.

### MCP client configuration

Standard config (drop this into your MCP client's server settings):

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

This package is a drop-in replacement for upstream `@playwright/mcp`, so it works with any MCP-compatible client (VS Code, Cursor, Claude Desktop, Codex, Goose, etc.). Refer to your client's MCP documentation for where to place the config above.

## About this fork

Upstream `@playwright/mcp` accepts a single static CDP endpoint at server startup. That is not enough when one long-running MCP server must control multiple browsers. This fork adds an optional `browserSession` argument to every browser MCP tool:

```json
{
  "browserSession": { "id": "chrome-a", "cdpEndpoint": "http://localhost:9222" }
}
```

Internally the MCP server keeps a map from session id to CDP browser/context. Each session has its own current tab state, so calls for different CDP endpoints do not overwrite each other.

See **[docs/dynamic-cdp-sessions.md](docs/dynamic-cdp-sessions.md)** for:

- Browser startup with `--remote-debugging-port`
- Tool-call examples (navigate, snapshot, click across multiple browsers)
- Agent prompt guidance
- OpenAI Agents SDK integration
- Validation scripts

## Upstream

This is a fork of [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp). For the full list of server options, configuration file schema, tools, Docker setup, and programmatic usage, see the upstream repository.

## Security

Playwright MCP is **not** a security boundary. See [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) for guidance on securing your deployment.
