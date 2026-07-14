import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/ingestion/event-processor.js', () => ({
  processEvent: vi.fn(),
}));

import { __testJetstreamQueue } from '../src/ingestion/jetstream.js';

describe('queue saturation drop counter', () => {
  it('starts at zero after reset', () => {
    __testJetstreamQueue.reset();
    expect(__testJetstreamQueue.getDroppedCount()).toBe(0);
  });

  it('increments cumulative drop metrics when message processing finds a full queue', async () => {
    __testJetstreamQueue.reset();

    // Fill all active slots
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    // Fill the pending queue to capacity
    const pendingAcquires = Array.from(
      { length: __testJetstreamQueue.maxPendingEvents },
      () => __testJetstreamQueue.acquireSlot()
    );

    const overflowResult = await __testJetstreamQueue.processMessage(Buffer.from('{}'));
    expect(overflowResult).toMatchObject({ acquired: false, dropped: true });
    expect(__testJetstreamQueue.getDroppedCount()).toBe(1);
    expect(__testJetstreamQueue.getRuntimeState().totalDroppedEvents).toBe(1);

    // Clean up
    __testJetstreamQueue.drainQueuedSlots(false);
    for (const p of pendingAcquires) {
      await p;
    }
    __testJetstreamQueue.reset();
  });

  it('does not count reconnect-cancelled queued work as a hard-limit drop', async () => {
    __testJetstreamQueue.reset();
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    const queuedResult = __testJetstreamQueue.processMessage(Buffer.from('{}'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(__testJetstreamQueue.getState().queued).toBe(1);

    __testJetstreamQueue.drainQueuedSlots(false);
    await expect(queuedResult).resolves.toMatchObject({
      acquired: false,
      dropped: false,
      errorMessage: 'jetstream message cancelled for reconnect',
    });
    expect(__testJetstreamQueue.getDroppedCount()).toBe(0);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      overloadReconnectCount: 0,
      flowControlFailureReconnectCount: 0,
      totalDroppedEvents: 0,
    });

    __testJetstreamQueue.reset();
  });

  it('keeps a queued duplicate timestamp behind the safely persisted cursor', async () => {
    __testJetstreamQueue.reset();
    __testJetstreamQueue.setCursorForTests('1000');
    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    const queuedResult = __testJetstreamQueue.processMessage(Buffer.from(JSON.stringify({
      did: 'did:plc:queued-cursor',
      time_us: 1000,
      kind: 'identity',
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(__testJetstreamQueue.getState().queued).toBe(1);
    expect(__testJetstreamQueue.getCursorState().lastCursorUs).toBe('999');

    __testJetstreamQueue.drainQueuedSlots(false);
    await expect(queuedResult).resolves.toMatchObject({ acquired: false, dropped: false });
    expect(__testJetstreamQueue.getCursorState().lastCursorUs).toBe('999');
    __testJetstreamQueue.reset();
  });

  it('resetDroppedCount clears the counter', () => {
    __testJetstreamQueue.reset();

    // The counter is module-level; verify reset works
    __testJetstreamQueue.resetDroppedCount();
    expect(__testJetstreamQueue.getDroppedCount()).toBe(0);
  });

  it('reset() also clears the dropped counter', () => {
    __testJetstreamQueue.reset();
    expect(__testJetstreamQueue.getDroppedCount()).toBe(0);
  });

  it('getState returns active and queued counts', async () => {
    __testJetstreamQueue.reset();

    // Acquire 3 active slots
    await __testJetstreamQueue.acquireSlot();
    await __testJetstreamQueue.acquireSlot();
    await __testJetstreamQueue.acquireSlot();

    const state = __testJetstreamQueue.getState();
    expect(state.active).toBe(3);
    expect(state.queued).toBe(0);

    __testJetstreamQueue.reset();
  });

  it('reports cursor lag from the last safely completed cursor', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-13T23:30:00.000Z'));
      const cursorUs = BigInt(Date.now() - 123_456) * 1000n;
      __testJetstreamQueue.reset();
      __testJetstreamQueue.setCursorForTests(cursorUs.toString());

      expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
        cursorUs: cursorUs.toString(),
        cursorLagMs: 123_456,
      });
    } finally {
      __testJetstreamQueue.reset();
      vi.useRealTimers();
    }
  });

  it('reports null cursor telemetry before a cursor is observed', () => {
    __testJetstreamQueue.reset();
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      cursorUs: null,
      cursorLagMs: null,
    });
  });

  it('reports zero lag for current and future cursors', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-13T23:30:00.000Z'));
      const currentCursorUs = BigInt(Date.now()) * 1000n;
      __testJetstreamQueue.reset();
      __testJetstreamQueue.setCursorForTests(currentCursorUs.toString());
      expect(__testJetstreamQueue.getRuntimeState().cursorLagMs).toBe(0);

      const futureCursorUs = currentCursorUs + 60_000_000n;
      __testJetstreamQueue.setCursorForTests(futureCursorUs.toString());
      expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
        cursorUs: futureCursorUs.toString(),
        cursorLagMs: 0,
      });
    } finally {
      __testJetstreamQueue.reset();
      vi.useRealTimers();
    }
  });
});
