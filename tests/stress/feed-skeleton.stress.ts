import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config.js';
import { redis } from '../../src/db/redis.js';
import { registerFeedSkeleton } from '../../src/feed/routes/feed-skeleton.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../../src/feed/snapshot-cache.js';
import type { HttpLoadRequest } from '../../scripts/http-load.js';
import { runHttpLoad } from '../../scripts/http-load.js';
import { AssertionResult, ScenarioResult, makeJwt, nowIso, rssMb, summarizeAssertions } from './_helpers.js';

export interface FeedPassResult {
  label: string;
  p50: number;
  p95: number;
  p99: number;
  average: number;
  max: number;
  requestsAverage: number;
  totalRequests: number;
  errors: number;
  timeouts: number;
  non2xx: number;
  statusBuckets: {
    s1xx: number;
    s2xx: number;
    s3xx: number;
    s4xx: number;
    s5xx: number;
    other: number;
  };
  rssBeforeMb: number;
  rssAfterMb: number;
  rssDeltaMb: number;
}

interface NoopRedisPipeline {
  rpush: () => NoopRedisPipeline;
  ltrim: () => NoopRedisPipeline;
  exec: () => Promise<[]>;
}

interface FeedSkeletonStressFixture {
  app: FastifyInstance;
  baseUrl: string;
  validCursor: string | null;
}

async function listSnapshotKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', 'snapshot:*', 'COUNT', '1000');
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function resetFeedSkeletonStressState(): Promise<void> {
  clearCurrentFeedSnapshotMemoryCache();
  const snapshotKeys = await listSnapshotKeys();
  await redis.del('feed:current');
  await redis.del('feed:request_log');
  await redis.del('feed:current_snapshot_id');
  await redis.del('feed:current_snapshot_generation');
  for (let index = 0; index < snapshotKeys.length; index += 500) {
    await redis.del(...snapshotKeys.slice(index, index + 500));
  }
}

