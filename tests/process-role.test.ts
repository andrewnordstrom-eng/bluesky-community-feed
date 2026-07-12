import { beforeAll, describe, expect, it } from 'vitest';

let ConfigSchema: typeof import('../src/config.js')['ConfigSchema'];

beforeAll(async () => {
  delete process.env.PROCESS_ROLE;
  Object.assign(process.env, {
    FEEDGEN_SERVICE_DID: 'did:plc:corgitestservice0000000000',
    FEEDGEN_PUBLISHER_DID: 'did:plc:corgitestpublisher00000000',
    FEEDGEN_HOSTNAME: 'feed.test',
    JETSTREAM_URL: 'wss://jetstream.test/subscribe',
    JETSTREAM_FALLBACK_URL: 'wss://jetstream-fallback.test/subscribe',
    JETSTREAM_COLLECTIONS: 'app.bsky.feed.post',
    DATABASE_URL: 'postgresql://feed:feed@127.0.0.1:5432/bluesky_feed',
    REDIS_URL: 'redis://127.0.0.1:6379',
    BSKY_IDENTIFIER: 'test.bsky.social',
    BSKY_APP_PASSWORD: 'test-password',
    NODE_ENV: 'test',
  });
  ({ ConfigSchema } = await import('../src/config.js'));
});

describe('process-role configuration', () => {
  it('retains all as the temporary rollback-compatible default', () => {
    expect(ConfigSchema.parse(process.env).PROCESS_ROLE).toBe('all');
  });

  it.each(['api', 'ranking-worker', 'all'] as const)('accepts %s', (role) => {
    expect(ConfigSchema.parse({ ...process.env, PROCESS_ROLE: role }).PROCESS_ROLE).toBe(role);
  });

  it('rejects an unknown process role', () => {
    expect(() => ConfigSchema.parse({ ...process.env, PROCESS_ROLE: 'combined-api-worker' }))
      .toThrow();
  });

  it('requires lease renewal comfortably before expiry', () => {
    expect(() => ConfigSchema.parse({
      ...process.env,
      RANKING_LEASE_TTL_MS: '60000',
      RANKING_LEASE_RENEW_INTERVAL_MS: '30000',
    })).toThrow('must be less than half');
  });

  it('does not reclaim a request before the ranking timeout can finish', () => {
    expect(() => ConfigSchema.parse({
      ...process.env,
      SCORING_TIMEOUT_MS: '240000',
      RANKING_CLAIM_STALE_MS: '240000',
    })).toThrow('must exceed SCORING_TIMEOUT_MS');
  });

  it('keeps lease ownership longer than the maximum ranking run', () => {
    expect(() => ConfigSchema.parse({
      ...process.env,
      SCORING_TIMEOUT_MS: '240000',
      RANKING_LEASE_TTL_MS: '240000',
    })).toThrow('must exceed SCORING_TIMEOUT_MS');
  });
});
