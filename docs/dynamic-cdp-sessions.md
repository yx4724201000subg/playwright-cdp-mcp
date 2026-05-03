# Dynamic CDP Browser Sessions

This fork publishes a patched Playwright MCP package that lets one MCP server control multiple Chromium browsers over different CDP endpoints.

Published package:

```bash
npx @dingmenghua/playwright-mcp-cdp-session@latest
```

The current published version is:

```text
@dingmenghua/playwright-mcp-cdp-session@0.0.73-cdp.1
```

## What Changed

Upstream `@playwright/mcp` accepts one CDP endpoint at server startup:

```bash
npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

That is static. It is not enough when one long-running MCP server must control multiple browsers.

This fork adds an optional `browserSession` argument to every browser MCP tool:

```json
{
  "browserSession": {
    "id": "chrome-a",
    "cdpEndpoint": "http://localhost:9222"
  }
}
```

The first call for a session id must include `cdpEndpoint`. Later calls can reuse the same browser by passing only the id:

```json
{
  "browserSession": {
    "id": "chrome-a"
  }
}
```

Internally the MCP server keeps a map from session id to CDP browser/context. Each session has its own current tab state, so calls for different CDP endpoints do not overwrite each other.

## MCP Client Configuration

Use this package instead of upstream `@playwright/mcp`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@dingmenghua/playwright-mcp-cdp-session@latest"
      ]
    }
  }
}
```

For clients that require `-y`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y",
        "@dingmenghua/playwright-mcp-cdp-session@latest"
      ]
    }
  }
}
```

You can still pass normal Playwright MCP startup options:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@dingmenghua/playwright-mcp-cdp-session@latest",
        "--headless"
      ]
    }
  }
}
```

Do not pass `--cdp-endpoint` if you want dynamic per-call endpoints. Use `browserSession.cdpEndpoint` in tool calls instead.

## Tool Call Examples

First call to browser A:

```json
{
  "name": "browser_navigate",
  "arguments": {
    "browserSession": {
      "id": "chrome-a",
      "cdpEndpoint": "http://localhost:9222"
    },
    "url": "https://example.com"
  }
}
```

First call to browser B:

```json
{
  "name": "browser_navigate",
  "arguments": {
    "browserSession": {
      "id": "chrome-b",
      "cdpEndpoint": "http://localhost:9223"
    },
    "url": "https://playwright.dev"
  }
}
```

Later call to browser A:

```json
{
  "name": "browser_snapshot",
  "arguments": {
    "browserSession": {
      "id": "chrome-a"
    }
  }
}
```

Later call to browser B:

```json
{
  "name": "browser_click",
  "arguments": {
    "browserSession": {
      "id": "chrome-b"
    },
    "element": "Search",
    "target": "button[type=submit]"
  }
}
```

## Starting Browsers With CDP

Each Chromium browser must be started with a distinct remote debugging port:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-a
google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-b
```

Then use these endpoints in MCP calls:

```text
http://localhost:9222
http://localhost:9223
```

Only Chromium-family browsers support CDP. Firefox and WebKit are not supported for this dynamic CDP mode.

## Agent Prompt Guidance

When using an LLM agent, make the target browser explicit:

```text
Use browserSession id "chrome-a" for http://localhost:9222.
Use browserSession id "chrome-b" for http://localhost:9223.
Always include browserSession in Playwright MCP tool calls.
On the first call for each id, include cdpEndpoint. Later calls may pass only id.
```

This avoids accidental calls to the default browser context.

## Validation Scripts

This repo includes two validation scripts.

Direct MCP multi-CDP test:

```bash
node scripts/direct-mcp-multi-cdp-check.mjs
```

This starts four CDP browsers, calls the MCP tools directly, and verifies snapshots do not leak content across sessions.

OpenAI Agents SDK test:

```bash
OPENAI_API_KEY=... node scripts/agent-sdk-cdp-session-check.mjs
```

Or with a local `.env` file:

```bash
node --env-file=.env scripts/agent-sdk-cdp-session-check.mjs
```

This starts three CDP browsers and lets an OpenAI Agent call the patched Playwright MCP server. A successful run prints:

```text
AGENT_CDP_SESSION_OK
```

## Publishing Notes

The package is a lightweight wrapper around upstream Playwright MCP. The implementation patch is applied during install through:

```text
postinstall -> node patches/patch-playwright-core-mcp-browser-session.js
```

The patch modifies `playwright-core/lib/coreBundle.js` after dependencies are installed. This is intentionally pragmatic for private/self-use distribution. If upstream changes the bundled implementation, the patch script may need to be updated.

Before publishing a new version:

```bash
npm pack --dry-run
npm publish --access public
```

After publishing, verify install from npm:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm init -y
npm install @dingmenghua/playwright-mcp-cdp-session@latest
node node_modules/@dingmenghua/playwright-mcp-cdp-session/cli.js --help
```

NPM does not allow overwriting an already published version. Bump the suffix for fixes:

```text
0.0.73-cdp.1
0.0.73-cdp.2
```

Use an npm token with package write permission and `bypass_2fa: true` for server-side publishing.
