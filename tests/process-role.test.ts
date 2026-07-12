import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let ConfigSchema: typeof import('../src/config.js')['ConfigSchema'];
const originalEnvironment = { ...process.env };
const controlledEnvironmentKeys = [
  'PROCESS_ROLE',
  'SCORING_TIMEOUT_MS',
  'RANKING_COMMUNITY_ID',
  'RANKING_WORKER_POLL_MS',
  'RANKING_CLAIM_STALE_MS',
  'RANKING_LEASE_TTL_MS',
  'RANKING_LEASE_RENEW_INTERVAL_MS',
  'RANKING_WORKER_HEARTBEAT_INTERVAL_MS',
  'RANKING_WORKER_HEARTBEAT_TTL_MS',
] as const;

beforeAll(async () => {
  for (const key of controlledEnvironmentKeys) {
    delete process.env[key];
  }
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

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
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

  it('accepts lease renewal immediately below the half-TTL boundary', () => {
    const parsed = ConfigSchema.parse({
      ...process.env,
      SCORING_TIMEOUT_MS: '30000',
      RANKING_LEASE_TTL_MS: '60000',
      RANKING_LEASE_RENEW_INTERVAL_MS: '29999',
    });
    expect(parsed.RANKING_LEASE_RENEW_INTERVAL_MS).toBe(29_999);
  });

  it('rejects heartbeat interval equality and accepts the passing boundary', () => {
    expect(() => ConfigSchema.parse({
      ...process.env,
      RANKING_WORKER_HEARTBEAT_INTERVAL_MS: '30000',
      RANKING_WORKER_HEARTBEAT_TTL_MS: '30000',
    })).toThrow('must be less than');

    const parsed = ConfigSchema.parse({
      ...process.env,
      RANKING_WORKER_HEARTBEAT_INTERVAL_MS: '29999',
      RANKING_WORKER_HEARTBEAT_TTL_MS: '30000',
    });
    expect(parsed.RANKING_WORKER_HEARTBEAT_INTERVAL_MS).toBe(29_999);
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

  it('accepts claim and lease windows one millisecond beyond the ranking timeout', () => {
    const parsed = ConfigSchema.parse({
      ...process.env,
      SCORING_TIMEOUT_MS: '240000',
      RANKING_CLAIM_STALE_MS: '240001',
      RANKING_LEASE_TTL_MS: '240001',
      RANKING_LEASE_RENEW_INTERVAL_MS: '60000',
    });
    expect(parsed.RANKING_CLAIM_STALE_MS).toBe(240_001);
    expect(parsed.RANKING_LEASE_TTL_MS).toBe(240_001);
  });

  it.each([
    { field: 'RANKING_WORKER_POLL_MS', minimum: 100 },
    { field: 'RANKING_CLAIM_STALE_MS', minimum: 30_000 },
    { field: 'RANKING_LEASE_TTL_MS', minimum: 5_000 },
    { field: 'RANKING_LEASE_RENEW_INTERVAL_MS', minimum: 1_000 },
    { field: 'RANKING_WORKER_HEARTBEAT_INTERVAL_MS', minimum: 1_000 },
    { field: 'RANKING_WORKER_HEARTBEAT_TTL_MS', minimum: 5_000 },
  ] as const)('rejects malformed and out-of-range $field values', ({ field, minimum }) => {
    const invalidValues: unknown[] = [
      String(minimum - 1),
      `${minimum}.5`,
      'not-a-number',
      null,
    ];
    for (const value of invalidValues) {
      const result = ConfigSchema.safeParse({ ...process.env, [field]: value });
      expect(result.success, `${field} unexpectedly accepted ${String(value)}`).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
      }
    }
  });
});
