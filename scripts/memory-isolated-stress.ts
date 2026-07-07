/**
 * Process-isolated memory stress harness for feed skeleton serving.
 */

import { randomUUID } from 'node:crypto';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { runHttpLoad, type HttpLoadRequest } from './http-load.js';
import { runMigrations } from './migrate.js';
import { assertEphemeralTarget } from '../src/harness/prod-guard.js';
import {
  collectArtifactDescriptor,
  collectGitBranch,
  collectGitState,
  collectRuntimeState,
  createLabRunId,
  ensureDirectory,
  resolveLabRunDirectory,
  sha256Text,
  writeChecksums,
  writeJsonArtifact,
  writeLabManifest,
  type LabArtifactDescriptor,
  type LabClaim,
  type LabManifest,
} from '../src/harness/lab-artifacts.js';

const execFileAsync = promisify(execFile);

interface CliOptions {
  dryRun: boolean;
  ephemeral: boolean;
  diagnostic: boolean;
  heapSnapshots: boolean;
  prodParity: boolean;
  runs: number;
  amount: number;
  connections: number;
  artifactsRoot: string;
}

interface MemoryTarget {
  databaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

interface ChildRun {
  mode: 'normal' | 'noop';
  runIndex: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  peakRssMb: number;
  parsed: Record<string, unknown> | null;
}

interface ReadyMessage {
  type: 'ready';
  mode: 'normal' | 'noop';
  baseUrl: string;
  feedUri: string;
  validCursor: string | null;
}

interface BaselineMessage {
  type: 'baseline';
  mode: 'normal' | 'noop';
  before: MemorySnapshotMessage;
  beforeHeapSnapshotPath: string | null;
  warmupDrain: {
    tracker: FeedRequestTrackerStatsMessage;
    remainingConnections: number;
  };
}

interface SnapshotMessage {
  type: 'snapshot';
  mode: 'normal' | 'noop';
  afterGc: MemorySnapshotMessage;
  afterGcDeltaMb: number;
  heapUsedAfterGcDeltaMb: number;
  eventLoopDelayP95Ms: number;
  drain: {
    tracker: FeedRequestTrackerStatsMessage;
    remainingConnections: number;
  };
  afterHeapSnapshotPath: string | null;
}

interface FeedRequestTrackerStatsMessage {
  queued: number;
  inFlight: number;
  enqueued: number;
  completed: number;
  failed: number;
  timedOut: number;
  dropped: number;
  backendSaturationDropped: number;
  abandonedBackendOps: number;
  abandonedBackendOpsTotal: number;
  maxQueuedObserved: number;
  maxInFlightObserved: number;
  maxAbandonedBackendOpsObserved: number;
}

interface MemorySnapshotMessage {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb?: number;
  heapStatistics?: Record<string, number>;
  heapSpaces?: Array<Record<string, number | string>>;
  activeResources?: Record<string, number>;
  tracker?: FeedRequestTrackerStatsMessage;
  redis?: Record<string, unknown>;
  sockets?: Record<string, unknown>;
}

interface ModeStats {
  runs: number;
  medianAfterGcDeltaMb: number;
  p95AfterGcDeltaMb: number;
  maxAfterGcDeltaMb: number;
  maxPeakRssMb: number;
  maxEventLoopDelayP95Ms: number;
}

interface MemorySummary {
  runsPerMode: number;
  amount: number;
  warmupAmount: number;
  connections: number;
  childRuntime: ChildRuntime;
  modes: {
    normal: ModeStats;
    noop: ModeStats;
  };
  childRuns: ChildRun[];
  passed: boolean;
  thresholds: Record<string, unknown>;
}

interface ChildRuntime {
  mode: 'tsx' | 'compiled';
  entrypoint: string;
  execArgv: string[];
  maxOldSpaceMb: number | null;
  maxSemiSpaceMb: number;
}

const ISSUE_KEY = 'PROJ-1551';
const DEFAULT_RUNS = 5;
const DEFAULT_AMOUNT = 10_000;
const WARMUP_AMOUNT = 1_000;
const DEFAULT_CONNECTIONS = 100;
const MAX_RUNS = 50;
const MAX_AMOUNT = 100_000;
const MAX_CONNECTIONS = 1_000;
const MAX_AFTER_GC_DELTA_MB_PER_RUN = 128;
const MEDIAN_AFTER_GC_DELTA_MB_PER_MODE = 64;
const P95_AFTER_GC_DELTA_MB_PER_MODE = 96;
const MAX_PEAK_RSS_MB_PER_MODE = 512;
const DEFAULT_ARTIFACTS_ROOT = 'artifacts/lab';
const SAMPLE_INTERVAL_MS = 500;
const CHILD_MESSAGE_TIMEOUT_MS = 60_000;
const CHILD_SHUTDOWN_GRACE_MS = 5_000;
const CHILD_MAX_SEMI_SPACE_MB = 16;
const CHILD_MAX_OLD_SPACE_MB = 896;
const CHILD_TS_ENTRYPOINT = path.join('tests', 'stress', 'feed-skeleton-memory-server.ts');
const CHILD_COMPILED_ENTRYPOINT = path.join('dist-lab', 'tests', 'stress', 'feed-skeleton-memory-server.js');
const CHILD_TS_EXEC_ARGV = [
  '--expose-gc',
  `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`,
  `--max-semi-space-size=${CHILD_MAX_SEMI_SPACE_MB}`,
  '--import',
  'tsx',
] as const;
const CHILD_COMPILED_EXEC_ARGV = [
  '--expose-gc',
  `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`,
  `--max-semi-space-size=${CHILD_MAX_SEMI_SPACE_MB}`,
] as const;
const FEED_REQUESTER_JWT_LXM = 'app.bsky.feed.getFeedSkeleton';
const FEED_REQUESTER_JWT_AUDIENCE = 'did:web:localhost';
const BOOLEAN_FLAGS = new Set(['--dry-run', '--ephemeral', '--diagnostic', '--heap-snapshots', '--prod-parity']);
const VALUE_FLAGS = new Set(['--runs', '--amount', '--connections', '--artifacts-root']);

function readFlagValue(args: readonly string[], name: string): string | null {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline !== undefined) {
    const value = inline.slice(inlinePrefix.length);
    if (!value) {
      throw new RangeError(`${name} requires a value`);
    }
    return value;
  }
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

function validateArgs(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new RangeError(`Unknown positional argument ${arg}`);
    }
    const equalsIndex = arg.indexOf('=');
    const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1);
    if (BOOLEAN_FLAGS.has(flag)) {
      if (inlineValue !== undefined) {
        throw new RangeError(`${flag} does not accept a value`);
      }
      continue;
    }
    if (VALUE_FLAGS.has(flag)) {
      if (inlineValue !== undefined) {
        if (!inlineValue) {
          throw new RangeError(`${flag} requires a value`);
        }
        continue;
      }
      index += 1;
      continue;
    }
    throw new RangeError(`Unknown argument ${arg}`);
  }
}

