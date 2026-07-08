/**
 * Partition Manager — Background Job (PROJ-917)
 *
 * Migrations 026-029 rebuilt likes/reposts/follows/posts/post_scores/
 * post_score_components as declaratively RANGE-partitioned-by-created_at
 * tables (daily partitions). This module is the runtime half of that
 * rebuild: retention is now "DETACH + DROP a whole day's partition"
 * (metadata-only, independent of row count) instead of the guarded
 * `DELETE ... WHERE created_at < NOW() - window` queries in cleanup.ts,
 * which — even indexed (migration 025) — still scan and delete row by row
 * and compete with autovacuum/bloat at 48M-row scale.
 *
 * Two jobs, run once per calendar day (mirrors interaction-aggregator.ts's
 * "hourly tick, daily-guarded work" pattern):
 *
 * 1. Create-ahead: ensure partitions exist for [today, today+2] on every
 *    partitioned table. Idempotent (CREATE TABLE IF NOT EXISTS under the
 *    hood via create_daily_range_partitions(), added in migration 026) —
 *    safe to call even if today's/tomorrow's partition already exists.
 *
 * 2. Drop-old: for every partitioned table, DETACH + DROP any daily
 *    partition whose upper bound has aged past that table's retention
 *    window (RAW_EVENT_RETENTION_DAYS=14 for likes/reposts/follows,
 *    SCORED_DATA_RETENTION_DAYS=30 for posts/post_scores/
 *    post_score_components — src/config.ts). For `posts` specifically, this
 *    also deletes the matching post_engagement rows FIRST — the
 *    application-level cascade PROJ-917 substitutes for the FK CASCADE that
 *    used to exist (see migration 027's header for why the FK had to be
 *    dropped: PG16 requires a partitioned table's unique constraints to
 *    include the full partition key, so `posts(uri)` alone can no longer be
 *    an FK target once the PK becomes (uri, created_at)).
 *
 * A small DEFAULT partition per table (created in migrations 026-029) is the
 * safety net for any row whose created_at falls outside every explicit daily
 * range (clock skew, a missed maintenance run, backfill replay) — without
 * one, an out-of-range INSERT hard-fails. This job also purges
 * default-partition rows once they age past retention, using the same
 * cutoff. Known limitation: a row with a *future*-dated created_at that
 * lands in the default partition never migrates into its "real" partition
 * once that day arrives — Postgres does not rebalance existing rows across
 * partitions. This is expected to be rare (client clock skew) and is not
 * swept by anything; it only ages out once past retention like any other
 * default-partition row.
 *
 * Follows the same start/stop/guard pattern as cleanup.ts and
 * interaction-aggregator.ts.
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // hourly tick; actual work is daily-guarded
const BATCH_SIZE = 5000;
/** How many days beyond a table's own retention window to keep checking for
 *  undropped partitions. Covers a maintenance-job outage of many days
 *  without needing operator intervention to "catch up". */
const DROP_LOOKBACK_BUFFER_DAYS = 90;
/** How many days ahead of today to guarantee a partition exists. */
const CREATE_AHEAD_DAYS = 2;
/** DETACH PARTITION needs a brief ACCESS EXCLUSIVE lock the constantly-written
 *  posts/post_scores tables rarely grant on the first try; retry a few times
 *  within the run (each attempt keeps the short 5s lock_timeout) to catch a
 *  quieter moment before deferring the partition to the next daily run. */
const DETACH_RETRY_ATTEMPTS = 3;
const DETACH_RETRY_BACKOFF_MS = 3000;

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PartitionedTableSpec {
  /** Live table name (also used as the partition-name prefix). */
  name: string;
  retentionDays: number;
}

function getPartitionedTables(): PartitionedTableSpec[] {
  return [
    { name: 'likes', retentionDays: config.RAW_EVENT_RETENTION_DAYS },
    { name: 'reposts', retentionDays: config.RAW_EVENT_RETENTION_DAYS },
    { name: 'follows', retentionDays: config.RAW_EVENT_RETENTION_DAYS },
    { name: 'posts', retentionDays: config.SCORED_DATA_RETENTION_DAYS },
    { name: 'post_scores', retentionDays: config.SCORED_DATA_RETENTION_DAYS },
    { name: 'post_score_components', retentionDays: config.SCORED_DATA_RETENTION_DAYS },
  ];
}

export interface PartitionMaintenanceResult {
  partitionsCreated: string[];
  partitionsDropped: string[];
  defaultPartitionRowsPurged: number;
  engagementRowsCascaded: number;
  durationMs: number;
  errors: string[];
}

let isRunning = false;
let isMaintaining = false;
let intervalId: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let lastMaintenanceDate: string | null = null;

/**
 * Start the partition maintenance scheduler. Runs immediately, then checks
 * hourly whether today's maintenance has already run (only actually does
 * the create-ahead/drop-old work once per calendar day).
 */
