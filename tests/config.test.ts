import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/config.js';

const baseEnv: Record<string, string> = {
  FEEDGEN_SERVICE_DID: 'did:plc:corgisimharness00000000000',
  FEEDGEN_PUBLISHER_DID: 'did:plc:corgisimharnesspublisher0',
  FEEDGEN_HOSTNAME: 'sim-harness.local.test',
  JETSTREAM_URL: 'wss://sim-harness.local.test/subscribe',
  JETSTREAM_FALLBACK_URL: 'wss://sim-harness.local.test/subscribe-fallback',
  JETSTREAM_COLLECTIONS: 'app.bsky.feed.post',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/corgi_dummy_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  DEMO_RATE_LIMIT_HASH_SECRET: 'demo-rate-limit-secret-1234567890',
  BSKY_IDENTIFIER: 'sim-harness.test',
  BSKY_APP_PASSWORD: 'sim-harness-not-a-real-password',
  NODE_ENV: 'test',
};
const PRODUCTION_SALT_32 = '12345678901234567890123456789012';

describe('ConfigSchema', () => {
  it('accepts a positive integer FEED_MAX_POSTS value', () => {
    const parsed = ConfigSchema.parse({
      ...baseEnv,
      FEED_MAX_POSTS: '1',
    });

    expect(parsed.FEED_MAX_POSTS).toBe(1);
  });

  it.each(['0', '-1', '1.5'])('rejects invalid FEED_MAX_POSTS=%s', (feedMaxPosts) => {
    expect(() =>
      ConfigSchema.parse({
        ...baseEnv,
        FEED_MAX_POSTS: feedMaxPosts,
      })
    ).toThrow();
  });

  it('defaults FEED_MAX_POSTS and REDIS_COMMAND_TIMEOUT_MS when omitted', () => {
    const parsed = ConfigSchema.parse(baseEnv);

    expect(parsed.FEED_MAX_POSTS).toBe(1000);
    expect(parsed.REDIS_COMMAND_TIMEOUT_MS).toBe(5000);
    expect(parsed.DEMO_REDIS_URL).toBe('redis://127.0.0.1:6381');
  });

  it.each(['true', undefined])('accepts enabled or default production rate limiting (%s)', (value) => {
    const environment = {
      ...baseEnv,
      NODE_ENV: 'production',
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
      ...(value === undefined ? {} : { RATE_LIMIT_ENABLED: value }),
    };

    expect(ConfigSchema.parse(environment).RATE_LIMIT_ENABLED).toBe(true);
  });

  it.each(['false', '0', 'invalid', ''])('rejects disabled production rate limiting (%s)', (value) => {
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      RATE_LIMIT_ENABLED: value,
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    })).toThrow(/RATE_LIMIT_ENABLED must remain enabled in production/);
  });

  it('enforces the production anonymization salt boundary', () => {
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      EXPORT_ANONYMIZATION_SALT: '1'.repeat(31),
    })).toThrow(/at least 32 characters/);
    expect(ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    }).EXPORT_ANONYMIZATION_SALT).toBe(PRODUCTION_SALT_32);
  });

  it('rejects a production demo Redis endpoint that equals production Redis', () => {
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      DEMO_REDIS_URL: baseEnv.REDIS_URL,
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    })).toThrow(/DEMO_REDIS_URL must not equal REDIS_URL/);
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      DEMO_REDIS_URL: 'redis://different-credentials@127.0.0.1/9',
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    })).toThrow(/DEMO_REDIS_URL must not equal REDIS_URL/);
  });

  it('requires an independent production demo rate-limit HMAC key', () => {
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      DEMO_RATE_LIMIT_HASH_SECRET: 'dev-demo-rate-limit-secret-not-for-prod',
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    })).toThrow(/must be explicitly set in production/);
    expect(() => ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'production',
      DEMO_RATE_LIMIT_HASH_SECRET: '1'.repeat(31),
      EXPORT_ANONYMIZATION_SALT: PRODUCTION_SALT_32,
    })).toThrow(/at least 32 characters/);
  });

  it('keeps production-only hardening scoped out of development', () => {
    const parsed = ConfigSchema.parse({
      ...baseEnv,
      NODE_ENV: 'development',
      RATE_LIMIT_ENABLED: 'false',
      EXPORT_ANONYMIZATION_SALT: 'short-development-salt',
    });

    expect(parsed.RATE_LIMIT_ENABLED).toBe(false);
  });

  it.each(['abc', ''])('rejects non-numeric FEED_MAX_POSTS=%s', (feedMaxPosts) => {
    expect(() =>
      ConfigSchema.parse({
        ...baseEnv,
        FEED_MAX_POSTS: feedMaxPosts,
      })
    ).toThrow();
  });

  it('defaults SCORING_CONCURRENCY to 8 when omitted', () => {
    expect(ConfigSchema.parse(baseEnv).SCORING_CONCURRENCY).toBe(8);
  });

  it.each(['1', '32'])('accepts SCORING_CONCURRENCY=%s', (value) => {
    expect(
      ConfigSchema.parse({ ...baseEnv, SCORING_CONCURRENCY: value }).SCORING_CONCURRENCY
    ).toBe(Number(value));
  });

  it.each(['0', '-1', '1.5', '33', 'abc'])('rejects invalid SCORING_CONCURRENCY=%s', (value) => {
    expect(() =>
      ConfigSchema.parse({ ...baseEnv, SCORING_CONCURRENCY: value })
    ).toThrow();
  });

  it.each(['99', '1.5', 'abc', ''])('rejects invalid REDIS_COMMAND_TIMEOUT_MS=%s', (timeoutMs) => {
    expect(() =>
      ConfigSchema.parse({
        ...baseEnv,
        REDIS_COMMAND_TIMEOUT_MS: timeoutMs,
      })
    ).toThrow();
  });

  it('accepts REDIS_COMMAND_TIMEOUT_MS at the minimum boundary', () => {
    const parsed = ConfigSchema.parse({
      ...baseEnv,
      REDIS_COMMAND_TIMEOUT_MS: '100',
    });

    expect(parsed.REDIS_COMMAND_TIMEOUT_MS).toBe(100);
  });
});
