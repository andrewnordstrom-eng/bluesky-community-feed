import { normalizeShadowWeights } from './weights.js';
import {
  SHADOW_DEMO_SYNTHETIC_VOTER_COUNT,
  SHADOW_DEMO_VOTER_BLOC_IDS,
  type ShadowDemoSyntheticVoterId,
  type ShadowDemoVoterBlocId,
  type ShadowDemoVote,
  type ShadowDemoTopicIntent,
  type ShadowDemoWeights,
} from './types.js';

export interface SyntheticVoterBlocProfile {
  id: ShadowDemoVoterBlocId;
  label: string;
  voterCount: number;
  baseWeights: ShadowDemoWeights;
  baseTopicWeights: Record<string, number>;
  reviewerBlend: number;
  policyInertia: number;
}

const SYNTHETIC_VOTER_BLOC_PROFILES: SyntheticVoterBlocProfile[] = [
  {
    id: 'research_practitioner',
    label: 'Research Practitioners',
    voterCount: 5,
    reviewerBlend: 0.18,
    policyInertia: 0.27,
    baseWeights: {
      recency: 0.24,
      engagement: 0.08,
      bridging: 0.15,
      source_diversity: 0.16,
      relevance: 0.37,
    },
    baseTopicWeights: {
      'science-research': 0.9,
      'data-science': 0.7,
      'software-development': 0.45,
      'open-source': 0.5,
    },
  },
  {
    id: 'dataset_steward',
    label: 'Data Stewards',
    voterCount: 5,
    reviewerBlend: 0.22,
    policyInertia: 0.3,
    baseWeights: {
      recency: 0.08,
      engagement: 0.12,
      bridging: 0.18,
      source_diversity: 0.2,
      relevance: 0.42,
    },
    baseTopicWeights: {
      'science-research': 0.65,
      'data-science': 0.92,
      'software-development': 0.72,
      'open-source': 0.82,
    },
  },
  {
    id: 'current_awareness',
    label: 'Current-Awareness Readers',
    voterCount: 5,
    reviewerBlend: 0.2,
    policyInertia: 0.24,
    baseWeights: {
      recency: 0.42,
      engagement: 0.14,
      bridging: 0.12,
      source_diversity: 0.1,
      relevance: 0.22,
    },
    baseTopicWeights: {
      'science-research': 0.82,
      'data-science': 0.45,
      'software-development': 0.35,
      'open-source': 0.4,
    },
  },
  {
    id: 'community_discussant',
    label: 'Community Discussants',
    voterCount: 4,
    reviewerBlend: 0.16,
    policyInertia: 0.2,
    baseWeights: {
      recency: 0.13,
      engagement: 0.48,
      bridging: 0.09,
      source_diversity: 0.08,
      relevance: 0.22,
    },
    baseTopicWeights: {
      'science-research': 0.4,
      'data-science': 0.35,
      'software-development': 0.62,
      'open-source': 0.48,
    },
  },
  {
    id: 'interdisciplinary_connector',
    label: 'Interdisciplinary Connectors',
    voterCount: 5,
    reviewerBlend: 0.24,
    policyInertia: 0.32,
    baseWeights: {
      recency: 0.12,
      engagement: 0.1,
      bridging: 0.42,
      source_diversity: 0.2,
      relevance: 0.16,
    },
    baseTopicWeights: {
      'science-research': 0.78,
      'data-science': 0.8,
      'software-development': 0.82,
      'open-source': 0.8,
    },
  },
];

export function getShadowDemoVoterProfiles(): SyntheticVoterBlocProfile[] {
  return SYNTHETIC_VOTER_BLOC_PROFILES.map((profile) => ({
    ...profile,
    baseWeights: { ...profile.baseWeights },
    baseTopicWeights: { ...profile.baseTopicWeights },
  }));
}

