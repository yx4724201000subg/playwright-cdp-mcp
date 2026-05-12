#!/usr/bin/env node
/**
 * Local self-use patch for playwright-core's bundled MCP server.
 *
 * It adds an optional `browserSession` argument to every MCP tool:
 * {
 *   browserSession: { id: "chrome-a", cdpEndpoint: "http://localhost:9222" }
 * }
 *
 * The first call for an id creates a CDP connection. Later calls can pass only
 * { browserSession: { id: "chrome-a" } } to reuse it.
 */

const fs = require('fs');
const path = require('path');

const bundlePath = require.resolve('playwright-core/lib/coreBundle');

function replaceOnce(source, from, to, label) {
  if (source.includes(to))
    return source;
  if (!source.includes(from))
    throw new Error(`Could not find patch target: ${label}`);
  return source.replace(from, to);
}

let source = fs.readFileSync(bundlePath, 'utf8');

source = replaceOnce(source, `function toMcpTool(tool) {
  const readOnly = tool.type === "readOnly" || tool.type === "assertion";
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zod.toJSONSchema(tool.inputSchema),`, `function toMcpTool(tool) {
  const readOnly = tool.type === "readOnly" || tool.type === "assertion";
  const inputSchema = zod.toJSONSchema(tool.inputSchema);
  inputSchema.properties ??= {};
  inputSchema.properties.browserSession = {
    type: "object",
    description: "Optional browser session selector. Use this to control multiple CDP browsers from one MCP server.",
    properties: {
      id: {
        type: "string",
        description: "Stable browser session id, for example \\"chrome-a\\". Reuse the same id in later calls."
      },
      cdpEndpoint: {
        type: "string",
        description: "CDP endpoint for the first call that creates this session, for example \\"http://localhost:9222\\"."
      }
    },
    required: ["id"],
    additionalProperties: false
  };
  return {
    name: tool.name,
    description: tool.description,
    inputSchema,`, 'toMcpTool browserSession schema');

source = replaceOnce(source, `      constructor(config, browserContext, tools) {
        this._config = config;
        this._tools = tools;
        this.browserContext = browserContext;
      }`, `      constructor(config, browserContext, tools) {
        this._config = config;
        this._tools = tools;
        this.browserContext = browserContext;
        this._browserSessions = /* @__PURE__ */ new Map();
      }`, 'BrowserBackend constructor');

source = replaceOnce(source, `      async initialize(clientInfo) {
        this._sessionLog = this._config.saveSession ? await SessionLog.create(this._config, clientInfo.cwd) : void 0;
        this._context = new Context(this.browserContext, {`, `      async initialize(clientInfo) {
        this._sessionLog = this._config.saveSession ? await SessionLog.create(this._config, clientInfo.cwd) : void 0;
        this._cwd = clientInfo.cwd;
        this._context = new Context(this.browserContext, {`, 'BrowserBackend initialize cwd');

source = replaceOnce(source, `        this._context = new Context(this.browserContext, {
          config: this._config,
          sessionLog: this._sessionLog,
          cwd: clientInfo.cwd
        });`, `        this._context = this.browserContext ? new Context(this.browserContext, {
          config: this._config,
          sessionLog: this._sessionLog,
          cwd: clientInfo.cwd
        }) : void 0;`, 'BrowserBackend initialize optional context');

source = replaceOnce(source, `      async dispose() {
        await this._context?.dispose().catch((e) => debug10("pw:tools:error")(e));
      }
      async callTool(name, rawArguments = {}, signal) {`, `      async dispose() {
        await this._context?.dispose().catch((e) => debug10("pw:tools:error")(e));
        for (const session of this._browserSessions.values()) {
          await session.context.dispose().catch((e) => debug10("pw:tools:error")(e));
          await session.browser.close().catch((e) => debug10("pw:tools:error")(e));
        }
        this._browserSessions.clear();
      }
      async _contextForBrowserSession(browserSession) {
        if (!browserSession)
          return this._context;
        if (typeof browserSession !== "object" || Array.isArray(browserSession))
          throw new Error('"browserSession" must be an object with an "id" field.');
        const id = browserSession.id;
        if (typeof id !== "string" || !id)
          throw new Error('"browserSession.id" must be a non-empty string.');
        let session = this._browserSessions.get(id);
        if (!session) {
          const cdpEndpoint = browserSession.cdpEndpoint;
          if (typeof cdpEndpoint !== "string" || !cdpEndpoint)
            throw new Error(\`browserSession "\${id}" does not exist yet; provide "browserSession.cdpEndpoint" on the first call.\`);
          const browser = await playwright.chromium.connectOverCDP(cdpEndpoint, {
            headers: this._config.browser.cdpHeaders,
            timeout: this._config.browser.cdpTimeout
          });
          const browserContext = browser.contexts()[0];
          if (!browserContext) {
            await browser.close().catch(() => {
            });
            throw new Error(\`CDP endpoint "\${cdpEndpoint}" did not expose a browser context.\`);
          }
          const context2 = new Context(browserContext, {
            config: this._config,
            sessionLog: this._sessionLog,
            cwd: this._cwd
          });
          session = { id, cdpEndpoint, browser, browserContext, context: context2 };
          this._browserSessions.set(id, session);
        } else if (browserSession.cdpEndpoint && browserSession.cdpEndpoint !== session.cdpEndpoint) {
          throw new Error(\`browserSession "\${id}" is already bound to \${session.cdpEndpoint}.\`);
        }
        return session.context;
      }
      async callTool(name, rawArguments = {}, signal) {`, 'BrowserBackend session manager');

