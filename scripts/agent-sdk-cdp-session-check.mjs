#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

import { Agent, MCPServerStdio, run } from '@openai/agents';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function launchCdpBrowser(label) {
  const port = await freePort();
  const context = await chromium.launchPersistentContext(`/tmp/pw-mcp-agent-${label}`, {
    channel: 'chrome',
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  return { context, endpoint: `http://localhost:${port}` };
}

const browsers = [
  { label: 'a', sessionId: 'chrome-a', expectedText: 'Agent browser A' },
  { label: 'b', sessionId: 'chrome-b', expectedText: 'Agent browser B' },
  { label: 'c', sessionId: 'chrome-c', expectedText: 'Agent browser C' },
];

for (const browser of browsers)
  Object.assign(browser, await launchCdpBrowser(browser.label));

const mcpServer = new MCPServerStdio({
  name: 'patched-playwright',
  command: 'node',
  args: ['cli.js', '--headless'],
  cwd: repoRoot,
  env: process.env,
  cacheToolsList: false,
});

try {
  await mcpServer.connect();
  const tools = await mcpServer.listTools();
  const navigate = tools.find(tool => tool.name === 'browser_navigate');
  if (!navigate?.inputSchema?.properties?.browserSession)
    throw new Error('browserSession is missing from browser_navigate schema');

  console.log('MCP_SCHEMA_OK');
  for (const browser of browsers)
    console.log(`CDP_${browser.label.toUpperCase()}=${browser.endpoint}`);

  if (!process.env.OPENAI_API_KEY) {
    console.log('OPENAI_API_KEY is not set; skipped live Agent run.');
    process.exitCode = 2;
  } else {
    const agent = new Agent({
      name: 'Playwright CDP Session Checker',
      instructions: [
        'Use the patched Playwright MCP tools.',
        'Always include browserSession when calling browser tools.',
        ...browsers.map(browser => `For browser ${browser.label.toUpperCase()} use browserSession id "${browser.sessionId}" and cdpEndpoint "${browser.endpoint}" on its first call.`),
        ...browsers.map(browser => `Navigate browser ${browser.label.toUpperCase()} to a data URL containing the exact text "${browser.expectedText}".`),
        'Perform the work in an interleaved order: first A, then B, then A snapshot, then C, then B snapshot, then C snapshot.',
        'When taking snapshots after the initial navigation, reuse only the browserSession id without cdpEndpoint.',
        'Finish with the exact text AGENT_CDP_SESSION_OK if all three snapshots show their expected text and no browser content is mixed.',
      ].join('\n'),
      mcpServers: [mcpServer],
    });

    const result = await run(agent, 'Verify that one MCP server can control two CDP browser sessions at once.');
    console.log(result.finalOutput);
  }
} finally {
  await mcpServer.close().catch(() => {});
  for (const browser of browsers)
    await browser.context.close().catch(() => {});
}
