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

This fork vendors the Playwright monorepo via `git subtree` into the
`playwright/` directory and edits the MCP TypeScript sources directly.
No string-replacement patches against published bundles — every change
lives as TypeScript source under
`playwright/packages/playwright-core/src/`.

### First-time setup

Just clone and install:

```bash
git clone https://github.com/yx4724201000subg/playwright-cdp-mcp.git
cd playwright-cdp-mcp
npm install
```

`npm install` triggers a `postinstall` script that:

1. Installs the playwright subtree's devDependencies (esbuild, ws, zod, …)
   into `playwright/node_modules/`.
2. Regenerates the injected script sources
   (`packages/playwright-core/src/generated/*Source.ts`).
3. Builds `lib/utilsBundle.js` + `lib/coreBundle.js` via esbuild.

The bundles land in `playwright/packages/playwright-core/lib/`, which is
`.gitignore`d. `cli.js`, `index.js`, and `update-readme.js` load them via
relative paths.

### Editing MCP source

Make changes under `playwright/packages/playwright-core/src/`, then rebuild:

```bash
npm run build:pw        # rebuilds utilsBundle.js + coreBundle.js
node cli.js --help      # smoke test
node scripts/direct-mcp-multi-cdp-check.mjs   # end-to-end multi-CDP test
```

The TS changes this fork maintains vs upstream `microsoft/playwright`:

- `src/tools/utils/mcp/tool.ts` — adds `browserSession` to every tool's input schema.
- `src/tools/mcp/config.d.ts` + `config.ts` — adds `browser.explicitBrowser` flag.
- `src/tools/backend/browserBackend.ts` — adds the `_browserSessions` map + lazy CDP resolver.
- `src/tools/mcp/index.ts` — `createConnection` skips local launch in dynamic CDP mode.
- `src/tools/mcp/program.ts` — CLI factory skips local launch in dynamic CDP mode.

### Upgrading the playwright subtree

```bash
# Fetch upstream changes into the subtree
git subtree pull --prefix=playwright https://github.com/microsoft/playwright.git <commit-or-tag> --squash
# Re-apply the TS edits above if the upstream touched the same files.
npm install            # re-runs postinstall → rebuild
```

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
