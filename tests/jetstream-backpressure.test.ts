import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ingestion/event-processor.js', () => ({
  processEvent: vi.fn(),
}));

import { __testJetstreamQueue } from '../src/ingestion/jetstream.js';

describe('jetstream backpressure queue', () => {
  it('rejects new work when pending queue is saturated', async () => {
    __testJetstreamQueue.reset();

    const activeAcquires = await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    expect(activeAcquires.every(Boolean)).toBe(true);

    const pendingAcquires = Array.from({ length: __testJetstreamQueue.maxPendingEvents }, () =>
      __testJetstreamQueue.acquireSlot()
    );

    expect(__testJetstreamQueue.getState()).toEqual({
      active: __testJetstreamQueue.maxConcurrentEvents,
      queued: __testJetstreamQueue.maxPendingEvents,
    });

    const overflowAcquire = await __testJetstreamQueue.acquireSlot();
    expect(overflowAcquire).toBe(false);

    __testJetstreamQueue.releaseSlot();
    await expect(pendingAcquires[0]).resolves.toBe(true);

    __testJetstreamQueue.drainQueuedSlots(false);
    for (const acquire of pendingAcquires.slice(1)) {
      await expect(acquire).resolves.toBe(false);
    }

    __testJetstreamQueue.reset();
  });

  it('drains queued acquires as false during reconnect/close cleanup', async () => {
    __testJetstreamQueue.reset();

    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    const queuedA = __testJetstreamQueue.acquireSlot();
    const queuedB = __testJetstreamQueue.acquireSlot();

    expect(__testJetstreamQueue.getState().queued).toBe(2);

    __testJetstreamQueue.drainQueuedSlots(false);
    await expect(queuedA).resolves.toBe(false);
    await expect(queuedB).resolves.toBe(false);
    expect(__testJetstreamQueue.getState().queued).toBe(0);

    __testJetstreamQueue.reset();
  });

  it('pauses inbound delivery at the high-water mark and resumes after drainage', async () => {
    __testJetstreamQueue.reset();

    const pause = vi.fn();
    const resume = vi.fn();
    __testJetstreamQueue.setFlowControlSocket({
      readyState: 1,
      pause,
      resume,
      close: vi.fn(),
    });

    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.pauseQueueThreshold },
      () => __testJetstreamQueue.acquireSlot()
    );

    __testJetstreamQueue.applyInboundBackpressure();
    __testJetstreamQueue.applyInboundBackpressure();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      activeEvents: __testJetstreamQueue.maxConcurrentEvents,
      inboundPaused: true,
      pendingEvents: __testJetstreamQueue.pauseQueueThreshold,
      pauseCount: 1,
      resumeCount: 0,
      totalDroppedEvents: 0,
    });

    const releasesUntilResume =
      __testJetstreamQueue.pauseQueueThreshold - __testJetstreamQueue.resumeQueueThreshold;
    for (let index = 0; index < releasesUntilResume; index += 1) {
      __testJetstreamQueue.releaseSlot();
    }

    expect(resume).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      activeEvents: __testJetstreamQueue.maxConcurrentEvents,
      inboundPaused: false,
      pendingEvents: __testJetstreamQueue.resumeQueueThreshold,
      pauseCount: 1,
      resumeCount: 1,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
    });

    __testJetstreamQueue.drainQueuedSlots(false);
    await Promise.all(pendingAcquires);
    __testJetstreamQueue.reset();
  });

  it('reserves room for frames already buffered when inbound delivery pauses', async () => {
    __testJetstreamQueue.reset();

    const pause = vi.fn();
    __testJetstreamQueue.setFlowControlSocket({
      readyState: 1,
      pause,
      resume: vi.fn(),
      close: vi.fn(),
    });
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    const bufferedFrameCount = Math.min(
      __testJetstreamQueue.pauseReservedHeadroom,
      __testJetstreamQueue.maxConcurrentEvents * 2
    );
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.pauseQueueThreshold + bufferedFrameCount },
      () => __testJetstreamQueue.acquireSlot()
    );

    expect(pause).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      inboundPaused: true,
      pendingEvents: __testJetstreamQueue.pauseQueueThreshold + bufferedFrameCount,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
    });
    expect(__testJetstreamQueue.getState().queued).toBeLessThan(
      __testJetstreamQueue.maxPendingEvents
    );

    __testJetstreamQueue.drainQueuedSlots(false);
    await Promise.all(pendingAcquires);
    __testJetstreamQueue.reset();
  });

  it('forces overload recovery when pausing inbound delivery throws', async () => {
    __testJetstreamQueue.reset();

    const pause = vi.fn(() => {
      throw new Error('pause failed');
    });
    __testJetstreamQueue.setFlowControlSocket({
      readyState: 1,
      pause,
      resume: vi.fn(),
      close: vi.fn(),
    });
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.pauseQueueThreshold },
      () => __testJetstreamQueue.acquireSlot()
    );

    await Promise.all(pendingAcquires);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      inboundPaused: false,
      pendingEvents: 0,
      pauseCount: 0,
      overloadReconnectCount: 1,
    });

    __testJetstreamQueue.reset();
  });

  it('detaches and closes the socket when resuming inbound delivery throws', async () => {
    __testJetstreamQueue.reset();

    const close = vi.fn();
    const resume = vi.fn(() => {
      throw new Error('resume failed');
    });
    __testJetstreamQueue.setFlowControlSocket({
      readyState: 1,
      pause: vi.fn(),
      resume,
      close,
    });
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.pauseQueueThreshold },
      () => __testJetstreamQueue.acquireSlot()
    );

    const releasesUntilResume =
      __testJetstreamQueue.pauseQueueThreshold - __testJetstreamQueue.resumeQueueThreshold;
    for (let index = 0; index < releasesUntilResume; index += 1) {
      __testJetstreamQueue.releaseSlot();
    }

    expect(resume).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(1011, 'backpressure_resume_failed');
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      inboundPaused: false,
      resumeCount: 0,
    });

    __testJetstreamQueue.drainQueuedSlots(false);
    await Promise.all(pendingAcquires);
    __testJetstreamQueue.reset();
  });

  it('does not pause without an open flow-control socket', async () => {
    __testJetstreamQueue.reset();
    expect(() => __testJetstreamQueue.applyInboundBackpressure()).not.toThrow();

    const pause = vi.fn();
    __testJetstreamQueue.setFlowControlSocket({
      readyState: 3,
      pause,
      resume: vi.fn(),
      close: vi.fn(),
    });
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.pauseQueueThreshold },
      () => __testJetstreamQueue.acquireSlot()
    );

    expect(pause).not.toHaveBeenCalled();
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      inboundPaused: false,
      pendingEvents: __testJetstreamQueue.pauseQueueThreshold,
      pauseCount: 0,
    });

    __testJetstreamQueue.drainQueuedSlots(false);
    await Promise.all(pendingAcquires);
    __testJetstreamQueue.reset();
  });
});