function parsePositiveInteger(raw: string | null, fallback: number, name: string): number {
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${name} must be a positive integer; received ${raw}`);
  }
  const max =
    name === '--runs'
      ? MAX_RUNS
      : name === '--amount'
        ? MAX_AMOUNT
        : name === '--connections'
          ? MAX_CONNECTIONS
          : Number.MAX_SAFE_INTEGER;
  if (parsed > max) {
    throw new RangeError(`${name} must be <= ${max}; received ${raw}`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  validateArgs(args);
  const artifactsRoot = readFlagValue(args, '--artifacts-root');
  return {
    dryRun: args.includes('--dry-run'),
    ephemeral: args.includes('--ephemeral'),
    diagnostic: args.includes('--diagnostic'),
    heapSnapshots: args.includes('--heap-snapshots'),
    prodParity: args.includes('--prod-parity'),
    runs: parsePositiveInteger(readFlagValue(args, '--runs'), DEFAULT_RUNS, '--runs'),
    amount: parsePositiveInteger(readFlagValue(args, '--amount'), DEFAULT_AMOUNT, '--amount'),
    connections: parsePositiveInteger(readFlagValue(args, '--connections'), DEFAULT_CONNECTIONS, '--connections'),
    artifactsRoot: artifactsRoot === null ? DEFAULT_ARTIFACTS_ROOT : artifactsRoot,
  };
}

function resolveChildRuntime(options: CliOptions): ChildRuntime {
  if (options.prodParity) {
    return {
      mode: 'compiled',
      entrypoint: CHILD_COMPILED_ENTRYPOINT,
      execArgv: [...CHILD_COMPILED_EXEC_ARGV],
      maxOldSpaceMb: CHILD_MAX_OLD_SPACE_MB,
      maxSemiSpaceMb: CHILD_MAX_SEMI_SPACE_MB,
    };
  }

  return {
    mode: 'tsx',
    entrypoint: CHILD_TS_ENTRYPOINT,
    execArgv: [...CHILD_TS_EXEC_ARGV],
    maxOldSpaceMb: CHILD_MAX_OLD_SPACE_MB,
    maxSemiSpaceMb: CHILD_MAX_SEMI_SPACE_MB,
  };
}

async function assertChildRuntimeReady(runtime: ChildRuntime): Promise<void> {
  if (runtime.mode !== 'compiled') {
    return;
  }

  const absoluteEntrypoint = path.resolve(runtime.entrypoint);
  try {
    await access(absoluteEntrypoint);
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(
        `compiled memory child is missing at ${absoluteEntrypoint}; run npm run build:lab-memory before --prod-parity: ${error.message}`
      );
    }
    throw new Error(`compiled memory child is missing at ${absoluteEntrypoint}; non-Error thrown by access()`);
  }
}

function makeJwt(did: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: did,
      sub: did,
      aud: FEED_REQUESTER_JWT_AUDIENCE,
      lxm: FEED_REQUESTER_JWT_LXM,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    })
  ).toString('base64url');
  const sig = Buffer.from(randomUUID()).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function buildFeedRequests(feedUri: string, validCursor: string | null): HttpLoadRequest[] {
  const goodJwt = `Bearer ${makeJwt('did:plc:stressfeedrequester')}`;
  const malformedJwt = 'Bearer malformed.jwt.token';
  const garbageCursor = '%%%NOT_A_CURSOR%%%';
  const cursorQuery = validCursor ? `&cursor=${encodeURIComponent(validCursor)}` : '';

  return [
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
}

function normalizePostgresUrl(url: string): string {
  return url.replace(/^postgres:\/\//, 'postgresql://');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Use --ephemeral for throwaway local containers.`);
  }
  return value;
}

