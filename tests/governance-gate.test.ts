/**
 * Governance Gate Unit Tests
 *
 * Tests the governance gate module: pure relevance logic, fail-open
 * behavior, and Redis/DB caching for topic weights.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock, redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { checkGovernanceGate, isGovernanceGateReady, loadGovernanceGateWeights, invalidateGovernanceGateCache } from '../src/ingestion/governance-gate.js';

/** Standard community weights for testing. */
const COMMUNITY_WEIGHTS: Record<string, number> = {
  'decentralized-social': 0.90,
  'open-source': 0.85,
  'software-development': 0.80,
  'ai-machine-learning': 0.75,
  'dogs-pets': 0.50,
  'politics-governance': 0.05,
  'adult-content': 0.0,
};

/** Helper: set Redis cache to return topic weights. */
function setRedisWeights(weights: Record<string, number>): void {
  redisGetMock.mockResolvedValue(JSON.stringify(weights));
}

/** Helper: set DB to return topic weights. */
function setDbWeights(weights: Record<string, number>): void {
  dbQueryMock.mockResolvedValue({ rows: [{ topic_weights: weights }] });
}

describe('checkGovernanceGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSetMock.mockResolvedValue('OK');
  });

  it('passes post matching a topic with community weight > 0', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({ 'software-development': 0.8 });

    expect(result.passes).toBe(true);
    expect(result.relevance).toBeCloseTo(0.8, 6); // single topic: weight is the result
  });

  it('passes post matching multiple topics where at least one has weight > 0', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({
      'software-development': 0.7,
      'open-source': 0.5,
    });

    expect(result.passes).toBe(true);
    // (0.7*0.80 + 0.5*0.85) / (0.7+0.5) = (0.56+0.425)/1.2 ≈ 0.8208
    expect(result.relevance).toBeCloseTo(0.8208, 3);
  });

  it('rejects post with empty topic vector (no classification)', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({});

    expect(result.passes).toBe(false);
    expect(result.relevance).toBe(0);
  });

  it('rejects post matching ONLY topics with weight = 0 (e.g., adult-content)', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({ 'adult-content': 0.9 });

    expect(result.passes).toBe(false);
    expect(result.relevance).toBe(0);
  });

  it('rejects post matching ONLY topics with weight below threshold', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    // politics-governance at 0.05 is below default INGESTION_MIN_RELEVANCE of 0.10
    const result = await checkGovernanceGate({ 'politics-governance': 0.9 });

    expect(result.passes).toBe(false);
    expect(result.relevance).toBeCloseTo(0.05, 6);
  });

  it('passes post matching topic with weight exactly at threshold', async () => {
    // Default INGESTION_MIN_RELEVANCE = 0.10
    setRedisWeights({ 'edge-topic': 0.10 });
    const result = await checkGovernanceGate({ 'edge-topic': 1.0 });

    expect(result.passes).toBe(true);
    expect(result.relevance).toBeCloseTo(0.10, 6);
  });

  it('computes correct weighted average with mixed high/low weight topics', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({
      'software-development': 0.8,
      'politics-governance': 0.2,
    });

    // (0.8*0.80 + 0.2*0.05) / (0.8+0.2) = (0.64+0.01)/1.0 = 0.65
    expect(result.passes).toBe(true);
    expect(result.relevance).toBeCloseTo(0.65, 6);
  });

  it('uses default weight (0.2) for topics not in community weights', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({ 'unknown-topic': 0.5 });

    // single topic, unknown: weight = 0.2 (default)
    expect(result.passes).toBe(true); // 0.2 >= 0.10 threshold
    expect(result.relevance).toBeCloseTo(0.2, 6);
  });

  it('handles post with single topic match correctly', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({ 'ai-machine-learning': 1.0 });

    expect(result.passes).toBe(true);
    expect(result.relevance).toBeCloseTo(0.75, 6);
  });

  it('returns relevance score and best matching topic in result', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);
    const result = await checkGovernanceGate({
      'software-development': 0.8,
      'open-source': 0.3,
    });

    expect(result.passes).toBe(true);
    // best contribution: sw-dev: 0.8*0.80=0.64 vs oss: 0.3*0.85=0.255
    expect(result.bestTopic).toBe('software-development');
    expect(result.relevance).toBeGreaterThan(0);
  });
});

