/**
 * Vote Route
 *
 * POST /api/governance/vote
 *
 * Allows authenticated subscribers to vote on algorithm weights.
 * - Validates weights sum to 1.0
 * - Normalizes before storing
 * - Uses UPSERT to allow vote updates
 * - Logs to audit trail
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { config } from '../../config.js';
import { GOVERNANCE_WEIGHT_VOTE_FIELDS, VOTABLE_WEIGHT_PARAMS } from '../../config/votable-params.js';
import { logger } from '../../lib/logger.js';
import { Errors } from '../../lib/errors.js';
import { getAuthenticatedDid, SessionStoreUnavailableError } from '../auth.js';
import { isParticipantApproved } from '../../feed/access-control.js';
import {
  normalizeWeights,
  votePayloadToWeights,
  weightsToVotePayload,
  normalizeKeywords,
} from '../governance.types.js';
import type { VotePayload } from '../governance.types.js';

const weightFieldSchemas = Object.fromEntries(
  VOTABLE_WEIGHT_PARAMS.map((param) => [
    param.voteField,
    z.number().min(param.min).max(param.max).optional(),
  ])
) as Record<(typeof GOVERNANCE_WEIGHT_VOTE_FIELDS)[number], z.ZodOptional<z.ZodNumber>>;

/**
 * Zod schema for vote validation.
 * Weights must be 0.0-1.0 and sum to 1.0.
 * Keywords are optional - users can vote on weights only, keywords only, or both.
 */
const VoteSchema = z
  .object({
    // Weight fields (optional for keyword-only votes)
    ...weightFieldSchemas,
    // Keyword fields (optional for weight-only votes)
    include_keywords: z
      .array(z.string().max(50, 'Keywords must be 50 characters or less'))
      .max(20, 'Maximum 20 include keywords')
      .optional(),
    exclude_keywords: z
      .array(z.string().max(50, 'Keywords must be 50 characters or less'))
      .max(20, 'Maximum 20 exclude keywords')
      .optional(),
  })
  .refine(
    (data) => {
      // If any weight is provided, all must be provided and sum to 1.0
      const hasAnyWeight = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => data[field] !== undefined);

      if (!hasAnyWeight) return true; // Keywords-only vote is valid

      // If any weight provided, all must be provided
      const hasAllWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.every((field) => data[field] !== undefined);

      if (!hasAllWeights) return false;

      const sum = GOVERNANCE_WEIGHT_VOTE_FIELDS.reduce((acc, field) => acc + (data[field] as number), 0);
      return Math.abs(sum - 1.0) < 0.01;
    },
    { message: 'If weights are provided, all must be present and sum to 1.0' }
  )
  .refine(
    (data) => {
      // At least one of weights or keywords must be provided
      const hasWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => data[field] !== undefined);
      const hasKeywords =
        (data.include_keywords?.length ?? 0) > 0 ||
        (data.exclude_keywords?.length ?? 0) > 0;
      return hasWeights || hasKeywords;
    },
    { message: 'Must provide either weights or keywords (or both)' }
  );

