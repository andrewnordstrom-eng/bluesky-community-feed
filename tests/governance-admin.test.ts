import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  invalidateContentRulesCacheMock,
  invalidateGovernanceGateCacheMock,
  aggregateVotesMock,
  aggregateContentVotesMock,
  aggregateTopicWeightsMock,
  writeEpochWeightsMock,
  tryTriggerManualScoringRunMock,
  forceEpochTransitionMock,
  triggerEpochTransitionMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  invalidateContentRulesCacheMock: vi.fn(),
  invalidateGovernanceGateCacheMock: vi.fn(),
  aggregateVotesMock: vi.fn(),
  aggregateContentVotesMock: vi.fn(),
  aggregateTopicWeightsMock: vi.fn(),
  writeEpochWeightsMock: vi.fn(),
  tryTriggerManualScoringRunMock: vi.fn(),
  forceEpochTransitionMock: vi.fn(),
  triggerEpochTransitionMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/governance/content-filter.js', () => ({
  invalidateContentRulesCache: invalidateContentRulesCacheMock,
}));

vi.mock('../src/ingestion/governance-gate.js', () => ({
  invalidateGovernanceGateCache: invalidateGovernanceGateCacheMock,
}));

vi.mock('../src/governance/aggregation.js', () => ({
  aggregateVotes: aggregateVotesMock,
  aggregateContentVotes: aggregateContentVotesMock,
  aggregateTopicWeights: aggregateTopicWeightsMock,
}));

vi.mock('../src/governance/weight-longtable.js', () => ({
  readEpochWeightsForMultipleEpochs: vi.fn().mockResolvedValue({}),
  writeEpochWeights: writeEpochWeightsMock,
}));

vi.mock('../src/scoring/scheduler.js', () => ({
  tryTriggerManualScoringRun: tryTriggerManualScoringRunMock,
}));

vi.mock('../src/governance/epoch-manager.js', () => ({
  forceEpochTransition: forceEpochTransitionMock,
  triggerEpochTransition: triggerEpochTransitionMock,
}));

import { registerGovernanceRoutes } from '../src/admin/routes/governance.js';

function epochRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    status: 'active',
    voting_ends_at: '2026-02-10T00:00:00.000Z',
    auto_transition: true,
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    content_rules: {
      include_keywords: ['ai'],
      exclude_keywords: ['spam'],
    },
    topic_weights: {
      'software-development': 0.5,
    },
    proposed_weights: null,
    proposed_topic_weights: null,
    proposed_content_rules: null,
    created_at: '2026-02-08T00:00:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

