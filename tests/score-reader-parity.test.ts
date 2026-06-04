/**
 * Parity tests for score-reader and weight-longtable helpers.
 *
 * The P4 reader migration relies on a single contract: for the same input
 * data, the wide-column path and the long-table path return identical
 * shapes. These tests pin that contract — flip the flag on/off, feed the
 * mocked queries the same logical decomposition, and assert the helper
 * returns the same record.
 *
 * If a future component is added to DEFAULT_COMPONENTS, the wide-path
 * fixtures here will need updating; the long-path fixtures auto-cover any
 * registered key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, configMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  configMock: {
    SCORE_LONGTABLE_READ_ENABLED: false,
    GOVERNANCE_LONGTABLE_READ_ENABLED: false,
  },
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/config.js', () => ({
  config: configMock,
}));

import {
  readPostScore,
  readPostScoresForEpoch,
  readEpochComponentStats,
  countPostsWithComponentAbove,
} from '../src/scoring/score-reader.js';
import {
  readEpochWeights,
  readEpochWeightsForMultipleEpochs,
} from '../src/governance/weight-longtable.js';

// ─── Shared fixtures ────────────────────────────────────────────────────────
// One canonical scored post + epoch, expressed in both shapes.

const POST_URI = 'at://did:plc:alice/app.bsky.feed.post/abc';
const EPOCH_ID = 7;
const SCORED_AT_ISO = '2026-05-27T20:00:00.000Z';

/** Wide-row shape returned by SELECT recency_score, engagement_score, ... */
const WIDE_POST_ROW = {
  post_uri: POST_URI,
  epoch_id: EPOCH_ID,
  total_score: '0.78',
  scored_at: SCORED_AT_ISO,
  classification_method: 'keyword',
  component_details: { run_id: 'run-xyz' },
  recency_score: '0.95',
  engagement_score: '0.70',
  bridging_score: '0.50',
  source_diversity_score: '0.60',
  relevance_score: '0.80',
  recency_weight: '0.20',
  engagement_weight: '0.20',
  bridging_weight: '0.20',
  source_diversity_weight: '0.20',
  relevance_weight: '0.20',
  recency_weighted: '0.19',
  engagement_weighted: '0.14',
  bridging_weighted: '0.10',
  source_diversity_weighted: '0.12',
  relevance_weighted: '0.16',
};

/** Long-table per-component rows for the same post. */
const LONG_POST_HEADER = {
  post_uri: POST_URI,
  epoch_id: EPOCH_ID,
  total_score: '0.78',
  scored_at: SCORED_AT_ISO,
  classification_method: 'keyword',
  component_details: { run_id: 'run-xyz' },
};

const LONG_POST_COMPONENT_ROWS = [
  { component_key: 'recency', raw: '0.95', weight: '0.20', weighted: '0.19' },
  { component_key: 'engagement', raw: '0.70', weight: '0.20', weighted: '0.14' },
  { component_key: 'bridging', raw: '0.50', weight: '0.20', weighted: '0.10' },
  { component_key: 'sourceDiversity', raw: '0.60', weight: '0.20', weighted: '0.12' },
  { component_key: 'relevance', raw: '0.80', weight: '0.20', weighted: '0.16' },
];

/** Wide governance_epochs row. */
const WIDE_EPOCH_ROW = {
  recency_weight: '0.20',
  engagement_weight: '0.20',
  bridging_weight: '0.20',
  source_diversity_weight: '0.20',
  relevance_weight: '0.20',
};

/** Long-table governance_epoch_weights rows. */
const LONG_EPOCH_WEIGHT_ROWS = [
  { component_key: 'recency', weight: '0.20' },
  { component_key: 'engagement', weight: '0.20' },
  { component_key: 'bridging', weight: '0.20' },
  { component_key: 'sourceDiversity', weight: '0.20' },
  { component_key: 'relevance', weight: '0.20' },
];

beforeEach(() => {
  dbQueryMock.mockReset();
  configMock.SCORE_LONGTABLE_READ_ENABLED = false;
  configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
});

// ────────────────────────────────────────────────────────────────────────────
// readPostScore
// ────────────────────────────────────────────────────────────────────────────

