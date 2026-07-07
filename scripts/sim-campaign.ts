/**
 * Simulated epoch campaign runner.
 *
 * Safe by construction: actual runs either use --ephemeral throwaway
 * containers or require DATABASE_URL and REDIS_URL, then reuse
 * src/harness/prod-guard.ts before importing config-bound db/redis singletons.
 * Use --dry-run to emit the exact campaign manifest without I/O.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { runMigrations } from './migrate.js';
import { assertEphemeralTarget } from '../src/harness/prod-guard.js';
import {
  campaignManifest,
  scenarioForCampaignRun,
  selectCampaignStages,
  totalCampaignRuns,
  type CampaignStageId,
} from '../src/harness/index.js';

interface CliOptions {
  dryRun: boolean;
  ephemeral: boolean;
  onlyStageId: string | null;
  maxStageId: string | null;
  artifactsDir: string;
  clockMs: number | null;
}

interface CampaignTarget {
  databaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

interface CampaignDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface CampaignRedis {
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  disconnect(): void;
}

interface CampaignRunReceipt {
  stageId: CampaignStageId;
  label: string;
  seed: number;
  subscriberCount: number;
  postCount: number;
  expectation: 'gate' | 'capacity';
  durationMs: number;
  scoreRowCount: number;
  redisFeedCount: number | null;
  topPostsFetched: number;
  voteCount: number;
  artifactJsonPath: string | null;
  artifactCsvPath: string | null;
}

interface CampaignSummary {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  error: string | null;
  totalRuns: number;
  runs: CampaignRunReceipt[];
}

const DEFAULT_ARTIFACTS_DIR = 'artifacts/sim-campaign';
const PIPELINE_STEP_TIMEOUT_MS = 240_000;
const BOOLEAN_FLAGS = new Set(['--dry-run', '--ephemeral']);
const VALUE_FLAGS = new Set(['--stage', '--max-stage', '--artifacts-dir', '--clock-ms']);

const HARNESS_TABLES = [
  'post_score_components',
  'post_scores',
  'post_engagement',
  'likes',
  'reposts',
  'follows',
  'posts',
  'governance_vote_weights',
  'governance_epoch_weights',
  'governance_votes',
  'governance_audit_log',
  'governance_epochs',
  'subscribers',
  'system_status',
  'topic_catalog',
] as const;

function readFlagValue(args: readonly string[], name: string): string | null {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline !== undefined) {
    const inlineValue = inline.slice(inlinePrefix.length);
    if (!inlineValue) {
      throw new RangeError(`${name} requires a value`);
    }
    return inlineValue;
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

function parseClockMs(raw: string | null): number | null {
  if (raw === null) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new RangeError(`--clock-ms must be a non-negative integer, received ${raw}`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  validateArgs(args);
  const stage = readFlagValue(args, '--stage');
  const maxStage = readFlagValue(args, '--max-stage');
  const artifactsDir = readFlagValue(args, '--artifacts-dir');
  const clockMs = readFlagValue(args, '--clock-ms');

  return {
    dryRun: args.includes('--dry-run'),
    ephemeral: args.includes('--ephemeral'),
    onlyStageId: stage,
    maxStageId: maxStage,
    artifactsDir: artifactsDir === null ? DEFAULT_ARTIFACTS_DIR : artifactsDir,
    clockMs: parseClockMs(clockMs),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for sim-campaign runs. Use --dry-run for a manifest-only check.`);
  }
  return value;
}

function normalizePostgresUrl(url: string): string {
  return url.replace(/^postgres:\/\//, 'postgresql://');
}

async function writeStdout(output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function writeStderr(output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stderr.write(output, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function stopContainers(
  pg: StartedPostgreSqlContainer | undefined,
  redis: StartedRedisContainer | undefined
): Promise<void> {
  const results = await Promise.allSettled([pg?.stop(), redis?.stop()]);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      'Failed to stop one or more simulation campaign containers'
    );
  }
}

async function buildEphemeralTarget(): Promise<CampaignTarget> {
  let pg: StartedPostgreSqlContainer | undefined;
  let redis: StartedRedisContainer | undefined;

  try {
    const [{ PostgreSqlContainer }, { RedisContainer }] = await Promise.all([
      import('@testcontainers/postgresql'),
      import('@testcontainers/redis'),
    ]);
    const [pgResult, redisResult] = await Promise.allSettled([
      new PostgreSqlContainer('postgres:16')
        .withDatabase('corgi_sim_campaign')
        .withUsername('corgi_sim')
        .withPassword('corgi_sim')
        .start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);

    if (pgResult.status === 'fulfilled') {
      pg = pgResult.value;
    }
    if (redisResult.status === 'fulfilled') {
      redis = redisResult.value;
    }
    if (pgResult.status === 'rejected') {
      throw pgResult.reason;
    }
    if (redisResult.status === 'rejected') {
      throw redisResult.reason;
    }
    if (pg === undefined || redis === undefined) {
      throw new Error('Testcontainers did not return both Postgres and Redis handles');
    }

    const databaseUrl = normalizePostgresUrl(pg.getConnectionUri());
    await runMigrations(databaseUrl);

    return {
      databaseUrl,
      redisUrl: redis.getConnectionUrl(),
      stop: async (): Promise<void> => {
        await stopContainers(pg, redis);
      },
    };
  } catch (err) {
    await stopContainers(pg, redis).catch(() => {});
    throw err;
  }
}

async function buildCampaignTarget(options: CliOptions): Promise<CampaignTarget> {
  if (options.ephemeral) {
    return buildEphemeralTarget();
  }

  return {
    databaseUrl: normalizePostgresUrl(requiredEnv('DATABASE_URL')),
    redisUrl: requiredEnv('REDIS_URL'),
    stop: async (): Promise<void> => {},
  };
}

function ensureHarnessPlaceholderEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.LOG_LEVEL ??= 'warn';
  process.env.FEEDGEN_SERVICE_DID ??= 'did:plc:corgisimcampaign000000000';
  process.env.FEEDGEN_PUBLISHER_DID ??= 'did:plc:corgisimcampaignpublisher';
  process.env.FEEDGEN_HOSTNAME ??= 'sim-campaign.local.test';
  process.env.JETSTREAM_URL ??= 'wss://sim-campaign.local.test/subscribe';
  process.env.JETSTREAM_FALLBACK_URL ??= 'wss://sim-campaign.local.test/subscribe-fallback';
  process.env.JETSTREAM_COLLECTIONS ??= 'app.bsky.feed.post';
  process.env.BSKY_IDENTIFIER ??= 'sim-campaign.test';
  process.env.BSKY_APP_PASSWORD ??= 'sim-campaign-not-a-real-password';
  process.env.BOT_ENABLED ??= 'false';
  process.env.TOPIC_EMBEDDING_ENABLED ??= 'false';
}

async function resetCampaignData(
  db: CampaignDb,
  redis: CampaignRedis
): Promise<void> {
  // HARNESS_TABLES is compile-time fixed; TRUNCATE identifiers cannot be parameterized.
  await db.query(`TRUNCATE TABLE ${HARNESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  const feedKeys = await redis.keys('feed:*');
  if (feedKeys.length > 0) {
    await redis.del(...feedKeys);
  }

  const contentRuleKeys = await redis.keys('content_rules:*');
  if (contentRuleKeys.length > 0) {
    await redis.del(...contentRuleKeys);
  }
}

async function fetchScoreRowCount(db: CampaignDb, epochId: number): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM post_scores WHERE epoch_id = $1`,
    [epochId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function fetchRedisFeedCount(redis: CampaignRedis): Promise<number | null> {
  const rawCount = await redis.get('feed:count');
  if (rawCount === null) {
    return null;
  }
  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid Redis feed:count value: ${rawCount}`);
  }
  return count;
}

async function writeSummary(artifactsDir: string, summary: CampaignSummary): Promise<string> {
  await mkdir(artifactsDir, { recursive: true });
  const summaryPath = path.join(artifactsDir, 'campaign-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summaryPath;
}

function serializeCampaignError(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map((nested) => serializeCampaignError(nested)).join('; ')}`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

async function runCampaign(options: CliOptions): Promise<void> {
  const stages = selectCampaignStages({
    onlyStageId: options.onlyStageId,
    maxStageId: options.maxStageId,
  });

  if (options.dryRun) {
    await writeStdout(`${JSON.stringify(campaignManifest(stages, new Date().toISOString()), null, 2)}\n`);
    return;
  }

  const startedAtMs = Date.now();
  const runs: CampaignRunReceipt[] = [];
  let target: CampaignTarget | null = null;
  let dbClient: CampaignDb | null = null;
  let redisClient: CampaignRedis | null = null;
  let primaryError: unknown;

  try {
    target = await buildCampaignTarget(options);
    process.env.DATABASE_URL = target.databaseUrl;
    process.env.REDIS_URL = target.redisUrl;
    ensureHarnessPlaceholderEnv();
    assertEphemeralTarget(target.databaseUrl, target.redisUrl);

    const dbModule = await import('../src/db/client.js');
    dbClient = dbModule.db;
    const redisModule = await import('../src/db/redis.js');
    redisClient = redisModule.redis;
    const harnessModule = await import('../src/harness/index.js');
    const { db } = dbModule;
    const { redis } = redisModule;
    const { runScenario, createRng, SeededClock } = harnessModule;
    const campaignClockMs = options.clockMs === null ? Date.now() : options.clockMs;

    for (const stage of stages) {
      for (const seed of stage.seeds) {
        await resetCampaignData(db, redis);
        const runStartedAtMs = Date.now();
        const scenario = scenarioForCampaignRun(stage, seed);
        const clockMs = campaignClockMs;
        const result = await runScenario(scenario, {
          deps: {
            rng: createRng(seed),
            clock: new SeededClock(clockMs),
            db,
            databaseUrl: target.databaseUrl,
            redisUrl: target.redisUrl,
            pipelineStepTimeoutMs: PIPELINE_STEP_TIMEOUT_MS,
          },
          artifactsDir: options.artifactsDir,
        });
        const scoreRowCount = await fetchScoreRowCount(db, result.metrics.scoring.epochId);
        if (scoreRowCount < 1) {
          throw new Error(
            `campaign run produced zero score rows: stage=${stage.id} seed=${seed} epoch=${result.metrics.scoring.epochId} clockMs=${clockMs}`
          );
        }
        const redisFeedCount = await fetchRedisFeedCount(redis);

        runs.push({
          stageId: stage.id,
          label: stage.label,
          seed,
          subscriberCount: stage.subscriberCount,
          postCount: stage.postCount,
          expectation: stage.expectation,
          durationMs: Date.now() - runStartedAtMs,
          scoreRowCount,
          redisFeedCount,
          topPostsFetched: result.metrics.scoring.topPosts.length,
          voteCount: result.metrics.population.voteCount,
          artifactJsonPath: result.artifactPaths?.jsonPath ?? null,
          artifactCsvPath: result.artifactPaths?.csvPath ?? null,
        });
      }
    }
  } catch (err) {
    primaryError = err;
  }

  const cleanupFailureReasons: unknown[] = [];
  if (dbClient !== null) {
    try {
      await dbClient.end();
    } catch (cleanupFailure: unknown) {
      cleanupFailureReasons.push(cleanupFailure);
    }
  }
  if (redisClient !== null) {
    try {
      redisClient.disconnect();
    } catch (cleanupFailure: unknown) {
      cleanupFailureReasons.push(cleanupFailure);
    }
  }
  if (target !== null) {
    try {
      await target.stop();
    } catch (cleanupFailure: unknown) {
      cleanupFailureReasons.push(cleanupFailure);
    }
  }
  const cleanupError =
    cleanupFailureReasons.length === 0
      ? undefined
      : new AggregateError(
          cleanupFailureReasons,
          'Failed to clean up one or more simulation campaign resources'
        );

  const finalError =
    primaryError !== undefined && cleanupError !== undefined
      ? new AggregateError(
          [primaryError, cleanupError],
          'Simulation campaign failed and cleanup also failed'
        )
      : primaryError !== undefined
        ? primaryError
        : cleanupError;

  const summary: CampaignSummary = {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    status: finalError === undefined ? 'passed' : 'failed',
    error: finalError === undefined ? null : serializeCampaignError(finalError),
    totalRuns: totalCampaignRuns(stages),
    runs,
  };

  const summaryPath = await writeSummary(options.artifactsDir, summary);
  await writeStdout(`${JSON.stringify({ ...summary, summaryPath }, null, 2)}\n`);

  if (finalError !== undefined) {
    throw finalError;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runCampaign(options);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    await writeStderr(`${message}\n`);
    process.exit(1);
  });
