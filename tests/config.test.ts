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
  BSKY_IDENTIFIER: 'sim-harness.test',
  BSKY_APP_PASSWORD: 'sim-harness-not-a-real-password',
  NODE_ENV: 'test',
};

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
});
