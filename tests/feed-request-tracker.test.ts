import { afterEach, describe, expect, it, vi } from 'vitest';

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  FEED_REQUEST_TRACKER_MAX_IN_FLIGHT,
  __resetFeedRequestTrackerForTests,
  __setFeedRequestTrackerTaskTimeoutForTests,
  drainFeedRequestTracker,
  enqueueFeedRequestTracking,
  getFeedRequestTrackerStats,
} from '../src/feed/request-tracker.js';

describe('feed request tracker', () => {
  afterEach(async () => {
    await drainFeedRequestTracker(5000);
    __resetFeedRequestTrackerForTests();
    loggerWarnMock.mockReset();
  });

  it('drains accepted tracking tasks without drops', async () => {
    for (let index = 0; index < 100; index += 1) {
      const accepted = enqueueFeedRequestTracking(async () => undefined);
      expect(accepted).toBe(true);
    }

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.enqueued).toBe(100);
    expect(stats.completed).toBe(100);
    expect(stats.failed).toBe(0);
    expect(stats.timedOut).toBe(0);
    expect(stats.dropped).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.maxInFlightObserved).toBeGreaterThan(0);
    expect(stats.maxInFlightObserved).toBeLessThanOrEqual(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);
  });

  it('returns an isolated stats snapshot copy', () => {
    const snapshot = getFeedRequestTrackerStats();
    snapshot.enqueued = 500;
    expect(getFeedRequestTrackerStats().enqueued).toBe(0);
  });

  it('records task failures without rejecting the drain', async () => {
    const accepted = enqueueFeedRequestTracking(async () => {
      throw new Error('tracking write failed');
    });
    expect(accepted).toBe(true);

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.timedOut).toBe(0);
    expect(stats.dropped).toBe(0);
  });

  it('records synchronous task failures without stalling the queue', async () => {
    const accepted = enqueueFeedRequestTracking(() => {
      throw new Error('sync tracking write failed');
    });
    expect(accepted).toBe(true);

    const stats = await drainFeedRequestTracker(1000);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(1);
    expect(stats.timedOut).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(0);
  });

  it('resolves immediately when already idle', async () => {
    const stats = await drainFeedRequestTracker(1);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid drain timeout %s', async (timeoutMs) => {
    await expect(drainFeedRequestTracker(timeoutMs)).rejects.toThrow(RangeError);
  });

  it('rejects drain waiters when work does not finish before the timeout', async () => {
    let resolveTask: (() => void) | null = null;
    let taskStarted: (() => void) | null = null;
    const taskStartedPromise = new Promise<void>((resolve) => {
      taskStarted = resolve;
    });
    enqueueFeedRequestTracking(
      () =>
        new Promise<void>((resolve) => {
          taskStarted?.();
          resolveTask = resolve;
        })
    );

    await taskStartedPromise;
    expect(getFeedRequestTrackerStats().inFlight).toBe(1);
    await expect(drainFeedRequestTracker(1)).rejects.toThrow(/did not drain/);
    resolveTask?.();
    await drainFeedRequestTracker(1000);
  });

  it('times out and aborts hanging tasks, releases the slot, and accepts later work', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let observedSignal: AbortSignal | null = null;
    const accepted = enqueueFeedRequestTracking(
      (signal) =>
        new Promise<void>(() => {
          observedSignal = signal;
        })
    );
    expect(accepted).toBe(true);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(getFeedRequestTrackerStats().inFlight).toBe(1);

    const timedOutStats = await drainFeedRequestTracker(1000);

    expect(timedOutStats.completed).toBe(0);
    expect(timedOutStats.failed).toBe(0);
    expect(timedOutStats.timedOut).toBe(1);
    expect(timedOutStats.inFlight).toBe(0);
    expect(observedSignal?.aborted).toBe(true);

    const laterAccepted = enqueueFeedRequestTracking(async () => undefined);
    expect(laterAccepted).toBe(true);
    const recoveredStats = await drainFeedRequestTracker(1000);
    expect(recoveredStats.completed).toBe(1);
    expect(recoveredStats.failed).toBe(0);
    expect(recoveredStats.timedOut).toBe(1);
    expect(recoveredStats.inFlight).toBe(0);
  });

  it('records abort-aware task resolution as a timeout, not a completion', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    const accepted = enqueueFeedRequestTracking(
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        })
    );
    expect(accepted).toBe(true);

    const stats = await drainFeedRequestTracker(1000);

    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.timedOut).toBe(1);
    expect(stats.inFlight).toBe(0);
  });

  it('starts queued work after timed-out tasks release concurrency slots', async () => {
    __setFeedRequestTrackerTaskTimeoutForTests(5);
    let lateTaskStarted = false;
    for (let index = 0; index < FEED_REQUEST_TRACKER_MAX_IN_FLIGHT; index += 1) {
      const accepted = enqueueFeedRequestTracking(
        () =>
          new Promise<void>(() => {
            // Intentionally never resolves.
          })
      );
      expect(accepted).toBe(true);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(getFeedRequestTrackerStats().inFlight).toBe(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);

    const lateAccepted = enqueueFeedRequestTracking(async () => {
      lateTaskStarted = true;
    });
    expect(lateAccepted).toBe(true);

    const drainedStats = await drainFeedRequestTracker(1000);
    expect(lateTaskStarted).toBe(true);
    expect(drainedStats.timedOut).toBe(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);
    expect(drainedStats.maxInFlightObserved).toBeGreaterThan(0);
    expect(drainedStats.maxInFlightObserved).toBeLessThanOrEqual(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);
    expect(drainedStats.inFlight).toBe(0);
    expect(drainedStats.queued).toBe(0);
    expect(drainedStats.completed).toBe(1);
  });

  it('keeps burst tracking concurrency below the database pool budget', async () => {
    let releaseAllTasks: (() => void) | null = null;
    const releasePromise = new Promise<void>((resolve) => {
      releaseAllTasks = resolve;
    });
    const burstCount = FEED_REQUEST_TRACKER_MAX_IN_FLIGHT + 15;
    for (let index = 0; index < burstCount; index += 1) {
      const accepted = enqueueFeedRequestTracking(async () => releasePromise);
      expect(accepted).toBe(true);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    const burstStats = getFeedRequestTrackerStats();
    expect(burstStats.inFlight).toBe(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);
    expect(burstStats.maxInFlightObserved).toBe(FEED_REQUEST_TRACKER_MAX_IN_FLIGHT);
    expect(burstStats.queued).toBe(15);

    releaseAllTasks?.();
    await drainFeedRequestTracker(1000);
  });

  it('drains 20,000 queued tasks in FIFO order', async () => {
    const executionOrder: number[] = [];
    const taskCount = 20_000;
    for (let index = 0; index < taskCount; index += 1) {
      const accepted = enqueueFeedRequestTracking(async () => {
        executionOrder.push(index);
      });
      expect(accepted).toBe(true);
    }

    const statsAfterEnqueue = getFeedRequestTrackerStats();
    expect(statsAfterEnqueue.queued).toBe(taskCount);
    expect(statsAfterEnqueue.maxQueuedObserved).toBe(taskCount);

    const drainedStats = await drainFeedRequestTracker(5000);
    expect(drainedStats.completed).toBe(taskCount);
    expect(drainedStats.queued).toBe(0);
    expect(drainedStats.inFlight).toBe(0);
    expect(executionOrder).toEqual(Array.from({ length: taskCount }, (_value, index) => index));
  });

  it('resolves drain waiters after queued and in-flight work become idle', async () => {
    let releaseBlockingTask: (() => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    let drainResolved = false;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const completedFastTasks: number[] = [];

    const blockerAccepted = enqueueFeedRequestTracking(
      () =>
        new Promise<void>((resolve) => {
          resolveStarted?.();
          releaseBlockingTask = resolve;
        })
    );
    expect(blockerAccepted).toBe(true);

    for (let index = 0; index < 70; index += 1) {
      const accepted = enqueueFeedRequestTracking(async () => {
        completedFastTasks.push(index);
      });
      expect(accepted).toBe(true);
    }

    await started;
    const drainPromise = drainFeedRequestTracker(5000).then((stats) => {
      drainResolved = true;
      return stats;
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(drainResolved).toBe(false);
    expect(getFeedRequestTrackerStats().inFlight).toBe(1);

    releaseBlockingTask?.();
    const drainedStats = await drainPromise;
    expect(drainResolved).toBe(true);
    expect(completedFastTasks).toHaveLength(70);
    expect(drainedStats.completed).toBe(71);
    expect(drainedStats.queued).toBe(0);
    expect(drainedStats.inFlight).toBe(0);
  });

  it('resolves overlapping drain waiters after the same blocking task is released', async () => {
    let releaseBlockingTask: (() => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const accepted = enqueueFeedRequestTracking(
      () =>
        new Promise<void>((resolve) => {
          resolveStarted?.();
          releaseBlockingTask = resolve;
        })
    );
    expect(accepted).toBe(true);

    await started;
    const firstDrain = drainFeedRequestTracker(1000);
    const secondDrain = drainFeedRequestTracker(1000);

    releaseBlockingTask?.();
    const [firstStats, secondStats] = await Promise.all([firstDrain, secondDrain]);
    expect(firstStats.completed).toBe(1);
    expect(secondStats.completed).toBe(1);
    expect(firstStats.inFlight).toBe(0);
    expect(secondStats.queued).toBe(0);
  });

  it('does not let a short drain timeout cancel a concurrent long drain waiter', async () => {
    let releaseBlockingTask: (() => void) | null = null;
    let resolveStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const accepted = enqueueFeedRequestTracking(
      () =>
        new Promise<void>((resolve) => {
          resolveStarted?.();
          releaseBlockingTask = resolve;
        })
    );
    expect(accepted).toBe(true);

    await started;
    const shortDrain = drainFeedRequestTracker(1);
    const longDrain = drainFeedRequestTracker(1000);

    await expect(shortDrain).rejects.toThrow(/did not drain/);
    releaseBlockingTask?.();
    const longStats = await longDrain;
    expect(longStats.completed).toBe(1);
    expect(longStats.inFlight).toBe(0);
    expect(longStats.queued).toBe(0);
  });

  it('refuses to reset while queued or in-flight work exists', async () => {
    let resolveTask: (() => void) | null = null;
    enqueueFeedRequestTracking(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        })
    );

    expect(() => __resetFeedRequestTrackerForTests()).toThrow(/cannot reset active/);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    resolveTask?.();
    await drainFeedRequestTracker(1000);
  });

  it('drops tasks beyond the bounded queue limit', async () => {
    for (let index = 0; index < 20_000; index += 1) {
      const accepted = enqueueFeedRequestTracking(async () => undefined);
      expect(accepted).toBe(true);
    }

    const statsAfterFill = getFeedRequestTrackerStats();
    expect(statsAfterFill.enqueued).toBe(20_000);
    expect(statsAfterFill.queued).toBe(20_000);
    expect(statsAfterFill.maxQueuedObserved).toBe(20_000);

    const accepted = enqueueFeedRequestTracking(async () => undefined);
    expect(accepted).toBe(false);
    const statsAfterDrop = getFeedRequestTrackerStats();
    expect(statsAfterDrop.enqueued).toBe(20_000);
    expect(statsAfterDrop.dropped).toBe(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        queued: 20_000,
        dropped: 1,
      },
      'Feed request tracking queue is saturated; dropping tracking task'
    );

    const secondAccepted = enqueueFeedRequestTracking(async () => undefined);
    expect(secondAccepted).toBe(false);
    expect(getFeedRequestTrackerStats().dropped).toBe(2);
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });
});
