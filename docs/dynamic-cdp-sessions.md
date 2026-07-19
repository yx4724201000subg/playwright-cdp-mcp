# Dynamic CDP Browser Sessions

This fork of `@playwright/mcp` lets one MCP server control multiple Chromium browsers over different CDP endpoints. It works by adding an optional `browserSession` argument to every browser MCP tool.

By default (when no `--cdp-endpoint`, `--endpoint`, or `--extension` is configured, and no `--browser`/`--executable-path` is explicitly requested) the server starts in **dynamic CDP mode**: it does not launch a local Chrome/Chromium and waits for per-call `browserSession.cdpEndpoint` values, connecting lazily when the first tool call for that session arrives.

To opt into the legacy local-browser launch flow instead, pass `--browser` (e.g. `--browser=chrome`) or `--executable-path`. A local Chrome/Chromium is only launched in that case.

## Install

Two ways to use this fork:

### Published npm package

```bash
npx @dingmenghua/playwright-mcp-cdp-session@latest
```

Current published version:

```text
@dingmenghua/playwright-mcp-cdp-session@0.0.73-cdp.4
```

### Clone this repo

```bash
git clone https://github.com/yx4724201000subg/playwright-cdp-mcp.git
cd playwright-cdp-mcp
npm install          # postinstall auto-builds lib/coreBundle.js
```

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

See [README.md](../README.md) for the full developer guide.

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

If the server was started in dynamic CDP mode (the default when no remote/extension/local-browser option is configured) and a tool call omits `browserSession`, the call will fail with an explicit error telling the client to provide `browserSession.id` and `browserSession.cdpEndpoint`.

## MCP Client Configuration

Use this package instead of upstream `@playwright/mcp`:

For dynamic CDP usage, keep the MCP server startup config minimal. Do not pass `--browser`, `--cdp-endpoint`, or `--executable-path` — the server defaults to dynamic CDP mode and waits for `browserSession.cdpEndpoint` in tool calls. `--headless` is harmless but has no effect in this mode (the headed/headless state is determined by the externally launched CDP browsers).

Temporary/simple configuration:

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "npx",
      "args": [
        "-y",
        "@dingmenghua/playwright-mcp-cdp-session@latest"
      ]
    }
  }
}
```

This requires no pre-install step. It is convenient for quick setup, but the first startup may be slower because `npx` can download and install the package before the MCP server starts.

Codex CLI add command:

```bash
codex mcp add playwright-cdp -- npx -y @dingmenghua/playwright-mcp-cdp-session@latest
```

Optional prewarm command for machines that use the `npx` configuration:

```bash
npx -y @dingmenghua/playwright-mcp-cdp-session@latest --help
```

Codex config template:

```toml
[mcp_servers.playwright-cdp]
command = "npx"
args = ["-y", "@dingmenghua/playwright-mcp-cdp-session@latest"]
```

If you installed the package globally, use this Codex config instead:

```toml
[mcp_servers.playwright-cdp]
command = "playwright-mcp-cdp"
args = []
```

Minimal `npx` configuration:

```json
{
  "mcpServers": {
    "playwright-cdp": {
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
    "playwright-cdp": {
      "command": "npx",
      "args": [
        "-y",
        "@dingmenghua/playwright-mcp-cdp-session@latest"
      ]
    }
  }
}
```

You can still pass normal Playwright MCP startup options (e.g. `--port` for HTTP transport). Dynamic CDP mode is the default as long as you do not pass `--browser`, `--cdp-endpoint`, `--endpoint`, `--extension`, or `--executable-path`:

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "npx",
      "args": [
        "@dingmenghua/playwright-mcp-cdp-session@latest"
      ]
    }
  }
}
```

Do not pass `--cdp-endpoint` if you want dynamic per-call endpoints. Use `browserSession.cdpEndpoint` in tool calls instead. Pass `--browser=chrome` (or `--executable-path`) only if you want the legacy local-browser launch flow instead of dynamic CDP.

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

These browsers are external to the MCP server. The MCP server itself does not need Chrome/Chromium installed locally if all browser access is done through remote CDP endpoints.

## Agent Prompt Guidance

When using an LLM agent, make the target browser explicit:

```text
Use browserSession id "chrome-a" for http://localhost:9222.
Use browserSession id "chrome-b" for http://localhost:9223.
Always include browserSession in Playwright MCP tool calls.
On the first call for each id, include cdpEndpoint. Later calls may pass only id.
```

This avoids accidental calls to the default browser context.

If you want to be strict, instruct the agent to never call Playwright MCP tools without `browserSession`.

## OpenAI Agents SDK Integration

When using `@openai/agents`, configure the MCP server with `MCPServerStdio`.

`npx` may take more than the default MCP request timeout on its first run because it has to resolve, download, install, and run the package. Set `clientSessionTimeoutSeconds` high enough for cold starts. A value around 120 seconds is a practical default for server environments.

```js
import { Agent, MCPServerStdio, run } from '@openai/agents';

const playwrightMcp = new MCPServerStdio({
  name: 'playwright-cdp-session',
  command: 'npx',
  args: ['-y', '@dingmenghua/playwright-mcp-cdp-session@latest'],
  clientSessionTimeoutSeconds: 120,
  cacheToolsList: false,
});

await playwrightMcp.connect();

const agent = new Agent({
  name: 'Browser agent',
  instructions: [
    'Always include browserSession when calling Playwright MCP tools.',
    'On the first call for a session id, include cdpEndpoint.',
    'On later calls, pass only browserSession.id.',
  ].join('\n'),
  mcpServers: [playwrightMcp],
});

const result = await run(agent, 'Use browserSession id "chrome-a" with CDP endpoint http://localhost:9222.');
console.log(result.finalOutput);

await playwrightMcp.close();
```

If you do not increase the timeout, cold `npx` starts can fail with an MCP timeout similar to:

```text
MCP error -32001: Request timed out
```

You can also prewarm the package on a host:

```bash
npx -y @dingmenghua/playwright-mcp-cdp-session@latest --help
```

For long-running servers, prefer installing the package ahead of time instead of relying on `npx @latest` during MCP startup.

Global install:

```bash
npm install -g @dingmenghua/playwright-mcp-cdp-session@latest
```

MCP config after global install:

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "playwright-mcp-cdp",
      "args": []
    }
  }
}
```

Project-local install:

```bash
npm install @dingmenghua/playwright-mcp-cdp-session@latest
```

MCP config after local install:

```json
{
  "mcpServers": {
    "playwright-cdp": {
      "command": "node",
      "args": [
        "node_modules/@dingmenghua/playwright-mcp-cdp-session/cli.js"
      ]
    }
  }
}
```

Installed-package startup avoids the `npx` cold-start download path and is more predictable in production.

## Validation Scripts

This repo includes two validation scripts.

`mcp2cli` smoke test:

```bash
mcp2cli --mcp-stdio "node cli.js" --list
mcp2cli --mcp-stdio "node cli.js" browser-navigate --help
mcp2cli --pretty --mcp-stdio "node cli.js" browser-snapshot --browser-session '{"id":"demo"}'
```

Expected signs of success:

```text
--browser-session BROWSER_SESSION
Error: browserSession "demo" does not exist yet; provide "browserSession.cdpEndpoint" on the first call.
```

Those results show that the MCP server started successfully without requiring a local Chrome/Chromium and reached the dynamic CDP session logic.

You can also intentionally verify the dynamic connect path with an invalid endpoint:

```bash
printf '%s\n' '{"url":"https://example.com","browserSession":{"id":"demo","cdpEndpoint":"http://127.0.0.1:65535"}}' | mcp2cli --pretty --mcp-stdio "node cli.js" browser-navigate --stdin
```

Expected result is a CDP connection error such as `ECONNREFUSED`, not a local browser installation error.

Note that `mcp2cli --mcp-stdio "node cli.js" ...` starts a fresh MCP server process for each command invocation. That makes it a good smoke test for startup behavior and first-call dynamic CDP connection, but not for reusing an in-memory `browserSession` across separate shell commands.

To validate session reuse within one long-running MCP server process, use the direct validation script below.

`mcp2cli` persistent-session example:

```bash
mcp2cli --mcp-stdio "node cli.js" --session-start pwcdp
mcp2cli --session-list

