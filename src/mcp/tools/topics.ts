/**
 * MCP Topic Tools
 *
 * Tools for managing the topic catalog and testing classification.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { formatInjectResponse } from './format.js';

/** Register topic management tools on the MCP server. */
export function registerTopicTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'list_topics',
    {
      description: 'List all topics in the catalog with post counts and community weights',
      inputSchema: {
        includeInactive: z.boolean().optional().default(true)
          .describe('Include inactive topics (default true)'),
      },
    },
    async ({ includeInactive }: { includeInactive?: boolean }) => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/topics',
        headers: { cookie },
      });
      const data = JSON.parse(res.body);

      if (!includeInactive && Array.isArray(data)) {
        const filtered = data.filter((t: Record<string, unknown>) => t.isActive);
        return { content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }] };
      }

      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'add_topic',
    {
      description: 'Add a new topic to the catalog for community voting',
      inputSchema: {
        slug: z.string().describe('URL-safe identifier (lowercase, hyphens)'),
        name: z.string().describe('Display name'),
        description: z.string().optional().describe('Topic description'),
        terms: z.array(z.string()).describe('Primary matching terms'),
        contextTerms: z.array(z.string()).optional().describe('Co-occurrence context terms'),
        antiTerms: z.array(z.string()).optional().describe('Terms that exclude this topic'),
      },
    },
    async (input: {
      slug: string;
      name: string;
      description?: string;
      terms: string[];
      contextTerms?: string[];
      antiTerms?: string[];
    }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/topics',
        headers: { cookie, 'content-type': 'application/json' },
        payload: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          terms: input.terms,
          contextTerms: input.contextTerms ?? [],
          antiTerms: input.antiTerms ?? [],
        },
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'update_topic',
    {
      description: "Update a topic's terms, context terms, or metadata",
      inputSchema: {
        slug: z.string().describe('Topic slug to update'),
        name: z.string().optional().describe('New display name'),
        terms: z.array(z.string()).optional().describe('Replace primary terms'),
        contextTerms: z.array(z.string()).optional().describe('Replace context terms'),
        antiTerms: z.array(z.string()).optional().describe('Replace anti terms'),
      },
    },
    async (input: {
      slug: string;
      name?: string;
      terms?: string[];
      contextTerms?: string[];
      antiTerms?: string[];
    }) => {
      const body: Record<string, unknown> = {};
      if (input.name !== undefined) body.name = input.name;
      if (input.terms !== undefined) body.terms = input.terms;
      if (input.contextTerms !== undefined) body.contextTerms = input.contextTerms;
      if (input.antiTerms !== undefined) body.antiTerms = input.antiTerms;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/admin/topics/${encodeURIComponent(input.slug)}`,
        headers: { cookie, 'content-type': 'application/json' },
        payload: body,
      });
      return formatInjectResponse(res);
    }
  );

  server.registerTool(
    'get_topic_stats',
    {
      description: 'Get topic classification statistics: total topics, posts classified, most/least matched',
    },
    async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/admin/topics',
        headers: { cookie },
      });
      const topics = JSON.parse(res.body) as Array<{
        slug: string; name: string; isActive: boolean; postCount: number;
      }>;

      const active = topics.filter(t => t.isActive);
      const totalPosts = active.reduce((sum, t) => sum + t.postCount, 0);
      const sorted = [...active].sort((a, b) => b.postCount - a.postCount);

      const stats = {
        totalTopics: topics.length,
        activeTopics: active.length,
        topicsWithPosts: active.filter(t => t.postCount > 0).length,
        totalClassifiedPosts: totalPosts,
        mostMatched: sorted.slice(0, 5).map(t => ({ name: t.name, posts: t.postCount })),
        leastMatched: sorted.slice(-5).reverse().map(t => ({ name: t.name, posts: t.postCount })),
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    'classify_text',
    {
      description: 'Test: classify a sample text against the topic taxonomy (debugging tool)',
      inputSchema: {
        text: z.string().describe('Text to classify against the topic taxonomy'),
      },
    },
    async ({ text }: { text: string }) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/topics/classify',
        headers: { cookie, 'content-type': 'application/json' },
        payload: { text },
      });
      return formatInjectResponse(res);
    }
  );
}
