/**
 * MCP Tools Barrel Export
 *
 * Registers all MCP tool categories on a server instance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { registerGovernanceTools } from './governance.js';
import { registerFeedTools } from './feed.js';
import { registerParticipantTools } from './participants.js';
import { registerExportTools } from './export.js';
import { registerAnnounceTools } from './announce.js';

/** Register all MCP tools on the server. */
export function registerAllTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  registerGovernanceTools(server, app, token, cookieName);
  registerFeedTools(server, app, token, cookieName);
  registerParticipantTools(server, app, token, cookieName);
  registerExportTools(server, app, token, cookieName);
  registerAnnounceTools(server, app, token, cookieName);
}
