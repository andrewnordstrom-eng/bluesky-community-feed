/**
 * Recorded Jetstream replay harness.
 *
 * Runs synthetic recorded-message fixtures through the same message-processing
 * path as the websocket client, then writes durable lab artifacts.
 */

import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
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

interface CliOptions {
  dryRun: boolean;
  ephemeral: boolean;
  eventCount: number;
  artifactsRoot: string;
  runScoring: boolean;
}

interface ReplayTarget {
  databaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

interface ReplayDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface ReplayRedis {
  disconnect(): void;
}

const ISSUE_KEY = 'PROJ-1551';
const DEFAULT_EVENT_COUNT = 1200;
const DEFAULT_ARTIFACTS_ROOT = 'artifacts/lab';
const BOOLEAN_FLAGS = new Set(['--dry-run', '--ephemeral', '--skip-scoring']);
const VALUE_FLAGS = new Set(['--events', '--artifacts-root']);

const RESET_TABLES = [
  'post_score_components',
  'post_scores',
  'engagement_attributions',
  'feed_requests',
  'feed_interactions',
  'likes',
  'reposts',
  'follows',
  'post_engagement',
  'posts',
  'governance_vote_weights',
  'governance_epoch_weights',
  'governance_votes',
  'governance_audit_log',
  'governance_epochs',
  'subscribers',
  'system_status',
  'topic_catalog',
  'jetstream_cursor',
] as const;

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

function parsePositiveIntegerFlag(raw: string | null, fallback: number, flagName: string): number {
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${flagName} must be a positive integer; received ${raw}`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  validateArgs(args);
  const eventCount = parsePositiveIntegerFlag(readFlagValue(args, '--events'), DEFAULT_EVENT_COUNT, '--events');
  const artifactsRoot = readFlagValue(args, '--artifacts-root');

  return {
    dryRun: args.includes('--dry-run'),
    ephemeral: args.includes('--ephemeral'),
    eventCount,
    artifactsRoot: artifactsRoot === null ? DEFAULT_ARTIFACTS_ROOT : artifactsRoot,
    runScoring: !args.includes('--skip-scoring'),
  };
}

function normalizePostgresUrl(url: string): string {
  return url.replace(/^postgres:\/\//, 'postgresql://');
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
  process.env.TOPIC_EMBEDDING_ENABLED = 'false';
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Use --ephemeral for throwaway local containers.`);
  }
  return value;
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
      'Failed to stop one or more Jetstream replay containers'
    );
  }
}

