import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
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
  },
}));

import { upsertSubscriberAsync } from '../src/db/queries/subscribers.js';

describe('subscriber query logging', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    loggerErrorMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it('does not log raw subscriber DID on upsert failure', async () => {
    const did = 'did:plc:subscriber-secret';
    const error = Object.assign(new Error(`database unavailable for ${did}`), {
      code: '23505',
      constraint: 'subscribers_pkey',
      detail: `Key (did)=(${did}) already exists.`,
    });
    dbQueryMock.mockRejectedValueOnce(error);

    await upsertSubscriberAsync(did);

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const [context] = loggerWarnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.didDigest).toMatch(/^[a-f0-9]{16}$/);
    expect(context.subscriberError).toEqual({
      code: '23505',
      constraint: 'subscribers_pkey',
      name: 'Error',
    });
    expect(context).not.toHaveProperty('did');
    expect(JSON.stringify(context)).not.toContain(did);
  });

  it('does not warn on successful upsert', async () => {
    dbQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const did = 'did:plc:subscriber-ok';
    await upsertSubscriberAsync(did);

    expect(dbQueryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO subscribers'), [did]);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it('uses stable per-DID digests without logging unusual raw input', async () => {
    dbQueryMock.mockRejectedValue(new Error('database unavailable'));

    await upsertSubscriberAsync('did:plc:same-subscriber');
    await upsertSubscriberAsync('did:plc:same-subscriber');
    await upsertSubscriberAsync('');

    const digests = loggerWarnMock.mock.calls.map(([context]) => (context as Record<string, unknown>).didDigest);
    expect(digests[0]).toBe(digests[1]);
    expect(digests[2]).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain('did:plc:same-subscriber');
  });

  it.each([
    ['string rejection', 'database unavailable for did:plc:subscriber-secret', {}],
    ['null rejection', null, {}],
    ['object with non-string properties', { code: 23505, constraint: 'subscribers_pkey', severity: 10 }, {
      constraint: 'subscribers_pkey',
    }],
  ])('redacts subscriber failure context for %s', async (_label, rejection, expectedSubscriberError) => {
    const did = 'did:plc:subscriber-secret';
    dbQueryMock.mockRejectedValueOnce(rejection);

    await upsertSubscriberAsync(did);

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const [context] = loggerWarnMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(context.didDigest).toMatch(/^[a-f0-9]{16}$/);
    expect(context.subscriberError).toEqual(expectedSubscriberError);
    expect(JSON.stringify(context)).not.toContain(did);
  });

  it('does not reject or log raw DID when digest secret resolution fails during DB error handling', async () => {
    vi.resetModules();
    vi.doMock('../src/config.js', () => ({
      config: {
        EXPORT_ANONYMIZATION_SALT: '',
        NODE_ENV: 'production',
      },
    }));
    try {
      const {
        getSubscriberDigestUnavailableTotal,
        upsertSubscriberAsync: productionUpsertSubscriberAsync,
      } = await import('../src/db/queries/subscribers.js');
      const did = 'did:plc:subscriber-secret';
      dbQueryMock.mockRejectedValue(new Error(`database unavailable for ${did}`));

      await expect(productionUpsertSubscriberAsync(did)).resolves.toBeUndefined();
      await expect(productionUpsertSubscriberAsync(did)).resolves.toBeUndefined();

      expect(getSubscriberDigestUnavailableTotal()).toBe(2);
      expect(loggerErrorMock).toHaveBeenCalledTimes(2);
      const [digestContext] = loggerErrorMock.mock.calls[0] as [Record<string, unknown>, string];
      expect(digestContext.subscriberError).toEqual({ name: 'Error' });
      expect(loggerWarnMock).toHaveBeenCalledTimes(2);
      const [upsertContext] = loggerWarnMock.mock.calls[0] as [Record<string, unknown>, string];
      expect(upsertContext.didDigest).toBe('unavailable');
      expect(upsertContext.subscriberError).toEqual({ name: 'Error' });
      expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(did);
      expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(did);
    } finally {
      vi.doUnmock('../src/config.js');
      vi.resetModules();
    }
  });
});
