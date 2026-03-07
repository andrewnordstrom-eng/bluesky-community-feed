/**
 * Tests for the interaction aggregator background jobs.
 * Verifies daily stats rollup, epoch stats, and retention cleanup.
 *
 * Note: The aggregator uses module-level state (lastRetentionDate) that
 * persists between test runs within the same module import. Tests are
 * designed around this constraint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
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

const { startInteractionAggregator, stopInteractionAggregator } = await import(
  '../src/maintenance/interaction-aggregator.js'
);

describe('interaction aggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('runs all three jobs on first start (daily stats + epoch stats + retention)', async () => {
    // This MUST be the first test — it's the only one that will trigger retention cleanup
    // (retention runs once per day, tracked by module-level lastRetentionDate)

    await startInteractionAggregator();
    await stopInteractionAggregator();

    const allSql = dbQueryMock.mock.calls.map((call: unknown[]) => call[0] as string);

    // Job 1: Daily stats rollup
    const dailyStats = allSql.filter((s) => s.includes('feed_request_daily_stats'));
    expect(dailyStats.length).toBeGreaterThanOrEqual(1);
    expect(dailyStats[0]).toContain('INSERT INTO feed_request_daily_stats');
    expect(dailyStats[0]).toContain('ON CONFLICT');

    // Job 2: Epoch stats (queries for active epoch first)
    const epochQuery = allSql.filter((s) => s.includes('governance_epochs'));
    expect(epochQuery.length).toBeGreaterThanOrEqual(1);

    // Job 3: Retention cleanup (runs once per day — this is the first run)
    const feedDelete = allSql.filter((s) => s.includes('DELETE FROM feed_requests'));
    expect(feedDelete.length).toBeGreaterThanOrEqual(1);
    expect(feedDelete[0]).toContain("($1::int * INTERVAL '1 day')");

    const attrDelete = allSql.filter((s) => s.includes('DELETE FROM engagement_attributions'));
    expect(attrDelete.length).toBeGreaterThanOrEqual(1);
    expect(attrDelete[0]).toContain("($1::int * INTERVAL '1 day')");
  });

  it('computes epoch stats when active epoch exists', async () => {
    // Mock: active epoch found
    dbQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // daily stats rollup
      .mockResolvedValueOnce({ rows: [{ id: 3 }], rowCount: 1 }) // active epoch
      .mockResolvedValueOnce({ // feed request stats
        rows: [{
          total_feed_loads: '100',
          unique_viewers: '25',
          avg_scroll_depth: '75.5',
          returning_viewer_pct: '40.0',
          posts_served: '5000',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ // engagement stats
        rows: [{
          total_attributions: '500',
          engaged: '50',
          engagement_rate: '0.1',
          avg_engagement_position: '12.5',
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 }); // remaining calls

    await startInteractionAggregator();
    await stopInteractionAggregator();

    // Should have called epoch stats UPSERT
    const epochStatsCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO epoch_engagement_stats')
    );
    expect(epochStatsCalls.length).toBeGreaterThanOrEqual(1);

    const sql = epochStatsCalls[0][0] as string;
    expect(sql).toContain('ON CONFLICT (epoch_id)');

    // Verify epoch_id was passed as parameter
    const params = epochStatsCalls[0][1] as unknown[];
    expect(params[0]).toBe(3); // epoch_id
  });

  it('skips epoch stats when no active epoch exists', async () => {
    // Daily stats → empty
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Active epoch query → no rows
    dbQueryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Remaining calls
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await startInteractionAggregator();
    await stopInteractionAggregator();

    // Should NOT have an INSERT into epoch_engagement_stats
    const epochStatsCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO epoch_engagement_stats')
    );
    expect(epochStatsCalls).toHaveLength(0);
  });

  it('handles empty tables gracefully without errors', async () => {
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    // Should not throw
    await startInteractionAggregator();
    await stopInteractionAggregator();

    // Verify it ran (db.query was called)
    expect(dbQueryMock).toHaveBeenCalled();
  });

  it('handles db errors without crashing', async () => {
    dbQueryMock.mockRejectedValue(new Error('connection lost'));

    // Should not throw
    await startInteractionAggregator();
    await stopInteractionAggregator();

    // It ran and caught the error internally
    expect(dbQueryMock).toHaveBeenCalled();
  });
});
