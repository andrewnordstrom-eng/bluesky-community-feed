/**
 * Governance Types
 *
 * Type definitions for the governance system including:
 * - Weight vectors
 * - Vote payloads
 * - Epoch information
 * - Audit log entries
 */
import { createDefaultGovernanceWeightRecord, GOVERNANCE_WEIGHT_KEYS } from '../config/votable-params.js';
import type { GovernanceWeights, ContentRules } from '../shared/api-types.js';

export type { GovernanceWeights, ContentRules } from '../shared/api-types.js';

const WEIGHT_KEYS = GOVERNANCE_WEIGHT_KEYS as ReadonlyArray<keyof GovernanceWeights>;
const WEIGHT_SCALE = 1000;
const SUM_TOLERANCE = 0.000001;

/**
 * Vote payload as submitted by the API (snake_case to match DB schema).
 */
export interface VotePayload {
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
}

/**
 * Governance epoch information.
 */
export interface EpochInfo {
  id: number;
  status: 'active' | 'voting' | 'closed';
  weights: GovernanceWeights;
  voteCount: number;
  createdAt: Date;
  closedAt: Date | null;
  description: string | null;
}

/**
 * Audit log entry for governance actions.
 */
export interface AuditLogEntry {
  id: number;
  action: string;
  actorDid: string | null;
  epochId: number | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Session info for authenticated users.
 */
export interface SessionInfo {
  did: string;
  handle: string;
  accessJwt: string;
  expiresAt: Date;
}

/**
 * Convert database row to EpochInfo.
 */
export function toEpochInfo(row: Record<string, unknown>): EpochInfo {
  return {
    id: row.id as number,
    status: row.status as 'active' | 'voting' | 'closed',
    weights: {
      recency: row.recency_weight as number,
      engagement: row.engagement_weight as number,
      bridging: row.bridging_weight as number,
      sourceDiversity: row.source_diversity_weight as number,
      relevance: row.relevance_weight as number,
    },
    voteCount: row.vote_count as number,
    createdAt: new Date(row.created_at as string),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
    description: row.description as string | null,
  };
}

/**
 * Convert database row to AuditLogEntry.
 */
export function toAuditLogEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as number,
    action: row.action as string,
    actorDid: row.actor_did as string | null,
    epochId: row.epoch_id as number | null,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Convert VotePayload to GovernanceWeights.
 */
export function votePayloadToWeights(payload: VotePayload): GovernanceWeights {
  return {
    recency: payload.recency_weight,
    engagement: payload.engagement_weight,
    bridging: payload.bridging_weight,
    sourceDiversity: payload.source_diversity_weight,
    relevance: payload.relevance_weight,
  };
}

/**
 * Convert GovernanceWeights to VotePayload format.
 */
export function weightsToVotePayload(weights: GovernanceWeights): VotePayload {
  return {
    recency_weight: weights.recency,
    engagement_weight: weights.engagement,
    bridging_weight: weights.bridging,
    source_diversity_weight: weights.sourceDiversity,
    relevance_weight: weights.relevance,
  };
}

/**
 * Normalize weights to sum to exactly 1.0.
 * Handles floating point precision issues.
 */
export function normalizeWeights(weights: GovernanceWeights): GovernanceWeights {
  const values = WEIGHT_KEYS.map((key) => weights[key]);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Weights must be finite numbers');
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    // Default to equal weights if all zero
    return createDefaultGovernanceWeightRecord();
  }

  const normalized = fromEntries(
    WEIGHT_KEYS.map((key) => [key, weights[key] / total] as const)
  );
  const redistributed = redistributeNegativeDeficit(normalized);
  const clamped = clampWeights(redistributed);
  const clampedTotal = sumWeights(clamped);

  if (clampedTotal <= 0) {
    throw new Error('Weights cannot be normalized: no positive weight remains after clamping');
  }

  const renormalized = fromEntries(
    WEIGHT_KEYS.map((key) => [key, clamped[key] / clampedTotal] as const)
  );
  const rounded = roundToExactUnitSum(renormalized);
  assertNormalizedWeights(rounded);

  return rounded;
}

/**
 * Validate that weights sum to approximately 1.0.
 */
export function validateWeightsSum(weights: GovernanceWeights): boolean {
  const sum = sumWeights(weights);

  return Math.abs(sum - 1.0) < 0.01;
}

