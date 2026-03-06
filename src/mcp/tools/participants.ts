/**
 * MCP Participant Tools
 *
 * Tools for managing approved participants in private feed mode.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register participant management tools on the MCP server. */
export function registerParticipantTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'list_participants',
    {
      description: 'List all approved participants for the private feed mode',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/participants', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'add_participant',
    {
      description: 'Add a participant by DID or Bluesky handle. Handles are automatically resolved to DIDs.',
      inputSchema: {
        identifier: z.string().describe('Bluesky DID (did:plc:...) or handle (user.bsky.social)'),
      },
    },
    async ({ identifier }: { identifier: string }) => {
      const body = identifier.startsWith('did:')
        ? { did: identifier }
        : { handle: identifier };

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/participants',
        headers: { cookie, 'content-type': 'application/json' },
        payload: body,
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'remove_participant',
    {
      description: 'Remove an approved participant by their DID',
      inputSchema: {
        did: z.string().startsWith('did:').describe('Bluesky DID of the participant to remove'),
      },
    },
    async ({ did }: { did: string }) => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/admin/participants/${encodeURIComponent(did)}`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );
}
