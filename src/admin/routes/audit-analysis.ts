/**
 * Admin Audit Analysis Routes
 *
 * Analytics endpoints for governance integrity and ranking impact.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { adminSecurity, ErrorResponseSchema } from '../../lib/openapi.js';
import { GovernanceWeights, normalizeWeights } from '../../governance/governance.types.js';

type ComponentKey = keyof GovernanceWeights;

const COMPONENT_KEYS: ComponentKey[] = [
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
];

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** JSON Schema for OpenAPI documentation. */
const QueryJsonSchema = zodToJsonSchema(QuerySchema, { target: 'jsonSchema7' });

const SENSITIVITY_SAMPLE_SIZE = 100;

interface EpochRow {
  id: number;
  recency_weight: number | string;
  engagement_weight: number | string;
  bridging_weight: number | string;
  source_diversity_weight: number | string;
  relevance_weight: number | string;
}

interface ScoreRow {
  post_uri: string;
  text: string | null;
  total_score: number | string;
  recency_score: number | string;
  engagement_score: number | string;
  bridging_score: number | string;
  source_diversity_score: number | string;
  relevance_score: number | string;
}

interface ScoreVector {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

interface AnalyzedRow {
  uri: string;
  text: string | null;
  currentRank: number;
  currentScore: number;
  raw: ScoreVector;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toWeights(row: EpochRow): GovernanceWeights {
  return {
    recency: toNumber(row.recency_weight),
    engagement: toNumber(row.engagement_weight),
    bridging: toNumber(row.bridging_weight),
    sourceDiversity: toNumber(row.source_diversity_weight),
    relevance: toNumber(row.relevance_weight),
  };
}

function toRawScores(row: ScoreRow): ScoreVector {
  return {
    recency: toNumber(row.recency_score),
    engagement: toNumber(row.engagement_score),
    bridging: toNumber(row.bridging_score),
    sourceDiversity: toNumber(row.source_diversity_score),
    relevance: toNumber(row.relevance_score),
  };
}

function scoreWithWeights(raw: ScoreVector, weights: GovernanceWeights): number {
  return (
    raw.recency * weights.recency +
    raw.engagement * weights.engagement +
    raw.bridging * weights.bridging +
    raw.sourceDiversity * weights.sourceDiversity +
    raw.relevance * weights.relevance
  );
}

function weightedComponents(raw: ScoreVector, weights: GovernanceWeights): Record<ComponentKey, number> {
  return {
    recency: raw.recency * weights.recency,
    engagement: raw.engagement * weights.engagement,
    bridging: raw.bridging * weights.bridging,
    sourceDiversity: raw.sourceDiversity * weights.sourceDiversity,
    relevance: raw.relevance * weights.relevance,
  };
}

function getDominantFactor(weighted: Record<ComponentKey, number>): ComponentKey {
  let dominant: ComponentKey = 'recency';

  for (const key of COMPONENT_KEYS) {
    if (weighted[key] > weighted[dominant]) {
      dominant = key;
    }
  }

  return dominant;
}

function shiftSingleWeight(
  base: GovernanceWeights,
  targetKey: ComponentKey,
  multiplier: number
): GovernanceWeights {
  const next: GovernanceWeights = { ...base };
  const originalTarget = base[targetKey];
  const adjustedTarget = Math.min(1, Math.max(0, originalTarget * multiplier));
  const delta = adjustedTarget - originalTarget;

  if (Math.abs(delta) < 0.0000001) {
    return normalizeWeights(next);
  }

  const otherKeys = COMPONENT_KEYS.filter((key) => key !== targetKey);
  const othersTotal = otherKeys.reduce((sum, key) => sum + base[key], 0);

  next[targetKey] = adjustedTarget;

  if (delta > 0) {
    if (othersTotal <= 0) {
      return normalizeWeights(base);
    }

    for (const key of otherKeys) {
      next[key] = Math.max(0, base[key] - (delta * base[key]) / othersTotal);
    }
  } else {
    const increase = Math.abs(delta);

    if (othersTotal > 0) {
      for (const key of otherKeys) {
        next[key] = base[key] + (increase * base[key]) / othersTotal;
      }
    } else {
      const evenIncrease = increase / otherKeys.length;
      for (const key of otherKeys) {
        next[key] = base[key] + evenIncrease;
      }
    }
  }

  return normalizeWeights(next);
}

function simulateRankMap(
  rows: AnalyzedRow[],
  weights: GovernanceWeights
): Map<string, number> {
  const scored = rows
    .map((row) => ({
      uri: row.uri,
      score: scoreWithWeights(row.raw, weights),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.uri.localeCompare(b.uri);
    });

  const ranks = new Map<string, number>();
  scored.forEach((item, index) => {
    ranks.set(item.uri, index + 1);
  });

  return ranks;
}

function computeScenarioMetrics(
  baselineRankMap: Map<string, number>,
  simulatedRankMap: Map<string, number>
): { changedCount: number; avgAbsRankChange: number } {
  let changedCount = 0;
  let absDeltaSum = 0;

  for (const [uri, baselineRank] of baselineRankMap.entries()) {
    const simulatedRank = simulatedRankMap.get(uri);
    if (!simulatedRank) {
      continue;
    }

    const delta = Math.abs(simulatedRank - baselineRank);
    if (delta > 0) {
      changedCount += 1;
      absDeltaSum += delta;
    }
  }

  return {
    changedCount,
    avgAbsRankChange: changedCount > 0 ? absDeltaSum / changedCount : 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toTextPreview(text: string | null): string | null {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }

  return `${trimmed.slice(0, 157)}...`;
}

interface CurrentScoringRunValue {
  run_id?: unknown;
  epoch_id?: unknown;
}

async function getCurrentScoringRunScope(): Promise<{ runId: string; epochId: number } | null> {
  const result = await db.query<{ value: CurrentScoringRunValue }>(
    `SELECT value
     FROM system_status
     WHERE key = 'current_scoring_run'`
  );

  const value = result.rows[0]?.value;
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (typeof value.run_id !== 'string' || typeof value.epoch_id !== 'number') {
    return null;
  }

  return {
    runId: value.run_id,
    epochId: value.epoch_id,
  };
}

/** Reusable component detail schema fragment. */
const componentDetailSchema = {
  type: 'object' as const,
  properties: {
    raw: { type: 'number' as const },
    weighted: { type: 'number' as const },
  },
};

export function registerAuditAnalysisRoutes(app: FastifyInstance): void {
  app.get('/audit/weight-impact', {
    schema: {
      tags: ['Admin'],
      summary: 'Weight impact analysis',
      description:
        'Performs sensitivity analysis on current governance weights. Shows how the top-N posts ' +
        'are ranked, which scoring component dominates each, and how ±10% weight shifts would ' +
        'affect rankings. Uses live feed from Redis + score decomposition from PostgreSQL.',
      security: adminSecurity,
      querystring: QueryJsonSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            currentEpochId: { type: 'integer' },
            currentWeights: {
              type: 'object',
              properties: {
                recency: { type: 'number' },
                engagement: { type: 'number' },
                bridging: { type: 'number' },
                sourceDiversity: { type: 'number' },
                relevance: { type: 'number' },
              },
            },
            topPosts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                  textPreview: { type: 'string', nullable: true },
                  rank: { type: 'integer' },
                  totalScore: { type: 'number' },
                  components: {
                    type: 'object',
                    properties: {
                      recency: componentDetailSchema,
                      engagement: componentDetailSchema,
                      bridging: componentDetailSchema,
                      sourceDiversity: componentDetailSchema,
                      relevance: componentDetailSchema,
                    },
                  },
                  dominantFactor: { type: 'string' },
                  wouldRankWithEqualWeights: { type: 'integer' },
                },
              },
            },
            weightSensitivity: {
              type: 'object',
              description: 'Per-component sensitivity (±10% shift impact)',
              additionalProperties: {
                type: 'object',
                properties: {
                  postsAffected: { type: 'integer' },
                  avgRankChange: { type: 'number' },
                },
              },
            },
            analyzedPosts: { type: 'integer' },
            generatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['currentEpochId', 'currentWeights', 'topPosts', 'weightSensitivity', 'analyzedPosts', 'generatedAt'],
        },
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        503: ErrorResponseSchema,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = QuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid weight impact query parameters',
        details: parseResult.error.issues,
      });
    }

