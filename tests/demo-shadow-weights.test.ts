import { describe, expect, it } from 'vitest';
import {
  aggregateShadowVotes,
  explainTopicRelevance,
  scoreFromRawWeights,
  validateShadowWeights,
} from '../src/demo/weights.js';
import { scoreTopicVectorRelevance } from '../src/scoring/components/relevance.js';
import {
  SHADOW_DEMO_SYNTHETIC_VOTER_COUNT,
  SHADOW_DEMO_TOTAL_DEMO_VOTERS,
  type ShadowDemoWeights,
} from '../src/demo/types.js';
import {
  assertSyntheticVoterProfiles,
  createSyntheticVoterVotes,
  getShadowDemoVoterProfiles,
} from '../src/demo/synthetic-voters.js';
import { aggregateRowsWithTrimmedMean } from '../src/governance/aggregation-math.js';
import { validateShadowTopicIntentForCatalog } from '../src/demo/topic-intent.js';

const RECENCY_ONLY: ShadowDemoWeights = {
  recency: 1,
  engagement: 0,
  bridging: 0,
  source_diversity: 0,
  relevance: 0,
};

const ENGAGEMENT_ONLY: ShadowDemoWeights = {
  recency: 0,
  engagement: 1,
  bridging: 0,
  source_diversity: 0,
  relevance: 0,
};

const TOPIC_INTENT = {
  topicWeights: {
    'science-research': 0.9,
    'data-science': 0.75,
    'software-development': 0.7,
    'open-source': 0.8,
  },
};

