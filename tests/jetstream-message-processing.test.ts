import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, loggerErrorMock, loggerWarnMock, loggerDebugMock, processEventMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  processEventMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
    debug: loggerDebugMock,
    info: vi.fn(),
  },
}));

vi.mock('../src/ingestion/event-processor.js', () => ({
  processEvent: processEventMock,
}));

import { __testJetstreamQueue, clearJetstreamFailedCursorPins } from '../src/ingestion/jetstream.js';

describe('Jetstream message processing', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
    loggerDebugMock.mockReset();
    processEventMock.mockReset();
    processEventMock.mockResolvedValue('non-commit-ignored');
    __testJetstreamQueue.reset();
  });

  afterEach(() => {
    __testJetstreamQueue.reset();
  });

  it('logs invalid payload byte counts without raw payload data', async () => {
    const payload = Buffer.from('{"did":"did:plc:secret-value","kind":"commit","time_us":', 'utf8');

    const result = await __testJetstreamQueue.processMessage(payload);

    expect(result.parsed).toBe(false);
    expect(result.processed).toBe(false);
    expect(result.ingestionOutcome).toBeNull();
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [context] = loggerErrorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.payloadBytes).toBe(payload.byteLength);
    expect(context).not.toHaveProperty('data');
    expect(JSON.stringify(context)).not.toContain('secret-value');
    expect(result.errorMessage).toBe('invalid Jetstream JSON payload');
    expect(result.errorMessage).not.toContain('secret-value');
  });

  it('sanitizes malformed JSON parser snippets from logs and returned errors', async () => {
    const payload = Buffer.from(
      '{"did":"did:plc:secret-snippet","kind":"commit","time_us":1,"commit":}',
      'utf8'
    );

    const result = await __testJetstreamQueue.processMessage(payload);

    expect(result.parsed).toBe(false);
    expect(result.processed).toBe(false);
    expect(result.errorMessage).toBe('invalid Jetstream JSON payload');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    const [context] = loggerErrorMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context).toEqual({ errName: 'SyntaxError', payloadBytes: payload.byteLength });
    expect(JSON.stringify(context)).not.toContain('secret-snippet');
    expect(result.errorMessage).not.toContain('secret-snippet');
  });

  it('rejects empty strings and non-positive cursor timestamps before processing', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        did: '',
        time_us: 0,
        kind: 'commit',
        commit: {
          rev: '',
          operation: 'create',
          collection: '',
          rkey: '',
        },
      }),
      'utf8'
    );

    const result = await __testJetstreamQueue.processMessage(payload);

    expect(result.parsed).toBe(false);
    expect(result.processed).toBe(false);
    expect(processEventMock).not.toHaveBeenCalled();
  });

  it('resets cursor-save interval after a failed cursor persistence attempt', async () => {
    dbQueryMock.mockRejectedValue(new Error('cursor database unavailable'));
    let latestResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1, kind: 'identity' }), 'utf8')
    );

    for (let index = 2; index <= 1000; index += 1) {
      latestResult = await __testJetstreamQueue.processMessage(
        Buffer.from(
          JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }),
          'utf8'
        )
      );
    }

    expect(latestResult.cursorSaved).toBe(false);
    expect(latestResult.eventCounter).toBe(0);
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: '1000',
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { cursor: '1000' },
      'Cursor save failed; continuing with interval backoff'
    );
  });

  it('resets cursor-save interval after a successful cursor persistence attempt', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    let latestResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1, kind: 'identity' }), 'utf8')
    );

    for (let index = 2; index <= 1000; index += 1) {
      latestResult = await __testJetstreamQueue.processMessage(
        Buffer.from(
          JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }),
          'utf8'
        )
      );
    }

    expect(latestResult.cursorSaved).toBe(true);
    expect(latestResult.eventCounter).toBe(0);
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: '1000',
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(String(dbQueryMock.mock.calls[0]?.[0])).toContain('GREATEST(jetstream_cursor.cursor_us, EXCLUDED.cursor_us)');
    expect(loggerDebugMock).toHaveBeenCalledWith({ cursor: '1000' }, 'Cursor saved');
  });

  it('reports handler errors without an observed ingestion outcome', async () => {
    processEventMock.mockRejectedValueOnce(new Error('handler exploded'));

    const result = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:handler-user', time_us: 1, kind: 'identity' }), 'utf8')
    );

    expect(result.parsed).toBe(true);
    expect(result.processed).toBe(false);
    expect(result.ingestionOutcome).toBeNull();
    expect(result.errorMessage).toContain('handler exploded');
  });

  it('does not advance the persisted cursor beyond a failed handler event', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000) {
        return Promise.reject(new Error('handler exploded'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    const newerResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1001, kind: 'identity' }), 'utf8')
    );

    expect(failedResult.processed).toBe(false);
    expect(newerResult.cursorSaved).toBe(true);
    expect(newerResult.cursorUs).toBe('999');
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: '999',
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['999']);
  });

  it('allows a previously failed cursor to advance after the same event replays successfully', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    let shouldFailCursor = true;
    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000 && shouldFailCursor) {
        shouldFailCursor = false;
        return Promise.reject(new Error('handler exploded'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    const replayResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    const newerResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1001, kind: 'identity' }), 'utf8')
    );

    expect(failedResult.processed).toBe(false);
    expect(replayResult.processed).toBe(true);
    expect(replayResult.cursorSaved).toBe(true);
    expect(replayResult.cursorUs).toBe('1000');
    expect(newerResult.cursorSaved).toBe(false);
    expect(newerResult.cursorUs).toBe('1001');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['1000']);
  });

  it('lets operators clear a permanently failed cursor pin so later events can persist', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000) {
        return Promise.reject(new Error('permanent handler failure'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    const pinnedResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1001, kind: 'identity' }), 'utf8')
    );

    expect(failedResult.processed).toBe(false);
    expect(pinnedResult.cursorSaved).toBe(true);
    expect(pinnedResult.cursorUs).toBe('999');
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['999']);

    expect(() => clearJetstreamFailedCursorPins('')).toThrow(RangeError);
    const clearedCount = clearJetstreamFailedCursorPins('fixture cursor 1000 preserved in test incident evidence');
    expect(clearedCount).toBe(1);

    for (let index = 1002; index <= 2001; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    expect(dbQueryMock.mock.calls[1]?.[1]).toEqual(['2001']);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { clearedCount: 1, reason: 'fixture cursor 1000 preserved in test incident evidence' },
      'Cleared Jetstream failed cursor pins by operator request'
    );
  });

  it('ignores stale handler failures after a reconnect generation advances', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    let rejectOldEvent: (() => void) | null = null;
    let oldEventStarted: (() => void) | null = null;
    const oldEventStartedPromise = new Promise<void>((resolve) => {
      oldEventStarted = resolve;
    });

    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000 && rejectOldEvent === null) {
        oldEventStarted?.();
        return new Promise<string>((_resolve, reject) => {
          rejectOldEvent = () => reject(new Error('stale handler exploded'));
        });
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const oldEventPromise = __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    await oldEventStartedPromise;
    __testJetstreamQueue.invalidateConnectionForTests();

    const replayResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    expect(replayResult.cursorSaved).toBe(true);
    expect(replayResult.cursorUs).toBe('1000');

    rejectOldEvent?.();
    const oldEventResult = await oldEventPromise;
    expect(oldEventResult.processed).toBe(false);

    const newerResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1001, kind: 'identity' }), 'utf8')
    );
    expect(newerResult.cursorSaved).toBe(false);
    expect(newerResult.cursorUs).toBe('1001');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['1000']);
  });

  it('does not persist a cursor newer than the oldest in-flight event', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    let resolveOldEvent: (() => void) | null = null;
    let oldEventStarted: (() => void) | null = null;
    const oldEventStartedPromise = new Promise<void>((resolve) => {
      oldEventStarted = resolve;
    });

    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000) {
        oldEventStarted?.();
        return new Promise<string>((resolve) => {
          resolveOldEvent = () => resolve('non-commit-ignored');
        });
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const oldEventPromise = __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    await oldEventStartedPromise;

    const newEventResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1001, kind: 'identity' }), 'utf8')
    );

    expect(newEventResult.cursorSaved).toBe(true);
    expect(newEventResult.cursorUs).toBe('999');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['999']);

    resolveOldEvent?.();
    await oldEventPromise;
  });

  it('keeps duplicate in-flight cursor timestamps unsafe until every duplicate completes', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    let resolveFirstDuplicate: (() => void) | null = null;
    let firstDuplicateStarted: (() => void) | null = null;
    let duplicateCount = 0;
    const firstDuplicateStartedPromise = new Promise<void>((resolve) => {
      firstDuplicateStarted = resolve;
    });

    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000) {
        duplicateCount += 1;
        if (duplicateCount === 1) {
          firstDuplicateStarted?.();
          return new Promise<string>((resolve) => {
            resolveFirstDuplicate = () => resolve('non-commit-ignored');
          });
        }
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index <= 999; index += 1) {
      await __testJetstreamQueue.processMessage(
        Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: index, kind: 'identity' }), 'utf8')
      );
    }

    const firstDuplicatePromise = __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );
    await firstDuplicateStartedPromise;

    const secondDuplicateResult = await __testJetstreamQueue.processMessage(
      Buffer.from(JSON.stringify({ did: 'did:plc:cursor-user', time_us: 1000, kind: 'identity' }), 'utf8')
    );

    expect(secondDuplicateResult.cursorSaved).toBe(true);
    expect(secondDuplicateResult.cursorUs).toBe('999');
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['999']);

    resolveFirstDuplicate?.();
    await firstDuplicatePromise;
  });
});