async function setupFeedSkeletonStressFixture(): Promise<FeedSkeletonStressFixture> {
  const app = Fastify();
  try {
    registerFeedSkeleton(app);
    const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error(`feed skeleton stress server address was not a TCP address: ${String(address)}`);
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await resetFeedSkeletonStressState();
    await redis.set('feed:epoch', '1');

    const pipeline = redis.pipeline();
    for (let i = 0; i < 2000; i++) {
      const score = 2000 - i;
      const uri = `at://did:plc:feedstressauthor${i % 200}/app.bsky.feed.post/${i}`;
      pipeline.zadd('feed:current', score, uri);
    }
    await pipeline.exec();

    const seedResponse = await fetch(
      `${baseUrl}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`
    );
    if (!seedResponse.ok) {
      throw new Error(`feed skeleton stress seed request failed with status ${seedResponse.status}`);
    }
    const seedJson = (await seedResponse.json()) as { cursor?: string };
    return {
      app,
      baseUrl,
      validCursor: seedJson.cursor ?? null,
    };
  } catch (error: unknown) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

async function runLoad(
  baseUrl: string,
  validCursor: string | null,
  noOpRpush: boolean,
  amount: number,
  connections: number
): Promise<FeedPassResult> {
  const originalPipeline = redis.pipeline.bind(redis);
  if (noOpRpush) {
    (redis as unknown as { pipeline: () => NoopRedisPipeline }).pipeline = () => {
      const stub: NoopRedisPipeline = {
        rpush: () => stub,
        ltrim: () => stub,
        exec: async (): Promise<[]> => [],
      };
      return stub;
    };
  }

  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;
  const goodJwt = `Bearer ${makeJwt('did:plc:stressfeedrequester')}`;
  const malformedJwt = 'Bearer malformed.jwt.token';
  const garbageCursor = '%%%NOT_A_CURSOR%%%';

  const cursorQuery = validCursor ? `&cursor=${encodeURIComponent(validCursor)}` : '';

  const requests: HttpLoadRequest[] = [
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json' },
      body: null,
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json', Authorization: goodJwt },
      body: null,
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json', Authorization: malformedJwt },
      body: null,
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50${cursorQuery}`,
      headers: { Accept: 'application/json' },
      body: null,
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50${cursorQuery}`,
      headers: { Accept: 'application/json', Authorization: goodJwt },
      body: null,
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50&cursor=${encodeURIComponent(garbageCursor)}`,
      headers: { Accept: 'application/json', Authorization: malformedJwt },
      body: null,
    },
  ];

  const rssBefore = rssMb();

  try {
    const result = await runHttpLoad({
      baseUrl,
      amount,
      durationMs: null,
      connections,
      timeoutMs: 30_000,
      requests,
    });

    const rssAfter = rssMb();

    return {
      label: noOpRpush ? 'rpush_noop' : 'rpush_normal',
      p50: result.latency.p50,
      p95: result.latency.p95,
      p99: result.latency.p99,
      average: result.latency.average,
      max: result.latency.max,
      requestsAverage: result.requests.average,
      totalRequests: result.requests.total,
      errors: result.errors,
      timeouts: result.timeouts,
      non2xx: result.non2xx,
      statusBuckets: {
        s1xx: result.statusBuckets.s1xx,
        s2xx: result.statusBuckets.s2xx,
        s3xx: result.statusBuckets.s3xx,
        s4xx: result.statusBuckets.s4xx,
        s5xx: result.statusBuckets.s5xx,
        other: result.statusBuckets.other,
      },
      rssBeforeMb: rssBefore,
      rssAfterMb: rssAfter,
      rssDeltaMb: Number((rssAfter - rssBefore).toFixed(2)),
    };
  } finally {
    if (noOpRpush) {
      (redis as unknown as { pipeline: typeof redis.pipeline }).pipeline = originalPipeline;
    }
  }
}

export async function runFeedSkeletonStressMode(
  noOpRpush: boolean,
  amount: number,
  connections: number
): Promise<ScenarioResult> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const assertions: AssertionResult[] = [];
  const errors: string[] = [];
  let app: FastifyInstance | null = null;

  try {
    const fixture = await setupFeedSkeletonStressFixture();
    app = fixture.app;
    const pass = await runLoad(fixture.baseUrl, fixture.validCursor, noOpRpush, amount, connections);
    assertions.push({
      name: `p95_below_100ms_${pass.label}`,
      pass: pass.p95 < 100,
      detail: `${pass.label} p95=${pass.p95}ms`,
    });

    return {
      name: `feed-skeleton-load-${pass.label}`,
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: summarizeAssertions(assertions),
      metrics: {
        pass,
      },
      assertions,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    return {
      name: noOpRpush ? 'feed-skeleton-load-rpush_noop' : 'feed-skeleton-load-rpush_normal',
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: false,
      metrics: {},
      assertions,
      errors,
    };
  } finally {
    try {
      await app?.close();
    } catch {
      // ignore close errors in stress script
    }
  }
}

export async function runFeedSkeletonStress(): Promise<ScenarioResult> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const assertions: AssertionResult[] = [];
  const errors: string[] = [];
  let app: FastifyInstance | null = null;

  try {
    const fixture = await setupFeedSkeletonStressFixture();
    app = fixture.app;

    const normal = await runLoad(fixture.baseUrl, fixture.validCursor, false, 10_000, 100);
    const noop = await runLoad(fixture.baseUrl, fixture.validCursor, true, 10_000, 100);

    assertions.push({
      name: 'p95_below_100ms_normal',
      pass: normal.p95 < 100,
      detail: `normal p95=${normal.p95}ms`,
    });
    assertions.push({
      name: 'p95_below_100ms_noop',
      pass: noop.p95 < 100,
      detail: `noop p95=${noop.p95}ms`,
    });

    const p95Delta = Number((normal.p95 - noop.p95).toFixed(2));
    const rssDelta = Number((normal.rssAfterMb - normal.rssBeforeMb).toFixed(2));

    return {
      name: 'feed-skeleton-load',
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: summarizeAssertions(assertions),
      metrics: {
        normal,
        noop,
        asyncLoggingP95DeltaMs: p95Delta,
        asyncLoggingOverheadPct: noop.p95 > 0 ? Number((((normal.p95 - noop.p95) / noop.p95) * 100).toFixed(2)) : null,
        processRssDeltaMb: rssDelta,
      },
      assertions,
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    return {
      name: 'feed-skeleton-load',
      startedAt,
      endedAt: nowIso(),
      durationMs: Date.now() - startMs,
      success: false,
      metrics: {},
      assertions,
      errors,
    };
  } finally {
    try {
      await app?.close();
    } catch {
      // ignore close errors in stress script
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFeedSkeletonStress()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exit(1);
    });
}
