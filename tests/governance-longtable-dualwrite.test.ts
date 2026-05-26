/**
 * Governance Long-Table Dual-Write + Read Tests (PROJ-815 / P2)
 *
 * Three surfaces under test:
 *   1. writeEpochWeights / writeVoteWeights helpers (writers)
 *   2. aggregateVotes read-flag branch (reader)
 *   3. Parity between wide-path and long-path aggregation
 *
 * Wide-row behavior is exhaustively covered by governance-admin.test.ts and
 * governance.types.test.ts; this file focuses on the long-table additions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  configMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  configMock: {
    GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED: true,
    GOVERNANCE_LONGTABLE_READ_ENABLED: false,
    SCORING_WINDOW_HOURS: 48,
    FEED_MAX_POSTS: 300,
  },
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/config.js', () => ({
  config: configMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  writeEpochWeights,
  writeVoteWeights,
} from '../src/governance/weight-longtable.js';
import { aggregateVotes } from '../src/governance/aggregation.js';

/** Find a db.query call by an SQL substring. */
function findCall(needle: string): unknown[] | undefined {
  return dbQueryMock.mock.calls.find((c: unknown[]) =>
    String(c[0]).includes(needle)
  );
}

describe('governance long-table dual-write (PROJ-815)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED = true;
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValue({ rows: [] });
  });

  describe('writeEpochWeights', () => {
    it('writes one row per registered weight key in a batched INSERT', async () => {
      // Helper accepts a transactional client; we pass dbQueryMock as a stand-in
      // since the test only inspects what query was issued.
      const fakeClient = { query: dbQueryMock } as unknown as Parameters<typeof writeEpochWeights>[0];

      await writeEpochWeights(fakeClient, 42, {
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.2,
        relevance: 0.2,
      });

      const call = findCall('INSERT INTO governance_epoch_weights');
      expect(call).toBeDefined();

      const sql = String(call![0]);
      const params = call![1] as unknown[];

      expect(params.length).toBe(5 * 3);
      expect(sql).toMatch(
        /ON CONFLICT \(epoch_id, component_key\) DO UPDATE SET weight = EXCLUDED\.weight/
      );

      // component_key column is the 2nd of each 3-tuple.
      const componentKeys = [params[1], params[4], params[7], params[10], params[13]];
      expect(new Set(componentKeys)).toEqual(
        new Set(['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'])
      );
    });

    it('is a no-op when weights map is empty', async () => {
      const fakeClient = { query: dbQueryMock } as unknown as Parameters<typeof writeEpochWeights>[0];
      await writeEpochWeights(fakeClient, 1, {});
      expect(findCall('INSERT INTO governance_epoch_weights')).toBeUndefined();
    });

    it('accepts a 6th hypothetical key without DDL changes', async () => {
      // The "6th-key fixture" from the PROJ-815 packet: a 'civility' key flows
      // through the helper unchanged, proving the long-table contract is
      // component-agnostic. (Live registry still has 5; this exercises the path.)
      const fakeClient = { query: dbQueryMock } as unknown as Parameters<typeof writeEpochWeights>[0];

      await writeEpochWeights(fakeClient, 99, {
        recency: 0.15,
        engagement: 0.15,
        bridging: 0.15,
        sourceDiversity: 0.15,
        relevance: 0.15,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        civility: 0.25 as any,
      });

      const call = findCall('INSERT INTO governance_epoch_weights');
      expect(call).toBeDefined();
      const params = call![1] as unknown[];

      // 6 rows × 3 columns = 18 params; one of the component_keys must be civility.
      expect(params.length).toBe(6 * 3);
      const keys = [params[1], params[4], params[7], params[10], params[13], params[16]];
      expect(keys).toContain('civility');
    });
  });

  describe('writeVoteWeights', () => {
    it('writes one row per submitted weight key', async () => {
      await writeVoteWeights('vote-uuid-1', {
        recency: 0.3,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.15,
        relevance: 0.15,
      });

      const call = findCall('INSERT INTO governance_vote_weights');
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params.length).toBe(5 * 3);

      const sql = String(call![0]);
      expect(sql).toMatch(
        /ON CONFLICT \(vote_id, component_key\) DO UPDATE SET weight = EXCLUDED\.weight/
      );
    });

    it('skips null/undefined values (mirrors wide-row COALESCE semantics)', async () => {
      // Partial update: only recency and engagement submitted; the rest must
      // be skipped (not written as 0).
      await writeVoteWeights('vote-uuid-2', {
        recency: 0.4,
        engagement: 0.3,
        bridging: null,
        sourceDiversity: undefined,
        relevance: null,
      });

      const call = findCall('INSERT INTO governance_vote_weights');
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params.length).toBe(2 * 3);
    });

    it('is a no-op when every value is null/undefined', async () => {
      await writeVoteWeights('vote-uuid-3', {
        recency: null,
        engagement: null,
        bridging: null,
        sourceDiversity: null,
        relevance: null,
      });
      expect(findCall('INSERT INTO governance_vote_weights')).toBeUndefined();
    });

    it('propagates db.query errors instead of swallowing them', async () => {
      // The caller (routes/vote.ts) is responsible for the
      // logger.warn-and-continue eventual-consistency behavior; the helper
      // itself must surface failures so callers can decide whether to swallow.
      dbQueryMock.mockReset();
      dbQueryMock.mockRejectedValueOnce(new Error('db connection lost'));

      await expect(
        writeVoteWeights('vote-uuid-err', {
          recency: 0.2,
          engagement: 0.2,
          bridging: 0.2,
          sourceDiversity: 0.2,
          relevance: 0.2,
        })
      ).rejects.toThrow('db connection lost');
    });

    it('accepts boundary weights at exactly 0 and 1 (CHECK boundary parity)', async () => {
      // The long table's CHECK (weight >= 0 AND weight <= 1) is inclusive on
      // both ends. The writer must not silently filter out exact 0 or 1 — those
      // are legal values and a future "civility" component could plausibly emit
      // a 0 weight if it has no opinion.
      await writeVoteWeights('vote-uuid-boundary', {
        recency: 0,
        engagement: 1,
        bridging: 0.0,
        sourceDiversity: 1.0,
        relevance: 0.5,
      });

      const call = findCall('INSERT INTO governance_vote_weights');
      expect(call).toBeDefined();
      const params = call![1] as unknown[];
      expect(params.length).toBe(5 * 3);

      // Spot-check the actual values appear in the parameter list, not silently dropped.
      const weights = params.filter((_, i) => i % 3 === 2);
      expect(weights).toEqual(expect.arrayContaining([0, 1, 0.0, 1.0, 0.5]));
    });

    it('does not leak parameters between concurrent writeVoteWeights calls', async () => {
      // Concurrent writers must each see their own vote_id and weight set in
      // the INSERT — the helper builds parameter arrays per-call and should
      // not share state. Run two writes in parallel and verify each call's
      // parameter list carries only its own vote_id.
      dbQueryMock.mockReset();
      dbQueryMock.mockResolvedValue({ rows: [] });

      await Promise.all([
        writeVoteWeights('vote-concurrent-A', {
          recency: 0.5,
          engagement: 0.5,
          bridging: 0,
          sourceDiversity: 0,
          relevance: 0,
        }),
        writeVoteWeights('vote-concurrent-B', {
          recency: 0,
          engagement: 0,
          bridging: 0.3,
          sourceDiversity: 0.3,
          relevance: 0.4,
        }),
      ]);

      const longCalls = dbQueryMock.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('INSERT INTO governance_vote_weights')
      );
      expect(longCalls.length).toBe(2);

      // Each call's vote_id parameters (positions 0, 3, 6, …) should be only one of the two ids.
      for (const [, params] of longCalls) {
        const voteIds = (params as unknown[]).filter((_, i) => i % 3 === 0);
        const unique = new Set(voteIds);
        expect(unique.size).toBe(1);
        expect(['vote-concurrent-A', 'vote-concurrent-B']).toContain(
          [...unique][0]
        );
      }
    });
  });

  describe('writeEpochWeights error propagation', () => {
    it('propagates client.query errors so the outer transaction can roll back', async () => {
      // Epoch dual-write runs inside an existing BEGIN/COMMIT block in
      // epoch-manager.ts. If the long-table INSERT throws, the helper must
      // surface it so the surrounding transaction rolls back atomically.
      const failingClient = {
        query: vi.fn().mockRejectedValueOnce(new Error('long-table insert failed')),
      } as unknown as Parameters<typeof writeEpochWeights>[0];

      await expect(
        writeEpochWeights(failingClient, 7, {
          recency: 0.2,
          engagement: 0.2,
          bridging: 0.2,
          sourceDiversity: 0.2,
          relevance: 0.2,
        })
      ).rejects.toThrow('long-table insert failed');
    });
  });

  describe('aggregateVotes read-flag branch', () => {
    it('reads from governance_votes wide columns when flag is off', async () => {
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;

      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // keyword-only query
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          {
            recency_weight: 0.2,
            engagement_weight: 0.2,
            bridging_weight: 0.2,
            source_diversity_weight: 0.2,
            relevance_weight: 0.2,
          },
        ],
      });

      const result = await aggregateVotes(1);
      expect(result).not.toBeNull();

      expect(findCall('FROM governance_votes')).toBeDefined();
      expect(findCall('FROM governance_vote_weights')).toBeUndefined();
    });

    it('reads from governance_vote_weights long table when flag is on', async () => {
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;

      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // keyword-only query
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          { vote_id: 'v1', component_key: 'recency', weight: 0.2 },
          { vote_id: 'v1', component_key: 'engagement', weight: 0.2 },
          { vote_id: 'v1', component_key: 'bridging', weight: 0.2 },
          { vote_id: 'v1', component_key: 'sourceDiversity', weight: 0.2 },
          { vote_id: 'v1', component_key: 'relevance', weight: 0.2 },
        ],
      });

      const result = await aggregateVotes(1);
      expect(result).not.toBeNull();

      expect(findCall('FROM governance_vote_weights')).toBeDefined();
    });

    it('produces parity between wide-path and long-path aggregation on the same input', async () => {
      // Hand-rolled 3-vote dataset:
      const votes = [
        { recency: 0.30, engagement: 0.20, bridging: 0.20, sourceDiversity: 0.15, relevance: 0.15 },
        { recency: 0.10, engagement: 0.30, bridging: 0.20, sourceDiversity: 0.20, relevance: 0.20 },
        { recency: 0.20, engagement: 0.20, bridging: 0.20, sourceDiversity: 0.20, relevance: 0.20 },
      ];

      // Wide path
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
      dbQueryMock.mockReset();
      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      dbQueryMock.mockResolvedValueOnce({
        rows: votes.map((v) => ({
          recency_weight: v.recency,
          engagement_weight: v.engagement,
          bridging_weight: v.bridging,
          source_diversity_weight: v.sourceDiversity,
          relevance_weight: v.relevance,
        })),
      });
      const wideResult = await aggregateVotes(1);

      // Long path with the same votes pivoted to long shape
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
      dbQueryMock.mockReset();
      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      dbQueryMock.mockResolvedValueOnce({
        rows: votes.flatMap((v, i) => [
          { vote_id: `v${i}`, component_key: 'recency', weight: v.recency },
          { vote_id: `v${i}`, component_key: 'engagement', weight: v.engagement },
          { vote_id: `v${i}`, component_key: 'bridging', weight: v.bridging },
          { vote_id: `v${i}`, component_key: 'sourceDiversity', weight: v.sourceDiversity },
          { vote_id: `v${i}`, component_key: 'relevance', weight: v.relevance },
        ]),
      });
      const longResult = await aggregateVotes(1);

      expect(wideResult).not.toBeNull();
      expect(longResult).not.toBeNull();

      // Float comparison within tight tolerance (1e-9 — these are exact rationals).
      for (const key of ['recency', 'engagement', 'bridging', 'sourceDiversity', 'relevance'] as const) {
        expect(longResult![key]).toBeCloseTo(wideResult![key], 9);
      }
    });

    it('returns null on empty-input wide path', async () => {
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // keyword-only count
      dbQueryMock.mockResolvedValueOnce({ rows: [] });              // wide votes query

      const result = await aggregateVotes(99);
      expect(result).toBeNull();
    });

    it('returns null on empty-input long path (parity with wide)', async () => {
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // keyword-only count
      dbQueryMock.mockResolvedValueOnce({ rows: [] });              // long votes query

      const result = await aggregateVotes(99);
      expect(result).toBeNull();
    });

    it('excludes votes missing any component (long-path filter parity)', async () => {
      // One vote has all 5 components, the other is missing 'relevance'. The
      // wide path uses "AND xxx_weight IS NOT NULL" for each column; the long
      // path's equivalent is "vote has rows for every registered key".
      configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
      dbQueryMock.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          // complete vote
          { vote_id: 'complete', component_key: 'recency', weight: 0.2 },
          { vote_id: 'complete', component_key: 'engagement', weight: 0.2 },
          { vote_id: 'complete', component_key: 'bridging', weight: 0.2 },
          { vote_id: 'complete', component_key: 'sourceDiversity', weight: 0.2 },
          { vote_id: 'complete', component_key: 'relevance', weight: 0.2 },
          // partial vote (missing relevance) — should be excluded
          { vote_id: 'partial', component_key: 'recency', weight: 0.5 },
          { vote_id: 'partial', component_key: 'engagement', weight: 0.2 },
          { vote_id: 'partial', component_key: 'bridging', weight: 0.1 },
          { vote_id: 'partial', component_key: 'sourceDiversity', weight: 0.2 },
        ],
      });

      const result = await aggregateVotes(1);
      expect(result).not.toBeNull();

      // If the partial vote had been included, recency would be > 0.2 (it
      // contributed 0.5). Excluded → all-equal complete vote → uniform 0.2.
      expect(result!.recency).toBeCloseTo(0.2, 6);
    });
  });
});
