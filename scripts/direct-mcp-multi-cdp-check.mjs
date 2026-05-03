#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
  const context = await chromium.launchPersistentContext(`/tmp/pw-mcp-direct-${label}`, {
    channel: 'chrome',
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  return { context, endpoint: `http://localhost:${port}` };
}

function textOf(result) {
  return result.content?.map(item => item.text ?? '').join('\n') ?? '';
}

const sessions = [
  { label: 'a', id: 'direct-a', text: 'Direct browser A' },
  { label: 'b', id: 'direct-b', text: 'Direct browser B' },
  { label: 'c', id: 'direct-c', text: 'Direct browser C' },
  { label: 'd', id: 'direct-d', text: 'Direct browser D' },
];

for (const session of sessions)
  Object.assign(session, await launchCdpBrowser(session.label));

const transport = new StdioClientTransport({
  command: 'node',
  args: ['cli.js', '--headless'],
  cwd: repoRoot,
  stderr: 'pipe',
});
const client = new Client({ name: 'direct-multi-cdp-check', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const navigate = tools.tools.find(tool => tool.name === 'browser_navigate');
  if (!navigate?.inputSchema?.properties?.browserSession)
    throw new Error('browserSession schema missing');

  for (const session of sessions) {
    await client.callTool({
      name: 'browser_navigate',
      arguments: {
        browserSession: { id: session.id, cdpEndpoint: session.endpoint },
        url: `data:text/html,<title>${session.label}</title><main><h1>${session.text}</h1></main>`,
      },
    });
  }

  const snapshotOrder = [sessions[2], sessions[0], sessions[3], sessions[1], sessions[0], sessions[2]];
  for (const session of snapshotOrder) {
    const result = await client.callTool({
      name: 'browser_snapshot',
      arguments: {
        browserSession: { id: session.id },
      },
    });
    const text = textOf(result);
    if (!text.includes(session.text))
      throw new Error(`Snapshot for ${session.id} did not include ${session.text}: ${text.slice(0, 500)}`);
    for (const other of sessions) {
      if (other !== session && text.includes(other.text))
        throw new Error(`Snapshot for ${session.id} leaked content from ${other.id}`);
    }
  }

  console.log('DIRECT_MULTI_CDP_OK');
} finally {
  await client.close().catch(() => {});
  for (const session of sessions)
    await session.context.close().catch(() => {});
}
