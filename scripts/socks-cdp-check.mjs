#!/usr/bin/env node
/**
 * End-to-end validation for SOCKS-proxied CDP sessions.
 *
 * Boots a tiny SOCKS5 server on a random localhost port that forwards
 * to the real CDP browser port, then drives the MCP server with
 * `browserSession.proxy = { server: 'socks5://127.0.0.1:<socksPort>' }`
 * and verifies snapshots work end-to-end.
 */

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
  const context = await chromium.launchPersistentContext(`/tmp/pw-mcp-socks-${label}`, {
    headless: true,
    args: [`--remote-debugging-port=${port}`],
  });
  return { context, port };
}

function startSocks5Server() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => {
      let phase = 'greeting';
      let remaining = Buffer.alloc(0);

      const handle = data => {
        if (phase === 'greeting') {
          if (data.length < 2 || data[0] !== 0x05)
            return socket.destroy();
          socket.write(Buffer.from([0x05, 0x00]));
          phase = 'request';
          return;
        }
        if (phase === 'request') {
          if (data.length < 4 || data[0] !== 0x05 || data[1] !== 0x01)
            return socket.destroy();
          const atyp = data[3];
          let host;
          let portOffset;
          if (atyp === 0x01) {
            host = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
            portOffset = 8;
          } else if (atyp === 0x03) {
            const len = data[4];
            host = data.slice(5, 5 + len).toString();
            portOffset = 5 + len;
          } else if (atyp === 0x04) {
            const parts = [];
            for (let i = 0; i < 16; i++) parts.push(data[4 + i].toString(16));
            host = parts.join(':');
            portOffset = 20;
          } else {
            return socket.destroy();
          }
          const port = data.readUInt16BE(portOffset);

          const upstream = net.connect(port, host);
          upstream.on('error', () => socket.destroy());
          upstream.on('connect', () => {
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            socket.pipe(upstream);
            upstream.pipe(socket);
            socket.removeListener('data', handle);
          });
          return;
        }
      };
      socket.on('data', handle);
      socket.on('error', () => socket.destroy());
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function textOf(result) {
  return result.content?.map(item => item.text ?? '').join('\n') ?? '';
}

const browser = await launchCdpBrowser('socks');
const socksServer = await startSocks5Server();
const socksPort = socksServer.address().port;
const cdpViaProxy = `http://127.0.0.1:${browser.port}`;
const proxyUrl = `socks5://127.0.0.1:${socksPort}`;

console.log(`[socks-check] SOCKS5 server on ${socksPort}, forwarding to CDP port ${browser.port}`);

const transport = new StdioClientTransport({
  command: 'node',
  args: ['cli.js', '--headless'],
  cwd: repoRoot,
  stderr: 'pipe',
});
const client = new Client({ name: 'socks-cdp-check', version: '1.0.0' });

try {
  await client.connect(transport);

  const marker = 'SOCKS_CDP_OK';
  await client.callTool({
    name: 'browser_navigate',
    arguments: {
      browserSession: {
        id: 'via-socks',
        cdpEndpoint: cdpViaProxy,
        proxy: { server: proxyUrl },
      },
      url: `data:text/html,<title>socks</title><main><h1>${marker}</h1></main>`,
    },
  });

  const snapshot = await client.callTool({
    name: 'browser_snapshot',
    arguments: { browserSession: { id: 'via-socks' } },
  });

  const text = textOf(snapshot);
  if (!text.includes(marker))
    throw new Error(`Snapshot did not contain marker "${marker}": ${text.slice(0, 500)}`);

  console.log('SOCKS_CDP_OK');
} finally {
  await client.close().catch(() => {});
  socksServer.close();
  await browser.context.close().catch(() => {});
}