function setLabConfigDefaults(databaseUrl: string, redisUrl: string): void {
  assertEphemeralTarget(databaseUrl, redisUrl);
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.CORGI_SIM_ALLOW = '1';
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.FEEDGEN_SERVICE_DID = 'did:web:localhost';
  process.env.FEEDGEN_PUBLISHER_DID = 'did:plc:corgi-lab-publisher';
  process.env.FEEDGEN_HOSTNAME = 'localhost';
  process.env.JETSTREAM_URL = 'https://jetstream1.us-east.bsky.network/subscribe';
  process.env.JETSTREAM_FALLBACK_URL = 'https://jetstream2.us-east.bsky.network/subscribe';
  process.env.JETSTREAM_COLLECTIONS = 'app.bsky.feed.post,app.bsky.feed.like,app.bsky.feed.repost,app.bsky.graph.follow';
  process.env.BSKY_IDENTIFIER = 'corgi-lab.invalid';
  process.env.BSKY_APP_PASSWORD = 'corgi-lab-password';
  process.env.RATE_LIMIT_ENABLED = 'false';
}

async function stopContainers(
  pg: StartedPostgreSqlContainer | undefined,
  redis: StartedRedisContainer | undefined
): Promise<void> {
  const results = await Promise.allSettled([
    pg === undefined ? Promise.resolve() : pg.stop(),
    redis === undefined ? Promise.resolve() : redis.stop(),
  ]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      'Failed to stop one or more memory-stress containers'
    );
  }
}

