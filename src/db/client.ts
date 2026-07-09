import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: config.DB_STATEMENT_TIMEOUT,
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

db.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

/**
 * Dedicated health-check pool (PROJ-917).
 *
 * Prod incident 2026-07-06: the health check's `SELECT 1` shared the main
 * `db` pool above. When the main pool was exhausted (every connection
 * checked out by real request/scoring traffic), the health query queued
 * behind it, /health/ready started failing, and systemd's watchdog
 * (src/lib/watchdog.ts, which gates its heartbeat on this same check)
 * eventually SIGABRT-killed the service — the health check became a victim
 * of the exact condition it exists to detect.
 *
 * This tiny, separate pool is used ONLY by checkDatabase() in
 * src/lib/health.ts (and therefore by the watchdog heartbeat path that
 * calls it). Kept intentionally small: a health probe never needs more
 * than a couple of connections, and keeping it separate means main-pool
 * exhaustion can no longer starve the one check whose entire job is to
 * notice that.
 */
export const healthDb = new Pool({
  connectionString: config.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 5000,
});

healthDb.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL health-pool error');
});
