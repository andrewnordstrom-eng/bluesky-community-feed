/**
 * Scoring Pipeline — Source-Diversity Determinism Under Concurrency (PROJ-917)
 *
 * The score loop is parallelized (SCORING_CONCURRENCY). source-diversity is the
 * only order-dependent component (1st post from an author -> 1.0, 2nd -> 0.7,
 * 3rd -> 0.5, 4th+ -> 0.3). These tests prove the pre-pass decouples those scores
 * from the concurrent completion order: even when each post's bridging query
 * resolves in a deliberately different order than the input array, every post
 * gets the penalty its INPUT-ARRAY position dictates — identical at any
 * SCORING_CONCURRENCY, and identical to the old sequential loop.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  redisPipelineFactoryMock,
  pipelineDelMock,
  pipelineZaddMock,
  pipelineSetMock,
  pipelineExecMock,
  getCurrentContentRulesMock,
  hasActiveContentRulesMock,
  updateScoringStatusMock,
  loggerErrorMock,
  configMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisPipelineFactoryMock: vi.fn(),
  pipelineDelMock: vi.fn(),
  pipelineZaddMock: vi.fn(),
  pipelineSetMock: vi.fn(),
  pipelineExecMock: vi.fn(),
  getCurrentContentRulesMock: vi.fn(),
  hasActiveContentRulesMock: vi.fn(),
  updateScoringStatusMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  configMock: {
    SCORING_WINDOW_HOURS: 48,
    FEED_MAX_POSTS: 300,
    SCORING_FULL_RESCORE_INTERVAL: 6,
    SCORING_CANDIDATE_LIMIT: 5000,
    SCORING_TIMEOUT_MS: 240000,
    SCORING_CONCURRENCY: 8,
    TOPIC_EMBEDDING_ENABLED: false,
    TOPIC_EMBEDDING_MIN_SIMILARITY: 0.35,
    FEED_MIN_RELEVANCE: 0,
    FEED_DEDUP_ENABLED: false,
    FEED_DEDUP_MIN_TEXT: 100,
    SCORE_LONGTABLE_DUALWRITE_ENABLED: false,
  },
}));

vi.mock('../src/db/client.js', () => ({ db: { query: dbQueryMock } }));
vi.mock('../src/db/redis.js', () => ({
  redis: { pipeline: redisPipelineFactoryMock, incr: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1), eval: vi.fn().mockResolvedValue(1) },
}));
vi.mock('../src/governance/content-filter.js', () => ({
  getCurrentContentRules: getCurrentContentRulesMock,
  hasActiveContentRules: hasActiveContentRulesMock,
  filterPosts: vi.fn(),
}));
vi.mock('../src/admin/status-tracker.js', () => ({ updateScoringStatus: updateScoringStatusMock }));
vi.mock('../src/config.js', () => ({ config: configMock }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerErrorMock, debug: vi.fn() },
}));

import { runScoringPipeline, __resetPipelineState } from '../src/scoring/pipeline.js';
import { buildEpochRow, buildPostRow } from './helpers/index.js';

const URI_A = 'at://did:plc:testauthor/app.bsky.feed.post/A';
const URI_B = 'at://did:plc:testauthor/app.bsky.feed.post/B';
const URI_C = 'at://did:plc:testauthor/app.bsky.feed.post/C';

/** Extract uri -> source_diversity_score ($6, params[5]) from every wide INSERT. */
function sourceDiversityByUri(): Map<string, number> {
  const out = new Map<string, number>();
  for (const call of dbQueryMock.mock.calls as unknown[][]) {
    if (String(call[0]).includes('INSERT INTO post_scores')) {
      const params = call[1] as unknown[];
      out.set(String(params[0]), Number(params[5]));
    }
  }
  return out;
}

/**
 * db mock: three same-author posts A,B,C fetched in that order; each post's
 * bridging engager query resolves after a deliberately DIFFERENT delay
 * (A slowest, B fastest) so a naive completion-order implementation would rank
 * B first. Everything else returns empty.
 */