describe('admin governance routes', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    dbConnectMock.mockReset();
    clientQueryMock.mockReset();
    invalidateContentRulesCacheMock.mockReset();
    invalidateGovernanceGateCacheMock.mockReset();
    aggregateVotesMock.mockReset();
    aggregateContentVotesMock.mockReset();
    aggregateTopicWeightsMock.mockReset();
    writeEpochWeightsMock.mockReset();
    tryTriggerManualScoringRunMock.mockReset();
    forceEpochTransitionMock.mockReset();
    triggerEpochTransitionMock.mockReset();

    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: vi.fn(),
    });

    invalidateContentRulesCacheMock.mockResolvedValue(undefined);
    invalidateGovernanceGateCacheMock.mockResolvedValue(undefined);
    tryTriggerManualScoringRunMock.mockReturnValue(true);
    aggregateVotesMock.mockResolvedValue(null);
    aggregateContentVotesMock.mockResolvedValue({ includeKeywords: [], excludeKeywords: [] });
    aggregateTopicWeightsMock.mockResolvedValue({});
    writeEpochWeightsMock.mockResolvedValue(undefined);
    forceEpochTransitionMock.mockResolvedValue(8);
    triggerEpochTransitionMock.mockResolvedValue({ success: true, newEpochId: 8 });
  });

  it('rejects keyword add when keyword has special characters', async () => {
    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/content-rules/keyword',
      payload: {
        type: 'include',
        keyword: 'bad@keyword',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(clientQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns 409 when adding duplicate keyword', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow()] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/content-rules/keyword',
      payload: {
        type: 'include',
        keyword: 'ai',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'Conflict' });

    await app.close();
  });

  it('requires confirmation when removing last include keyword', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow({ content_rules: { include_keywords: ['only'], exclude_keywords: [] } })] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'DELETE',
      url: '/governance/content-rules/keyword',
      payload: {
        type: 'include',
        keyword: 'only',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'ConfirmationRequired' });

    await app.close();
  });

  it('normalizes weight override and triggers rescore', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/governance/weights',
      payload: {
        recency: 0.6,
        engagement: 0.2,
        bridging: 0.1,
        sourceDiversity: 0.05,
        relevance: 0.05,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const sum = Object.values(body.weights).reduce((acc: number, value: number) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(body.rescoreTriggered).toBe(true);
    expect(tryTriggerManualScoringRunMock).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('rejects negative weight override', async () => {
    const app = Fastify();
    app.setValidatorCompiler(() => () => true);
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'PATCH',
      url: '/governance/weights',
      payload: {
        recency: -0.1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'ValidationError' });
    expect(clientQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('extends voting and returns updated round', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'voting' })] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'voting', voting_ends_at: '2026-02-11T00:00:00.000Z' })] })
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/extend-voting',
      payload: { hours: 24 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      round: {
        votingEndsAt: '2026-02-11T00:00:00.000Z',
      },
    });

    await app.close();
  });

  it('legacy apply-results alias requires reviewed results and keeps policy without votes', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'results' })] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'running' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/apply-results',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      voteCount: 0,
      appliedWeights: false,
      weights: {
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.2,
        relevance: 0.2,
      },
    });
    expect(aggregateVotesMock).not.toHaveBeenCalled();

    const auditInsert = clientQueryMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO governance_audit_log')
    );
    expect(auditInsert).toBeTruthy();

    await app.close();
  });

  it('does not let the legacy apply-results alias bypass results review', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'voting' })] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/apply-results',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'ResultsNotPending' });
    expect(aggregateVotesMock).not.toHaveBeenCalled();
    expect(aggregateTopicWeightsMock).not.toHaveBeenCalled();
    expect(aggregateContentVotesMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('reviews and applies signal, topic, and content-rule proposals before rescoring', async () => {
    const proposedWeights = {
      recency: 0.1,
      engagement: 0.2,
      bridging: 0.25,
      sourceDiversity: 0.15,
      relevance: 0.3,
    };
    const proposedTopicWeights = {
      'science-research': 0.9,
      'software-development': 0.75,
    };
    const proposedContentRules = {
      include_keywords: ['research'],
      exclude_keywords: ['spam'],
    };

    aggregateVotesMock.mockResolvedValue(proposedWeights);
    aggregateTopicWeightsMock.mockResolvedValue(proposedTopicWeights);
    aggregateContentVotesMock.mockResolvedValue({
      includeKeywords: proposedContentRules.include_keywords,
      excludeKeywords: proposedContentRules.exclude_keywords,
    });

    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'voting' })] })
      .mockResolvedValueOnce({ rows: [{ total: '25', content: '8', topic: '25' }] })
      .mockResolvedValueOnce({
        rows: [epochRow({
          phase: 'results',
          proposed_weights: proposedWeights,
          proposed_topic_weights: proposedTopicWeights,
          proposed_content_rules: proposedContentRules,
        })],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerGovernanceRoutes(app);

    const closed = await app.inject({
      method: 'POST',
      url: '/governance/end-voting',
      payload: { announce: false },
    });

    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({
      voteCount: 25,
      proposedWeights,
      proposedTopicWeights,
      proposedContentRules: {
        includeKeywords: ['research'],
        excludeKeywords: ['spam'],
      },
    });

    clientQueryMock.mockReset();
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [epochRow({
          phase: 'results',
          proposed_weights: proposedWeights,
          proposed_topic_weights: proposedTopicWeights,
          proposed_content_rules: proposedContentRules,
        })],
      })
      .mockResolvedValueOnce({
        rows: [epochRow({
          phase: 'running',
          recency_weight: proposedWeights.recency,
          engagement_weight: proposedWeights.engagement,
          bridging_weight: proposedWeights.bridging,
          source_diversity_weight: proposedWeights.sourceDiversity,
          relevance_weight: proposedWeights.relevance,
          topic_weights: proposedTopicWeights,
          content_rules: proposedContentRules,
        })],
      })
      .mockResolvedValueOnce({ rows: [{ total: '25', content: '8', topic: '25' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const approved = await app.inject({
      method: 'POST',
      url: '/governance/approve-results',
      payload: { announce: false },
    });

    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      weights: proposedWeights,
      topicWeights: proposedTopicWeights,
      contentRules: {
        includeKeywords: ['research'],
        excludeKeywords: ['spam'],
      },
      rescoreTriggered: true,
    });
    expect(writeEpochWeightsMock).toHaveBeenCalledWith(expect.anything(), 7, proposedWeights);
    expect(invalidateContentRulesCacheMock).toHaveBeenCalledTimes(1);
    expect(invalidateGovernanceGateCacheMock).toHaveBeenCalledTimes(1);
    expect(tryTriggerManualScoringRunMock).toHaveBeenCalledWith();

    const update = clientQueryMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('topic_weights = $6')
    );
    expect(update?.[1]).toContain(JSON.stringify(proposedTopicWeights));

    await app.close();
  });
});
