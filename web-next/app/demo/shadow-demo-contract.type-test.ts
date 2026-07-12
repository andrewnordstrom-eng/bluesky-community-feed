import { SHADOW_DEMO_CONTRACT_VERSION } from './shadow-demo-contract';
import type { ShadowDemoEnvelope } from './shadow-demo-view-model';
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
  actorId: 'synthetic-freshness_watcher-1',
  blocId: 'freshness_watcher',
  label: 'Research practitioner voter 1',
  weights,
  topicIntent: { topicWeights: {} },
  createdAt: '2026-07-10T00:00:00.000Z',
};

const v4Envelope: ShadowDemoEnvelope<null> = {
  contractVersion: SHADOW_DEMO_CONTRACT_VERSION,
  requestId: 'request-v4',
  generatedAt: '2026-07-11T00:00:00.000Z',
  sessionId: null,
  payload: null,
  warnings: [],
};

// @ts-expect-error Reviewer votes cannot carry a synthetic voter id.
const invalidReviewerVote: ShadowDemoVote = {
  ...reviewerVote,
  actorId: 'synthetic-freshness_watcher-1',
};

// @ts-expect-error Synthetic votes must carry their bloc id.
const invalidSyntheticVote: ShadowDemoVote = {
  ...syntheticVote,
  blocId: undefined,
};

void [reviewerVote, syntheticVote, invalidReviewerVote, invalidSyntheticVote, v4Envelope];
