/**
 * Shared API Types
 *
 * Type-only exports shared between backend and frontend.
 * NO runtime code — only interfaces, type aliases, and const enums.
 *
 * Backend imports: import type { ... } from '../shared/api-types.js'
 * Frontend imports: import type { ... } from '@shared/api-types'
 */

// ============================================================================
// Governance Weight Types
// ============================================================================

/** Union of all governance weight parameter keys. */
export type GovernanceWeightKey =
  | 'recency'
  | 'engagement'
  | 'bridging'
  | 'sourceDiversity'
  | 'relevance';

/** Weight vector for the scoring algorithm. All values 0.0–1.0, sum to 1.0. */
export interface GovernanceWeights {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

/**
 * Configuration for a votable weight parameter.
 * Shared base — backend extends with `voteField` for DB column mapping.
 */
export interface VotableWeightParam {
  key: GovernanceWeightKey;
  label: string;
  description: string;
  min: number;
  max: number;
  defaultValue: number;
}

// ============================================================================
// Content Rules Types
// ============================================================================

/** Content filtering rules derived from community keyword votes. */
export interface ContentRules {
  /** Posts must contain at least one of these keywords (OR logic). */
  includeKeywords: string[];
  /** Posts containing any of these keywords are filtered out (OR logic, takes precedence). */
  excludeKeywords: string[];
}