async function startTarget(options: CliOptions): Promise<MemoryTarget> {
  if (options.dryRun) {
    throw new Error('dry-run does not start targets');
  }

  if (options.ephemeral) {
    let pg: StartedPostgreSqlContainer | undefined;
    let redis: StartedRedisContainer | undefined;
    try {
      const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([
        import('@testcontainers/postgresql'),
        import('@testcontainers/redis'),
      ]);
      pg = await new PostgreSqlContainer('postgres:16-alpine').start();
      redis = await new RedisContainer('redis:7-alpine').start();
      const databaseUrl = normalizePostgresUrl(pg.getConnectionUri());
      const redisUrl = redis.getConnectionUrl();
      setLabConfigDefaults(databaseUrl, redisUrl);
      await runMigrations(databaseUrl);
      return {
        databaseUrl,
        redisUrl,
        stop: async () => stopContainers(pg, redis),
      };
    } catch (error: unknown) {
      try {
        await stopContainers(pg, redis);
      } catch (cleanupError: unknown) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.warn(`failed to clean up memory-stress containers after startup error: ${cleanupMessage}`);
      }
      if (error instanceof Error) {
        throw new Error(`failed to start ephemeral memory target: ${error.message}`);
      }
      throw new Error('failed to start ephemeral memory target: non-Error thrown');
    }
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const redisUrl = requiredEnv('REDIS_URL');
  setLabConfigDefaults(databaseUrl, redisUrl);
  return {
    databaseUrl,
    redisUrl,
    stop: async () => undefined,
  };
}

async function sampleRssMb(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
    const raw = stdout.trim();
    if (!raw) {
      return null;
    }
    return Math.round((Number(raw) / 1024) * 100) / 100;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (code === 1) {
        return null;
      }
    }
    if (error instanceof Error) {
      throw new Error(`failed to sample RSS for pid ${pid}: ${error.message}`);
    }
    return null;
  }
}

function parseChildJson(stdout: string): Record<string, unknown> | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    return null;
  }
  const parsed = JSON.parse(last) as Record<string, unknown>;
  return parsed;
}

function nestedRssMb(parsed: Record<string, unknown>, key: string): number {
  const snapshot = parsed[key];
  if (typeof snapshot !== 'object' || snapshot === null) {
    return 0;
  }
  const rssMb = (snapshot as { rssMb?: unknown }).rssMb;
  return typeof rssMb === 'number' && Number.isFinite(rssMb) ? rssMb : 0;
}

function isReadyMessage(message: unknown): message is ReadyMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.type === 'ready' && typeof record.baseUrl === 'string' && typeof record.feedUri === 'string';
}

function isBaselineMessage(message: unknown): message is BaselineMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.type === 'baseline' && typeof record.before === 'object' && record.before !== null;
}

function isSnapshotMessage(message: unknown): message is SnapshotMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const record = message as Record<string, unknown>;
  return record.type === 'snapshot' && typeof record.afterGcDeltaMb === 'number';
}

function waitForMessageOrExit<T>(
  child: ChildProcess,
  description: string,
  predicate: (message: unknown) => message is T
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('close', onClose);
    };
    const onMessage = (message: unknown): void => {
      if (!predicate(message)) {
        return;
      }
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`memory child exited before ${description}; code=${String(code)} signal=${String(signal)}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting ${CHILD_MESSAGE_TIMEOUT_MS}ms for memory child ${description}`));
    }, CHILD_MESSAGE_TIMEOUT_MS);

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('close', onClose);
  });
}

function waitForChildClose(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      child.off('close', onClose);
      reject(error);
    };
    const onClose = (code: number | null): void => {
      child.off('error', onError);
      resolve(code);
    };
    child.once('error', onError);
    child.once('close', onClose);
  });
}