describe('readPostScore parity', () => {
  it('wide and long paths produce identical PostScoreRecord', async () => {
    // Wide path: single SELECT returns the 17-column row.
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [WIDE_POST_ROW] });
    const wideResult = await readPostScore({ postUri: POST_URI, epochId: EPOCH_ID });

    // Long path: post-row SELECT + components SELECT.
    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock
      .mockResolvedValueOnce({ rows: [LONG_POST_HEADER] })
      .mockResolvedValueOnce({ rows: LONG_POST_COMPONENT_ROWS });
    const longResult = await readPostScore({ postUri: POST_URI, epochId: EPOCH_ID });

    expect(longResult).toEqual(wideResult);
    expect(longResult?.components.recency.raw).toBe(0.95);
    expect(longResult?.totalScore).toBe(0.78);
  });

  it('returns null on both paths when no row exists', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    const wide = await readPostScore({ postUri: POST_URI, epochId: 99 });

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    const long = await readPostScore({ postUri: POST_URI, epochId: 99 });

    expect(wide).toBeNull();
    expect(long).toBeNull();
  });

  it('long path applies runId filtering to the component query', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock
      .mockResolvedValueOnce({ rows: [LONG_POST_HEADER] })
      .mockResolvedValueOnce({ rows: LONG_POST_COMPONENT_ROWS });

    const result = await readPostScore({
      postUri: POST_URI,
      epochId: EPOCH_ID,
      runId: 'run-xyz',
    });

    expect(result).not.toBeNull();
    expect(String(dbQueryMock.mock.calls[1]?.[0])).toContain('JOIN post_scores ps');
    expect(String(dbQueryMock.mock.calls[1]?.[0])).toContain("ps.component_details->>'run_id'");
    expect(dbQueryMock.mock.calls[1]?.[1]).toEqual([POST_URI, EPOCH_ID, 'run-xyz']);
  });

  it('wide and long paths reject with the same DB error contract', async () => {
    const dbError = new Error('score read failed');

    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockRejectedValueOnce(dbError);
    await expect(readPostScore({ postUri: POST_URI, epochId: EPOCH_ID })).rejects.toThrow(
      'score read failed'
    );

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockRejectedValueOnce(dbError);
    await expect(readPostScore({ postUri: POST_URI, epochId: EPOCH_ID })).rejects.toThrow(
      'score read failed'
    );

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock
      .mockResolvedValueOnce({ rows: [LONG_POST_HEADER] })
      .mockRejectedValueOnce(dbError);
    await expect(readPostScore({ postUri: POST_URI, epochId: EPOCH_ID })).rejects.toThrow(
      'score read failed'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// readPostScoresForEpoch
// ────────────────────────────────────────────────────────────────────────────

describe('readPostScoresForEpoch parity', () => {
  it('wide and long paths produce identical BatchPostScoreRow[]', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [WIDE_POST_ROW] });
    const wide = await readPostScoresForEpoch({ epochId: EPOCH_ID, limit: 1 });

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    // Long path: one row per post with jsonb-aggregated components_raw/weight/weighted.
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        {
          post_uri: POST_URI,
          total_score: '0.78',
          components_raw: {
            recency: '0.95',
            engagement: '0.70',
            bridging: '0.50',
            sourceDiversity: '0.60',
            relevance: '0.80',
          },
          components_weight: {
            recency: '0.20',
            engagement: '0.20',
            bridging: '0.20',
            sourceDiversity: '0.20',
            relevance: '0.20',
          },
          components_weighted: {
            recency: '0.19',
            engagement: '0.14',
            bridging: '0.10',
            sourceDiversity: '0.12',
            relevance: '0.16',
          },
        },
      ],
    });
    const long = await readPostScoresForEpoch({ epochId: EPOCH_ID, limit: 1 });

    expect(long).toEqual(wide);
    expect(long[0].components.engagement.raw).toBe(0.7);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// readEpochComponentStats
// ────────────────────────────────────────────────────────────────────────────

describe('readEpochComponentStats parity', () => {
  it('wide and long paths produce identical EpochComponentStats for bridging', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ avg: '0.42', median: '0.40', count: '50' }],
    });
    const wide = await readEpochComponentStats({
      epochId: EPOCH_ID,
      componentKey: 'bridging',
    });

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ avg: '0.42', median: '0.40', count: '50' }],
    });
    const long = await readEpochComponentStats({
      epochId: EPOCH_ID,
      componentKey: 'bridging',
    });

    expect(long).toEqual(wide);
    expect(long).toEqual({ avg: 0.42, median: 0.4, count: 50 });
  });

  it('both paths return null on empty epoch', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ avg: null, median: null, count: '0' }],
    });
    const wide = await readEpochComponentStats({
      epochId: 99,
      componentKey: 'bridging',
    });

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ avg: null, median: null, count: '0' }],
    });
    const long = await readEpochComponentStats({
      epochId: 99,
      componentKey: 'bridging',
    });

    expect(wide).toBeNull();
    expect(long).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// countPostsWithComponentAbove