function installMock() {
  const engagerDelayMs: Record<string, number> = { [URI_A]: 60, [URI_B]: 5, [URI_C]: 30 };
  dbQueryMock.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    if (text.includes('FROM governance_epochs') || text.includes('WHERE status')) {
      return { rows: [buildEpochRow({ id: 1 })] };
    }
    if (text.includes('FROM posts p') && text.includes('LEFT JOIN post_engagement')) {
      return {
        rows: [
          buildPostRow({ uri: URI_A }),
          buildPostRow({ uri: URI_B }),
          buildPostRow({ uri: URI_C }),
        ],
      };
    }
    // bridging engager query — inject out-of-order latency keyed by subject_uri ($1).
    if (text.includes('SELECT DISTINCT author_did') && text.includes('subject_uri')) {
      const subjectUri = String(params?.[0]);
      await new Promise((r) => setTimeout(r, engagerDelayMs[subjectUri] ?? 0));
      return { rows: [] }; // < MIN_ENGAGERS -> bridging short-circuits to default
    }
    return { rows: [] }; // wide INSERT, writeToRedisFromDb, updateCurrentRunScope, etc.
  });
}

describe('source-diversity determinism under concurrency (PROJ-917)', () => {
  beforeEach(() => {
    __resetPipelineState();
    vi.clearAllMocks();
    configMock.SCORING_CONCURRENCY = 8;
    const pipeline = {
      del: pipelineDelMock.mockReturnThis(),
      zadd: pipelineZaddMock.mockReturnThis(),
      set: pipelineSetMock.mockReturnThis(),
      exec: pipelineExecMock.mockResolvedValue([]),
    };
    redisPipelineFactoryMock.mockReturnValue(pipeline);
    getCurrentContentRulesMock.mockResolvedValue({ includeKeywords: [], excludeKeywords: [] });
    hasActiveContentRulesMock.mockReturnValue(false);
    updateScoringStatusMock.mockResolvedValue(undefined);
    installMock();
  });

  it('assigns diversity penalties by INPUT order, not completion order (concurrency=8)', async () => {
    await runScoringPipeline();

    const byUri = sourceDiversityByUri();
    // A (input-first, but bridging slowest) still gets the 1st-post penalty.
    expect(byUri.get(URI_A)).toBe(1.0);
    expect(byUri.get(URI_B)).toBe(0.7);
    expect(byUri.get(URI_C)).toBe(0.5);
  });

  it('handles an empty candidate set without error (worker pool degenerates to a no-op)', async () => {
    dbQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM governance_epochs') || text.includes('WHERE status')) {
        return { rows: [buildEpochRow({ id: 1 })] };
      }
      if (text.includes('FROM posts p') && text.includes('LEFT JOIN post_engagement')) {
        return { rows: [] }; // no candidate posts
      }
      return { rows: [] };
    });

    await expect(runScoringPipeline()).resolves.toBeUndefined();

    const wideInserts = (dbQueryMock.mock.calls as unknown[][]).filter((c) =>
      String(c[0]).includes('INSERT INTO post_scores')
    );
    expect(wideInserts.length).toBe(0);
  });

  it('produces the identical mapping at concurrency=1 (sequential)', async () => {
    configMock.SCORING_CONCURRENCY = 1;
    await runScoringPipeline();

    const byUri = sourceDiversityByUri();
    expect(byUri.get(URI_A)).toBe(1.0);
    expect(byUri.get(URI_B)).toBe(0.7);
    expect(byUri.get(URI_C)).toBe(0.5);
  });

  it('isolates a per-post scoring failure without failing the run (concurrency=8)', async () => {
    // Make B's bridging query throw. B should be dropped (one error log), while
    // A and C still score with their correct input-order diversity penalties.
    dbQueryMock.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);
      if (text.includes('FROM governance_epochs') || text.includes('WHERE status')) {
        return { rows: [buildEpochRow({ id: 1 })] };
      }
      if (text.includes('FROM posts p') && text.includes('LEFT JOIN post_engagement')) {
        return {
          rows: [buildPostRow({ uri: URI_A }), buildPostRow({ uri: URI_B }), buildPostRow({ uri: URI_C })],
        };
      }
      if (text.includes('SELECT DISTINCT author_did') && text.includes('subject_uri')) {
        if (String(params?.[0]) === URI_B) {
          throw new Error('simulated bridging failure for B');
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    await expect(runScoringPipeline()).resolves.toBeUndefined();

    const byUri = sourceDiversityByUri();
    // B dropped (no wide INSERT); A and C keep their input-order penalties.
    expect(byUri.has(URI_B)).toBe(false);
    expect(byUri.get(URI_A)).toBe(1.0);
    expect(byUri.get(URI_C)).toBe(0.5);

    const failureLogs = (loggerErrorMock.mock.calls as unknown[][]).filter(
      (call) => String(call[1]).includes('Failed to score post')
    );
    expect(failureLogs.length).toBe(1);
  });
});