describe('governance gate fail-open behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSetMock.mockResolvedValue('OK');
  });

  it('passes all posts when topic weights map is empty', async () => {
    // Redis returns empty object
    redisGetMock.mockResolvedValue(JSON.stringify({}));

    const result = await checkGovernanceGate({ 'adult-content': 0.9 });

    // Empty weights = fail-open, default relevance 0.2
    expect(result.passes).toBe(true);
    expect(result.relevance).toBe(0.2);
  });

  it('passes all posts when topic weights are unavailable (DB error)', async () => {
    // Redis miss
    redisGetMock.mockResolvedValue(null);
    // DB error
    dbQueryMock.mockRejectedValue(new Error('connection refused'));

    const result = await checkGovernanceGate({ 'software-development': 0.8 });

    // Both cache and DB failed = fail-open
    expect(result.passes).toBe(true);
    expect(result.relevance).toBe(0.2);
  });

  it('passes all posts when no active epoch exists', async () => {
    redisGetMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({ rows: [] });

    const result = await checkGovernanceGate({ 'adult-content': 0.9 });

    // No epoch = fail-open
    expect(result.passes).toBe(true);
    expect(result.relevance).toBe(0.2);
  });
});

describe('governance gate weight caching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSetMock.mockResolvedValue('OK');
  });

  it('loads weights from Redis cache when available', async () => {
    setRedisWeights(COMMUNITY_WEIGHTS);

    await checkGovernanceGate({ 'software-development': 0.8 });

    // Should have called Redis GET
    expect(redisGetMock).toHaveBeenCalledWith('governance_gate:topic_weights');
    // Should NOT have called DB (cache hit)
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('falls back to DB when Redis cache misses', async () => {
    redisGetMock.mockResolvedValue(null);
    setDbWeights(COMMUNITY_WEIGHTS);

    const result = await checkGovernanceGate({ 'software-development': 0.8 });

    expect(redisGetMock).toHaveBeenCalled();
    expect(dbQueryMock).toHaveBeenCalled();
    expect(result.passes).toBe(true);
  });

  it('caches weights to Redis after DB load', async () => {
    redisGetMock.mockResolvedValue(null);
    setDbWeights(COMMUNITY_WEIGHTS);

    await checkGovernanceGate({ 'software-development': 0.8 });

    // Should have written to Redis with EX TTL
    expect(redisSetMock).toHaveBeenCalledWith(
      'governance_gate:topic_weights',
      JSON.stringify(COMMUNITY_WEIGHTS),
      'EX',
      300
    );
  });

  it('falls back to DB when Redis returns unparseable data', async () => {
    redisGetMock.mockResolvedValue('not-valid-json');
    setDbWeights(COMMUNITY_WEIGHTS);

    const result = await checkGovernanceGate({ 'software-development': 0.8 });

    expect(dbQueryMock).toHaveBeenCalled();
    expect(result.passes).toBe(true);
  });
});

describe('loadGovernanceGateWeights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisSetMock.mockResolvedValue('OK');
  });

  it('sets gate ready after successful load', async () => {
    redisGetMock.mockResolvedValue(null);
    setDbWeights(COMMUNITY_WEIGHTS);

    await loadGovernanceGateWeights();

    expect(isGovernanceGateReady()).toBe(true);
  });
});

describe('invalidateGovernanceGateCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisDelMock.mockResolvedValue(1);
  });

  it('deletes cache key from Redis', async () => {
    await invalidateGovernanceGateCache();

    expect(redisDelMock).toHaveBeenCalledWith('governance_gate:topic_weights');
  });
});
