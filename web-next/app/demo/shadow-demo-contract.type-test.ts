import type { ShadowDemoVote, ShadowDemoWeights } from './shadow-demo-contract';

const weights: ShadowDemoWeights = {
  recency: 0.2,
  engagement: 0.2,
  bridging: 0.2,
  source_diversity: 0.2,
  relevance: 0.2,
};

const reviewerVote: ShadowDemoVote = {
  id: 'reviewer-vote',
  epochId: 'epoch-1',
  actorType: 'reviewer',
  actorId: 'reviewer',
  label: 'Reviewer',
  weights,
  topicIntent: { topicWeights: {} },
  createdAt: '2026-07-10T00:00:00.000Z',
};

const syntheticVote: ShadowDemoVote = {
  id: 'synthetic-vote',
  epochId: 'epoch-1',
  actorType: 'synthetic_voter',
  actorId: 'synthetic-research_practitioner-1',
  blocId: 'research_practitioner',
  label: 'Research practitioner voter 1',
  weights,
  topicIntent: { topicWeights: {} },
  createdAt: '2026-07-10T00:00:00.000Z',
};

// @ts-expect-error Reviewer votes cannot carry a synthetic voter id.
const invalidReviewerVote: ShadowDemoVote = {
  ...reviewerVote,
  actorId: 'synthetic-research_practitioner-1',
};

// @ts-expect-error Synthetic votes must carry their bloc id.
const invalidSyntheticVote: ShadowDemoVote = {
  ...syntheticVote,
  blocId: undefined,
};

void [reviewerVote, syntheticVote, invalidReviewerVote, invalidSyntheticVote];