export async function startPartitionManager(): Promise<void> {
  if (isRunning) {
    logger.warn('Partition manager already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;

  logger.info(
    {
      rawEventRetentionDays: config.RAW_EVENT_RETENTION_DAYS,
      scoredDataRetentionDays: config.SCORED_DATA_RETENTION_DAYS,
    },
    'Starting partition manager'
  );

  await runWithGuard();

  intervalId = setInterval(runWithGuard, MAINTENANCE_INTERVAL_MS);

  logger.info('Partition manager started');
}

export async function stopPartitionManager(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping partition manager...');
  isShuttingDown = true;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  while (isMaintaining) {
    logger.info('Waiting for partition maintenance run to complete...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  isRunning = false;
  logger.info('Partition manager stopped');
}

export function isPartitionManagerRunning(): boolean {
  return isRunning;
}

async function runWithGuard(): Promise<void> {
  if (isShuttingDown) return;

  const today = await getServerToday();
  if (lastMaintenanceDate === today) {
    return;
  }

  try {
    // runPartitionMaintenanceNow owns the concurrency guard (shared with the
    // disk-monitor emergency path). Only advance the once-per-day marker if the
    // run actually executed — null means another run already held the guard.
    const result = await runPartitionMaintenanceNow();
    if (result !== null) {
      lastMaintenanceDate = today;
    }
  } catch (err) {
    logger.error({ err }, 'Partition maintenance run failed');
  }
}

/**
 * Run partition maintenance immediately (bypasses the once-per-day date guard,
 * but NOT the concurrency guard). Exported for manual triggers, the
 * disk-monitor emergency recovery path, and the Testcontainers suite.
 *
 * Acquires the shared `isMaintaining` mutex so a direct call — e.g. an
 * emergency disk-pressure run from disk-monitor.ts — cannot execute
 * concurrently with the scheduled hourly run and race to DETACH/DROP the same
 * partition (the loser's DETACH would fail noisily on an already-gone
 * partition). Returns null if a run is already in progress.
 */
export async function runPartitionMaintenanceNow(): Promise<PartitionMaintenanceResult | null> {
  if (isMaintaining) {
    logger.warn('Partition maintenance already in progress - skipping concurrent invocation');
    return null;
  }
  isMaintaining = true;
  try {
    return await doPartitionMaintenance();
  } finally {
    isMaintaining = false;
  }
}

async function doPartitionMaintenance(): Promise<PartitionMaintenanceResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const partitionsCreated: string[] = [];
  const partitionsDropped: string[] = [];
  let defaultPartitionRowsPurged = 0;
  let engagementRowsCascaded = 0;

  const today = await getServerTodayAsDate();
  const tables = getPartitionedTables();

  for (const table of tables) {
    try {
      const created = await createAheadPartitions(table, today);
      partitionsCreated.push(...created);
    } catch (err) {
      const message = `create-ahead failed for ${table.name}: ${String(err instanceof Error ? err.message : err)}`;
      logger.error({ err, table: table.name }, 'Partition create-ahead failed');
      errors.push(message);
    }
  }

  for (const table of tables) {
    try {
      const { dropped, engagementCascaded } = await dropOldPartitions(table, today);
      partitionsDropped.push(...dropped);
      engagementRowsCascaded += engagementCascaded;
    } catch (err) {
      const message = `drop-old failed for ${table.name}: ${String(err instanceof Error ? err.message : err)}`;
      logger.error({ err, table: table.name }, 'Partition drop-old failed');
      errors.push(message);
    }
  }

  for (const table of tables) {
    try {
      defaultPartitionRowsPurged += await purgeDefaultPartition(table, today);
    } catch (err) {
      const message = `default-partition purge failed for ${table.name}: ${String(err instanceof Error ? err.message : err)}`;
      logger.error({ err, table: table.name }, 'Default partition purge failed');
      errors.push(message);
    }
  }

  const result: PartitionMaintenanceResult = {
    partitionsCreated,
    partitionsDropped,
    defaultPartitionRowsPurged,
    engagementRowsCascaded,
    durationMs: Date.now() - startTime,
    errors,
  };

  logger.info(result, 'Partition maintenance run complete');

  try {
    await db.query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('last_partition_maintenance_run', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(result)]
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to store partition maintenance result in system_status');
  }

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────

/** `YYYY-MM-DD` string for today, per PostgreSQL's own clock/timezone —
 *  deliberately asked of the DB rather than computed from Node's `Date`, so
 *  partition boundaries always agree with the `CURRENT_DATE` the migrations
 *  used to create them, regardless of the app server's local timezone. */
async function getServerToday(): Promise<string> {
  const result = await db.query<{ today: string }>(`SELECT CURRENT_DATE::text AS today`);
  return result.rows[0].today;
}

async function getServerTodayAsDate(): Promise<Date> {
  const today = await getServerToday();
  return parseDateOnly(today);
}

/** Parse a `YYYY-MM-DD` string as a UTC midnight Date (avoids local-timezone
 *  drift when doing day-granularity arithmetic in JS). */
function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((part) => parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function assertSafeIdentifier(name: string): void {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Refusing to use unsafe SQL identifier: ${JSON.stringify(name)}`);
  }
}

function quoteIdent(name: string): string {
  assertSafeIdentifier(name);
  return `"${name}"`;
}

function partitionName(table: string, date: Date): string {
  return `${table}_p${formatDateOnly(date).replace(/-/g, '')}`;
}

async function partitionExists(name: string): Promise<boolean> {
  assertSafeIdentifier(name);
  const result = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`,
    [name]
  );
  return result.rows[0]?.exists === true;
}

/**
 * Ensure a partition exists for every day in [today, today + CREATE_AHEAD_DAYS].
 * Delegates the actual DDL to create_daily_range_partitions() (migration
 * 026), which is idempotent (`CREATE TABLE IF NOT EXISTS`), so calling this
 * daily even when partitions already exist is a cheap no-op.
 */
async function createAheadPartitions(table: PartitionedTableSpec, today: Date): Promise<string[]> {
  assertSafeIdentifier(table.name);
  const endDate = addDays(today, CREATE_AHEAD_DAYS);

  const beforeNames: string[] = [];
  for (let d = today; d <= endDate; d = addDays(d, 1)) {
    beforeNames.push(partitionName(table.name, d));
  }

  // Only report names that didn't already exist, so callers/tests can
  // distinguish "created this run" from "already there".
  const existedBefore = new Set<string>();
  for (const name of beforeNames) {
    if (await partitionExists(name)) {
      existedBefore.add(name);
    }
  }

  await db.query(`SELECT create_daily_range_partitions($1, $2, $3, $4)`, [
    table.name,
    table.name,
    formatDateOnly(today),
    formatDateOnly(endDate),
  ]);

  return beforeNames.filter((name) => !existedBefore.has(name));
}

/**
 * DETACH + DROP every daily partition of `table` whose upper bound (i.e. the
 * day after the partition's date) is at or before `today - retentionDays`.
 * Scans up to DROP_LOOKBACK_BUFFER_DAYS beyond the cutoff so a maintenance
 * outage still drains the backlog on the next successful run, using cheap
 * to_regclass() existence checks rather than introspecting pg_inherits.
 */
async function dropOldPartitions(
  table: PartitionedTableSpec,
  today: Date
): Promise<{ dropped: string[]; engagementCascaded: number }> {
  assertSafeIdentifier(table.name);
  const cutoff = addDays(today, -table.retentionDays);
  const scanStart = addDays(cutoff, -DROP_LOOKBACK_BUFFER_DAYS);

  const dropped: string[] = [];
  let engagementCascaded = 0;

  // Partition for date `d` covers [d, d+1) — drop it once d+1 <= cutoff.
  for (let d = scanStart; d < cutoff; d = addDays(d, 1)) {
    const name = partitionName(table.name, d);
    if (!(await partitionExists(name))) {
      continue;
    }

    if (table.name === 'posts') {
      engagementCascaded += await cascadeDeletePostEngagement(name);
    }

    await detachAndDropPartition(table.name, name);
    dropped.push(name);
    logger.info({ table: table.name, partition: name }, 'Dropped expired partition');
  }

  return { dropped, engagementCascaded };
}

/**
 * Application-level cascade substituting for the FK CASCADE that used to
 * exist on post_engagement.post_uri before migration 027 dropped it (a
 * partitioned table's PK/unique constraints must include the full partition
 * key, so `posts(uri)` alone could no longer back that FK). Deletes
 * post_engagement rows for every post in the specific posts partition about
 * to be dropped — bounded by that one day's post volume, not a full-table
 * scan.
 */
async function cascadeDeletePostEngagement(postsPartitionName: string): Promise<number> {
  assertSafeIdentifier(postsPartitionName);
  let totalDeleted = 0;

  // Batch over post_engagement itself (the table being modified), not over the
  // static posts partition — selecting `SELECT uri FROM <partition> LIMIT n`
  // returns the SAME n rows every iteration (nothing is removed from the
  // partition), so once those n engagement rows are gone the count drops below
  // BATCH_SIZE and the loop exits, orphaning every post beyond the first n.
  // Keying the LIMIT off post_engagement.ctid makes each batch delete a fresh
  // set and self-advance (same pattern purgeDefaultPartition's posts branch uses).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await db.query(
      `DELETE FROM post_engagement
       WHERE ctid IN (
         SELECT pe.ctid FROM post_engagement pe
         WHERE pe.post_uri IN (SELECT uri FROM ${quoteIdent(postsPartitionName)})
         LIMIT $1
       )`,
      [BATCH_SIZE]
    );
    const deleted = result.rowCount ?? 0;
    totalDeleted += deleted;
    if (deleted < BATCH_SIZE) break;
  }

  return totalDeleted;
}

async function detachAndDropPartition(parentTable: string, partitionTable: string): Promise<void> {
  assertSafeIdentifier(parentTable);
  assertSafeIdentifier(partitionTable);

  // DETACH PARTITION takes an ACCESS EXCLUSIVE lock on the parent; CONCURRENTLY
  // is unavailable because these tables keep a DEFAULT partition. This path is
  // also reachable from disk-monitor's emergency recovery, so bound the lock
  // wait: fail fast rather than stall reads/writes during disk pressure. A
  // timeout throws, is recorded in the run's `errors`, and the partition is
  // retried on the next run (the drop-lookback buffer drains any backlog).
  // DETACH + DROP run in one transaction so the drop can't leave a detached
  // orphan table behind.
  //
  // Retry a few times within the run: the constantly-written high-volume tables
  // (posts, post_scores) rarely have a clear 5s window on the first try, so a
  // single attempt loses the drop for the whole day (observed 2026-07-08:
  // likes/reposts/follows dropped but posts/post_scores hit "lock timeout").
  // Each attempt keeps the SHORT 5s lock_timeout so a waiting ACCESS EXCLUSIVE
  // never queues long enough to stall writers — we back off and try again for a
  // quieter moment rather than holding the lock request open.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DETACH_RETRY_ATTEMPTS; attempt++) {
    const client = await db.connect();
    // If ROLLBACK itself fails, the connection's transaction state is unknown;
    // pass that error to release() so pg-pool DESTROYS the connection instead of
    // returning a possibly-broken one to the pool. A clean rollback leaves this
    // undefined and the connection is reused normally.
    let releaseError: Error | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(`ALTER TABLE ${quoteIdent(parentTable)} DETACH PARTITION ${quoteIdent(partitionTable)}`);
      await client.query(`DROP TABLE ${quoteIdent(partitionTable)}`);
      await client.query('COMMIT');
      return;
    } catch (err) {
      lastErr = err;
      await client.query('ROLLBACK').catch((rollbackErr) => {
        releaseError = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      });
      if (attempt < DETACH_RETRY_ATTEMPTS) {
        logger.warn(
          { parentTable, partitionTable, attempt, err },
          'DETACH PARTITION lock attempt failed; retrying after backoff'
        );
        await sleep(DETACH_RETRY_BACKOFF_MS);
      }
    } finally {
      client.release(releaseError);
    }
  }
  throw lastErr;
}