async function waitForChildCloseWithin(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      waitForChildClose(child),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`memory child did not exit within ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function forceKillChild(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }

  child.kill('SIGTERM');
  try {
    return await waitForChildCloseWithin(child, CHILD_SHUTDOWN_GRACE_MS);
  } catch {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    try {
      return await waitForChildCloseWithin(child, CHILD_SHUTDOWN_GRACE_MS);
    } catch {
      return child.exitCode;
    }
  }
}

async function stopChild(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return child.exitCode;
  }
  return forceKillChild(child);
}

function buildChildArgs(
  mode: 'normal' | 'noop',
  runIndex: number,
  options: CliOptions,
  phaseDirectory: string
): string[] {
  const runLabel = `${mode}-run-${runIndex}`;
  const args = ['--mode', mode, '--run-label', runLabel];
  if (options.diagnostic) {
    args.push('--diagnostic');
  }
  if (options.heapSnapshots) {
    args.push('--heap-snapshots', '--heap-dir', path.join(phaseDirectory, 'heaps'));
  }
  return args;
}

async function runChild(
  mode: 'normal' | 'noop',
  runIndex: number,
  options: CliOptions,
  phaseDirectory: string,
  childRuntime: ChildRuntime
): Promise<ChildRun> {
  const child = fork(
    childRuntime.entrypoint,
    buildChildArgs(mode, runIndex, options, phaseDirectory),
    {
      cwd: process.cwd(),
      env: process.env,
      execArgv: [...childRuntime.execArgv],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }
  );

  if (child.stdout === null || child.stderr === null) {
    throw new Error('memory child stdout/stderr streams were not created');
  }

  let stdout = '';
  let stderr = '';
  let peakRssMb = 0;
  const sampler = setInterval(() => {
    if (child.pid === undefined) {
      return;
    }
    void sampleRssMb(child.pid)
      .then((rss) => {
        if (rss !== null) {
          peakRssMb = Math.max(peakRssMb, rss);
        }
      })
      .catch((error: unknown) => {
        stderr += `${error instanceof Error ? error.message : String(error)}\n`;
      });
  }, SAMPLE_INTERVAL_MS);

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  let exitCode: number | null = null;
  try {
    const ready = await waitForMessageOrExit(child, 'ready message', isReadyMessage);
    const requests = buildFeedRequests(ready.feedUri, ready.validCursor);

    const warmup = await runHttpLoad({
      baseUrl: ready.baseUrl,
      amount: WARMUP_AMOUNT,
      durationMs: null,
      connections: Math.min(options.connections, WARMUP_AMOUNT),
      timeoutMs: 30_000,
      requests,
    });

    if (!child.connected) {
      throw new Error('memory child IPC channel closed before baseline request');
    }
    const baselinePromise = waitForMessageOrExit(child, 'baseline message', isBaselineMessage);
    child.send({ type: 'baseline' });
    const baseline = await baselinePromise;

    const load = await runHttpLoad({
      baseUrl: ready.baseUrl,
      amount: options.amount,
      durationMs: null,
      connections: options.connections,
      timeoutMs: 30_000,
      requests,
    });

    if (!child.connected) {
      throw new Error('memory child IPC channel closed before snapshot request');
    }
    const snapshotPromise = waitForMessageOrExit(child, 'snapshot message', isSnapshotMessage);
    child.send({ type: 'snapshot' });
    const snapshot = await snapshotPromise;

    try {
      exitCode = await waitForChildCloseWithin(child, CHILD_SHUTDOWN_GRACE_MS);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      stderr += `${message}\n`;
      exitCode = await forceKillChild(child);
    }

    const pass = {
      label: mode === 'noop' ? 'rpush_noop' : 'rpush_normal',
      p50: load.latency.p50,
      p95: load.latency.p95,
      p99: load.latency.p99,
      average: load.latency.average,
      max: load.latency.max,
      requestsAverage: load.requests.average,
      totalRequests: load.requests.total,
      errors: load.errors,
      timeouts: load.timeouts,
      non2xx: load.non2xx,
      statusBuckets: load.statusBuckets,
      rssBeforeMb: baseline.before.rssMb,
      rssAfterMb: snapshot.afterGc.rssMb,
      rssDeltaMb: snapshot.afterGcDeltaMb,
    };
    const warmupSucceeded = warmup.errors === 0 && warmup.timeouts === 0 && warmup.statusBuckets.s5xx === 0;
    const success =
      warmupSucceeded && load.latency.p95 < 100 && load.errors === 0 && load.timeouts === 0 && load.statusBuckets.s5xx === 0;
    const parsed: Record<string, unknown> = {
      mode,
      amount: options.amount,
      warmupAmount: WARMUP_AMOUNT,
      connections: options.connections,
      before: baseline.before,
      afterGc: snapshot.afterGc,
      afterGcDeltaMb: snapshot.afterGcDeltaMb,
      heapUsedAfterGcDeltaMb: snapshot.heapUsedAfterGcDeltaMb,
      eventLoopDelayP95Ms: snapshot.eventLoopDelayP95Ms,
      warmup: {
        p95: warmup.latency.p95,
        p99: warmup.latency.p99,
        errors: warmup.errors,
        timeouts: warmup.timeouts,
        non2xx: warmup.non2xx,
        statusBuckets: warmup.statusBuckets,
        drain: baseline.warmupDrain,
      },
      drain: snapshot.drain,
      heapSnapshots: {
        before: baseline.beforeHeapSnapshotPath,
        afterGc: snapshot.afterHeapSnapshotPath,
      },
      result: {
        name: `feed-skeleton-load-${pass.label}`,
        success,
        metrics: { pass },
        assertions: [
          {
            name: `warmup_no_errors_${pass.label}`,
            pass: warmupSucceeded,
            detail: `${pass.label} warmup errors=${warmup.errors} timeouts=${warmup.timeouts} s5xx=${warmup.statusBuckets.s5xx}`,
          },
          {
            name: `p95_below_100ms_${pass.label}`,
            pass: load.latency.p95 < 100,
            detail: `${pass.label} p95=${load.latency.p95}ms`,
          },
        ],
        errors: [],
      },
    };
    peakRssMb = Math.max(peakRssMb, nestedRssMb(parsed, 'before'), nestedRssMb(parsed, 'afterGc'));

    return {
      mode,
      runIndex,
      exitCode,
      stdout,
      stderr,
      peakRssMb,
      parsed,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr += `${message}\n`;
    exitCode = await stopChild(child);
    return {
      mode,
      runIndex,
      exitCode,
      stdout,
      stderr,
      peakRssMb,
      parsed: null,
    };
  } finally {
    clearInterval(sampler);
    if (child.exitCode === null && child.signalCode === null) {
      await forceKillChild(child);
    }
  }
}

function numericField(parsed: Record<string, unknown>, name: string): number {
  const value = parsed[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`child parsed field ${name} must be numeric`);
  }
  return value;
}

function parsedResultSucceeded(parsed: Record<string, unknown> | null): boolean {
  if (parsed === null) {
    return false;
  }
  const result = parsed.result;
  if (typeof result !== 'object' || result === null) {
    return false;
  }
  return (result as { success?: unknown }).success === true;
}

function parsedTrackerNumberField(parsed: Record<string, unknown> | null, name: string): number {
  if (parsed === null) {
    return 0;
  }
  const drain = parsed.drain;
  if (typeof drain !== 'object' || drain === null) {
    return 0;
  }
  const tracker = (drain as { tracker?: unknown }).tracker;
  if (typeof tracker !== 'object' || tracker === null) {
    return 0;
  }
  const value = (tracker as Record<string, unknown>)[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parsedRemainingConnections(parsed: Record<string, unknown> | null): number {
  if (parsed === null) {
    return 0;
  }
  const drain = parsed.drain;
  if (typeof drain !== 'object' || drain === null) {
    return 0;
  }
  const remainingConnections = (drain as { remainingConnections?: unknown }).remainingConnections;
  return typeof remainingConnections === 'number' && Number.isFinite(remainingConnections) ? remainingConnections : 0;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  const boundedRank = Math.max(0, Math.min(sorted.length - 1, rank));
  return Math.round(sorted[boundedRank] * 100) / 100;
}

function modeStats(mode: 'normal' | 'noop', childRuns: readonly ChildRun[]): ModeStats {
  const runs = childRuns.filter((run) => run.mode === mode && run.parsed !== null);
  const deltas = runs.map((run) => numericField(run.parsed as Record<string, unknown>, 'afterGcDeltaMb'));
  const eventLoop = runs.map((run) => numericField(run.parsed as Record<string, unknown>, 'eventLoopDelayP95Ms'));
  return {
    runs: runs.length,
    medianAfterGcDeltaMb: percentile(deltas, 50),
    p95AfterGcDeltaMb: percentile(deltas, 95),
    maxAfterGcDeltaMb: deltas.length === 0 ? 0 : Math.max(...deltas),
    maxPeakRssMb: runs.length === 0 ? 0 : Math.max(...runs.map((run) => run.peakRssMb)),
    maxEventLoopDelayP95Ms: eventLoop.length === 0 ? 0 : Math.max(...eventLoop),
  };
}

function summaryPassed(summary: MemorySummary): boolean {
  const everyChildPassed = summary.childRuns.every((run) => run.exitCode === 0 && run.parsed !== null);
  const everyLoadPassed = summary.childRuns.every((run) => parsedResultSucceeded(run.parsed));
  const noDroppedTracking = summary.childRuns.every((run) => parsedTrackerNumberField(run.parsed, 'dropped') === 0);
  const noBackendSaturationDrops = summary.childRuns.every(
    (run) => parsedTrackerNumberField(run.parsed, 'backendSaturationDropped') === 0
  );
  const noAbandonedBackendOps = summary.childRuns.every(
    (run) => parsedTrackerNumberField(run.parsed, 'abandonedBackendOps') === 0
  );
  const noRemainingConnections = summary.childRuns.every((run) => parsedRemainingConnections(run.parsed) === 0);
  const stats = [summary.modes.normal, summary.modes.noop];
  return (
    everyChildPassed &&
    everyLoadPassed &&
    noDroppedTracking &&
    noBackendSaturationDrops &&
    noAbandonedBackendOps &&
    noRemainingConnections &&
    stats.every((stat) => stat.runs === summary.runsPerMode) &&
    stats.every((stat) => stat.maxAfterGcDeltaMb <= MAX_AFTER_GC_DELTA_MB_PER_RUN) &&
    stats.every((stat) => stat.medianAfterGcDeltaMb <= MEDIAN_AFTER_GC_DELTA_MB_PER_MODE) &&
    stats.every((stat) => stat.p95AfterGcDeltaMb <= P95_AFTER_GC_DELTA_MB_PER_MODE) &&
    stats.every((stat) => stat.maxPeakRssMb <= MAX_PEAK_RSS_MB_PER_MODE)
  );
}

function envAllowlist(databaseUrl: string, redisUrl: string): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? '',
    CORGI_SIM_ALLOW: process.env.CORGI_SIM_ALLOW ?? '',
    DATABASE_URL_SHA256: sha256Text(databaseUrl),
    REDIS_URL_SHA256: sha256Text(redisUrl),
  };
}

function buildClaims(summaryPath: string, passed: boolean, childRuntime: ChildRuntime): LabClaim[] {
  return [
    {
      claim: `Feed skeleton memory profile is measured in fresh Node processes with forced after-GC snapshots using ${childRuntime.mode} runtime`,
      status: passed ? 'pass' : 'fail',
      evidencePaths: [summaryPath],
    },
  ];
}

function collectHeapSnapshotPaths(childRuns: readonly ChildRun[]): string[] {
  const paths: string[] = [];
  for (const run of childRuns) {
    const heapSnapshots = run.parsed?.heapSnapshots;
    if (typeof heapSnapshots !== 'object' || heapSnapshots === null) {
      continue;
    }
    const before = (heapSnapshots as { before?: unknown }).before;
    const afterGc = (heapSnapshots as { afterGc?: unknown }).afterGc;
    if (typeof before === 'string') {
      paths.push(before);
    }
    if (typeof afterGc === 'string') {
      paths.push(afterGc);
    }
  }
  return paths;
}

export async function runMemory(options: CliOptions): Promise<void> {
  const startedAt = new Date();
  const childRuntime = resolveChildRuntime(options);
  const runId = createLabRunId(startedAt);
  const runDirectory = resolveLabRunDirectory(path.resolve(options.artifactsRoot), ISSUE_KEY, runId);
  const phaseDirectory = path.join(runDirectory, 'memory-isolated');

  if (options.dryRun) {
    const dryRunReceipt = {
      issue: ISSUE_KEY,
      runs: options.runs,
    amount: options.amount,
    warmupAmount: WARMUP_AMOUNT,
    connections: options.connections,
      diagnostic: options.diagnostic,
      heapSnapshots: options.heapSnapshots,
      prodParity: options.prodParity,
      childRuntime,
      runDirectory,
    };
    await ensureDirectory(phaseDirectory);
    await writeJsonArtifact(phaseDirectory, 'dry-run.json', dryRunReceipt);
    console.log(JSON.stringify(dryRunReceipt, null, 2));
    return;
  }

  await assertChildRuntimeReady(childRuntime);
  const target = await startTarget(options);
  try {
    await ensureDirectory(phaseDirectory);
    const childRuns: ChildRun[] = [];
    for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
      childRuns.push(await runChild('normal', runIndex, options, phaseDirectory, childRuntime));
      childRuns.push(await runChild('noop', runIndex, options, phaseDirectory, childRuntime));
    }

    const thresholds = {
      maxAfterGcDeltaMbPerRun: `<=${MAX_AFTER_GC_DELTA_MB_PER_RUN}`,
      medianAfterGcDeltaMbPerMode: `<=${MEDIAN_AFTER_GC_DELTA_MB_PER_MODE}`,
      p95AfterGcDeltaMbPerMode: `<=${P95_AFTER_GC_DELTA_MB_PER_MODE}`,
      maxPeakRssMbPerMode: `<=${MAX_PEAK_RSS_MB_PER_MODE}`,
      baseline: `${WARMUP_AMOUNT} external warmup requests before before-GC snapshot`,
      droppedTracking: 0,
      backendSaturationDropped: 0,
      abandonedBackendOps: 0,
      remainingConnections: 0,
      childExitCode: 0,
    };
    const summary: MemorySummary = {
      runsPerMode: options.runs,
      amount: options.amount,
      warmupAmount: WARMUP_AMOUNT,
      connections: options.connections,
      childRuntime,
      modes: {
        normal: modeStats('normal', childRuns),
        noop: modeStats('noop', childRuns),
      },
      childRuns,
      passed: false,
      thresholds,
    };
    summary.passed = summaryPassed(summary);

    const summaryPath = await writeJsonArtifact(phaseDirectory, 'summary.json', summary);
    const summaryDescriptor = await collectArtifactDescriptor(
      runDirectory,
      summaryPath,
      'application/json',
      'scripts/memory-isolated-stress.ts'
    );
    const artifacts: LabArtifactDescriptor[] = [summaryDescriptor];

    if (options.diagnostic) {
      const diagnosticsPath = await writeJsonArtifact(phaseDirectory, 'diagnostics.json', {
        diagnostic: true,
        heapSnapshots: options.heapSnapshots,
        childRuns,
      });
      artifacts.push(
        await collectArtifactDescriptor(
          runDirectory,
          diagnosticsPath,
          'application/json',
          'scripts/memory-isolated-stress.ts'
        )
      );
    }

    for (const heapSnapshotPath of collectHeapSnapshotPaths(childRuns)) {
      artifacts.push(
        await collectArtifactDescriptor(
          runDirectory,
          heapSnapshotPath,
          'application/vnd.v8.heapsnapshot+json',
          'tests/stress/feed-skeleton-memory-server.ts'
        )
      );
    }

    const checksumsPath = await writeChecksums(runDirectory, artifacts);
    artifacts.push(
      await collectArtifactDescriptor(runDirectory, checksumsPath, 'text/plain', 'src/harness/lab-artifacts.ts')
    );

    const manifest: LabManifest = {
      schemaVersion: '1.0.0',
      issue: ISSUE_KEY,
      branch: await collectGitBranch(process.cwd()),
      git: await collectGitState(process.cwd(), 'origin/main'),
      command: {
        argv: process.argv,
        cwd: process.cwd(),
        exitCode: summary.passed ? 0 : 1,
        stdoutPath: null,
        stderrPath: null,
      },
      envAllowlist: envAllowlist(target.databaseUrl, target.redisUrl),
      runtime: await collectRuntimeState(process.cwd()),
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      artifacts,
      thresholds,
      claims: buildClaims(summaryDescriptor.path, summary.passed, childRuntime),
    };
    const manifestPath = await writeLabManifest(runDirectory, manifest);
    console.log(
      JSON.stringify(
        {
          passed: summary.passed,
          manifestPath,
          summaryPath,
          summary,
        },
        null,
        2
      )
    );
    if (!summary.passed) {
      process.exitCode = 1;
    }
  } finally {
    await target.stop();
  }
}

function isDirectCliInvocation(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) {
    return false;
  }
  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectCliInvocation()) {
  const options = parseArgs(process.argv.slice(2));
  runMemory(options).catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error('memory isolated stress failed with non-Error thrown');
    }
    process.exit(1);
  });
}
