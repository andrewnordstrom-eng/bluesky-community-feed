/**
 * Disk Space Monitor
 *
 * Monitors filesystem usage and takes escalating action to prevent
 * the VPS from filling up and killing the feed:
 *
 * - WARNING (80%):  Log warning, store alert in system_status
 * - CRITICAL (90%): Trigger immediate cleanup, truncate journald
 * - EMERGENCY (95%): Free-space-safe recovery — force an immediate
 *   partition-manager drop pass, cleanup's orphan sweeps, journald
 *   truncation, a WAL checkpoint, and a plain VACUUM (never FULL) — plus
 *   an escalating system_status alert. See runEmergencyDiskFreeingActions()
 *   for why VACUUM FULL was removed (PROJ-917).
 *
 * Runs every 5 minutes. Uses fs.statfs() (no shell exec).
 * Follows the same start/stop/isRunning pattern as cleanup.ts.
 */

import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { triggerManualCleanup } from './cleanup.js';
import { runPartitionMaintenanceNow } from './partition-manager.js';

const CHECK_INTERVAL_MS = 5 * 60_000; // 5 minutes

export interface DiskStatus {
  used_percent: number;
  available_gb: number;
  total_gb: number;
  level: 'ok' | 'warning' | 'critical' | 'emergency';
  last_checked_at: string;
}

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let isChecking = false;
let lastStatus: DiskStatus | null = null;
let consecutiveCriticalChecks = 0;
let isEmergencyActionRunning = false;

/**
 * Get current disk status using fs.statfs (no shell needed).
 */
async function checkDiskUsage(): Promise<DiskStatus> {
  return new Promise((resolve, reject) => {
    fs.statfs('/', (err, stats) => {
      if (err) {
        reject(err);
        return;
      }

      const totalBytes = stats.blocks * stats.bsize;
      const availableBytes = stats.bavail * stats.bsize;
      const usedBytes = totalBytes - availableBytes;
      const usedPercent = Math.round((usedBytes / totalBytes) * 100);
      const availableGb = Math.round((availableBytes / (1024 ** 3)) * 100) / 100;
      const totalGb = Math.round((totalBytes / (1024 ** 3)) * 100) / 100;

      let level: DiskStatus['level'] = 'ok';
      if (usedPercent >= config.DISK_EMERGENCY_PERCENT) {
        level = 'emergency';
      } else if (usedPercent >= config.DISK_CRITICAL_PERCENT) {
        level = 'critical';
      } else if (usedPercent >= config.DISK_WARNING_PERCENT) {
        level = 'warning';
      }

      resolve({
        used_percent: usedPercent,
        available_gb: availableGb,
        total_gb: totalGb,
        level,
        last_checked_at: new Date().toISOString(),
      });
    });
  });
}

/**
 * Truncate journald logs to free disk space.
 * Uses execFile with hardcoded args — safe, no shell injection possible.
 */
async function truncateJournald(): Promise<void> {
  return new Promise((resolve) => {
    execFile('journalctl', ['--vacuum-size=500M'], (err) => {
      if (err) {
        logger.warn({ err }, 'Failed to truncate journald (may need root)');
      } else {
        logger.info('Journald truncated to 500M');
      }
      resolve();
    });
  });
}

/** Tables targeted by the emergency plain-VACUUM pass (same targets the old
 *  VACUUM FULL used to hit — follows/reposts/likes are the highest-churn raw
 *  event tables, posts is the largest content table). All four are now
 *  RANGE-partitioned (migrations 026-029); running VACUUM on a partitioned
 *  parent recurses into every leaf partition (PostgreSQL 16 docs,
 *  "VACUUM Parameters": "If a partitioned table is specified, all its leaf
 *  partitions will be vacuumed."), so this still covers the same data. */
const EMERGENCY_VACUUM_TABLES = ['follows', 'reposts', 'likes', 'posts'];

/**
 * Run a plain VACUUM (NEVER FULL) on the emergency-tier tables.
 *
 * PROJ-917 postmortem: the previous emergency action ran `VACUUM FULL`,
 * which rewrites the entire table into a new file and therefore needs
 * roughly as much free disk space as the table itself to complete. On a
 * disk that is already at 95%+, that space is exactly what's missing — in
 * production this failed with ENOSPC 3 times in a row against the 21GB
 * `likes` table, and each attempt held an ACCESS EXCLUSIVE lock on the
 * table for its full (failed) duration, starving the connection pool of
 * every other query that touched `likes`.
 *
 * Plain VACUUM only needs a SHARE UPDATE EXCLUSIVE lock (does not block
 * reads/writes) and, critically, can still return space to the OS: when it
 * finds entirely-empty pages at the physical end of a table/partition it
 * truncates the file (unless `vacuum_truncate` is disabled), which is
 * exactly the space this monitor is trying to free. It just can't compact
 * fragmented pages in the middle of the table the way VACUUM FULL can —
 * that's an acceptable trade during an active emergency; a full compaction
 * can be scheduled later, off the emergency path, during a maintenance
 * window when disk headroom is no longer contested.
 */