describe('shadow demo weight math', () => {
  it('rejects duplicate slugs in a dynamic topic catalog before validating a vote', () => {
    const catalog = Array.from({ length: 26 }, (_unused, index) => `topic-${index}`);
    catalog[25] = catalog[0];
    expect(() => validateShadowTopicIntentForCatalog(
      { topicWeights: Object.fromEntries(catalog.map((slug) => [slug, 0.5])) },
      catalog
    )).toThrow(/unique topic slugs/);
  });

  it('validates finite non-negative weights that sum to one', () => {
    expect(validateShadowWeights(RECENCY_ONLY)).toEqual(RECENCY_ONLY);
    expect(() =>
      validateShadowWeights({
        recency: 0.5,
        engagement: 0.5,
        bridging: 0,
        source_diversity: 0,
        relevance: 0.2,
      })
    ).toThrow(/sum to 1.0/);
    expect(() =>
      validateShadowWeights({
        recency: Number.NaN,
        engagement: 1,
        bridging: 0,
        source_diversity: 0,
        relevance: 0,
      })
    ).toThrow(/finite/);
    expect(() =>
      validateShadowWeights({
        recency: -0.5,
        engagement: 1.5,
        bridging: 0,
        source_diversity: 0,
        relevance: 0,
      })
    ).toThrow(/non-negative/);
    expect(() => validateShadowWeights({
      recency: 0,
      engagement: 0,
      bridging: 0,
      source_diversity: 0,
      relevance: 0,
    })).toThrow(/sum to 1.0/);
  });

  it('rejects an empty electorate', () => {
    expect(() => aggregateShadowVotes([])).toThrow('Cannot aggregate zero shadow demo votes');
  });

  it('uses the stored relevance score when topic intent is empty', () => {
    const scored = scoreFromRawWeights(
      { recency: 0.5, engagement: 0.8, bridging: 0.25, source_diversity: 1, relevance: 0.4 },
      { recency: 0.2, engagement: 0.3, bridging: 0.1, source_diversity: 0.1, relevance: 0.3 },
      { 'science-research': 0.8 },
      { topicWeights: {} }
    );

    expect(scored.effectiveRawScores.relevance).toBe(0.4);
  });

  it('does not trim small electorates below ten votes', () => {
    const summary = aggregateShadowVotes([RECENCY_ONLY, ENGAGEMENT_ONLY]);

    expect(summary.aggregateMethod).toBe('trimmed_mean_no_trim_under_10');
    expect(summary.voteCount).toBe(2);
    expect(summary.trimCount).toBe(0);
    expect(summary.weights.recency).toBe(0.5);
    expect(summary.weights.engagement).toBe(0.5);
  });

  it('does not trim exactly nine votes', () => {
    const summary = aggregateShadowVotes(Array(9).fill(RECENCY_ONLY));

    expect(summary.aggregateMethod).toBe('trimmed_mean_no_trim_under_10');
    expect(summary.voteCount).toBe(9);
    expect(summary.trimCount).toBe(0);
  });

  it('trims extremes once ten or more votes exist', () => {
    const middle: ShadowDemoWeights = {
      recency: 0.5,
      engagement: 0.5,
      bridging: 0,
      source_diversity: 0,
      relevance: 0,
    };
    const summary = aggregateShadowVotes([
      RECENCY_ONLY,
      ENGAGEMENT_ONLY,
      middle,
      middle,
      middle,
      middle,
      middle,
      middle,
      middle,
      middle,
    ]);

    expect(summary.voteCount).toBe(10);
    expect(summary.trimCount).toBe(1);
    expect(summary.weights.recency).toBe(0.5);
    expect(summary.weights.engagement).toBe(0.5);
  });

  it('rejects malformed rows before trimmed-mean arithmetic', () => {
    expect(() =>
      aggregateRowsWithTrimmedMean({
        rows: [{ recency: 0.5 }, { recency: Number.NaN }],
        components: ['recency'],
      })
    ).toThrow(/component recency at row 1/);
    expect(() =>
      aggregateRowsWithTrimmedMean({
        rows: [{ recency: 0.5 }, {}],
        components: ['recency'],
      })
    ).toThrow(/component recency at row 1/);
  });

  it('generates twenty-four deterministic synthetic voters across visible blocs', () => {
    assertSyntheticVoterProfiles();
    const profiles = getShadowDemoVoterProfiles('open_science_builders');
    const profileVoteCount = profiles.reduce((sum, profile) => sum + profile.voterCount, 0);
    const syntheticVotes = createSyntheticVoterVotes({
      seed: 'session-seed',
      epochId: 'shadow-epoch-1',
      communityId: 'open_science_builders',
      reviewerWeights: RECENCY_ONLY,
      reviewerTopicIntent: TOPIC_INTENT,
      priorCommunityWeights: ENGAGEMENT_ONLY,
      priorTopicIntent: TOPIC_INTENT,
      createdAt: '2026-07-09T12:00:00.000Z',
    });
    const repeatedVotes = createSyntheticVoterVotes({
      seed: 'session-seed',
      epochId: 'shadow-epoch-1',
      communityId: 'open_science_builders',
      reviewerWeights: RECENCY_ONLY,
      reviewerTopicIntent: TOPIC_INTENT,
      priorCommunityWeights: ENGAGEMENT_ONLY,
      priorTopicIntent: TOPIC_INTENT,
      createdAt: '2026-07-09T12:00:00.000Z',
    });

    expect(profileVoteCount).toBe(SHADOW_DEMO_SYNTHETIC_VOTER_COUNT);
    expect(syntheticVotes).toHaveLength(SHADOW_DEMO_SYNTHETIC_VOTER_COUNT);
    expect(syntheticVotes).toEqual(repeatedVotes);
    expect(new Set(syntheticVotes.map((vote) => vote.actorId)).size).toBe(SHADOW_DEMO_SYNTHETIC_VOTER_COUNT);
    expect(new Set(syntheticVotes.map((vote) => vote.blocId))).toEqual(
      new Set([
        'research_practitioner',
        'dataset_steward',
        'current_awareness',
        'community_discussant',
        'interdisciplinary_connector',
      ])
    );
  });

  it('exercises production trimming with reviewer plus synthetic voters', () => {
    const syntheticVotes = createSyntheticVoterVotes({
      seed: 'session-seed',
      epochId: 'shadow-epoch-1',
      communityId: 'open_science_builders',
      reviewerWeights: RECENCY_ONLY,
      reviewerTopicIntent: TOPIC_INTENT,
      priorCommunityWeights: ENGAGEMENT_ONLY,
      priorTopicIntent: TOPIC_INTENT,
      createdAt: '2026-07-09T12:00:00.000Z',
    });
    const summary = aggregateShadowVotes([
      { weights: RECENCY_ONLY, topicIntent: TOPIC_INTENT },
      ...syntheticVotes,
    ]);

    expect(summary.voteCount).toBe(SHADOW_DEMO_TOTAL_DEMO_VOTERS);
    expect(summary.trimCount).toBe(2);
  });

  it('inherits unspecified general-bloc topic preferences from the prior production policy', () => {
    const votes = createSyntheticVoterVotes({
      seed: 'community-gov-seed',
      epochId: 'shadow-epoch-1',
      communityId: 'community_gov',
      reviewerWeights: RECENCY_ONLY,
      reviewerTopicIntent: { topicWeights: { 'decentralized-social': 0.1 } },
      priorCommunityWeights: ENGAGEMENT_ONLY,
      priorTopicIntent: { topicWeights: { 'decentralized-social': 0.9, 'science-research': 0.82 } },
      createdAt: '2026-07-11T12:00:00.000Z',
    });

    expect(votes).toHaveLength(24);
    for (const vote of votes) {
      expect(vote.topicIntent.topicWeights['decentralized-social']).toBeGreaterThan(0.7);
      expect(vote.topicIntent.topicWeights['decentralized-social']).toBeLessThan(0.78);
      expect(vote.topicIntent.topicWeights['science-research']).toBeGreaterThan(0.68);
      expect(vote.topicIntent.topicWeights['science-research']).toBeLessThan(0.72);
      expect(Object.values(vote.topicIntent.topicWeights).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });

  it('rejects unknown community IDs instead of silently selecting voter profiles', () => {
    expect(() => getShadowDemoVoterProfiles('unknown' as never)).toThrow(/Unsupported shadow demo community/);
  });

  it('carries prior-policy inertia across otherwise identical epoch proposals', () => {
    const common = {
      seed: 'session-seed',
      epochId: 'shadow-epoch-2',
      communityId: 'open_science_builders',
      reviewerWeights: RECENCY_ONLY,
      reviewerTopicIntent: TOPIC_INTENT,
      priorTopicIntent: TOPIC_INTENT,
      createdAt: '2026-07-09T12:00:00.000Z',
    };
    const engagementHistory = createSyntheticVoterVotes({
      ...common,
      priorCommunityWeights: ENGAGEMENT_ONLY,
    });
    const recencyHistory = createSyntheticVoterVotes({
      ...common,
      priorCommunityWeights: RECENCY_ONLY,
    });

    expect(engagementHistory).not.toEqual(recencyHistory);
    const engagementAggregate = aggregateShadowVotes(engagementHistory);
    const recencyAggregate = aggregateShadowVotes(recencyHistory);
    expect(recencyAggregate.weights.recency).toBeGreaterThan(engagementAggregate.weights.recency);
    expect(engagementAggregate.weights.engagement).toBeGreaterThan(recencyAggregate.weights.engagement);
  });

  it('keeps receipt contribution math equal to displayed total', () => {
    const scored = scoreFromRawWeights(
      {
        recency: 0.5,
        engagement: 0.8,
        bridging: 0.25,
        source_diversity: 1,
        relevance: 0.4,
      },
      {
        recency: 0.2,
        engagement: 0.3,
        bridging: 0.1,
        source_diversity: 0.1,
        relevance: 0.3,
      },
      { 'science-research': 0.8 },
      TOPIC_INTENT
    );
    const contributionSum = Object.values(scored.weightedComponents).reduce(
      (sum, value) => sum + value,
      0
    );

    expect(scored.score).toBeCloseTo(0.735, 6);
    expect(contributionSum).toBeCloseTo(scored.score, 6);
  });

  it('reconstructs the production topic relevance formula exactly', () => {
    const topicVector = {
      'science-research': 0.42,
      'open-source': 0.18,
      politics: 0.1,
    };
    const formula = explainTopicRelevance(0.31, topicVector, TOPIC_INTENT);
    const productionValue = scoreTopicVectorRelevance(topicVector, TOPIC_INTENT.topicWeights);

    expect(formula.formulaApplied).toBe(true);
    expect(formula.weightedSum).toBeCloseTo(0.542, 6);
    expect(formula.signalSum).toBeCloseTo(0.7, 6);
    expect(formula.confidenceMultiplier).toBe(1);
    expect(formula.effectiveRelevance).toBeCloseTo(0.774286, 6);
    expect(formula.effectiveRelevance).toBeCloseTo(productionValue, 6);
    expect(formula.terms.find((term) => term.topic === 'politics')).toMatchObject({
      communityWeight: 0.2,
      usedDefaultWeight: true,
    });
  });

  it('explains stored, zero-signal, confidence-damped, and explicit-zero relevance cases', () => {
    expect(explainTopicRelevance(0.31, {}, TOPIC_INTENT)).toMatchObject({
      formulaApplied: true,
      weightedSum: 0,
      signalSum: 0,
      baseRelevance: 0.2,
      effectiveRelevance: scoreTopicVectorRelevance({}, TOPIC_INTENT.topicWeights),
    });
    expect(explainTopicRelevance(0.31, { 'science-research': 0 }, TOPIC_INTENT)).toMatchObject({
      formulaApplied: true,
      weightedSum: 0,
      signalSum: 0,
      effectiveRelevance: 0.2,
    });
    expect(explainTopicRelevance(
      0.31,
      { 'science-research': 0.25 },
      { topicWeights: { 'science-research': 0.8 } }
    )).toMatchObject({
      baseRelevance: 0.8,
      confidenceMultiplier: 0.5,
      effectiveRelevance: 0.4,
    });
    expect(explainTopicRelevance(
      0.31,
      { 'science-research': 0.5 },
      { topicWeights: { 'science-research': 0 } }
    )).toMatchObject({
      baseRelevance: 0,
      confidenceMultiplier: 1,
      effectiveRelevance: 0,
      usedDefaultWeight: false,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'keeps production and receipt relevance finite for non-finite topic signal %s',
    (invalidSignal) => {
      const topicVector = { 'science-research': invalidSignal };
      const production = scoreTopicVectorRelevance(topicVector, TOPIC_INTENT.topicWeights);
      const explanation = explainTopicRelevance(0.31, topicVector, TOPIC_INTENT);

      expect(production).toBe(0.2);
      expect(explanation).toMatchObject({
        weightedSum: 0,
        signalSum: 0,
        effectiveRelevance: production,
      });
    }
  );

  it('treats a non-finite community topic weight as the neutral default in both paths', () => {
    const topicVector = { 'science-research': 0.5 };
    const topicIntent = { topicWeights: { 'science-research': Number.NaN } };
    const production = scoreTopicVectorRelevance(topicVector, topicIntent.topicWeights);
    const explanation = explainTopicRelevance(0.31, topicVector, topicIntent);

    expect(production).toBe(0.2);
    expect(explanation.effectiveRelevance).toBe(production);
    expect(explanation.usedDefaultWeight).toBe(true);
  });
});
