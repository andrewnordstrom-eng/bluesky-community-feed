import { afterEach, describe, expect, it, vi } from 'vitest';

const { wsCtorMock, wsPauseMock, wsResumeMock, wsCloseMock, dbQueryMock, processEventMock } = vi.hoisted(() => ({
  wsCtorMock: vi.fn(),
  wsPauseMock: vi.fn(),
  wsResumeMock: vi.fn(),
  wsCloseMock: vi.fn(),
  dbQueryMock: vi.fn(),
  processEventMock: vi.fn(),
}));

let latestSocket: MockWebSocket | null = null;
const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  public readyState = MockWebSocket.CONNECTING;
  private handlers: Record<string, (...args: unknown[]) => void> = {};

  constructor(url: string) {
    wsCtorMock(url);
    latestSocket = this;
    sockets.push(this);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers[event] = handler;
  }

  close(code?: number, reason?: string): void {
    if (
      code !== undefined &&
      (code < 1000 || code > 4999 || code === 1004 || code === 1005 || code === 1006)
    ) {
      throw new RangeError(`Invalid WebSocket close code: ${code}`);
    }
    wsCloseMock(code, reason);
    this.emitClose(code, reason);
  }

  emitClose(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.handlers.close?.(code ?? 1000, Buffer.from(reason ?? 'closed'));
  }

  pause(): void {
    wsPauseMock();
  }

  resume(): void {
    wsResumeMock();
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.handlers.open?.();
  }

  emitMessage(data: Buffer): void {
    this.handlers.message?.(data);
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/ingestion/event-processor.js', () => ({
  processEvent: processEventMock,
}));

