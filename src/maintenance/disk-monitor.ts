/**
 * Disk Space Monitor
 *
 * Monitors filesystem usage and takes escalating action to prevent
 * the VPS from filling up and killing the feed:
 *
 * - WARNING (80%):  Log warning, store alert in system_status
 * - CRITICAL (90%): Trigger immediate cleanup, truncate journald
 * - EMERGENCY (95%): Run VACUUM FULL, CHECKPOINT to reclaim space
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

/**
 * Run VACUUM FULL on tables to return space to the OS.
 * This takes ACCESS EXCLUSIVE locks — only runs at emergency threshold.
 */
async function runEmergencyVacuumFull(): Promise<void> {
  const tables = ['follows', 'reposts', 'likes', 'posts'];
  let client;

  try {
    client = await db.connect();
    await client.query("SET statement_timeout = '600s'");

    for (const table of tables) {
      const before = await client.query(
        `SELECT pg_total_relation_size($1) as size_bytes`,
        [table]
      );
      const sizeMb = Math.round(Number(before.rows[0].size_bytes) / (1024 * 1024));
      logger.info({ table, size_mb: sizeMb }, 'Running VACUUM FULL');

      await client.query(`VACUUM FULL ${table}`);

      const after = await client.query(
        `SELECT pg_total_relation_size($1) as size_bytes`,
        [table]
      );
      const afterMb = Math.round(Number(after.rows[0].size_bytes) / (1024 * 1024));
      logger.info(
        { table, before_mb: sizeMb, after_mb: afterMb, freed_mb: sizeMb - afterMb },
        'VACUUM FULL complete'
      );
    }

    // Run CHECKPOINT to flush WAL
    await client.query('CHECKPOINT');
    logger.info('CHECKPOINT complete');

    // Store result
    await client.query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('last_emergency_vacuum', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify({ timestamp: new Date().toISOString(), tables })]
    );
  } catch (err) {
    logger.error({ err }, 'Emergency VACUUM FULL failed');
  } finally {
    if (client) {
      await client.query("SET statement_timeout = '10s'").catch(() => {});
      client.release();
    }
  }
}

/**
 * Check WAL size and run CHECKPOINT if too large.
 */
async function checkWalSize(): Promise<void> {
  let client;
  try {
    client = await db.connect();
    const result = await client.query(
      `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') as wal_bytes`
    );
    const walMb = Math.round(Number(result.rows[0].wal_bytes) / (1024 * 1024));

    if (walMb > 500) {
      logger.warn({ wal_size_mb: walMb }, 'WAL size exceeds 500MB — running CHECKPOINT');
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
        'EMERGENCY: Disk usage critical — running VACUUM FULL + cleanup'
      );

      await triggerManualCleanup();
      await truncateJournald();
      await runEmergencyVacuumFull();
    } else if (lastStatus.level === 'critical') {
      consecutiveCriticalChecks++;
      logger.warn(
        { used_percent: lastStatus.used_percent, available_gb: lastStatus.available_gb, consecutive: consecutiveCriticalChecks },
        'CRITICAL: Disk usage high — triggering cleanup + journal truncation'
      );

      await triggerManualCleanup();
      await truncateJournald();
      await checkWalSize();
    } else if (lastStatus.level === 'warning') {
      consecutiveCriticalChecks = 0;
      logger.warn(
        { used_percent: lastStatus.used_percent, available_gb: lastStatus.available_gb },
        'WARNING: Disk usage approaching critical'
      );
      await checkWalSize();
    } else {
      consecutiveCriticalChecks = 0;
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
