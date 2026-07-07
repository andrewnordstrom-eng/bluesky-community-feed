import Fastify from 'fastify';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Socket } from 'node:net';
import { getHeapSpaceStatistics, getHeapStatistics, writeHeapSnapshot } from 'node:v8';
import { config } from '../../src/config.js';
import { redis } from '../../src/db/redis.js';
import { registerFeedSkeleton } from '../../src/feed/routes/feed-skeleton.js';
import { clearCurrentFeedSnapshotMemoryCache } from '../../src/feed/snapshot-cache.js';
import {
  drainFeedRequestTracker,
  getFeedRequestTrackerStats,
  type FeedRequestTrackerStats,
} from '../../src/feed/request-tracker.js';

interface ServerOptions {
  mode: 'normal' | 'noop';
  diagnostic: boolean;
  heapSnapshots: boolean;
  heapDir: string | null;
  runLabel: string;
}

interface MemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  heapStatistics: Record<string, number>;
  heapSpaces: Array<Record<string, number | string>>;
  activeResources: Record<string, number>;
  tracker: FeedRequestTrackerStats;
  redis: RedisDiagnosticStats;
  sockets: SocketDiagnosticStats;
}

interface NoopRedisPipeline {
  rpush: () => NoopRedisPipeline;
  ltrim: () => NoopRedisPipeline;
  exec: () => Promise<[]>;
}

interface SnapshotMessage {
  type: 'snapshot';
}

interface BaselineMessage {
  type: 'baseline';
}

interface RedisDiagnosticStats {
  requestLogDepth: number;
  snapshotKeyCount: number;
}

interface SocketDiagnosticStats {
  trackedOpen: number;
  serverConnections: number;
  bytesRead: number;
  bytesWritten: number;
  readableLength: number;
  writableLength: number;
}

interface DrainDiagnosticStats {
  tracker: FeedRequestTrackerStats;
  remainingConnections: number;
}

function readFlagValue(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new RangeError(`${name} requires a value`);
  }
  return value;
}

function parseOptions(args: readonly string[]): ServerOptions {
  const mode = readFlagValue(args, '--mode');
  if (mode !== 'normal' && mode !== 'noop') {
    throw new RangeError(`--mode must be normal or noop; received ${mode}`);
  }
  const heapDir = readFlagValue(args, '--heap-dir');
  const runLabel = readFlagValue(args, '--run-label');
  return {
    mode,
    diagnostic: args.includes('--diagnostic'),
    heapSnapshots: args.includes('--heap-snapshots'),
    heapDir,
    runLabel: runLabel === null ? `${mode}-run` : runLabel,
  };
}

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function summarizeActiveResources(): Record<string, number> {
  const resources = process.getActiveResourcesInfo();
  const summary: Record<string, number> = {};
  for (const resource of resources) {
    summary[resource] = (summary[resource] ?? 0) + 1;
  }
  return summary;
}

function summarizeHeapStatistics(): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [key, value] of Object.entries(getHeapStatistics())) {
    summary[key] = value;
  }
  return summary;
}

function summarizeHeapSpaces(): Array<Record<string, number | string>> {
  return getHeapSpaceStatistics().map((space) => ({
    spaceName: space.space_name,
    spaceSizeMb: mb(space.space_size),
    spaceUsedSizeMb: mb(space.space_used_size),
    spaceAvailableSizeMb: mb(space.space_available_size),
    physicalSpaceSizeMb: mb(space.physical_space_size),
  }));
}

async function getConnectionCount(app: ReturnType<typeof Fastify>): Promise<number> {
  return new Promise((resolve, reject) => {
    app.server.getConnections((error: Error | null, count: number) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(count);
    });
  });
}

function summarizeSockets(sockets: ReadonlySet<Socket>, serverConnections: number): SocketDiagnosticStats {
  let bytesRead = 0;
  let bytesWritten = 0;
  let readableLength = 0;
  let writableLength = 0;
  for (const socket of sockets) {
    bytesRead += socket.bytesRead;
    bytesWritten += socket.bytesWritten;
    readableLength += socket.readableLength;
    writableLength += socket.writableLength;
  }

  return {
    trackedOpen: sockets.size,
    serverConnections,
    bytesRead,
    bytesWritten,
    readableLength,
    writableLength,
  };
}