describe('jetstream lifecycle', () => {
  afterEach(async () => {
    vi.resetModules();
    wsCtorMock.mockReset();
    wsPauseMock.mockReset();
    wsResumeMock.mockReset();
    wsCloseMock.mockReset();
    dbQueryMock.mockReset();
    processEventMock.mockReset();
    latestSocket = null;
    sockets.length = 0;
  });

  it('can reconnect after a stop/start cycle', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });

    const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');

    await startJetstream();
    expect(wsCtorMock).toHaveBeenCalledTimes(1);

    await stopJetstream();
    await startJetstream();
    expect(wsCtorMock).toHaveBeenCalledTimes(2);

    await stopJetstream();
  });

  it('resets in-memory cursor state to the durable cursor on reconnect', async () => {
    vi.useFakeTimers();
    try {
      dbQueryMock.mockImplementation((query: unknown) => {
        if (String(query).includes('SELECT cursor_us FROM jetstream_cursor')) {
          return Promise.resolve({ rows: [{ cursor_us: '100' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const { __testJetstreamQueue, startJetstream, stopJetstream } =
        await import('../src/ingestion/jetstream.js');
      await startJetstream();
      __testJetstreamQueue.setCursorForTests('500');

      expect(() => latestSocket?.close(1006, 'network interruption')).toThrow(RangeError);
      latestSocket?.emitClose(1006, 'network interruption');
      await vi.advanceTimersByTimeAsync(1000);

      expect(wsCtorMock).toHaveBeenCalledTimes(2);
      expect(__testJetstreamQueue.getCursorState()).toEqual({
        eventCounter: 0,
        lastCursorUs: '100',
      });

      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the safely completed in-memory cursor when a reconnect cursor read fails', async () => {
    vi.useFakeTimers();
    try {
      let cursorReadCount = 0;
      dbQueryMock.mockImplementation((query: unknown) => {
        if (String(query).includes('SELECT cursor_us FROM jetstream_cursor')) {
          cursorReadCount += 1;
          if (cursorReadCount === 1) {
            return Promise.resolve({ rows: [{ cursor_us: '100' }] });
          }
          return Promise.reject(new Error('cursor read unavailable'));
        }
        return Promise.resolve({ rows: [] });
      });

      const { __testJetstreamQueue, startJetstream, stopJetstream } =
        await import('../src/ingestion/jetstream.js');
      await startJetstream();
      __testJetstreamQueue.setCursorForTests('500');

      sockets[0]?.emitClose(1006, 'network interruption');
      await vi.advanceTimersByTimeAsync(1000);

      expect(wsCtorMock).toHaveBeenCalledTimes(2);
      expect(String(wsCtorMock.mock.calls[1]?.[0])).toContain('cursor=500');
      expect(__testJetstreamQueue.getCursorState().lastCursorUs).toBe('500');

      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late close event from a replaced socket', async () => {
    vi.useFakeTimers();
    try {
      dbQueryMock.mockResolvedValue({ rows: [] });
      const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');
      await startJetstream();
      const firstSocket = sockets[0];

      firstSocket?.emitClose(1006, 'network interruption');
      await vi.advanceTimersByTimeAsync(1000);
      expect(wsCtorMock).toHaveBeenCalledTimes(2);

      firstSocket?.emitClose(1006, 'late duplicate close');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wsCtorMock).toHaveBeenCalledTimes(2);

      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores buffered messages from a replaced socket before event side effects', async () => {
    vi.useFakeTimers();
    try {
      dbQueryMock.mockResolvedValue({ rows: [] });
      processEventMock.mockResolvedValue('non-commit-ignored');
      const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');
      await startJetstream();
      const firstSocket = sockets[0];
      firstSocket?.open();

      firstSocket?.emitClose(1006, 'network interruption');
      await vi.advanceTimersByTimeAsync(1000);
      const replacementSocket = sockets[1];
      replacementSocket?.open();

      firstSocket?.emitMessage(Buffer.from(JSON.stringify({
        did: 'did:plc:stale-socket-user',
        time_us: 100,
        kind: 'identity',
      })));
      await vi.advanceTimersByTimeAsync(0);
      expect(processEventMock).not.toHaveBeenCalled();

      replacementSocket?.emitMessage(Buffer.from(JSON.stringify({
        did: 'did:plc:current-socket-user',
        time_us: 200,
        kind: 'identity',
      })));
      await vi.advanceTimersByTimeAsync(0);
      expect(processEventMock).toHaveBeenCalledTimes(1);

      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending reconnect before an operator-triggered replacement', async () => {
    vi.useFakeTimers();
    try {
      dbQueryMock.mockResolvedValue({ rows: [] });
      const { startJetstream, stopJetstream, triggerJetstreamReconnect } =
        await import('../src/ingestion/jetstream.js');
      await startJetstream();

      sockets[0]?.emitClose(1006, 'network interruption');
      triggerJetstreamReconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(wsCtorMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(wsCtorMock).toHaveBeenCalledTimes(2);

      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a delayed overload callback close a replacement socket', async () => {
    vi.useFakeTimers();
    try {
      let resolveCursorSave: (() => void) | null = null;
      dbQueryMock.mockImplementation((query: unknown) => {
        if (String(query).includes('INSERT INTO jetstream_cursor')) {
          return new Promise((resolve) => {
            resolveCursorSave = () => resolve({ rows: [] });
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const {
        __testJetstreamQueue,
        startJetstream,
        stopJetstream,
        triggerJetstreamReconnect,
      } = await import('../src/ingestion/jetstream.js');
      await startJetstream();
      const overloadedSocket = sockets[0];
      overloadedSocket?.open();
      __testJetstreamQueue.setCursorForTests('500');

      __testJetstreamQueue.triggerQueueOverload();
      await vi.advanceTimersByTimeAsync(0);
      expect(resolveCursorSave).not.toBeNull();

      triggerJetstreamReconnect();
      await vi.advanceTimersByTimeAsync(1000);
      const replacementSocket = sockets[1];
      replacementSocket?.open();

      const finishCursorSave = resolveCursorSave as (() => void) | null;
      finishCursorSave?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(wsCloseMock).not.toHaveBeenCalledWith(1013, 'event_queue_overflow');
      expect(replacementSocket?.readyState).toBe(MockWebSocket.OPEN);
      dbQueryMock.mockResolvedValue({ rows: [] });
      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for active work before saving the final shutdown cursor', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    let finishHandler: ((outcome: string) => void) | null = null;
    processEventMock.mockImplementation(() => new Promise<string>((resolve) => {
      finishHandler = resolve;
    }));

    const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');
    await startJetstream();
    latestSocket?.open();
    latestSocket?.emitMessage(Buffer.from(JSON.stringify({
      did: 'did:plc:shutdown-user',
      time_us: 500,
      kind: 'identity',
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));

    let stopResolved = false;
    const stopPromise = stopJetstream().then(() => {
      stopResolved = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stopResolved).toBe(false);

    const completeHandler = finishHandler as ((outcome: string) => void) | null;
    completeHandler?.('non-commit-ignored');
    await stopPromise;

    const cursorWrite = dbQueryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO jetstream_cursor')
    );
    expect(cursorWrite?.[1]).toEqual(['500']);
  });

  it('fails shutdown when the final cursor cannot be persisted', async () => {
    dbQueryMock.mockImplementation((query: string) => {
      if (query.includes('INSERT INTO jetstream_cursor')) {
        return Promise.reject(new Error('cursor database unavailable'));
      }
      return Promise.resolve({ rows: [] });
    });
    processEventMock.mockResolvedValue('non-commit-ignored');

    const { getJetstreamStartedAt, startJetstream, stopJetstream } =
      await import('../src/ingestion/jetstream.js');
    await startJetstream();
    latestSocket?.open();
    latestSocket?.emitMessage(Buffer.from(JSON.stringify({
      did: 'did:plc:shutdown-write-failure',
      time_us: 700,
      kind: 'identity',
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(stopJetstream()).rejects.toMatchObject({
      name: 'JetstreamCursorPersistenceError',
      message: 'Failed to persist final Jetstream cursor 700',
    });
    expect(getJetstreamStartedAt()).toBeNull();
  });

  it('reset clears pending reconnects and restores the primary connection lifecycle', async () => {
    vi.useFakeTimers();
    try {
      dbQueryMock.mockResolvedValue({ rows: [] });
      const { __testJetstreamQueue, startJetstream, stopJetstream } =
        await import('../src/ingestion/jetstream.js');
      await startJetstream();
      const primaryUrl = String(wsCtorMock.mock.calls[0]?.[0]);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        sockets[attempt]?.emitClose(1006, 'network interruption');
        await vi.advanceTimersByTimeAsync(1000 * (2 ** attempt));
      }
      expect(String(wsCtorMock.mock.calls[5]?.[0])).not.toBe(primaryUrl);

      __testJetstreamQueue.reset();
      const connectionCountAfterReset = wsCtorMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wsCtorMock).toHaveBeenCalledTimes(connectionCountAfterReset);

      await startJetstream();
      expect(String(wsCtorMock.mock.lastCall?.[0])).toBe(primaryUrl);
      await stopJetstream();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies socket backpressure until sustained async work drains', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    const completions: Array<() => void> = [];
    processEventMock.mockImplementation(() => new Promise<string>((resolve) => {
      completions.push(() => resolve('non-commit-ignored'));
    }));

    const { __testJetstreamQueue, startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');
    await startJetstream();
    const socket = latestSocket;
    expect(socket).not.toBeNull();
    socket?.open();

    const eventCount =
      __testJetstreamQueue.maxConcurrentEvents + __testJetstreamQueue.pauseQueueThreshold;
    for (let index = 1; index <= eventCount; index += 1) {
      socket?.emitMessage(Buffer.from(JSON.stringify({
        did: 'did:plc:backpressure-user',
        time_us: index,
        kind: 'identity',
      })));
    }
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(wsPauseMock).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      activeEvents: __testJetstreamQueue.maxConcurrentEvents,
      pendingEvents: __testJetstreamQueue.pauseQueueThreshold,
      inboundPaused: true,
      totalDroppedEvents: 0,
    });

    let completed = 0;
    const releasesUntilResume =
      __testJetstreamQueue.pauseQueueThreshold - __testJetstreamQueue.resumeQueueThreshold;
    while (completed < releasesUntilResume) {
      const complete = completions.shift();
      expect(complete).toBeDefined();
      complete?.();
      completed += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(wsResumeMock).toHaveBeenCalledTimes(1);
    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      pendingEvents: __testJetstreamQueue.resumeQueueThreshold,
      inboundPaused: false,
      pauseCount: 1,
      resumeCount: 1,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
    });

    while (completed < eventCount) {
      const complete = completions.shift();
      expect(complete).toBeDefined();
      complete?.();
      completed += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(__testJetstreamQueue.getRuntimeState()).toMatchObject({
      activeEvents: 0,
      pendingEvents: 0,
      overloadReconnectCount: 0,
      totalDroppedEvents: 0,
    });
    expect(wsCloseMock).not.toHaveBeenCalledWith(1013, expect.anything());

    await stopJetstream();
  });

  it('serializes create and delete events for the same record in arrival order', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] });
    const observedOperations: string[] = [];
    let completeCreate: (() => void) | null = null;
    processEventMock.mockImplementation((event: { commit?: { operation?: string } }) => {
      const operation = event.commit?.operation ?? 'unknown';
      observedOperations.push(operation);
      if (operation === 'create') {
        return new Promise<string>((resolve) => {
          completeCreate = () => resolve('post-inserted');
        });
      }
      return Promise.resolve('delete-post-applied');
    });

    const { startJetstream, stopJetstream } = await import('../src/ingestion/jetstream.js');
    await startJetstream();
    latestSocket?.open();
    const baseEvent = {
      did: 'did:plc:ordered-record',
      kind: 'commit',
      commit: {
        rev: 'revision',
        collection: 'app.bsky.feed.post',
        rkey: 'same-record',
      },
    };
    latestSocket?.emitMessage(Buffer.from(JSON.stringify({
      ...baseEvent,
      time_us: 1000,
      commit: { ...baseEvent.commit, operation: 'create', cid: 'cid-create', record: {} },
    })));
    latestSocket?.emitMessage(Buffer.from(JSON.stringify({
      ...baseEvent,
      time_us: 1001,
      commit: { ...baseEvent.commit, operation: 'delete' },
    })));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(observedOperations).toEqual(['create']);
    const releaseCreate = completeCreate as (() => void) | null;
    releaseCreate?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observedOperations).toEqual(['create', 'delete']);

    await stopJetstream();
  });
});
