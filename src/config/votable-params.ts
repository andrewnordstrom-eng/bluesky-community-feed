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

/** Backend-specific extension with DB column mapping. */
export interface VotableWeightParam extends SharedVotableWeightParam {
  voteField: 'recency_weight' | 'engagement_weight' | 'bridging_weight' | 'source_diversity_weight' | 'relevance_weight';
}

export const VOTABLE_WEIGHT_PARAMS: readonly VotableWeightParam[] = [
  {
    key: 'recency',
    voteField: 'recency_weight',
    label: 'Recency',
    description: 'Favor newer posts over older posts',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'engagement',
    voteField: 'engagement_weight',
    label: 'Engagement',
    description: 'Favor posts with likes, replies, and reposts',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'bridging',
    voteField: 'bridging_weight',
    label: 'Bridging',
    description: 'Favor posts that bridge communities',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'sourceDiversity',
    voteField: 'source_diversity_weight',
    label: 'Source Diversity',
    description: 'Avoid over-concentration from a small set of authors',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'relevance',
    voteField: 'relevance_weight',
    label: 'Relevance',
    description: 'Favor posts matching feed themes',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  // GENERATOR_PARAM_ANCHOR — do not remove
] as const;

export type GovernanceWeightVoteField = (typeof VOTABLE_WEIGHT_PARAMS)[number]['voteField'];

export { type GovernanceWeightKey } from '../shared/api-types.js';
export const GOVERNANCE_WEIGHT_KEYS = VOTABLE_WEIGHT_PARAMS.map((param) => param.key) as ReadonlyArray<GovernanceWeightKey>;
export const GOVERNANCE_WEIGHT_VOTE_FIELDS = VOTABLE_WEIGHT_PARAMS.map((param) => param.voteField) as ReadonlyArray<GovernanceWeightVoteField>;

export function createDefaultGovernanceWeightRecord(): Record<GovernanceWeightKey, number> {
  return Object.fromEntries(
    VOTABLE_WEIGHT_PARAMS.map((param) => [param.key, param.defaultValue] as const)
  ) as Record<GovernanceWeightKey, number>;
}
