/**
 * MCP Server Factory
 *
 * Creates a per-request McpServer instance with all admin tools registered.
 * Each request gets a fresh server with the authenticated session token
 * threaded through tool handlers via closure.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { registerAllTools } from './tools/index.js';

const MCP_SERVER_NAME = 'corgi-feed-admin';
const MCP_SERVER_VERSION = '1.0.0';

/** Create a new McpServer with all admin tools bound to the given session token. */
export function createMcpServer(
  app: FastifyInstance,
  sessionToken: string,
  cookieName: string
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  registerAllTools(server, app, sessionToken, cookieName);

  return server;
}
