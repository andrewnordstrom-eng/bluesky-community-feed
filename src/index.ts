import { config } from './config.js';
import { logger } from './lib/logger.js';
import { createServer } from './feed/server.js';
import { startJetstream, stopJetstream, isJetstreamConnected, getLastEventReceivedAt } from './ingestion/jetstream.js';
import { startScoring, stopScoring, isScoringInProgress } from './scoring/scheduler.js';
import { getLastScoringRunAt } from './scoring/pipeline.js';
import { runStartupChecks } from './lib/startup-checks.js';
import { registerShutdownHandlers } from './lib/shutdown.js';
import { registerJetstreamHealth, registerScoringHealth, registerDiskHealth, JetstreamHealth, ScoringHealth } from './lib/health.js';
import { getDiskStatus } from './maintenance/disk-monitor.js';
import { registerBotRoutes } from './bot/server.js';
import { initializeBot } from './bot/agent.js';
import { startEpochScheduler, stopEpochScheduler } from './scheduler/epoch-scheduler.js';
import { stopCleanup } from './maintenance/cleanup.js';
import { stopInteractionLogger } from './maintenance/interaction-logger.js';
import { stopInteractionAggregator } from './maintenance/interaction-aggregator.js';
import {
  startMaintenanceWorkerSupervisor,
  stopMaintenanceWorkerSupervisor,
} from './maintenance/worker-supervisor.js';
import { loadTaxonomy, loadTopicEmbeddings } from './scoring/topics/taxonomy.js';
import { initEmbedder } from './scoring/topics/embedder.js';
import { loadGovernanceGateWeights } from './ingestion/governance-gate.js';
import { sdNotifyReady, startWatchdog, stopWatchdog } from './lib/watchdog.js';

async function main() {
  logger.info('Starting Community Feed Generator...');

  // 0. Run startup checks (fail fast if dependencies are down)
  try {
    await runStartupChecks();
  } catch (err) {
    logger.fatal({ err }, 'Startup checks failed');
    process.exit(1);
  }

  // 1. Create and configure the HTTP server
  const app = await createServer();

  // 1.5. Register bot routes (if enabled)
  registerBotRoutes(app);

  // 2. Start HTTP server
  try {
    await app.listen({
      port: config.FEEDGEN_PORT,
      host: config.FEEDGEN_LISTENHOST,
    });
    logger.info(
      { port: config.FEEDGEN_PORT, host: config.FEEDGEN_LISTENHOST },
      'Feed generator server started'
    );

    // Tell systemd we're ready (Type=notify). No-op outside systemd.
    sdNotifyReady();

    // Start watchdog heartbeat immediately after READY so long startup
    // phases cannot miss the first watchdog deadline.
    startWatchdog();
  } catch (err) {
    logger.fatal({ err }, 'Failed to start HTTP server');
    process.exit(1);
  }

  // 2.5. Load topic taxonomy (before Jetstream starts consuming)
  try {
    await loadTaxonomy();
  } catch (err) {
    logger.warn({ err }, 'Failed to load topic taxonomy - posts will have empty topic vectors');
  }

  // 2.6. Initialize embedding classifier (if enabled)
  if (config.TOPIC_EMBEDDING_ENABLED) {
    try {
      await initEmbedder();
      await loadTopicEmbeddings();
      logger.info('Embedding classifier initialized');
    } catch (err) {
      logger.warn({ err }, 'Embedding classifier init failed — falling back to keyword classifier');
    }
  }

  // 2.7. Initialize governance gate weights (fail-open: gate disabled if load fails)
  if (config.INGESTION_GATE_ENABLED) {
    try {
      await loadGovernanceGateWeights();
    } catch (err) {
      logger.warn({ err }, 'Failed to load governance gate weights — gate will be disabled until next cache refresh');
    }
  }

  // 3. Start Jetstream ingestion
  try {
    await startJetstream();
    logger.info('Jetstream ingestion started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Jetstream ingestion');
    process.exit(1);
  }

  // 4. Register Jetstream health check
  registerJetstreamHealth((): JetstreamHealth => {
    const connected = isJetstreamConnected();
    const lastEventAt = getLastEventReceivedAt();
    const lastEventAgeMs = lastEventAt ? Date.now() - lastEventAt.getTime() : undefined;

    // Consider unhealthy if no events for more than 5 minutes
    const isHealthy = connected && (lastEventAgeMs === undefined || lastEventAgeMs < 300_000);

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      connected,
      last_event_age_ms: lastEventAgeMs,
      error: !connected ? 'WebSocket not connected' : undefined,
    };
  });

  // 5. Register scoring health check (before starting scoring so it's available during initial run)
  registerScoringHealth((): ScoringHealth => {
    const isRunning = isScoringInProgress();
    const lastRunAt = getLastScoringRunAt();

    // Consider healthy if we've had a successful run in the last 10 minutes
    // or if no run has happened yet (startup grace period)
    const lastRunAgeMs = lastRunAt ? Date.now() - lastRunAt.getTime() : undefined;
    const isHealthy = lastRunAgeMs === undefined || lastRunAgeMs < 600_000;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      is_running: isRunning,
      last_run_at: lastRunAt?.toISOString(),
      error: !isHealthy ? 'No successful scoring run in last 10 minutes' : undefined,
    };
  });

  // 6. Start scoring pipeline
  try {
    await startScoring();
    logger.info('Scoring pipeline started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start scoring pipeline');
    process.exit(1);
  }

  // 6.5. Initialize announcement bot (if enabled, non-fatal)
  try {
    await initializeBot();
  } catch (err) {
    logger.warn({ err }, 'Bot initialization failed - will retry on first announcement');
  }

  // 6.6. Start epoch scheduler (for auto-transitions)
  startEpochScheduler();

  // 6.7-6.9. Start maintenance workers under a supervisor
  try {
    await startMaintenanceWorkerSupervisor();
    logger.info('Maintenance worker supervisor started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start maintenance worker supervisor');
    process.exit(1);
  }

  // 6.10. Register disk health check (disk-monitor is now running via supervisor)
  registerDiskHealth(getDiskStatus);

  // 7. Register graceful shutdown handlers
  registerShutdownHandlers({
    server: app,
    stopScoring,
    stopJetstream,
    stopEpochScheduler,
    stopMaintenanceWorkerSupervisor,
    stopWatchdog,
    // Kept for backwards compatibility in shutdown flow.
    stopCleanup,
    stopInteractionLogger,
    stopInteractionAggregator,
  });

  // 8. Log startup complete
  logger.info({
    serviceDid: config.FEEDGEN_SERVICE_DID,
    publisherDid: config.FEEDGEN_PUBLISHER_DID,
    hostname: config.FEEDGEN_HOSTNAME,
  }, 'All systems operational (Phase 6: Hardening)');
}

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
  // Don't crash - log and continue
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception - shutting down');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