async function startTarget(options: CliOptions): Promise<ReplayTarget> {
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
      await stopContainers(pg, redis);
      if (error instanceof Error) {
        throw new Error(`failed to start ephemeral replay target: ${error.message}`);
      }
      throw new Error('failed to start ephemeral replay target: non-Error thrown');
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

async function resetReplayTables(db: ReplayDb): Promise<void> {
  await db.query(`TRUNCATE TABLE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

async function seedReplayEpoch(db: ReplayDb): Promise<void> {
  const epoch = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
       status,
       phase,
       recency_weight,
       engagement_weight,
       bridging_weight,
       source_diversity_weight,
       relevance_weight,
       vote_count,
       description,
       topic_weights
     )
     VALUES ('active', 'running', 0.2, 0.3, 0.2, 0.15, 0.15, 0, 'PROJ-1551 jetstream replay seed', '{"software-development": 0.6, "community-governance": 0.4}'::jsonb)
     RETURNING id`
  );
  const row = epoch.rows[0];
  if (row === undefined) {
    throw new Error('failed to seed replay epoch: INSERT returned no id');
  }

  await db.query(
    `INSERT INTO governance_epoch_weights (epoch_id, component_key, weight)
     VALUES
       ($1, 'recency_weight', 0.2),
       ($1, 'engagement_weight', 0.3),
       ($1, 'bridging_weight', 0.2),
       ($1, 'source_diversity_weight', 0.15),
       ($1, 'relevance_weight', 0.15)`,
    [row.id]
  );

  await db.query(
    `INSERT INTO topic_catalog (slug, name, description, terms, context_terms, anti_terms, is_active)
     VALUES
       ('software-development', 'Software Development', 'Synthetic replay topic', ARRAY['software', 'code', 'feed'], ARRAY['governance'], ARRAY[]::text[], TRUE),
       ('community-governance', 'Community Governance', 'Synthetic replay topic', ARRAY['community', 'governance', 'moderation'], ARRAY['feed'], ARRAY[]::text[], TRUE)`
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

function replayPassed(summary: { droppedEvents: number; handlerErrors: number; stateMismatches: number; outcomeMismatches: number }): boolean {
  return (
    summary.droppedEvents === 0 &&
    summary.handlerErrors === 0 &&
    summary.stateMismatches === 0 &&
    summary.outcomeMismatches === 0
  );
}

function scoringStatus(
  summary: { scoringDelayMs: number | null; scoreRows: number | null },
  scoringEnabled: boolean
): LabClaim['status'] {
  if (!scoringEnabled) {
    return 'not-run';
  }
  if (summary.scoringDelayMs === null) {
    return 'fail';
  }
  return summary.scoreRows !== null && summary.scoreRows > 0 ? 'pass' : 'fail';
}

function buildClaims(summaryPath: string, replayStatus: boolean, scoringClaimStatus: LabClaim['status']): LabClaim[] {
  return [
    {
      claim: 'Jetstream replay processed without queue drops, handler errors, or state mismatches',
      status: replayStatus ? 'pass' : 'fail',
      evidencePaths: [summaryPath],
    },
    {
      claim: 'Scoring delay measured after replay',
      status: scoringClaimStatus,
      evidencePaths: [summaryPath],
    },
  ];
}

async function runReplay(options: CliOptions): Promise<void> {
  const startedAt = new Date();
  const runId = createLabRunId(startedAt);
  const runDirectory = resolveLabRunDirectory(path.resolve(options.artifactsRoot), ISSUE_KEY, runId);
  const phaseDirectory = path.join(runDirectory, 'jetstream-replay');

  if (options.dryRun) {
    const dryRunReceipt = {
      issue: ISSUE_KEY,
      eventCount: options.eventCount,
      runScoring: options.runScoring,
      runDirectory,
    };
    await ensureDirectory(phaseDirectory);
    await writeJsonArtifact(phaseDirectory, 'dry-run.json', dryRunReceipt);
    console.log(JSON.stringify(dryRunReceipt, null, 2));
    return;
  }

  const target = await startTarget(options);
  let dbClient: ReplayDb | null = null;
  let redisClient: ReplayRedis | null = null;
  try {
    const dbModule = await import('../src/db/client.js');
    const redisModule = await import('../src/db/redis.js');
    const replayModule = await import('../src/harness/jetstream-replay.js');
    const runScoring = options.runScoring
      ? (await import('../src/scoring/pipeline.js')).runScoringPipeline
      : null;
    dbClient = dbModule.db;
    redisClient = redisModule.redis;
    await resetReplayTables(dbClient);
    await seedReplayEpoch(dbClient);
    await ensureDirectory(phaseDirectory);

    const summary = await replayModule.runJetstreamReplay({
      db: dbClient,
      eventCount: options.eventCount,
      startCursorUs: 1_800_000_000_000_000,
      runScoring,
    });
    const summaryPath = await writeJsonArtifact(phaseDirectory, 'summary.json', summary);
    const summaryDescriptor = await collectArtifactDescriptor(
      runDirectory,
      summaryPath,
      'application/json',
      'scripts/jetstream-replay.ts'
    );

    const artifacts: LabArtifactDescriptor[] = [summaryDescriptor];
    const checksumsPath = await writeChecksums(runDirectory, artifacts);
    artifacts.push(
      await collectArtifactDescriptor(runDirectory, checksumsPath, 'text/plain', 'src/harness/lab-artifacts.ts')
    );

    const replayStatus = replayPassed(summary);
    const scoringClaimStatus = scoringStatus(summary, options.runScoring);
    const passed = replayStatus && scoringClaimStatus !== 'fail';
    const endedAt = new Date();
    const manifest: LabManifest = {
      schemaVersion: '1.0.0',
      issue: ISSUE_KEY,
      branch: await collectGitBranch(process.cwd()),
      git: await collectGitState(process.cwd(), 'origin/main'),
      command: {
        argv: process.argv,
        cwd: process.cwd(),
        exitCode: passed ? 0 : 1,
        stdoutPath: null,
        stderrPath: null,
      },
      envAllowlist: envAllowlist(target.databaseUrl, target.redisUrl),
      runtime: await collectRuntimeState(process.cwd()),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      artifacts,
      thresholds: {
        droppedEvents: 0,
        handlerErrors: 0,
        stateMismatches: 0,
        outcomeMismatches: 0,
        scoringRowsWhenScoringEnabled: '>0',
      },
      claims: buildClaims(summaryDescriptor.path, replayStatus, scoringClaimStatus),
    };
    const manifestPath = await writeLabManifest(runDirectory, manifest);
    console.log(
      JSON.stringify(
        {
          passed,
          manifestPath,
          summaryPath,
          summary,
        },
        null,
        2
      )
    );

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    const cleanupResults = await Promise.allSettled([
      dbClient === null ? Promise.resolve() : dbClient.end(),
      Promise.resolve().then(() => {
        redisClient?.disconnect();
      }),
      target.stop(),
    ]);
    const cleanupFailures = cleanupResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (cleanupFailures.length > 0) {
      console.error(`jetstream replay cleanup had ${cleanupFailures.length} failure(s)`);
      process.exitCode = 1;
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runReplay(options);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('jetstream replay failed with non-Error thrown');
  }
  process.exit(1);
});
