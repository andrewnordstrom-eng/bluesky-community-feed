/**
 * MCP Export Tools
 *
 * Tools for exporting anonymized research data (votes, scores, audit log).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register export tools on the MCP server. */
export function registerExportTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'export_votes',
    {
      description: 'Export anonymized vote data for a governance epoch as JSON',
      inputSchema: {
        epochId: z.string().describe('Epoch ID to export votes for'),
      },
    },
    async ({ epochId }: { epochId: string }) => {
      const params = new URLSearchParams({ epoch_id: epochId, format: 'json' });
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/export/votes?${params}`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'export_scores',
    {
      description: 'Export score decomposition for an epoch as JSON with pagination support',
      inputSchema: {
        epochId: z.string().describe('Epoch ID to export scores for'),
        limit: z.number().int().min(1).max(5000).optional().describe('Maximum results to return (default 5000)'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination (default 0)'),
      },
    },
    async ({ epochId, limit, offset }: { epochId: string; limit?: number; offset?: number }) => {
      const params = new URLSearchParams({ epoch_id: epochId, format: 'json' });
      if (limit !== undefined) params.set('limit', String(limit));
      if (offset !== undefined) params.set('offset', String(offset));

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/export/scores?${params}`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'export_audit',
    {
      description: 'Export audit log entries as JSON, optionally filtered by date range',
      inputSchema: {
        startDate: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
        endDate: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
      },
    },
    async ({ startDate, endDate }: { startDate?: string; endDate?: string }) => {
      const params = new URLSearchParams({ format: 'json' });
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);

      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/export/audit?${params}`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );
}
