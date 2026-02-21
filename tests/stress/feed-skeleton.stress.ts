import autocannon from 'autocannon';
import Fastify from 'fastify';
import { config } from '../../src/config.js';
import { redis } from '../../src/db/redis.js';
import { registerFeedSkeleton } from '../../src/feed/routes/feed-skeleton.js';
import { AssertionResult, ScenarioResult, makeJwt, nowIso, rssMb, summarizeAssertions } from './_helpers.js';

interface FeedPassResult {
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
  };
  rssBeforeMb: number;
  rssAfterMb: number;
  rssDeltaMb: number;
}

function getP95Latency(result: autocannon.Result): number {
  const latency = result.latency as Record<string, number | undefined>;
  if (typeof latency.p95 === 'number') {
    return latency.p95;
  }

  const p90 = typeof latency.p90 === 'number' ? latency.p90 : undefined;
  const p97_5 = typeof latency.p97_5 === 'number' ? latency.p97_5 : undefined;
  if (typeof p90 === 'number' && typeof p97_5 === 'number') {
    const interpolated = p90 + ((95 - 90) / (97.5 - 90)) * (p97_5 - p90);
    return Number(interpolated.toFixed(2));
  }

  if (typeof latency.p99 === 'number') {
    return latency.p99;
  }

  return result.latency.max;
}

async function runLoad(baseUrl: string, validCursor: string | null, noOpRpush = false): Promise<FeedPassResult> {
  const originalPipeline = redis.pipeline.bind(redis);
  if (noOpRpush) {
    (redis as unknown as { pipeline: () => { rpush: () => unknown; ltrim: () => unknown; exec: () => Promise<[]> } }).pipeline =
      () => {
        const stub = {
          rpush: () => stub,
          ltrim: () => stub,
          exec: async () => [],
        };
        return stub;
      };
  }

  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;
  const goodJwt = `Bearer ${makeJwt('did:plc:stressfeedrequester')}`;
  const malformedJwt = 'Bearer malformed.jwt.token';
  const garbageCursor = '%%%NOT_A_CURSOR%%%';

  const cursorQuery = validCursor ? `&cursor=${encodeURIComponent(validCursor)}` : '';

  const requests = [
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json' },
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json', Authorization: goodJwt },
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`,
      headers: { Accept: 'application/json', Authorization: malformedJwt },
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50${cursorQuery}`,
      headers: { Accept: 'application/json' },
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50${cursorQuery}`,
      headers: { Accept: 'application/json', Authorization: goodJwt },
    },
    {
      method: 'GET',
      path: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50&cursor=${encodeURIComponent(garbageCursor)}`,
      headers: { Accept: 'application/json', Authorization: malformedJwt },
    },
  ];

  const rssBefore = rssMb();

  const result = await autocannon({
    url: baseUrl,
    amount: 10_000,
    connections: 100,
    requests,
  });

  const rssAfter = rssMb();

  (redis as unknown as { pipeline: typeof redis.pipeline }).pipeline = originalPipeline;

  return {
    label: noOpRpush ? 'rpush_noop' : 'rpush_normal',
    p50: result.latency.p50,
    p95: getP95Latency(result),
    p99: result.latency.p99,
    average: result.latency.average,
    max: result.latency.max,
    requestsAverage: result.requests.average,
    totalRequests: result.requests.total,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
    statusBuckets: {
      s1xx: result['1xx'],
      s2xx: result['2xx'],
      s3xx: result['3xx'],
      s4xx: result['4xx'],
      s5xx: result['5xx'],
    },
    rssBeforeMb: rssBefore,
    rssAfterMb: rssAfter,
    rssDeltaMb: Number((rssAfter - rssBefore).toFixed(2)),
  };
}

export async function runFeedSkeletonStress(): Promise<ScenarioResult> {
  const startedAt = nowIso();
  const startMs = Date.now();
  const assertions: AssertionResult[] = [];
  const errors: string[] = [];

  const app = Fastify();
  registerFeedSkeleton(app);
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  const basePort = 3400 + Math.floor(Math.random() * 300);
  await app.listen({ host: '127.0.0.1', port: basePort });
  const baseUrl = `http://127.0.0.1:${basePort}`;

  try {
    await redis.del('feed:current');
    await redis.del('feed:request_log');
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
    const seedJson = (await seedResponse.json()) as { cursor?: string };
    const validCursor = seedJson.cursor ?? null;

    const normal = await runLoad(baseUrl, validCursor, false);
    const noop = await runLoad(baseUrl, validCursor, true);

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
      await app.close();
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