export function registerVoteRoute(app: FastifyInstance): void {
  /**
   * POST /api/governance/vote
   * Submit or update a vote for the current epoch.
   */
  app.post('/api/governance/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Authenticate voter
    let voterDid: string | null;
    try {
      voterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!voterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required. Please log in first.',
      });
    }

    // 2. Verify they're an active subscriber
    const subscriber = await db.query(
      `SELECT did FROM subscribers WHERE did = $1 AND is_active = TRUE`,
      [voterDid]
    );

    if (subscriber.rows.length === 0) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'You must be an active feed subscriber to vote. Use the feed first to become a subscriber.',
      });
    }

    // 2b. Private mode: require approved participant
    if (config.FEED_PRIVATE_MODE) {
      if (!await isParticipantApproved(voterDid)) {
        throw Errors.FORBIDDEN('Private feed mode: approved participants only.');
      }
    }

    // 3. Validate vote body
    const parseResult = VoteSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'InvalidVote',
        message: 'Invalid vote weights',
        details: parseResult.error.errors,
      });
    }

    const vote = parseResult.data;

    // 4. Normalize weights (if provided) and keywords
    const hasWeights = GOVERNANCE_WEIGHT_VOTE_FIELDS.some((field) => vote[field] !== undefined);
    let normalized = null;
    let normalizedPayload: VotePayload | null = null;

    if (hasWeights) {
      const weightPayload = Object.fromEntries(
        GOVERNANCE_WEIGHT_VOTE_FIELDS.map((field) => [field, vote[field]!])
      ) as unknown as VotePayload;

      normalized = normalizeWeights(
        votePayloadToWeights(weightPayload)
      );
      normalizedPayload = weightsToVotePayload(normalized);
    }

    // Normalize keywords (lowercase, trim, dedupe, enforce limits)
    const includeKeywords = normalizeKeywords(vote.include_keywords ?? []);
    const excludeKeywords = normalizeKeywords(vote.exclude_keywords ?? []);

    // 5. Get current epoch (must be active or voting)
    const epoch = await db.query(
      `SELECT id, status, phase FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.code(500).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch. Please try again later.',
      });
    }

    const epochId = epoch.rows[0].id;
    const epochPhase = epoch.rows[0].phase as string | null;

    if (epochPhase !== 'voting') {
      return reply.code(409).send({
        error: 'VotingClosed',
        message: 'Voting is currently closed for this round.',
      });
    }

    try {
      // 6. UPSERT vote with weights and/or keywords
      // Use xmax = 0 to detect if this was an INSERT (new) or UPDATE (existing)
      // Use COALESCE to preserve existing values when only updating one aspect
      const voteResult = await db.query(
        `INSERT INTO governance_votes (
          voter_did, epoch_id,
          recency_weight, engagement_weight, bridging_weight,
          source_diversity_weight, relevance_weight,
          include_keywords, exclude_keywords
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (voter_did, epoch_id) DO UPDATE SET
          recency_weight = COALESCE($3, governance_votes.recency_weight),
          engagement_weight = COALESCE($4, governance_votes.engagement_weight),
          bridging_weight = COALESCE($5, governance_votes.bridging_weight),
          source_diversity_weight = COALESCE($6, governance_votes.source_diversity_weight),
          relevance_weight = COALESCE($7, governance_votes.relevance_weight),
          include_keywords = COALESCE($8, governance_votes.include_keywords),
          exclude_keywords = COALESCE($9, governance_votes.exclude_keywords),
          voted_at = NOW()
        RETURNING id, (xmax = 0) as is_new_vote`,
        [
          voterDid,
          epochId,
          ...GOVERNANCE_WEIGHT_VOTE_FIELDS.map((field) => normalizedPayload?.[field] ?? null),
          includeKeywords.length > 0 ? includeKeywords : null,
          excludeKeywords.length > 0 ? excludeKeywords : null,
        ]
      );

      const isNewVote = voteResult.rows[0].is_new_vote;
      const auditAction = isNewVote ? 'vote_cast' : 'vote_updated';

      // 7. Log to audit trail with appropriate action
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ($1, $2, $3, $4)`,
        [
          auditAction,
          voterDid,
          epochId,
          JSON.stringify({
            weights: normalized,
            content_vote: {
              include_keywords: includeKeywords,
              exclude_keywords: excludeKeywords,
            },
            original_weights: hasWeights
              ? Object.fromEntries(
                  GOVERNANCE_WEIGHT_VOTE_FIELDS.map((field) => [field, vote[field]])
                )
              : null,
          }),
        ]
      );

      logger.info(
        {
          voterDid,
          epochId,
          weights: normalized,
          includeKeywords: includeKeywords.length,
          excludeKeywords: excludeKeywords.length,
          isNewVote,
        },
        'Vote recorded'
      );

      const message = isNewVote
        ? 'Your vote has been recorded.'
        : 'Your vote has been updated.';

      return reply.send({
        success: true,
        epoch_id: epochId,
        weights: normalized,
        content_vote: {
          includeKeywords,
          excludeKeywords,
        },
        is_update: !isNewVote,
        message,
      });
    } catch (err) {
      logger.error({ err, voterDid, epochId }, 'Failed to record vote');
      return reply.code(500).send({
        error: 'VoteFailed',
        message: 'Failed to record your vote. Please try again.',
      });
    }
  });

  /**
   * GET /api/governance/vote
   * Get the current user's vote for the active epoch.
   */
  app.get('/api/governance/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    let voterDid: string | null;
    try {
      voterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!voterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    // Get current epoch
    const epoch = await db.query(
      `SELECT id FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.send({ vote: null, epoch_id: null });
    }

    const epochId = epoch.rows[0].id;

    // Get user's vote for this epoch (including keywords)
    const vote = await db.query(
      `SELECT recency_weight, engagement_weight, bridging_weight,
              source_diversity_weight, relevance_weight,
              include_keywords, exclude_keywords, voted_at
       FROM governance_votes
       WHERE voter_did = $1 AND epoch_id = $2`,
      [voterDid, epochId]
    );

    if (vote.rows.length === 0) {
      return reply.send({
        vote: null,
        contentVote: null,
        voted_at: null,
        epoch_id: epochId,
      });
    }

    const v = vote.rows[0];
    return reply.send({
      vote: {
        recency: v.recency_weight,
        engagement: v.engagement_weight,
        bridging: v.bridging_weight,
        sourceDiversity: v.source_diversity_weight,
        relevance: v.relevance_weight,
      },
      contentVote: {
        includeKeywords: v.include_keywords ?? [],
        excludeKeywords: v.exclude_keywords ?? [],
      },
      voted_at: v.voted_at,
      epoch_id: epochId,
    });
  });
}