source = replaceOnce(source, `        if (!tool)
          return formatError(\`Tool "\${name}" not found\`);
        const parsedArguments = tool.schema.inputSchema.parse(rawArguments);
        const cwd = rawArguments._meta?.cwd;
        const raw = !!rawArguments._meta?.raw;
        const context2 = this._context;`, `        if (!tool)
          return formatError(\`Tool "\${name}" not found\`);
        const browserSession = rawArguments.browserSession;
        const toolArguments = { ...rawArguments };
        delete toolArguments.browserSession;
        const parsedArguments = tool.schema.inputSchema.parse(toolArguments);
        const cwd = rawArguments._meta?.cwd;
        const raw = !!rawArguments._meta?.raw;
        const context2 = await this._contextForBrowserSession(browserSession);`, 'BrowserBackend callTool browserSession routing');

source = replaceOnce(source, `        if (!browserSession)
          return this._context;`, `        if (!browserSession) {
          if (this._context)
            return this._context;
          throw new Error('No default browser is available. Provide "browserSession.id" and "browserSession.cdpEndpoint" to connect to a CDP browser dynamically.');
        }`, 'BrowserBackend default context guard');

source = replaceOnce(source, `async function createConnection(userConfig = {}, contextGetter) {
  const config = await resolveConfig(userConfig);
  const tools = filteredTools(config);
  const backendFactory = {
    name: "api",
    nameInConfig: "api",
    version: packageJSON.version,
    toolSchemas: tools.map((tool) => tool.schema),
    create: async (clientInfo) => {
      const browser = contextGetter ? new SimpleBrowser(await contextGetter()) : (await createBrowserWithInfo(config, clientInfo, {})).browser;
      const context2 = config.browser.isolated ? await browser.newContext(config.browser.contextOptions) : browser.contexts()[0];
      return new BrowserBackend(config, context2, tools);
    },
    disposed: async () => {
    }
  };
  return createServer("api", packageJSON.version, backendFactory, false);
}`, `async function createConnection(userConfig = {}, contextGetter) {
  const config = await resolveConfig(userConfig);
  const tools = filteredTools(config);
  const backendFactory = {
    name: "api",
    nameInConfig: "api",
    version: packageJSON.version,
    toolSchemas: tools.map((tool) => tool.schema),
    create: async (clientInfo) => {
      let browser;
      let context2;
      if (contextGetter) {
        browser = new SimpleBrowser(await contextGetter());
      } else {
        try {
          browser = (await createBrowserWithInfo(config, clientInfo, {})).browser;
        } catch (error) {
          const message = String(error);
          const canDeferToDynamicCDP = !config.browser.remoteEndpoint && !config.browser.cdpEndpoint && !config.extension;
          const isLocalBrowserAvailabilityError = message.includes('Browser "') && message.includes('" is not installed') || message.includes('Missing system dependencies required to run browser');
          if (!canDeferToDynamicCDP || !isLocalBrowserAvailabilityError)
            throw error;
        }
      }
      if (browser)
        context2 = config.browser.isolated ? await browser.newContext(config.browser.contextOptions) : browser.contexts()[0];
      return new BrowserBackend(config, context2, tools);
    },
    disposed: async () => {
    }
  };
  return createServer("api", packageJSON.version, backendFactory, false);
}`, 'createConnection dynamic CDP fallback');

fs.writeFileSync(bundlePath, source);
console.log(`Patched ${path.relative(process.cwd(), bundlePath)} for MCP browserSession support.`);
