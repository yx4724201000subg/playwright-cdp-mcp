/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as zod from 'zod';
import type { z } from 'zod';
import type * as mcpServer from './server';

export type ToolSchema<Input extends z.Schema> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Input;
  type: 'input' | 'assertion' | 'action' | 'readOnly';
};

export function toMcpTool(tool: ToolSchema<any>): mcpServer.Tool {
  const readOnly = tool.type === 'readOnly' || tool.type === 'assertion';
  const inputSchema = zod.toJSONSchema(tool.inputSchema) as mcpServer.Tool['inputSchema'];
  inputSchema.properties ??= {};
  (inputSchema.properties as Record<string, unknown>).browserSession = {
    type: 'object',
    description: 'Optional browser session selector. Use this to control multiple CDP browsers from one MCP server.',
    properties: {
      id: {
        type: 'string',
        description: 'Stable browser session id, for example "chrome-a". Reuse the same id in later calls.',
      },
      cdpEndpoint: {
        type: 'string',
        description: 'CDP endpoint for the first call that creates this session, for example "http://localhost:9222".',
      },
    },
    required: ['id'],
    additionalProperties: false,
  };
  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: readOnly,
      destructiveHint: !readOnly,
      openWorldHint: true,
    },
  };
}

export function defineToolSchema<Input extends z.Schema>(tool: ToolSchema<Input>): ToolSchema<Input> {
  return tool;
}