// ────────────────────────────────────────────────────────────────────────────

describe('countPostsWithComponentAbove parity', () => {
  it('wide and long paths return the same count for the same threshold', async () => {
    configMock.SCORE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [{ count: '17' }] });
    const wide = await countPostsWithComponentAbove({
      epochId: EPOCH_ID,
      componentKey: 'engagement',
      threshold: 0.5,
    });

    dbQueryMock.mockReset();
    configMock.SCORE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({ rows: [{ count: '17' }] });
    const long = await countPostsWithComponentAbove({
      epochId: EPOCH_ID,
      componentKey: 'engagement',
      threshold: 0.5,
    });

    expect(long).toBe(wide);
    expect(long).toBe(17);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// readEpochWeights
// ────────────────────────────────────────────────────────────────────────────

describe('readEpochWeights parity', () => {
  it('wide and long paths return identical Record<>-shaped weights', async () => {
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [WIDE_EPOCH_ROW] });
    const wide = await readEpochWeights({ epochId: EPOCH_ID });

    dbQueryMock.mockReset();
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({
      rows: LONG_EPOCH_WEIGHT_ROWS.map((row) => ({ ...row, epoch_id: EPOCH_ID })),
    });
    const long = await readEpochWeights({ epochId: EPOCH_ID });

    expect(long).toEqual(wide);
    expect(long).toEqual({
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    });
  });

  it('both paths return null when epoch does not exist', async () => {
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    const wide = await readEpochWeights({ epochId: 999 });

    dbQueryMock.mockReset();
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({ rows: [] });
    const long = await readEpochWeights({ epochId: 999 });

    expect(wide).toBeNull();
    expect(long).toBeNull();
  });

  it('wide and long paths reject with the same DB error contract', async () => {
    const dbError = new Error('epoch weights failed');

    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockRejectedValueOnce(dbError);
    await expect(readEpochWeights({ epochId: EPOCH_ID })).rejects.toThrow(
      'epoch weights failed'
    );

    dbQueryMock.mockReset();
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockRejectedValueOnce(dbError);
    await expect(readEpochWeights({ epochId: EPOCH_ID })).rejects.toThrow(
      'epoch weights failed'
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// readEpochWeightsForMultipleEpochs
// ────────────────────────────────────────────────────────────────────────────

describe('readEpochWeightsForMultipleEpochs parity', () => {
  it('wide and long paths return identical multi-epoch weights map', async () => {
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        { id: 1, ...WIDE_EPOCH_ROW },
        { id: 2, ...WIDE_EPOCH_ROW },
      ],
    });
    const wide = await readEpochWeightsForMultipleEpochs({ epochIds: [1, 2] });

    dbQueryMock.mockReset();
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        ...LONG_EPOCH_WEIGHT_ROWS.map((r) => ({ ...r, epoch_id: 1 })),
        ...LONG_EPOCH_WEIGHT_ROWS.map((r) => ({ ...r, epoch_id: 2 })),
      ],
    });
    const long = await readEpochWeightsForMultipleEpochs({ epochIds: [1, 2] });

    expect(long).toEqual(wide);
    expect(long[1]).toEqual({
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    });
  });

  it('both paths return empty {} for empty epoch list', async () => {
    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = false;
    const wide = await readEpochWeightsForMultipleEpochs({ epochIds: [] });

    configMock.GOVERNANCE_LONGTABLE_READ_ENABLED = true;
    const long = await readEpochWeightsForMultipleEpochs({ epochIds: [] });

    expect(wide).toEqual({});
    expect(long).toEqual({});
    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});
