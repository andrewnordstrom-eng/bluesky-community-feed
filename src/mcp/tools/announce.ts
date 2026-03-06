/**
 * MCP Announcement Tools
 *
 * Tools for listing and posting bot announcements.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register announcement tools on the MCP server. */
export function registerAnnounceTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'list_announcements',
    {
      description: 'List recent bot announcements with their text, post URI, and creation date',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/announcements', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'send_announcement',
    {
      description: 'Post a custom announcement through the bot account (max 280 characters)',
      inputSchema: {
        text: z.string().min(1).max(280).describe('Announcement text (max 280 characters)'),
      },
    },
    async ({ text }: { text: string }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { text },
      });
      return formatInjectResponse(res);
    }
  );
}
