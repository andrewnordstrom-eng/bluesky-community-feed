/**
 * Graceful Shutdown Module
 *
 * Handles clean shutdown of all system components with a timeout.
 * Order: Watchdog → HTTP server → Scoring → Jetstream → Epoch Scheduler → Maintenance Worker Supervisor → Cleanup → Interaction Logger → Interaction Aggregator → Database → Redis
 */

import type { FastifyInstance } from 'fastify';
import { logger } from './logger.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';

// Maximum time to wait for graceful shutdown before forcing exit
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds

export interface ShutdownDependencies {
  server: FastifyInstance;
  stopScoring: () => Promise<void>;
  stopJetstream: () => Promise<void>;
  stopEpochScheduler?: () => void;
  stopMaintenanceWorkerSupervisor?: () => Promise<void>;
  stopWatchdog?: () => void;
  stopCleanup?: () => Promise<void>;
  stopInteractionLogger?: () => Promise<void>;
  stopInteractionAggregator?: () => Promise<void>;
}

let isShuttingDown = false;

/**
 * Perform graceful shutdown of all components.
 * Exits with code 0 on success, 1 on timeout or error.
 */
export async function gracefulShutdown(deps: ShutdownDependencies): Promise<void> {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }
  isShuttingDown = true;

  logger.info('Starting graceful shutdown...');

  // Set a hard timeout to force exit if shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 30s, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // 0. Stop watchdog heartbeat (prevent systemd kill during shutdown)
    if (deps.stopWatchdog) {
      deps.stopWatchdog();
    }

    // 1. Stop accepting new HTTP requests (drain existing)
    logger.info('Closing HTTP server...');
    await deps.server.close();
    logger.info('HTTP server closed');

    // 2. Stop scoring scheduler (wait for any in-progress run)
    logger.info('Stopping scoring pipeline...');
    await deps.stopScoring();
    logger.info('Scoring pipeline stopped');

    // 3. Stop Jetstream (saves final cursor)
    logger.info('Stopping Jetstream...');
    await deps.stopJetstream();
    logger.info('Jetstream stopped');

    // 3.5. Stop epoch scheduler
    if (deps.stopEpochScheduler) {
      logger.info('Stopping epoch scheduler...');
      deps.stopEpochScheduler();
      logger.info('Epoch scheduler stopped');
    }

    // 3.6. Stop maintenance worker supervisor (includes cleanup/logger/aggregator)
    if (deps.stopMaintenanceWorkerSupervisor) {
      logger.info('Stopping maintenance worker supervisor...');
      await deps.stopMaintenanceWorkerSupervisor();
      logger.info('Maintenance worker supervisor stopped');
    } else {
      // Backwards-compatible fallback when no supervisor is registered.
      if (deps.stopCleanup) {
        logger.info('Stopping cleanup scheduler...');
        await deps.stopCleanup();
        logger.info('Cleanup scheduler stopped');
      }

      if (deps.stopInteractionLogger) {
        logger.info('Stopping interaction logger...');
        await deps.stopInteractionLogger();
        logger.info('Interaction logger stopped');
      }

      if (deps.stopInteractionAggregator) {
        logger.info('Stopping interaction aggregator...');
        await deps.stopInteractionAggregator();
        logger.info('Interaction aggregator stopped');
      }
    }

    // 4. Close database pool
    logger.info('Closing PostgreSQL connection pool...');
    await db.end();
    logger.info('PostgreSQL closed');

    // 5. Close Redis connection
    logger.info('Closing Redis connection...');
    await redis.quit();
    logger.info('Redis closed');

    // Clear the force exit timeout
    clearTimeout(forceExitTimeout);

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

/**
 * Register shutdown handlers for SIGTERM and SIGINT.
 */
export function registerShutdownHandlers(deps: ShutdownDependencies): void {
  const handler = () => {
    gracefulShutdown(deps).catch((err) => {
      logger.error({ err }, 'Fatal error during shutdown');
      process.exit(1);
    });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);

  logger.debug('Shutdown handlers registered');
}