printf '%s\n' '{"url":"data:text/html,<title>persist</title><main><h1>PERSIST_OK</h1></main>","browserSession":{"id":"demo","cdpEndpoint":"http://127.0.0.1:9222"}}' | mcp2cli --session pwcdp browser-navigate --stdin

mcp2cli --session pwcdp browser-snapshot --browser-session '{"id":"demo"}'

mcp2cli --session-stop pwcdp
```

In that mode, `mcp2cli` keeps a long-running MCP client session alive in the background, so later commands can reuse the same in-memory `browserSession` id.

Direct MCP multi-CDP test:

```bash
node scripts/direct-mcp-multi-cdp-check.mjs
```

This starts four CDP browsers with Playwright's bundled Chromium, calls the MCP tools directly, and verifies snapshots do not leak content across sessions.

OpenAI Agents SDK test:

```bash
OPENAI_API_KEY=... node scripts/agent-sdk-cdp-session-check.mjs
```

Or with a local `.env` file:

```bash
node --env-file=.env scripts/agent-sdk-cdp-session-check.mjs
```

This starts three CDP browsers with Playwright's bundled Chromium and lets an OpenAI Agent call the fork's Playwright MCP server. A successful run prints:

```text
AGENT_CDP_SESSION_OK
```

## Publishing Notes

This fork vendors the Playwright monorepo via `git subtree` into `playwright/` and edits the MCP TypeScript sources directly. No string-replacement patches against published bundles — every change lives as TypeScript source under `playwright/packages/playwright-core/src/tools/`.

On install, the `postinstall` hook:

1. Installs the playwright subtree's devDependencies (esbuild, ws, zod, …).
2. Regenerates the injected script sources.
3. Builds `lib/utilsBundle.js` + `lib/coreBundle.js` via esbuild.

Before publishing a new version:

```bash
npm install           # ensure lib/ is up to date
npm pack --dry-run    # inspect tarball contents
npm publish --access public
```

After publishing, verify install from npm:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm init -y
npm install @dingmenghua/playwright-mcp-cdp-session@latest
./node_modules/.bin/playwright-mcp-cdp --help
```

NPM does not allow overwriting an already published version. Bump the suffix for fixes:

```text
0.0.73-cdp.2
0.0.73-cdp.3
0.0.73-cdp.4
```

Use an npm token with package write permission and `bypass_2fa: true` for server-side publishing.