function fromEntries(
  entries: ReadonlyArray<readonly [keyof GovernanceWeights, number]>
): GovernanceWeights {
  return Object.fromEntries(entries) as unknown as GovernanceWeights;
}

function sumWeights(weights: GovernanceWeights): number {
  return WEIGHT_KEYS.reduce((sum, key) => sum + weights[key], 0);
}

function clampWeights(weights: GovernanceWeights): GovernanceWeights {
  return fromEntries(
    WEIGHT_KEYS.map((key) => [key, Math.min(1, Math.max(0, weights[key]))] as const)
  );
}

function redistributeNegativeDeficit(weights: GovernanceWeights): GovernanceWeights {
  const redistributed = { ...weights };
  let deficit = 0;

  for (const key of WEIGHT_KEYS) {
    if (redistributed[key] < 0) {
      deficit += Math.abs(redistributed[key]);
      redistributed[key] = 0;
    }
  }

  if (deficit === 0) {
    return redistributed;
  }

  const positiveTotal = WEIGHT_KEYS.reduce((sum, key) => {
    const value = redistributed[key];
    return value > 0 ? sum + value : sum;
  }, 0);

  if (positiveTotal <= 0) {
    throw new Error('Weights cannot be normalized: unable to redistribute negative deficit');
  }

  for (const key of WEIGHT_KEYS) {
    const value = redistributed[key];
    if (value > 0) {
      redistributed[key] = Math.max(0, value - (deficit * value) / positiveTotal);
    }
  }

  return redistributed;
}

function roundToExactUnitSum(weights: GovernanceWeights): GovernanceWeights {
  const scaled = WEIGHT_KEYS.map((key) => ({
    key,
    base: Math.floor(weights[key] * WEIGHT_SCALE),
    remainder: weights[key] * WEIGHT_SCALE - Math.floor(weights[key] * WEIGHT_SCALE),
  }));

  let remaining = WEIGHT_SCALE - scaled.reduce((sum, part) => sum + part.base, 0);

  if (remaining > 0) {
    scaled
      .slice()
      .sort((a, b) => b.remainder - a.remainder)
      .slice(0, remaining)
      .forEach((part) => {
        part.base += 1;
      });
  } else if (remaining < 0) {
    remaining = Math.abs(remaining);
    scaled
      .slice()
      .sort((a, b) => a.remainder - b.remainder)
      .forEach((part) => {
        if (remaining > 0 && part.base > 0) {
          part.base -= 1;
          remaining -= 1;
        }
      });
  }

  return fromEntries(scaled.map((part) => [part.key, part.base / WEIGHT_SCALE] as const));
}

function assertNormalizedWeights(weights: GovernanceWeights): void {
  for (const key of WEIGHT_KEYS) {
    const value = weights[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Weights cannot be normalized: ${key} is outside [0, 1]`);
    }
  }

  const sum = sumWeights(weights);
  if (Math.abs(sum - 1) > SUM_TOLERANCE) {
    throw new Error('Weights cannot be normalized: sum is not exactly 1.0');
  }
}

// ============================================================================
// Content Theme Governance Types
// ============================================================================

/**
 * Content vote payload (snake_case to match DB schema).
 */
export interface ContentVotePayload {
  include_keywords?: string[];
  exclude_keywords?: string[];
}

/**
 * Database row for content rules in governance_epochs.
 */
export interface ContentRulesRow {
  include_keywords?: string[];
  exclude_keywords?: string[];
}

/**
 * Result of content filtering check.
 */
export interface ContentFilterResult {
  passes: boolean;
  reason?: 'excluded_keyword' | 'no_include_match' | 'no_text_with_include_filter';
  matchedKeyword?: string;
}

/**
 * Normalize keywords: lowercase, trim, dedupe, enforce limits.
 * - Max 20 keywords per category
 * - Max 50 characters per keyword
 * - Removes empty strings and duplicates
 */
export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length > 0 && k.length <= 50)
    .filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 20);
}

/**
 * Convert database row to ContentRules.
 */
export function toContentRules(row: ContentRulesRow | null): ContentRules {
  return {
    includeKeywords: row?.include_keywords ?? [],
    excludeKeywords: row?.exclude_keywords ?? [],
  };
}

/**
 * Create empty content rules.
 */
export function emptyContentRules(): ContentRules {
  return {
    includeKeywords: [],
    excludeKeywords: [],
  };
}
