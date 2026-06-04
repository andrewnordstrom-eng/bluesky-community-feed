/**
 * Votable Parameter Configuration
 *
 * Central source of truth for governance weight parameters.
 * Extending weight voting should start here, then flow into DB/schema updates.
 */

import type {
  GovernanceWeightKey,
  VotableWeightParam as SharedVotableWeightParam,
} from '../shared/api-types.js';

/**
 * Backend-specific extension with DB column mapping.
 *
 * PROJ-816: `voteField` widened from a 5-value literal union to `string`.
 * The value is computed from `key` at array-construction time via
 * `voteFieldForKey(key)` so adding a new component is no longer a TypeScript
 * compile error. The field is removed entirely in PROJ-819 (P5) once the
 * wide columns are dropped.
 */
export interface VotableWeightParam extends SharedVotableWeightParam {
  voteField: string;
}

/**
 * Compute the snake_case wide-column name for a given component key.
 * Used by both the static `VOTABLE_WEIGHT_PARAMS` array below and by any
 * future generated component entry. Lives here so the convention is in one
 * place.
 */
export function voteFieldForKey(key: GovernanceWeightKey): string {
  // camelCase → snake_case, then suffix _weight
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `${snake}_weight`;
}

export const VOTABLE_WEIGHT_PARAMS: readonly VotableWeightParam[] = [
  {
    key: 'recency',
    voteField: voteFieldForKey('recency'),
    label: 'Recency',
    description: 'Favor newer posts over older posts',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'engagement',
    voteField: voteFieldForKey('engagement'),
    label: 'Engagement',
    description: 'Favor posts with likes, replies, and reposts',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'bridging',
    voteField: voteFieldForKey('bridging'),
    label: 'Bridging',
    description: 'Favor posts that bridge communities',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'sourceDiversity',
    voteField: voteFieldForKey('sourceDiversity'),
    label: 'Source Diversity',
    description: 'Avoid over-concentration from a small set of authors',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'relevance',
    voteField: voteFieldForKey('relevance'),
    label: 'Relevance',
    description: 'Favor posts matching feed themes',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  // GENERATOR_PARAM_ANCHOR — do not remove
];

/**
 * Backwards-compat alias for `string` — the literal union of 5 wide-column
 * snake_case names was the source of truth before PROJ-816 widened it.
 * Kept so callers that imported `GovernanceWeightVoteField` keep working;
 * removed entirely in PROJ-819 (P5) along with the wide columns.
 */
export type GovernanceWeightVoteField = string;

export { type GovernanceWeightKey } from '../shared/api-types.js';
export const GOVERNANCE_WEIGHT_KEYS = VOTABLE_WEIGHT_PARAMS.map((param) => param.key) as ReadonlyArray<GovernanceWeightKey>;
export const GOVERNANCE_WEIGHT_VOTE_FIELDS = VOTABLE_WEIGHT_PARAMS.map((param) => param.voteField) as ReadonlyArray<GovernanceWeightVoteField>;

export function createDefaultGovernanceWeightRecord(): Record<GovernanceWeightKey, number> {
  return Object.fromEntries(
    VOTABLE_WEIGHT_PARAMS.map((param) => [param.key, param.defaultValue] as const)
  ) as Record<GovernanceWeightKey, number>;
}
