import { logger } from '../lib/logger.js';
import { startCleanup, stopCleanup, isCleanupRunning } from './cleanup.js';
import {
  startInteractionLogger,
  stopInteractionLogger,
  isInteractionLoggerRunning,
} from './interaction-logger.js';
import {
  startInteractionAggregator,
  stopInteractionAggregator,
  isInteractionAggregatorRunning,
} from './interaction-aggregator.js';
import {
  startDiskMonitor,
  stopDiskMonitor,
  isDiskMonitorRunning,
} from './disk-monitor.js';

const START_RETRY_ATTEMPTS = 3;
const START_RETRY_DELAY_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60_000;

export interface ManagedWorker {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

interface WorkerSupervisorOptions {
  workers: ManagedWorker[];
  retryAttempts?: number;
  retryDelayMs?: number;
  healthCheckIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  exitFn?: (code: number) => void;
}

export interface WorkerSupervisor {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  checkNow: () => Promise<void>;
  isRunning: () => boolean;
}

const defaultWorkers: ManagedWorker[] = [
  {
    name: 'cleanup',
    start: startCleanup,
    stop: stopCleanup,
    isRunning: isCleanupRunning,
  },
  {
    name: 'interaction-logger',
    start: startInteractionLogger,
    stop: stopInteractionLogger,
    isRunning: isInteractionLoggerRunning,
  },
  {
    name: 'interaction-aggregator',
    start: startInteractionAggregator,
    stop: stopInteractionAggregator,
    isRunning: isInteractionAggregatorRunning,
  },
  {
    name: 'disk-monitor',
    start: startDiskMonitor,
    stop: stopDiskMonitor,
    isRunning: isDiskMonitorRunning,
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWorkerSupervisor(options: WorkerSupervisorOptions): WorkerSupervisor {
  const workers = options.workers;
  const retryAttempts = options.retryAttempts ?? START_RETRY_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? START_RETRY_DELAY_MS;
  const healthCheckIntervalMs = options.healthCheckIntervalMs ?? HEALTH_CHECK_INTERVAL_MS;
  const sleep = options.sleep ?? delay;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const exitFn = options.exitFn ?? ((code: number) => process.exit(code));

  let running = false;
  let healthCheckTimer: NodeJS.Timeout | null = null;
  let healthCheckInProgress = false;
  let stopping = false;

  const startWithRetry = async (worker: ManagedWorker, reason: 'startup' | 'restart') => {
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        await worker.start();
        if (!worker.isRunning()) {
          throw new Error('Worker did not report running state after start');
        }

        logger.info({ worker: worker.name, reason, attempt }, 'Maintenance worker started');
        return;
      } catch (err) {
        const isLastAttempt = attempt === retryAttempts;
        logger.warn(
          { err, worker: worker.name, reason, attempt, retryAttempts },
          'Maintenance worker start attempt failed'
        );

        if (isLastAttempt) {
          logger.fatal(
            { worker: worker.name, reason, retryAttempts },
            'Maintenance worker failed to start after retries'
          );
          exitFn(1);
          throw new Error(`Maintenance worker ${worker.name} failed to start`);
        }

        await sleep(retryDelayMs);
      }
    }
  };

  const checkWorkers = async () => {
    if (!running || stopping || healthCheckInProgress) {
      return;
    }

    healthCheckInProgress = true;
    try {
      for (const worker of workers) {
        if (!worker.isRunning()) {
          logger.error({ worker: worker.name }, 'Maintenance worker is not running, restarting');
          await startWithRetry(worker, 'restart');
        }
      }
    } finally {
      healthCheckInProgress = false;
    }
  };

  return {
    async start() {
      if (running) {
        logger.warn('Maintenance worker supervisor already running');
        return;
      }

      stopping = false;

      for (const worker of workers) {
        await startWithRetry(worker, 'startup');
      }

      healthCheckTimer = setIntervalFn(() => {
        void checkWorkers();
      }, healthCheckIntervalMs);

      running = true;
      logger.info({ workerCount: workers.length }, 'Maintenance worker supervisor started');
    },

    async stop() {
      if (!running && !healthCheckTimer) {
        return;
      }

      stopping = true;
      if (healthCheckTimer) {
        clearIntervalFn(healthCheckTimer);
        healthCheckTimer = null;
      }

      for (const worker of workers) {
        try {
          await worker.stop();
        } catch (err) {
          logger.error({ err, worker: worker.name }, 'Failed to stop maintenance worker');
        }
      }

      running = false;
      stopping = false;
      logger.info('Maintenance worker supervisor stopped');
    },

    checkNow: checkWorkers,

    isRunning() {
      return running;
    },
  };
}

let maintenanceWorkerSupervisor: WorkerSupervisor | null = null;

export async function startMaintenanceWorkerSupervisor(): Promise<void> {
  if (!maintenanceWorkerSupervisor) {
    maintenanceWorkerSupervisor = createWorkerSupervisor({
      workers: defaultWorkers,
    });
  }

  await maintenanceWorkerSupervisor.start();
}

export async function stopMaintenanceWorkerSupervisor(): Promise<void> {
  if (!maintenanceWorkerSupervisor) {
    return;
  }

  await maintenanceWorkerSupervisor.stop();
  maintenanceWorkerSupervisor = null;
}
