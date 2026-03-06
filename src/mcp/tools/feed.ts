/**
 * MCP Feed & Scoring Tools
 *
 * Tools for feed health, scoring pipeline, Jetstream, and post analysis.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register feed and scoring tools on the MCP server. */
export function registerFeedTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'get_feed_health',
    {
      description: 'Get feed health status including database, scoring pipeline, Jetstream, and subscriber counts',
    },
    async () => {
      const res = await app.inject({ method: 'GET', url: '/api/admin/feed-health', headers: { cookie } });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'trigger_rescore',
    {
      description: 'Trigger an immediate scoring pipeline run to re-score all posts',
      annotations: { destructiveHint: false, readOnlyHint: false },
    },
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/feed/rescore',
        headers: { cookie, 'content-type': 'application/json' },
        payload: {},
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'reconnect_jetstream',
    {
      description: 'Force Jetstream WebSocket reconnection for real-time post ingestion',
      annotations: { destructiveHint: false, readOnlyHint: false },
    },
    async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/jetstream/reconnect',
        headers: { cookie, 'content-type': 'application/json' },
        payload: {},
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'explain_post_score',
    {
      description: 'Get detailed score breakdown for a specific post showing all component scores and weights',
      inputSchema: {
        uri: z.string().describe('AT Protocol URI of the post (at://did:plc:.../app.bsky.feed.post/...)'),
      },
    },
    async ({ uri }: { uri: string }) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/posts/${encodeURIComponent(uri)}/explain`,
        headers: { cookie },
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'counterfactual_analysis',
    {
      description: 'Run a what-if analysis with hypothetical weights to see how feed ranking would change',
      inputSchema: {
        weights: z.record(z.string(), z.number().min(0).max(1)).describe('Hypothetical weight map, e.g. {"recency":0.3,"engagement":0.2,"bridging":0.2,"source_diversity":0.2,"relevance":0.1}'),
        limit: z.number().int().min(1).max(100).optional().describe('Number of posts to include in analysis (default 20)'),
      },
    },
    async ({ weights, limit }: { weights: Record<string, number>; limit?: number }) => {
      const payload: Record<string, unknown> = { weights };
      if (limit !== undefined) payload.limit = limit;

      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/counterfactual',
        headers: { cookie, 'content-type': 'application/json' },
        payload,
      });
      return formatInjectResponse(res);
    }
  );
}
