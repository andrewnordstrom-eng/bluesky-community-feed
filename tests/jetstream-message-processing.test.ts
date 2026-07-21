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

function identityMessage(did: string, timeUs: number): Buffer {
  return Buffer.from(JSON.stringify({ did, time_us: timeUs, kind: 'identity' }), 'utf8');
}

function postCommitMessage(did: string, timeUs: number, rkey: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      did,
      time_us: timeUs,
      kind: 'commit',
      commit: {
        rev: `rev-${rkey}`,
        cid: `cid-${rkey}`,
        operation: 'create',
        collection: 'app.bsky.feed.post',
        rkey,
        record: { text: `post ${rkey}` },
      },
    }),
    'utf8'
  );
}

function deadLetterInsertCalls(): unknown[][] {
  return dbQueryMock.mock.calls.filter(([query]) =>
    String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')
  );
}

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
    vi.useRealTimers();
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
      postCommitMessage('did:plc:cursor-user', 1000, 'failed-post')
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

  it('does not advance the persisted cursor beyond a resolved handler-error outcome', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    processEventMock.mockImplementation((event: { time_us?: number }) => {
      if (event.time_us === 1000) {
        return Promise.resolve('post-handler-error');
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
    expect(failedResult.ingestionOutcome).toBe('post-handler-error');
    expect(failedResult.errorMessage).toBe('post-handler-error');
    expect(newerResult.cursorSaved).toBe(true);
    expect(newerResult.cursorUs).toBe('999');
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: '999',
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual(['999']);
  });

  it('keeps a failed duplicate cursor timestamp pinned when a different event at that timestamp succeeds', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    const duplicateCursor = cursorSaveInterval;
    let failedDuplicateAttempts = 0;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'failed-duplicate') {
        failedDuplicateAttempts += 1;
        if (failedDuplicateAttempts > 1) {
          return Promise.resolve('non-commit-ignored');
        }
        return Promise.resolve('post-handler-error');
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    const failedDuplicateResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', duplicateCursor, 'failed-duplicate')
    );
    const successfulDuplicateResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', duplicateCursor, 'successful-duplicate')
    );
    const replayedFailedDuplicateResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', duplicateCursor, 'failed-duplicate')
    );

    expect(failedDuplicateResult.processed).toBe(false);
    expect(failedDuplicateResult.ingestionOutcome).toBe('post-handler-error');
    expect(successfulDuplicateResult.processed).toBe(true);
    expect(successfulDuplicateResult.cursorSaved).toBe(true);
    expect(successfulDuplicateResult.cursorUs).toBe(String(cursorSaveInterval - 1));
    expect(replayedFailedDuplicateResult.processed).toBe(true);
    expect(replayedFailedDuplicateResult.cursorUs).toBe(String(cursorSaveInterval));
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual([String(cursorSaveInterval - 1)]);
  });

  it('keeps a permanent failed cursor pinned without growing pins during later successful traffic', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    const failedCursor = cursorSaveInterval;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'permanent-failure') {
        return Promise.resolve('post-handler-error');
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', failedCursor, 'permanent-failure')
    );
    for (let index = failedCursor + 1; index <= failedCursor + cursorSaveInterval * 2; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    expect(failedResult.processed).toBe(false);
    expect(__testJetstreamQueue.getCursorState().lastCursorUs).toBe(String(cursorSaveInterval - 1));
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(2);
    for (const call of dbQueryMock.mock.calls) {
      expect(call[1]).toEqual([String(cursorSaveInterval - 1)]);
    }
  });

  it('pins the cursor when post processing throws before later traffic advances', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'throwing-post') {
        return Promise.reject(new Error('post handler threw'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'throwing-post')
    );
    const newerResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', cursorSaveInterval + 1)
    );

    expect(failedResult.processed).toBe(false);
    expect(failedResult.errorMessage).toBe('post handler threw');
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);
    expect(newerResult.cursorSaved).toBe(true);
    expect(newerResult.cursorUs).toBe(String(cursorSaveInterval - 1));
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: String(cursorSaveInterval - 1),
    });
  });

  it('clears thrown failure pins across reconnect generation invalidation before replay', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    let shouldThrow = true;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'replayed-post' && shouldThrow) {
        shouldThrow = false;
        return Promise.reject(new Error('stale post handler threw'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'replayed-post')
    );
    expect(failedResult.processed).toBe(false);
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);

    __testJetstreamQueue.invalidateConnectionForTests();
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);

    const replayResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'replayed-post')
    );

    expect(replayResult.processed).toBe(true);
    expect(replayResult.cursorSaved).toBe(true);
    expect(replayResult.cursorUs).toBe(String(cursorSaveInterval));
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[1]).toEqual([String(cursorSaveInterval)]);
  });

  it('dead-letters a repeatedly failing cursor pin after the retry budget', async () => {
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'poison-post') {
        return Promise.reject(new Error('poison post handler threw'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    for (let attempt = 0; attempt < __testJetstreamQueue.failedCursorPinRetryLimit; attempt += 1) {
      const failedResult = await __testJetstreamQueue.processMessage(
        postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'poison-post')
      );
      expect(failedResult.processed).toBe(false);
    }

    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(1);
    expect((deadLetterInsertCalls()[0]?.[1] as unknown[])[3]).toBe('retry_limit');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorUs: String(cursorSaveInterval),
        failureCount: __testJetstreamQueue.failedCursorPinRetryLimit,
        retryLimit: __testJetstreamQueue.failedCursorPinRetryLimit,
      }),
      'Dead-lettered Jetstream event after repeated handler failures'
    );

    const newerResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', cursorSaveInterval + 1)
    );
    expect(newerResult.cursorSaved).toBe(true);
    expect(newerResult.cursorUs).toBe(String(cursorSaveInterval + 1));
    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual([String(cursorSaveInterval + 1)]);
  });

  it('serializes overlapping retry-limit failures for the same event', async () => {
    const deadLetterResolvers: Array<() => void> = [];
    let deadLetterInsertStarted: (() => void) | null = null;
    const deadLetterInsertStartedPromise = new Promise<void>((resolve) => {
      deadLetterInsertStarted = resolve;
    });
    dbQueryMock.mockImplementation((query: unknown) => {
      if (String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')) {
        deadLetterInsertStarted?.();
        return new Promise((resolve) => {
          deadLetterResolvers.push(() => resolve({ rowCount: 1, rows: [] }));
        });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    processEventMock.mockResolvedValue('post-handler-error');
    const poisonMessage = postCommitMessage('did:plc:cursor-user', 1000, 'overlapping-poison-post');

    for (let attempt = 1; attempt < __testJetstreamQueue.failedCursorPinRetryLimit; attempt += 1) {
      await __testJetstreamQueue.processMessage(poisonMessage);
    }
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);

    const firstRetryPromise = __testJetstreamQueue.processMessage(poisonMessage);
    await deadLetterInsertStartedPromise;
    const secondRetryPromise = __testJetstreamQueue.processMessage(poisonMessage);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const overlappingDeadLetterInsertCount = deadLetterInsertCalls().length;
    for (const resolveDeadLetter of deadLetterResolvers) {
      resolveDeadLetter();
    }

    const [firstRetryResult, secondRetryResult] = await Promise.all([firstRetryPromise, secondRetryPromise]);

    expect(firstRetryResult.processed).toBe(false);
    expect(secondRetryResult.processed).toBe(false);
    expect(overlappingDeadLetterInsertCount).toBe(1);
    expect(deadLetterInsertCalls()).toHaveLength(1);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(1);
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);
  });

  it('does not let a stale failed-pin waiter overwrite current-generation safety state', async () => {
    let rejectDeadLetter: (() => void) | null = null;
    let markDeadLetterStarted: (() => void) | null = null;
    const deadLetterStarted = new Promise<void>((resolve) => {
      markDeadLetterStarted = resolve;
    });
    dbQueryMock.mockImplementation((query: unknown) => {
      if (String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')) {
        markDeadLetterStarted?.();
        return new Promise((_resolve, reject) => {
          rejectDeadLetter = () => reject(new Error('stale dead-letter database failure'));
        });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) =>
      Promise.resolve(event.commit?.rkey === 'cross-generation-poison'
        ? 'post-handler-error'
        : 'non-commit-ignored')
    );
    const poisonMessage = postCommitMessage(
      'did:plc:cursor-user',
      1000,
      'cross-generation-poison'
    );

    for (let attempt = 1; attempt < __testJetstreamQueue.failedCursorPinRetryLimit; attempt += 1) {
      await __testJetstreamQueue.processMessage(poisonMessage);
    }
    const staleRetry = __testJetstreamQueue.processMessageForGeneration(poisonMessage, 0);
    await deadLetterStarted;

    __testJetstreamQueue.invalidateConnectionForTests();
    const currentFailure = __testJetstreamQueue.processMessageForGeneration(poisonMessage, 1);
    const failDeadLetter = rejectDeadLetter as (() => void) | null;
    failDeadLetter?.();
    await Promise.all([staleRetry, currentFailure]);

    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);
    expect(__testJetstreamQueue.getFailedCursorPersistenceFloor()).toBeNull();
    const newerResult = await __testJetstreamQueue.processMessageForGeneration(
      identityMessage('did:plc:cursor-user', 1001),
      1
    );
    expect(newerResult.cursorUs).toBe('999');
  });

  it('keeps a failed cursor pinned when durable dead-letter persistence fails', async () => {
    dbQueryMock.mockImplementation((query: unknown) => {
      if (String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')) {
        return Promise.reject(new Error('dead-letter database unavailable'));
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'poison-post') {
        return Promise.reject(new Error('poison post handler threw'));
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    for (let attempt = 0; attempt < __testJetstreamQueue.failedCursorPinRetryLimit; attempt += 1) {
      await __testJetstreamQueue.processMessage(
        postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'poison-post')
      );
    }

    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(0);
    expect(deadLetterInsertCalls()).toHaveLength(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'retry_limit',
        cursorUs: String(cursorSaveInterval),
      }),
      'Failed to persist Jetstream dead-letter event'
    );

    const newerResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', cursorSaveInterval + 1)
    );
    expect(newerResult.cursorSaved).toBe(true);
    expect(newerResult.cursorUs).toBe(String(cursorSaveInterval - 1));
    expect(__testJetstreamQueue.getCursorState().lastCursorUs).toBe(String(cursorSaveInterval - 1));
    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual([String(cursorSaveInterval - 1)]);
  });

  it('bounds distinct failed cursor pins and dead-letters the oldest over the limit', async () => {
    processEventMock.mockResolvedValue('post-handler-error');

    for (let index = 1; index <= __testJetstreamQueue.failedCursorPinMaxCount + 1; index += 1) {
      await __testJetstreamQueue.processMessage(
        postCommitMessage('did:plc:cursor-user', index, `failed-post-${index}`)
      );
    }

    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(__testJetstreamQueue.failedCursorPinMaxCount);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(1);
    expect((deadLetterInsertCalls()[0]?.[1] as unknown[])[3]).toBe('pin_limit');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFailedCursorPins: __testJetstreamQueue.failedCursorPinMaxCount,
      }),
      'Attempted to dead-letter oldest Jetstream failed cursor pin after pin limit'
    );
  });

  it('bounds distinct failed cursor pins when dead-letter persistence fails during eviction', async () => {
    dbQueryMock.mockImplementation((query: unknown) => {
      if (String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')) {
        return Promise.reject(new Error('dead-letter database unavailable'));
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    processEventMock.mockResolvedValue('post-handler-error');

    for (let index = 1; index <= __testJetstreamQueue.failedCursorPinMaxCount + 1; index += 1) {
      await __testJetstreamQueue.processMessage(
        postCommitMessage('did:plc:cursor-user', index, `failed-post-${index}`)
      );
      expect(__testJetstreamQueue.getFailedCursorPinCount()).toBeLessThanOrEqual(
        __testJetstreamQueue.failedCursorPinMaxCount
      );
    }

    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(__testJetstreamQueue.failedCursorPinMaxCount);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(0);
    expect(__testJetstreamQueue.getFailedCursorPersistenceFloor()).toBe('1');
    expect(deadLetterInsertCalls()).toHaveLength(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'pin_limit',
      }),
      'Failed to persist Jetstream dead-letter event'
    );
  });

  it('does not pin or advance a failed message from a stale connection generation', async () => {
    __testJetstreamQueue.invalidateConnectionForTests();

    const result = await __testJetstreamQueue.processMessageForGeneration(
      postCommitMessage('did:plc:cursor-user', 1000, 'stale-generation-post'),
      0
    );

    expect(result.processed).toBe(false);
    expect(result.errorMessage).toBe('stale jetstream connection');
    expect(processEventMock).not.toHaveBeenCalled();
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);
    expect(__testJetstreamQueue.getCursorState()).toEqual({
      eventCounter: 0,
      lastCursorUs: null,
    });
  });

  it('expires old failed cursor pins so later safe cursor saves can advance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00.000Z'));
    dbQueryMock.mockResolvedValue({ rowCount: 1, rows: [] });
    const cursorSaveInterval = __testJetstreamQueue.cursorSaveInterval;
    processEventMock.mockImplementation((event: { commit?: { rkey?: string } }) => {
      if (event.commit?.rkey === 'expired-pin-post') {
        return Promise.resolve('post-handler-error');
      }
      return Promise.resolve('non-commit-ignored');
    });

    for (let index = 1; index < cursorSaveInterval; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    const failedResult = await __testJetstreamQueue.processMessage(
      postCommitMessage('did:plc:cursor-user', cursorSaveInterval, 'expired-pin-post')
    );
    expect(failedResult.processed).toBe(false);
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);

    vi.setSystemTime(new Date(Date.now() + __testJetstreamQueue.failedCursorPinMaxAgeMs - 1));
    const justUnderAgeResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', cursorSaveInterval + 1)
    );

    expect(justUnderAgeResult.cursorSaved).toBe(true);
    expect(justUnderAgeResult.cursorUs).toBe(String(cursorSaveInterval - 1));
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);

    vi.setSystemTime(new Date(Date.now() + 2));
    const expiredResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', cursorSaveInterval + 2)
    );

    expect(expiredResult.cursorUs).toBe(String(cursorSaveInterval + 2));
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(1);
    for (let index = cursorSaveInterval + 3; index <= cursorSaveInterval * 2 + 1; index += 1) {
      await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', index));
    }

    expect(dbQueryMock.mock.calls.at(-1)?.[1]).toEqual([String(cursorSaveInterval * 2 + 1)]);
    expect((deadLetterInsertCalls()[0]?.[1] as unknown[])[3]).toBe('age_limit');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expiredCount: 1,
        maxAgeMs: __testJetstreamQueue.failedCursorPinMaxAgeMs,
      }),
      'Expired Jetstream failed cursor pins after age limit'
    );
  });

  it('preserves a cursor safety floor when age-limit dead-letter persistence fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00.000Z'));
    dbQueryMock.mockImplementation((query: unknown) => {
      if (String(query).includes('INSERT INTO jetstream_failed_cursor_dead_letters')) {
        return Promise.reject(new Error('dead-letter database unavailable'));
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
    processEventMock.mockImplementation((event: { time_us?: number }) =>
      Promise.resolve(event.time_us === 1000 ? 'post-handler-error' : 'non-commit-ignored')
    );

    await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', 999));
    await __testJetstreamQueue.processMessage(identityMessage('did:plc:cursor-user', 1000));
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(1);

    vi.setSystemTime(new Date(Date.now() + __testJetstreamQueue.failedCursorPinMaxAgeMs + 1));
    const newerResult = await __testJetstreamQueue.processMessage(
      identityMessage('did:plc:cursor-user', 1001)
    );

    expect(newerResult.cursorUs).toBe('999');
    expect(__testJetstreamQueue.getFailedCursorPinCount()).toBe(0);
    expect(__testJetstreamQueue.getFailedCursorPersistenceFloor()).toBe('1000');
    expect(__testJetstreamQueue.getRuntimeState().failedCursorPersistenceFloorUs).toBe('1000');
    expect(__testJetstreamQueue.getFailedCursorDeadLetterCount()).toBe(0);
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
