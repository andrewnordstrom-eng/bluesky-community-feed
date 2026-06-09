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

/**
 * Identifier for a governance-voted scoring weight.
 *
 * Was a string-literal union of exactly 5 names (`recency`, `engagement`,
 * `bridging`, `sourceDiversity`, `relevance`) before PROJ-816. Widened to
 * `string` so the type contract no longer fossilizes a 5-component
 * assumption. Runtime validity is enforced by `validateRegistry` /
 * `REGISTERED_COMPONENT_KEYS` in `src/scoring/registry.ts`, which rejects
 * unregistered keys on vote intake.
 */
export type GovernanceWeightKey = string;

/**
 * Weight vector for the scoring algorithm. All values 0.0–1.0, sum to 1.0.
 *
 * Was a 5-field interface before PROJ-816; now a `Record<>` keyed by
 * `GovernanceWeightKey` so adding a 6th component is purely a registry
 * change. Live registry still has 5 components today — this is the contract
 * change that unblocks future additions.
 */
export type GovernanceWeights = Record<GovernanceWeightKey, number>;

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