export function createSyntheticVoterVotes(options: {
  seed: string;
  epochId: string;
  communityId: string;
  reviewerWeights: ShadowDemoWeights;
  reviewerTopicIntent: ShadowDemoTopicIntent;
  priorCommunityWeights: ShadowDemoWeights;
  priorTopicIntent: ShadowDemoTopicIntent;
  createdAt: string;
}): ShadowDemoVote[] {
  return SYNTHETIC_VOTER_BLOC_PROFILES.flatMap((profile) =>
    Array.from({ length: profile.voterCount }, (_unused, voterIndex) => {
      const voterNumber = voterIndex + 1;
      const actorId = syntheticVoterId(profile.id, voterNumber);
      const blended = {} as ShadowDemoWeights;
      const baseBlend = 1 - profile.reviewerBlend - profile.policyInertia;
      for (const key of Object.keys(profile.baseWeights) as Array<keyof ShadowDemoWeights>) {
        const jitter = deterministicJitter(
          `${options.seed}:${options.communityId}:${options.epochId}:${actorId}:${key}`
        );
        const base = profile.baseWeights[key] * baseBlend;
        const reviewer = options.reviewerWeights[key] * profile.reviewerBlend;
        const priorPolicy = options.priorCommunityWeights[key] * profile.policyInertia;
        blended[key] = Math.max(0.001, base + reviewer + priorPolicy + jitter);
      }

      const topicIntent = syntheticTopicIntent({
        profile,
        actorId,
        seed: options.seed,
        communityId: options.communityId,
        epochId: options.epochId,
        reviewerTopicIntent: options.reviewerTopicIntent,
        priorTopicIntent: options.priorTopicIntent,
      });

      return {
        id: `vote-${actorId}-${options.epochId}`,
        epochId: options.epochId,
        actorType: 'synthetic_voter',
        actorId,
        blocId: profile.id,
        label: `${profile.label} voter ${voterNumber}`,
        weights: normalizeShadowWeights(blended),
        topicIntent,
        createdAt: options.createdAt,
      };
    })
  );
}

export function assertSyntheticVoterProfiles(): void {
  const configured = new Set(SYNTHETIC_VOTER_BLOC_PROFILES.map((profile) => profile.id));
  for (const id of SHADOW_DEMO_VOTER_BLOC_IDS) {
    if (!configured.has(id)) {
      throw new Error(`Missing shadow demo voter bloc profile for ${id}`);
    }
  }
  for (const profile of SYNTHETIC_VOTER_BLOC_PROFILES) {
    if (profile.reviewerBlend < 0 || profile.policyInertia < 0 || profile.reviewerBlend + profile.policyInertia >= 1) {
      throw new Error(`Invalid shadow demo blend configuration for ${profile.id}`);
    }
  }
  const configuredVoterCount = SYNTHETIC_VOTER_BLOC_PROFILES.reduce(
    (sum, profile) => sum + profile.voterCount,
    0
  );
  if (configuredVoterCount !== SHADOW_DEMO_SYNTHETIC_VOTER_COUNT) {
    throw new Error(
      `Shadow demo synthetic voter count must be ${SHADOW_DEMO_SYNTHETIC_VOTER_COUNT}; received ${configuredVoterCount}`
    );
  }
}

function syntheticTopicIntent(options: {
  profile: SyntheticVoterBlocProfile;
  actorId: ShadowDemoSyntheticVoterId;
  seed: string;
  communityId: string;
  epochId: string;
  reviewerTopicIntent: ShadowDemoTopicIntent;
  priorTopicIntent: ShadowDemoTopicIntent;
}): ShadowDemoTopicIntent {
  const slugs = Array.from(new Set([
    ...Object.keys(options.profile.baseTopicWeights),
    ...Object.keys(options.reviewerTopicIntent.topicWeights),
    ...Object.keys(options.priorTopicIntent.topicWeights),
  ])).sort();
  const baseBlend = 1 - options.profile.reviewerBlend - options.profile.policyInertia;
  const topicWeights: Record<string, number> = {};
  for (const slug of slugs) {
    const base = (options.profile.baseTopicWeights[slug] ?? 0.2) * baseBlend;
    const reviewer = (options.reviewerTopicIntent.topicWeights[slug] ?? 0.2) * options.profile.reviewerBlend;
    const prior = (options.priorTopicIntent.topicWeights[slug] ?? 0.2) * options.profile.policyInertia;
    const jitter = deterministicJitter(
      `${options.seed}:${options.communityId}:${options.epochId}:${options.actorId}:topic:${slug}`
    );
    topicWeights[slug] = Math.min(1, Math.max(0, Number((base + reviewer + prior + jitter).toFixed(3))));
  }
  return { topicWeights };
}

function syntheticVoterId(
  blocId: ShadowDemoVoterBlocId,
  voterNumber: number
): ShadowDemoSyntheticVoterId {
  return `synthetic-${blocId}-${voterNumber}` as ShadowDemoSyntheticVoterId;
}

function deterministicJitter(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (hash >>> 0) / 0xffffffff;
  return (unit - 0.5) * 0.025;
}
