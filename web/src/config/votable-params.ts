import type { GovernanceWeightKey, GovernanceWeights, VotableWeightParam } from '@shared/api-types';

export type { GovernanceWeightKey, GovernanceWeights, VotableWeightParam };

export const VOTABLE_WEIGHT_PARAMS: readonly VotableWeightParam[] = [
  {
    key: 'recency',
    label: 'Recency',
    description: 'How much to favor newer posts over older ones',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'engagement',
    label: 'Engagement',
    description: 'How much to favor posts with more likes, reposts, and replies',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'bridging',
    label: 'Bridging',
    description: 'How much to favor posts that appeal across different communities',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'sourceDiversity',
    label: 'Source diversity',
    description: 'How much to penalize seeing too many posts from the same author',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
  {
    key: 'relevance',
    label: 'Relevance',
    description: 'How much to favor posts matching your interests (future feature)',
    min: 0,
    max: 1,
    defaultValue: 0.2,
  },
] as const;

export const GOVERNANCE_WEIGHT_KEYS = VOTABLE_WEIGHT_PARAMS.map((param) => param.key) as ReadonlyArray<GovernanceWeightKey>;

export const DEFAULT_GOVERNANCE_WEIGHTS: GovernanceWeights = Object.fromEntries(
  VOTABLE_WEIGHT_PARAMS.map((param) => [param.key, param.defaultValue] as const)
) as unknown as GovernanceWeights;
