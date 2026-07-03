// Governance API contract types.
//
// Mirrored from the backend source of truth:
//   bluesky-community-feed/src/shared/api-types.ts
// Keep these in sync when the governance weight / content-rule shapes change.
// (Extracted here so web-next stays a self-contained frontend package rather
// than reaching into the backend src tree via a path alias.)

export type GovernanceWeightKey = string

export type GovernanceWeights = Record<GovernanceWeightKey, number>

/**
 * Configuration for a votable weight parameter.
 * Shared base — the backend extends this with `voteField` for DB column mapping.
 */
export interface VotableWeightParam {
  key: GovernanceWeightKey
  label: string
  description: string
  min: number
  max: number
  defaultValue: number
}

export interface ContentRules {
  /** Posts must contain at least one of these keywords (OR logic). */
  includeKeywords: string[]
  /** Posts containing any of these keywords are filtered out (OR logic, takes precedence). */
  excludeKeywords: string[]
}