/**
 * Sweep the DEFAULT partition (the out-of-range safety net created in
 * migrations 026-029) for rows that have aged past retention, same cutoff as
 * dropOldPartitions. Bounded/batched like cleanup.ts's guarded deletes — the
 * default partition is expected to stay small (only clock-skew/backfill
 * stragglers land there), so this is not the 48M-row full-scan pattern
 * migration 025 fixed.
 */
async function purgeDefaultPartition(table: PartitionedTableSpec, today: Date): Promise<number> {
  assertSafeIdentifier(table.name);
  const defaultTable = `${table.name}_default`;
  if (!(await partitionExists(defaultTable))) {
    return 0;
  }

  const cutoff = addDays(today, -table.retentionDays);
  let totalDeleted = 0;

  if (table.name === 'posts') {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await db.query<{ uri: string }>(
        `DELETE FROM ${quoteIdent(defaultTable)}
         WHERE uri IN (
           SELECT uri FROM ${quoteIdent(defaultTable)} WHERE created_at < $1 LIMIT $2
         )
         RETURNING uri`,
        [formatDateOnly(cutoff), BATCH_SIZE]
      );
      const uris = result.rows.map((r) => r.uri);
      if (uris.length > 0) {
        await db.query(`DELETE FROM post_engagement WHERE post_uri = ANY($1::text[])`, [uris]);
      }
      totalDeleted += uris.length;
      if (uris.length < BATCH_SIZE) break;
    }
    return totalDeleted;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // ctid (physical row id) works generically regardless of each table's PK
    // shape, so this one query body covers likes/reposts/follows/post_scores/
    // post_score_components default partitions alike.
    const result = await db.query(
      `DELETE FROM ${quoteIdent(defaultTable)}
       WHERE ctid IN (
         SELECT ctid FROM ${quoteIdent(defaultTable)} WHERE created_at < $1 LIMIT $2
       )`,
      [formatDateOnly(cutoff), BATCH_SIZE]
    );
    const deleted = result.rowCount ?? 0;
    totalDeleted += deleted;
    if (deleted < BATCH_SIZE) break;
  }

  return totalDeleted;
}