    const { limit } = parseResult.data;

    const epochResult = await db.query<EpochRow>(
      `SELECT id,
              recency_weight,
              engagement_weight,
              bridging_weight,
              source_diversity_weight,
              relevance_weight
       FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC
       LIMIT 1`
    );

    if (epochResult.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found',
      });
    }

    const epoch = epochResult.rows[0];
    const currentWeights = toWeights(epoch);
    const runScope = await getCurrentScoringRunScope();

    let feedEntries: string[];
    try {
      const sampleSize = Math.max(limit, SENSITIVITY_SAMPLE_SIZE);
      feedEntries = await redis.zrevrange('feed:current', 0, sampleSize - 1, 'WITHSCORES');
    } catch (error) {
      return reply.code(503).send({
        error: 'RedisUnavailable',
        message: 'Unable to load live feed ranking for audit analysis',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    if (feedEntries.length === 0) {
      return reply.send({
        currentEpochId: epoch.id,
        currentWeights,
        topPosts: [],
        weightSensitivity: {},
        analyzedPosts: 0,
        generatedAt: new Date().toISOString(),
      });
    }

    const rankedFeed = [] as Array<{ uri: string; rank: number; score: number }>;
    for (let index = 0; index < feedEntries.length; index += 2) {
      const uri = feedEntries[index];
      const score = toNumber(feedEntries[index + 1]);
      rankedFeed.push({
        uri,
        rank: index / 2 + 1,
        score,
      });
    }

    const uris = rankedFeed.map((entry) => entry.uri);

    const scoreParams: unknown[] = [epoch.id, uris];
    let runScopeClause = '';
    if (runScope?.epochId === epoch.id) {
      scoreParams.push(runScope.runId);
      runScopeClause = `AND ps.component_details->>'run_id' = $${scoreParams.length}`;
    }

    const scoreResult = await db.query<ScoreRow>(
      `SELECT
        ps.post_uri,
        p.text,
        ps.total_score,
        ps.recency_score,
        ps.engagement_score,
        ps.bridging_score,
        ps.source_diversity_score,
        ps.relevance_score
       FROM post_scores ps
       LEFT JOIN posts p ON p.uri = ps.post_uri
       WHERE ps.epoch_id = $1
         AND ps.post_uri = ANY($2::text[])
         ${runScopeClause}`,
      scoreParams
    );

    const scoreMap = new Map(scoreResult.rows.map((row) => [row.post_uri, row]));

    const analyzedRows: AnalyzedRow[] = rankedFeed
      .map((entry) => {
        const row = scoreMap.get(entry.uri);
        if (!row) {
          return null;
        }

        return {
          uri: entry.uri,
          text: row.text,
          currentRank: entry.rank,
          currentScore: entry.score,
          raw: toRawScores(row),
        };
      })
      .filter((row): row is AnalyzedRow => row !== null);

    if (analyzedRows.length === 0) {
      return reply.send({
        currentEpochId: epoch.id,
        currentWeights,
        topPosts: [],
        weightSensitivity: {},
        analyzedPosts: 0,
        generatedAt: new Date().toISOString(),
      });
    }

    const equalRanks = simulateRankMap(analyzedRows, {
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    });

    const topPosts = analyzedRows.slice(0, limit).map((row) => {
      const weighted = weightedComponents(row.raw, currentWeights);

      return {
        uri: row.uri,
        textPreview: toTextPreview(row.text),
        rank: row.currentRank,
        totalScore: row.currentScore,
        components: {
          recency: { raw: row.raw.recency, weighted: weighted.recency },
          engagement: { raw: row.raw.engagement, weighted: weighted.engagement },
          bridging: { raw: row.raw.bridging, weighted: weighted.bridging },
          sourceDiversity: { raw: row.raw.sourceDiversity, weighted: weighted.sourceDiversity },
          relevance: { raw: row.raw.relevance, weighted: weighted.relevance },
        },
        dominantFactor: getDominantFactor(weighted),
        wouldRankWithEqualWeights: equalRanks.get(row.uri) ?? row.currentRank,
      };
    });

    const sensitivityRows = analyzedRows.slice(0, SENSITIVITY_SAMPLE_SIZE);
    const baselineRankMap = new Map(sensitivityRows.map((row) => [row.uri, row.currentRank]));

    const weightSensitivity = Object.fromEntries(
      COMPONENT_KEYS.map((key) => {
        const plusWeights = shiftSingleWeight(currentWeights, key, 1.1);
        const minusWeights = shiftSingleWeight(currentWeights, key, 0.9);

        const plusMetrics = computeScenarioMetrics(
          baselineRankMap,
          simulateRankMap(sensitivityRows, plusWeights)
        );
        const minusMetrics = computeScenarioMetrics(
          baselineRankMap,
          simulateRankMap(sensitivityRows, minusWeights)
        );

        return [
          key,
          {
            postsAffected: Math.round((plusMetrics.changedCount + minusMetrics.changedCount) / 2),
            avgRankChange: round2((plusMetrics.avgAbsRankChange + minusMetrics.avgAbsRankChange) / 2),
          },
        ];
      })
    );

    return reply.send({
      currentEpochId: epoch.id,
      currentWeights,
      topPosts,
      weightSensitivity,
      analyzedPosts: sensitivityRows.length,
      generatedAt: new Date().toISOString(),
    });
  });
}
