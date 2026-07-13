import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  aggregateVotesMock,
  aggregateContentVotesMock,
  aggregateTopicWeightsMock,
  readEpochWeightsMock,
  announceVotingClosedMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  aggregateVotesMock: vi.fn(),
  aggregateContentVotesMock: vi.fn(),
  aggregateTopicWeightsMock: vi.fn(),
  readEpochWeightsMock: vi.fn(),
  announceVotingClosedMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/governance/aggregation.js', () => ({
  aggregateVotes: aggregateVotesMock,
  aggregateContentVotes: aggregateContentVotesMock,
  aggregateTopicWeights: aggregateTopicWeightsMock,
}));

vi.mock('../src/governance/weight-longtable.js', () => ({
  readEpochWeights: readEpochWeightsMock,
}));

vi.mock('../src/bot/governance-announcements.js', () => ({
  announceVotingClosed: announceVotingClosedMock,
  announceVotingOpen: vi.fn(),
  announceVotingReminder: vi.fn(),
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { checkScheduledTransitions } from '../src/scheduler/epoch-scheduler.js';

describe('production governance lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: vi.fn(),
    });
    dbQueryMock.mockImplementation((sql: string) => {
      if (sql.includes('FROM scheduled_votes')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("voting_ends_at > NOW() + INTERVAL '23 hours'")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("phase = 'voting'") && sql.includes('voting_ends_at <= NOW()')) {
        return Promise.resolve({ rows: [{ id: 7 }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it('moves an expired vote to review with all three proposed policy channels', async () => {
    const signalWeights = {
      recency: 0.1,
      engagement: 0.2,
      bridging: 0.25,
      sourceDiversity: 0.15,
      relevance: 0.3,
    };
    const topicWeights = {
      'science-research': 0.9,
      'software-development': 0.75,
    };
    const contentRules = {
      includeKeywords: ['research'],
      excludeKeywords: ['spam'],
    };

    aggregateVotesMock.mockResolvedValue(signalWeights);
    aggregateTopicWeightsMock.mockResolvedValue(topicWeights);
    aggregateContentVotesMock.mockResolvedValue(contentRules);
    readEpochWeightsMock.mockResolvedValue({
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    });
    announceVotingClosedMock.mockResolvedValue(undefined);

    clientQueryMock.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT *') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [{
            id: 7,
            phase: 'voting',
            voting_ends_at: '2026-07-13T00:00:00.000Z',
            content_rules: { include_keywords: [], exclude_keywords: [] },
            topic_weights: { 'science-research': 0.5 },
            recency_weight: 0.2,
            engagement_weight: 0.2,
            bridging_weight: 0.2,
            source_diversity_weight: 0.2,
            relevance_weight: 0.2,
          }],
        });
      }
      if (sql.includes('COUNT(*)::int AS total')) {
        return Promise.resolve({ rows: [{ total: '25', content: '8', topic: '25' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await checkScheduledTransitions();

    expect(result).toEqual({
      startedVotes: 0,
      transitionedToResults: 1,
      remindersSent: 0,
      errors: 0,
    });

    const resultsUpdate = clientQueryMock.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes("SET phase = 'results'")
    );
    expect(resultsUpdate?.[1]).toEqual([
      JSON.stringify(signalWeights),
      JSON.stringify({ include_keywords: ['research'], exclude_keywords: ['spam'] }),
      JSON.stringify(topicWeights),
      7,
    ]);
    expect(aggregateTopicWeightsMock).toHaveBeenCalledWith(7);
    expect(announceVotingClosedMock).toHaveBeenCalledWith({ id: 7 }, 25);
  });

  it('does not close a voting window that was extended before the row lock', async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT *') && sql.includes('FOR UPDATE')) {
        expect(sql).toContain("auto_transition = TRUE");
        expect(sql).toContain('voting_ends_at <= NOW()');
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await checkScheduledTransitions();

    expect(result).toEqual({
      startedVotes: 0,
      transitionedToResults: 0,
      remindersSent: 0,
      errors: 0,
    });
    expect(aggregateVotesMock).not.toHaveBeenCalled();
    expect(aggregateTopicWeightsMock).not.toHaveBeenCalled();
    expect(aggregateContentVotesMock).not.toHaveBeenCalled();
    expect(announceVotingClosedMock).not.toHaveBeenCalled();
  });
});