async function runEmergencyPlainVacuum(): Promise<void> {
  let client;

  try {
    client = await db.connect();
    await client.query("SET statement_timeout = '600s'");

    for (const table of EMERGENCY_VACUUM_TABLES) {
      // Per-table try/catch: a failure on one table (lock contention, a
      // canceled statement, etc.) must not abort the whole emergency pass —
      // the remaining tables still need their space reclaimed. Without this,
      // a single failing VACUUM would silently skip every table after it.
      try {
        const before = await client.query(
          `SELECT pg_total_relation_size($1) as size_bytes`,
          [table]
        );
        const sizeMb = Math.round(Number(before.rows[0].size_bytes) / (1024 * 1024));
        logger.info({ table, size_mb: sizeMb }, 'Running emergency VACUUM (not FULL)');

        // NEVER VACUUM FULL here — see function header. Table names come from
        // the hardcoded EMERGENCY_VACUUM_TABLES list above, not user input.
        await client.query(`VACUUM ${table}`);

        const after = await client.query(
          `SELECT pg_total_relation_size($1) as size_bytes`,
          [table]
        );
        const afterMb = Math.round(Number(after.rows[0].size_bytes) / (1024 * 1024));
        logger.info(
          { table, before_mb: sizeMb, after_mb: afterMb, freed_mb: sizeMb - afterMb },
          'Emergency VACUUM complete'
        );
      } catch (err) {
        logger.error({ err, table }, 'Emergency VACUUM failed for table; continuing with remaining tables');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Emergency VACUUM failed');
  } finally {
    if (client) {
      await client.query("SET statement_timeout = '10s'").catch(() => {});
      client.release();
    }
  }
}

/**
 * Free-space-safe emergency recovery, run at the 95% (emergency) threshold.
 * Every action here is safe to run while the disk is nearly full — none of
 * them require the 2x-table-size scratch space that VACUUM FULL needed.
 * Guarded against overlapping runs (a 5-minute check interval could
 * otherwise start a second pass before a slow first pass finishes).
 */
// Exported (only) so tests can exercise the isEmergencyActionRunning guard
// directly — runDiskCheck()'s own isChecking flag already fully serializes
// this on the normal scheduled path, so there is no way to reach a second,
// overlapping invocation through startDiskMonitor()/stopDiskMonitor() alone.
export async function runEmergencyDiskFreeingActions(): Promise<void> {
  if (isEmergencyActionRunning) {
    logger.warn('Emergency disk-freeing actions skipped — already running');
    return;
  }
  isEmergencyActionRunning = true;

  try {
    // 1. Partition-manager's drop pass is normally once-per-calendar-day;
    // force it now so any partition that has aged past retention is
    // DETACHed + DROPped immediately (metadata-only, instant reclaim) —
    // then cleanup's guarded orphan/stale-row sweeps.
    try {
      await runPartitionMaintenanceNow();
    } catch (err) {
      logger.error({ err }, 'Emergency partition-manager drop failed');
    }

    try {
      await triggerManualCleanup();
    } catch (err) {
      logger.error({ err }, 'Emergency cleanup sweep failed');
    }

    // 2. Reclaim journald disk usage.
    await truncateJournald();

    // 3. CHECKPOINT + WAL-size check (flushes WAL if the on-disk WAL
    // directory has grown past checkWalSize()'s own threshold).
    await checkWalSize();

    // 4. Plain VACUUM (never FULL) — see runEmergencyPlainVacuum() header.
    await runEmergencyPlainVacuum();
  } finally {
    isEmergencyActionRunning = false;
  }
}

/**
 * Store an escalating alert in system_status and log at error level.
 * Severity escalates with consecutive emergency-level checks so an operator
 * scanning logs/vitals can tell "just tipped over" apart from "still stuck
 * at 95%+ after repeated recovery passes".
 */
async function recordEmergencyAlert(status: DiskStatus, consecutiveChecks: number): Promise<void> {
  const severity = consecutiveChecks >= 3 ? 'critical' : consecutiveChecks >= 2 ? 'high' : 'elevated';
  const alert = {
    severity,
    used_percent: status.used_percent,
    available_gb: status.available_gb,
    consecutive_checks: consecutiveChecks,
    detected_at: new Date().toISOString(),
  };

  logger.error(
    alert,
    `EMERGENCY disk alert (severity=${severity}): disk-freeing actions ran, usage still at ${status.used_percent}%`
  );

  try {
    await db.query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('disk_emergency_alert', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(alert)]
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to store disk emergency alert in system_status');
  }
}

/**
 * Clear the emergency alert once disk usage drops back out of the
 * emergency tier, so vitals/dashboards don't keep showing a stale critical
 * banner after the incident has resolved.
 *
 * Deliberately unconditional (no in-memory "was an alert active" guard):
 * system_status is tiny and a keyed DELETE on a row that doesn't exist is a
 * cheap no-op, whereas an in-memory flag would desync from the database
 * across a process restart — e.g. the service crashes while
 * 'disk_emergency_alert' is set, restarts with the flag defaulted back to
 * false, and a stale critical alert would then linger forever because the
 * guard thinks there's nothing to clear.
 */
async function clearEmergencyAlert(): Promise<void> {
  await db.query(`DELETE FROM system_status WHERE key = 'disk_emergency_alert'`).catch((err: unknown) => {
    logger.warn({ err }, 'Failed to clear disk emergency alert from system_status');
  });
}

/**
 * Check WAL directory size and run CHECKPOINT if too large.
 * Uses pg_ls_waldir() to get actual on-disk WAL size (not cumulative LSN position).
 */
async function checkWalSize(): Promise<void> {
  let client;
  try {
    client = await db.connect();
    const result = await client.query(
      `SELECT COALESCE(SUM(size), 0) as wal_bytes FROM pg_ls_waldir()`
    );
    const walMb = Math.round(Number(result.rows[0].wal_bytes) / (1024 * 1024));

    if (walMb > 500) {
      logger.warn({ wal_size_mb: walMb }, 'WAL directory exceeds 500MB — running CHECKPOINT');
      await client.query('CHECKPOINT');
      logger.info('WAL CHECKPOINT complete');
    }
  } catch (err) {
    logger.warn({ err }, 'WAL size check failed (non-fatal)');
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Main disk check loop.
 */
async function runDiskCheck(): Promise<void> {
  if (isChecking || isShuttingDown) return;
  isChecking = true;

  try {
    lastStatus = await checkDiskUsage();

    logger.debug(
      { used_percent: lastStatus.used_percent, level: lastStatus.level, available_gb: lastStatus.available_gb },
      'Disk check'
    );

    // Store status in system_status
    await db.query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('disk_status', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(lastStatus)]
    ).catch((err: unknown) => {
      logger.warn({ err }, 'Failed to store disk status');
    });

    if (lastStatus.level === 'emergency') {
      consecutiveCriticalChecks++;
      logger.error(
        { used_percent: lastStatus.used_percent, available_gb: lastStatus.available_gb, consecutive: consecutiveCriticalChecks },
        'EMERGENCY: Disk usage critical — running free-space-safe recovery actions'
      );

      await runEmergencyDiskFreeingActions();
      await recordEmergencyAlert(lastStatus, consecutiveCriticalChecks);
    } else if (lastStatus.level === 'critical') {
      consecutiveCriticalChecks++;
      logger.warn(
        { used_percent: lastStatus.used_percent, available_gb: lastStatus.available_gb, consecutive: consecutiveCriticalChecks },
        'CRITICAL: Disk usage high — triggering cleanup + journal truncation'
      );

      await triggerManualCleanup();
      await truncateJournald();
      await checkWalSize();
      await clearEmergencyAlert();
    } else if (lastStatus.level === 'warning') {
      consecutiveCriticalChecks = 0;
      logger.warn(
        { used_percent: lastStatus.used_percent, available_gb: lastStatus.available_gb },
        'WARNING: Disk usage approaching critical'
      );
      await checkWalSize();
      await clearEmergencyAlert();
    } else {
      consecutiveCriticalChecks = 0;
      await clearEmergencyAlert();
    }
  } catch (err) {
    logger.error({ err }, 'Disk check failed');
  } finally {
    isChecking = false;
  }
}

/**
 * Start the disk monitor.
 */
export async function startDiskMonitor(): Promise<void> {
  if (isRunning) {
    logger.warn('Disk monitor already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;
  consecutiveCriticalChecks = 0;

  logger.info(
    {
      intervalMs: CHECK_INTERVAL_MS,
      warningPct: config.DISK_WARNING_PERCENT,
      criticalPct: config.DISK_CRITICAL_PERCENT,
      emergencyPct: config.DISK_EMERGENCY_PERCENT,
    },
    'Starting disk monitor'
  );

  // Run immediately
  await runDiskCheck();

  // Schedule recurring
  intervalId = setInterval(() => void runDiskCheck(), CHECK_INTERVAL_MS);

  logger.info('Disk monitor started');
}

/**
 * Stop the disk monitor.
 */
export async function stopDiskMonitor(): Promise<void> {
  if (!isRunning) return;

  logger.info('Stopping disk monitor...');
  isShuttingDown = true;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  while (isChecking) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  isRunning = false;
  logger.info('Disk monitor stopped');
}

/**
 * Check if the disk monitor is running.
 */
export function isDiskMonitorRunning(): boolean {
  return isRunning;
}

/**
 * Get the last disk status check result.
 * Used by health.ts for the disk health component.
 */
export function getDiskStatus(): DiskStatus | null {
  return lastStatus;
}
