/**
 * MCP Governance Tools
 *
 * Tools for managing governance operations: epochs, voting, content rules, aggregation.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register governance tools on the MCP server. */
export function registerGovernanceTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'get_status',
    {
      description: 'Get overall system status including current epoch, scoring, and subscriber info',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/status', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'list_epochs',
    {
      description: 'List all governance epochs with their weights and metadata',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/epochs', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'get_governance_status',
    {
      description: 'Get current governance status including active weights, voting state, and content rules',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/governance/status', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'start_voting',
    {
      description: 'Open a voting period for the current epoch. Subscribers can then cast weight preferences.',
      inputSchema: {
        durationHours: z.number().int().min(1).max(168).optional().describe('Voting duration in hours (1-168, default 72)'),
        announce: z.boolean().optional().describe('Post a bot announcement about voting opening (default true)'),
      },
    },
    async ({ durationHours, announce }: { durationHours?: number; announce?: boolean }) => {
      const payload: Record<string, unknown> = { action: 'open_voting' };
      if (durationHours !== undefined) payload.durationHours = durationHours;
      if (announce !== undefined) payload.announce = announce;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/governance/weights/apply',
        headers: { cookie, 'content-type': 'application/json' },
        payload,
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'close_voting',
    {
      description: 'Close the active voting period and apply aggregated weights to the next epoch.',
      inputSchema: {
        announce: z.boolean().optional().describe('Post a bot announcement about voting closing (default true)'),
      },
    },
    async ({ announce }: { announce?: boolean }) => {
      const payload: Record<string, unknown> = { action: 'close_voting' };
      if (announce !== undefined) payload.announce = announce;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/governance/weights/apply',
        headers: { cookie, 'content-type': 'application/json' },
        payload,
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'trigger_epoch_transition',
    {
      description: 'Force an epoch transition to create a new epoch with current aggregated weights',
    },
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/epochs/transition',
        headers: { cookie, 'content-type': 'application/json' },
        payload: {},
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'get_content_rules',
    {
      description: 'Get current content filtering rules (include/exclude keywords)',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/governance/status', headers: { cookie } });
      if (res.statusCode >= 400) return formatInjectResponse(res);

      try {
        const data = JSON.parse(res.body);
        const rules = {
          includeKeywords: data.contentRules?.includeKeywords ?? [],
          excludeKeywords: data.contentRules?.excludeKeywords ?? [],
        };
        return { content: [{ type: 'text' as const, text: JSON.stringify(rules, null, 2) }] };
      } catch {
        return formatInjectResponse(res);
      }
    }
  );

  server.registerTool(
    'update_content_rules',
    {
      description: 'Update content filtering rules. Keywords are used to include/exclude posts from the feed.',
      inputSchema: {
        includeKeywords: z.array(z.string()).optional().describe('Keywords that posts must contain to be included'),
        excludeKeywords: z.array(z.string()).optional().describe('Keywords that cause posts to be excluded'),
      },
    },
    async ({ includeKeywords, excludeKeywords }: { includeKeywords?: string[]; excludeKeywords?: string[] }) => {
      const payload: Record<string, unknown> = {};
      if (includeKeywords !== undefined) payload.includeKeywords = includeKeywords;
      if (excludeKeywords !== undefined) payload.excludeKeywords = excludeKeywords;

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/admin/governance/content-rules',
        headers: { cookie, 'content-type': 'application/json' },
        payload,
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'get_vote_summary',
    {
      description: 'Get vote summary for a specific epoch including cast votes and aggregation',
      inputSchema: {
        epochId: z.string().describe('Epoch ID to get vote summary for'),
      },
    },
    async ({ epochId }: { epochId: string }) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/governance/votes/${encodeURIComponent(epochId)}`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'preview_aggregation',
    {
      description: 'Preview what the aggregated weights would be if voting closed now (trimmed mean calculation)',
    },
    async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/governance/aggregation/preview',
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );
}