async function collectRedisStats(): Promise<RedisDiagnosticStats> {
  const requestLogDepth = await redis.llen('feed:request_log');
  const snapshotKeys = await listSnapshotKeys();
  return {
    requestLogDepth,
    snapshotKeyCount: snapshotKeys.length,
  };
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

async function takeSnapshot(app: ReturnType<typeof Fastify>, sockets: ReadonlySet<Socket>): Promise<MemorySnapshot> {
  const usage = process.memoryUsage();
  const serverConnections = await getConnectionCount(app);
  return {
    rssMb: mb(usage.rss),
    heapUsedMb: mb(usage.heapUsed),
    heapTotalMb: mb(usage.heapTotal),
    externalMb: mb(usage.external),
    arrayBuffersMb: mb(usage.arrayBuffers),
    heapStatistics: summarizeHeapStatistics(),
    heapSpaces: summarizeHeapSpaces(),
    activeResources: summarizeActiveResources(),
    tracker: getFeedRequestTrackerStats(),
    redis: await collectRedisStats(),
    sockets: summarizeSockets(sockets, serverConnections),
  };
}

function requireGc(): () => void {
  const gc = globalThis.gc;
  if (typeof gc !== 'function') {
    throw new Error('global.gc is unavailable; run server process with node --expose-gc');
  }
  return gc;
}

function installNoopRequestLogPipeline(): void {
  (redis as unknown as { pipeline: () => NoopRedisPipeline }).pipeline = () => {
    const stub: NoopRedisPipeline = {
      rpush: () => stub,
      ltrim: () => stub,
      exec: async (): Promise<[]> => [],
    };
    return stub;
  };
}

async function seedFeed(): Promise<string> {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;
  clearCurrentFeedSnapshotMemoryCache();
  const snapshotKeys = await listSnapshotKeys();
  await redis.del('feed:current');
  await redis.del('feed:request_log');
  await redis.del('feed:current_snapshot_id');
  await redis.del('feed:current_snapshot_generation');
  for (let index = 0; index < snapshotKeys.length; index += 500) {
    await redis.del(...snapshotKeys.slice(index, index + 500));
  }
  await redis.set('feed:epoch', '1');

  const pipeline = redis.pipeline();
  for (let i = 0; i < 2000; i += 1) {
    const score = 2000 - i;
    const uri = `at://did:plc:feedstressauthor${i % 200}/app.bsky.feed.post/${i}`;
    pipeline.zadd('feed:current', score, uri);
  }
  await pipeline.exec();
  return feedUri;
}

async function sendMessage(message: Record<string, unknown>): Promise<void> {
  if (typeof process.send !== 'function') {
    throw new Error('feed-skeleton-memory-server requires an IPC channel');
  }
  await new Promise<void>((resolve, reject) => {
    process.send?.(message, (error: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function isSnapshotMessage(message: unknown): message is SnapshotMessage {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'snapshot';
}

function isBaselineMessage(message: unknown): message is BaselineMessage {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'baseline';
}

async function waitForConnectionDrain(app: ReturnType<typeof Fastify>, timeoutMs: number): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connections = await getConnectionCount(app);
    if (connections === 0) {
      return 0;
    }
    const serverWithIdleClose = app.server as typeof app.server & { closeIdleConnections?: () => void };
    if (typeof serverWithIdleClose.closeIdleConnections === 'function') {
      serverWithIdleClose.closeIdleConnections();
    }
    await sleep(50);
  }
  return getConnectionCount(app);
}

async function settleServerBeforeSnapshot(app: ReturnType<typeof Fastify>, gc: () => void): Promise<DrainDiagnosticStats> {
  const tracker = await drainFeedRequestTracker(10_000);
  const serverWithIdleClose = app.server as typeof app.server & { closeIdleConnections?: () => void };
  if (typeof serverWithIdleClose.closeIdleConnections === 'function') {
    serverWithIdleClose.closeIdleConnections();
  }
  const remainingConnections = await waitForConnectionDrain(app, 5_000);
  await sleep(250);
  gc();
  await sleep(50);
  gc();
  return {
    tracker,
    remainingConnections,
  };
}

async function maybeWriteHeapSnapshot(options: ServerOptions, phase: string): Promise<string | null> {
  if (!options.heapSnapshots) {
    return null;
  }
  if (options.heapDir === null) {
    throw new Error('--heap-dir is required when --heap-snapshots is provided');
  }

  await mkdir(options.heapDir, { recursive: true });
  const filename = path.join(options.heapDir, `${options.runLabel}-${phase}.heapsnapshot`);
  return writeHeapSnapshot(filename, { exposeInternals: false, exposeNumericValues: true });
}

async function parseSeedResponse(response: Response): Promise<{ cursor?: string }> {
  if (!response.ok) {
    throw new Error(`seed feed skeleton request failed with HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as { cursor?: string };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`seed feed skeleton request returned invalid JSON: ${error.message}`);
    }
    throw new Error('seed feed skeleton request returned invalid JSON: non-Error thrown');
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const gc = requireGc();
  const app = Fastify();
  const sockets = new Set<Socket>();
  let before: MemorySnapshot | null = null;
  let beforeHeapSnapshotPath: string | null = null;
  app.server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });
  registerFeedSkeleton(app);
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();

  try {
    const feedUri = await seedFeed();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error(`server address was not a TCP address: ${String(address)}`);
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const seedResponse = await fetch(
      `${baseUrl}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=50`
    );
    const seedJson = await parseSeedResponse(seedResponse);
    const validCursor = seedJson.cursor ?? null;
    if (options.mode === 'noop') {
      installNoopRequestLogPipeline();
    }

    process.on('message', (message: unknown) => {
      if (isBaselineMessage(message)) {
        void (async () => {
          const warmupDrain = await settleServerBeforeSnapshot(app, gc);
          beforeHeapSnapshotPath = await maybeWriteHeapSnapshot(options, 'before');
          before = await takeSnapshot(app, sockets);
          await sendMessage({
            type: 'baseline',
            mode: options.mode,
            before,
            beforeHeapSnapshotPath,
            warmupDrain,
          });
        })().catch((error: unknown) => {
          process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
          void app.close().finally(() => {
            redis.disconnect();
            process.exit(1);
          });
        });
        return;
      }

      if (!isSnapshotMessage(message)) {
        return;
      }
      void (async () => {
        if (before === null) {
          throw new Error('snapshot requested before baseline snapshot was collected');
        }
        const drain = await settleServerBeforeSnapshot(app, gc);
        const afterHeapSnapshotPath = await maybeWriteHeapSnapshot(options, 'after-gc');
        const afterGc = await takeSnapshot(app, sockets);
        eventLoop.disable();
        await sendMessage({
          type: 'snapshot',
          mode: options.mode,
          afterGc,
          afterGcDeltaMb: Math.round((afterGc.rssMb - before.rssMb) * 100) / 100,
          heapUsedAfterGcDeltaMb: Math.round((afterGc.heapUsedMb - before.heapUsedMb) * 100) / 100,
          eventLoopDelayP95Ms: Math.round((eventLoop.percentile(95) / 1_000_000) * 100) / 100,
          drain,
          afterHeapSnapshotPath,
        });
        await app.close();
        redis.disconnect();
        process.exit(0);
      })().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        void app.close().finally(() => {
          redis.disconnect();
          process.exit(1);
        });
      });
    });

    await sendMessage({
      type: 'ready',
      mode: options.mode,
      baseUrl,
      feedUri,
      validCursor,
    });
  } catch (error: unknown) {
    eventLoop.disable();
    try {
      await app.close();
    } catch (closeError: unknown) {
      process.stderr.write(`${closeError instanceof Error ? closeError.stack ?? closeError.message : String(closeError)}\n`);
    }
    redis.disconnect();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
