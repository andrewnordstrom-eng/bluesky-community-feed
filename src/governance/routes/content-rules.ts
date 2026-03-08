/**
 * Content Rules Route
 *
 * GET /api/governance/content-rules
 *
 * Returns the current epoch's content rules and vote statistics.
 * Shows which keywords are active and how many votes each received.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { ErrorResponseSchema } from '../../lib/openapi.js';
import { getCurrentContentRules } from '../content-filter.js';

/** Threshold for keyword inclusion (30% of voters) */
const KEYWORD_THRESHOLD = 0.3;

export function registerContentRulesRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/content-rules
   * Returns current content rules and vote statistics for transparency.
   */
  app.get('/api/governance/content-rules', {
    schema: {
      tags: ['Governance'],
      summary: 'Get content rules',
      description:
        'Returns the current epoch\'s content rules (active keywords) and per-keyword vote statistics. ' +
        'Keywords require 30% voter support to become active.',
      response: {
        200: {
          type: 'object',
          properties: {
            epoch_id: { type: 'integer', description: 'Active epoch ID' },
            include_keywords: { type: 'array', items: { type: 'string' }, description: 'Active include keywords (met threshold)' },
            exclude_keywords: { type: 'array', items: { type: 'string' }, description: 'Active exclude keywords (met threshold)' },
            include_keyword_votes: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              description: 'Keyword → vote count map for include keywords',
            },
            exclude_keyword_votes: {
              type: 'object',
              additionalProperties: { type: 'integer' },
              description: 'Keyword → vote count map for exclude keywords',
            },
            total_voters: { type: 'integer', description: 'Number of voters who submitted keyword votes' },
            threshold: { type: 'integer', description: 'Minimum votes required for keyword activation' },
          },
          required: ['epoch_id', 'include_keywords', 'exclude_keywords', 'total_voters', 'threshold'],
        },
        500: ErrorResponseSchema,
      },
    },
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    // Get current epoch
    const epoch = await db.query(
      `SELECT id FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.code(500).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch.',
      });
    }

    const epochId = epoch.rows[0].id;

    // Get current content rules (from epoch or cache)
    const rules = await getCurrentContentRules();

    // Get keyword vote statistics for transparency
    // This shows how many voters included each keyword
    const keywordStats = await db.query(
      `SELECT
        include_keywords,
        exclude_keywords
       FROM governance_votes
       WHERE epoch_id = $1
         AND (
           include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0
           OR exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0
         )`,
      [epochId]
    );

    // Count keyword occurrences
    const includeVotes: Record<string, number> = {};
    const excludeVotes: Record<string, number> = {};

    for (const row of keywordStats.rows) {
      for (const kw of row.include_keywords ?? []) {
        includeVotes[kw] = (includeVotes[kw] ?? 0) + 1;
      }
      for (const kw of row.exclude_keywords ?? []) {
        excludeVotes[kw] = (excludeVotes[kw] ?? 0) + 1;
      }
    }

    // Get total voter count for content rules
    const totalVoters = keywordStats.rows.length;
    const threshold = Math.ceil(totalVoters * KEYWORD_THRESHOLD);

    return reply.send({
      epoch_id: epochId,
      include_keywords: rules.includeKeywords,
      exclude_keywords: rules.excludeKeywords,
      include_keyword_votes: includeVotes,
      exclude_keyword_votes: excludeVotes,
      total_voters: totalVoters,
      threshold: threshold > 0 ? threshold : 1,
    });
  });
}
