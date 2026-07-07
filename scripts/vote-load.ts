/**
 * Real HTTP governance voting load harness.
 *
 * Starts the full Fastify server against an ephemeral or guarded local target,
 * seeds Redis governance sessions and subscriber rows, POSTs to the real
 * /api/governance/vote route, and reconciles PostgreSQL state.
 */

import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { runHttpLoad, type HttpLoadRequest, type HttpLoadResult } from './http-load.js';
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
  validRequests: number;
  users: number;
  connections: number;
  artifactsRoot: string;
}

interface VoteTarget {
  databaseUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

interface VoteDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

interface VoteRedis {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  disconnect(): void;
}

interface FastifyAddress {
  port: number;
}

interface VoteApp {
  close(): Promise<void>;
  listen(options: { host: string; port: number }): Promise<string>;
  server: {
    address(): string | FastifyAddress | null;
  };
}

interface VoteReconciliation {
  epochId: number;
  subscriberRows: number;
  voteRows: number;
  distinctVoters: number;
  auditRows: number;
  voteCastRows: number;
  voteUpdatedRows: number;
  longTableRows: number;
  expectedVoteRows: number;
  expectedAuditRows: number;
  expectedLongTableRows: number;
}

interface RateLimitSummary {
  requests: number;
  accepted: number;
  rateLimited: number;
  unexpectedStatuses: Record<string, number>;
  statusCodes: Record<string, number>;
  voteRowsForDid: number;
  auditRowsForDid: number;
  aggregateVoteRows: number;
  aggregateAuditRows: number;
  aggregateLongTableRows: number;
  expectedAggregateVoteRows: number;
  expectedAggregateAuditRows: number;
  expectedAggregateLongTableRows: number;
}

interface VoteLoadSummary {
  userCount: number;
  validRequests: number;
  connections: number;
  validLoad: HttpLoadResult | null;
  reconciliation: VoteReconciliation | null;
  rateLimit: RateLimitSummary | null;
  cleanupFailures: string[];
  error: string | null;
  passed: boolean;
  thresholds: Record<string, unknown>;
}

const ISSUE_KEY = 'PROJ-1551';
const DEFAULT_VALID_REQUESTS = 8000;
const DEFAULT_USERS = 500;
const DEFAULT_CONNECTIONS = 100;
const MAX_VALID_REQUESTS = 100_000;
const MAX_USERS = 10_000;
const MAX_CONNECTIONS = 1_000;
const DEFAULT_ARTIFACTS_ROOT = 'artifacts/lab';
const SESSION_TTL_SECONDS = 3600;
const DB_POOL_HEADROOM = 10;
const MIN_DB_POOL_MAX = 50;
const EPHEMERAL_POSTGRES_RESERVED_CONNECTIONS = 20;
const RATE_LIMIT_REQUESTS = 25;
const RATE_LIMIT_ACCEPTED = 20;
const BOOLEAN_FLAGS = new Set(['--dry-run', '--ephemeral']);
const VALUE_FLAGS = new Set(['--valid-requests', '--users', '--connections', '--artifacts-root']);

const RESET_TABLES = [
  'governance_vote_weights',
  'governance_epoch_weights',
  'governance_votes',
  'governance_audit_log',
  'governance_epochs',
  'subscribers',
  'topic_catalog',
  'approved_participants',
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
      const nextArg = args[index + 1];
      if (nextArg === undefined || nextArg.startsWith('--')) {
        throw new RangeError(`${flag} requires a value`);
      }
      index += 1;
      continue;
    }

    throw new RangeError(`Unknown argument ${arg}`);
  }
}

function maxForFlag(flagName: string): number {
  if (flagName === '--valid-requests') {
    return MAX_VALID_REQUESTS;
  }
  if (flagName === '--users') {
    return MAX_USERS;
  }
  if (flagName === '--connections') {
    return MAX_CONNECTIONS;
  }
  return Number.MAX_SAFE_INTEGER;
}

function parsePositiveIntegerFlag(raw: string | null, fallback: number, flagName: string): number {
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${flagName} must be a positive integer; received ${raw}`);
  }
  const max = maxForFlag(flagName);
  if (parsed > max) {
    throw new RangeError(`${flagName} must be <= ${max}; received ${raw}`);
  }
  return parsed;
}

function parseArgs(args: readonly string[]): CliOptions {
  validateArgs(args);
  const artifactsRoot = readFlagValue(args, '--artifacts-root');
  const validRequests = parsePositiveIntegerFlag(
    readFlagValue(args, '--valid-requests'),
    DEFAULT_VALID_REQUESTS,
    '--valid-requests'
  );
  const users = parsePositiveIntegerFlag(readFlagValue(args, '--users'), DEFAULT_USERS, '--users');
  const connections = parsePositiveIntegerFlag(
    readFlagValue(args, '--connections'),
    DEFAULT_CONNECTIONS,
    '--connections'
  );
  if (users > validRequests) {
    throw new RangeError(
      `users must be less than or equal to validRequests; received users=${users}, validRequests=${validRequests}`
    );
  }
  if (Math.ceil(validRequests / users) > RATE_LIMIT_ACCEPTED) {
    throw new RangeError(
      `valid phase would exceed per-DID vote limit: validRequests=${validRequests}, users=${users}, max per user=${Math.ceil(validRequests / users)}, limit=${RATE_LIMIT_ACCEPTED}`
    );
  }
  if (connections > validRequests) {
    throw new RangeError(
      `connections must be less than or equal to validRequests; received connections=${connections}, validRequests=${validRequests}`
    );
  }
  return {
    dryRun: args.includes('--dry-run'),
    ephemeral: args.includes('--ephemeral'),
    validRequests,
    users,
    connections,
    artifactsRoot: artifactsRoot === null ? DEFAULT_ARTIFACTS_ROOT : artifactsRoot,
  };
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

function dbPoolMaxForVoteLoad(connections: number): number {
  return Math.max(MIN_DB_POOL_MAX, connections + DB_POOL_HEADROOM);
}

function setLabConfigDefaults(databaseUrl: string, redisUrl: string, options: CliOptions): void {
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
  process.env.FEED_PRIVATE_MODE = 'false';
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_GLOBAL_MAX = String(options.validRequests + RATE_LIMIT_REQUESTS + 1000);
  process.env.RATE_LIMIT_GLOBAL_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_VOTE_MAX = String(RATE_LIMIT_ACCEPTED);
  process.env.RATE_LIMIT_VOTE_WINDOW_MS = '60000';
  process.env.DB_POOL_MAX = String(dbPoolMaxForVoteLoad(options.connections));
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
      'Failed to stop one or more vote-load containers'
    );
  }
}

async function startTarget(options: CliOptions): Promise<VoteTarget> {
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
      const maxConnections = dbPoolMaxForVoteLoad(options.connections) + EPHEMERAL_POSTGRES_RESERVED_CONNECTIONS;
      pg = await new PostgreSqlContainer('postgres:16-alpine')
        .withCommand(['postgres', '-c', `max_connections=${maxConnections}`])
        .start();
      redis = await new RedisContainer('redis:7-alpine').start();
      const databaseUrl = normalizePostgresUrl(pg.getConnectionUri());
      const redisUrl = redis.getConnectionUrl();
      setLabConfigDefaults(databaseUrl, redisUrl, options);
      await runMigrations(databaseUrl);
      return {
        databaseUrl,
        redisUrl,
        stop: async () => stopContainers(pg, redis),
      };
    } catch (error: unknown) {
      await stopContainers(pg, redis);
      if (error instanceof Error) {
        throw new Error(`failed to start ephemeral vote target: ${error.message}`);
      }
      throw new Error('failed to start ephemeral vote target: non-Error thrown');
    }
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const redisUrl = requiredEnv('REDIS_URL');
  setLabConfigDefaults(databaseUrl, redisUrl, options);
  return {
    databaseUrl,
    redisUrl,
    stop: async () => undefined,
  };
}

async function resetVoteTables(db: VoteDb): Promise<void> {
  await db.query(`TRUNCATE TABLE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

async function seedVotingEpoch(db: VoteDb): Promise<number> {
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
     VALUES ('active', 'voting', 0.2, 0.3, 0.2, 0.15, 0.15, 0, 'PROJ-1551 vote load seed', '{"software-development": 0.5, "community-governance": 0.3, "local-news": 0.2}'::jsonb)
     RETURNING id`
  );
  const row = epoch.rows[0];
  if (row === undefined) {
    throw new Error('failed to seed voting epoch: INSERT returned no id');
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
       ('software-development', 'Software Development', 'Synthetic voting topic', ARRAY['software', 'code'], ARRAY['feed'], ARRAY[]::text[], TRUE),
       ('community-governance', 'Community Governance', 'Synthetic voting topic', ARRAY['community', 'governance'], ARRAY['moderation'], ARRAY[]::text[], TRUE),
       ('local-news', 'Local News', 'Synthetic voting topic', ARRAY['local', 'news'], ARRAY['community'], ARRAY[]::text[], TRUE)`
  );

  return row.id;
}

async function seedUsers(db: VoteDb, redis: VoteRedis, userCount: number): Promise<void> {
  const subscriberValues: string[] = [];
  const subscriberParams: string[] = [];
  for (let index = 0; index < userCount; index += 1) {
    const did = `did:plc:corgi-vote-user-${index}`;
    subscriberParams.push(did);
    subscriberValues.push(`($${subscriberParams.length}, TRUE)`);
    const token = `vote-session-${index}`;
    await redis.set(
      `gov:session:${token}`,
      JSON.stringify({
        did,
        handle: `corgi-vote-user-${index}.test`,
        expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
      }),
      'EX',
      SESSION_TTL_SECONDS
    );
  }

  await db.query(
    `INSERT INTO subscribers (did, is_active)
     VALUES ${subscriberValues.join(', ')}
     ON CONFLICT (did) DO UPDATE SET is_active = TRUE, last_seen = NOW()`,
    subscriberParams
  );
}

async function seedSingleUser(db: VoteDb, redis: VoteRedis, did: string, token: string): Promise<void> {
  await db.query(
    `INSERT INTO subscribers (did, is_active)
     VALUES ($1, TRUE)
     ON CONFLICT (did) DO UPDATE SET is_active = TRUE, last_seen = NOW()`,
    [did]
  );
  await redis.set(
    `gov:session:${token}`,
    JSON.stringify({
      did,
      handle: `${did.replace('did:plc:', '')}.test`,
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    }),
    'EX',
    SESSION_TTL_SECONDS
  );
}

function requestBodyForIndex(index: number): string {
  const persona = index % 3;
  const topicWeights =
    persona === 0
      ? { 'software-development': 0.7, 'community-governance': 0.2, 'local-news': 0.1 }
      : persona === 1
        ? { 'software-development': 0.2, 'community-governance': 0.6, 'local-news': 0.2 }
        : { 'software-development': 0.2, 'community-governance': 0.2, 'local-news': 0.6 };

  return JSON.stringify({
    recency_weight: persona === 0 ? 0.25 : 0.2,
    engagement_weight: persona === 1 ? 0.35 : 0.3,
    bridging_weight: 0.2,
    source_diversity_weight: persona === 2 ? 0.2 : 0.15,
    relevance_weight: 0.1,
    include_keywords: persona === 0 ? ['software', 'feed'] : persona === 1 ? ['community', 'governance'] : ['local', 'news'],
    exclude_keywords: persona === 2 ? ['spam'] : [],
    topic_weights: topicWeights,
  });
}

function buildValidRequests(validRequests: number, userCount: number): HttpLoadRequest[] {
  const requests: HttpLoadRequest[] = [];
  for (let index = 0; index < validRequests; index += 1) {
    const userIndex = index % userCount;
    requests.push({
      method: 'POST',
      path: '/api/governance/vote',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer vote-session-${userIndex}`,
      },
      body: requestBodyForIndex(index),
      expectedStatuses: [200],
    });
  }
  return requests;
}

async function readReconciliation(db: VoteDb, epochId: number, expectedVoteRows: number, expectedAuditRows: number): Promise<VoteReconciliation> {
  const result = await db.query<VoteReconciliation>(
    `SELECT
       $1::int AS "epochId",
       (SELECT COUNT(*)::int FROM subscribers WHERE is_active = TRUE) AS "subscriberRows",
       (SELECT COUNT(*)::int FROM governance_votes WHERE epoch_id = $1) AS "voteRows",
       (SELECT COUNT(DISTINCT voter_did)::int FROM governance_votes WHERE epoch_id = $1) AS "distinctVoters",
       (SELECT COUNT(*)::int FROM governance_audit_log WHERE epoch_id = $1 AND action IN ('vote_cast', 'vote_updated')) AS "auditRows",
       (SELECT COUNT(*)::int FROM governance_audit_log WHERE epoch_id = $1 AND action = 'vote_cast') AS "voteCastRows",
       (SELECT COUNT(*)::int FROM governance_audit_log WHERE epoch_id = $1 AND action = 'vote_updated') AS "voteUpdatedRows",
       (SELECT COUNT(*)::int FROM governance_vote_weights gvw JOIN governance_votes gv ON gv.id = gvw.vote_id WHERE gv.epoch_id = $1) AS "longTableRows",
       $2::int AS "expectedVoteRows",
       $3::int AS "expectedAuditRows",
       ($2::int * 5) AS "expectedLongTableRows"`,
    [epochId, expectedVoteRows, expectedAuditRows]
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('vote reconciliation query returned no rows');
  }
  return row;
}

async function runRateLimitPhase(
  baseUrl: string,
  db: VoteDb,
  redis: VoteRedis,
  epochId: number,
  validReconciliation: VoteReconciliation
): Promise<RateLimitSummary> {
  const did = 'did:plc:corgi-vote-rate-limit-user';
  const token = 'vote-session-rate-limit';
  await seedSingleUser(db, redis, did, token);
  const statusCodes: Record<string, number> = {};
  const unexpectedStatuses: Record<string, number> = {};

  for (let index = 0; index < RATE_LIMIT_REQUESTS; index += 1) {
    const response = await fetch(`${baseUrl}/api/governance/vote`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: requestBodyForIndex(index),
    });
    const key = String(response.status);
    statusCodes[key] = (statusCodes[key] ?? 0) + 1;
    if (response.status !== 200 && response.status !== 429) {
      unexpectedStatuses[key] = (unexpectedStatuses[key] ?? 0) + 1;
    }
    await response.arrayBuffer();
  }

  const reconciliation = await db.query<{
    voteRowsForDid: number;
    auditRowsForDid: number;
    aggregateVoteRows: number;
    aggregateAuditRows: number;
    aggregateLongTableRows: number;
  }>(
    `SELECT
       (SELECT COUNT(*)::int FROM governance_votes WHERE voter_did = $1) AS "voteRowsForDid",
       (SELECT COUNT(*)::int FROM governance_audit_log WHERE actor_did = $1 AND action IN ('vote_cast', 'vote_updated')) AS "auditRowsForDid",
       (SELECT COUNT(*)::int FROM governance_votes WHERE epoch_id = $2) AS "aggregateVoteRows",
       (SELECT COUNT(*)::int FROM governance_audit_log WHERE epoch_id = $2 AND action IN ('vote_cast', 'vote_updated')) AS "aggregateAuditRows",
       (SELECT COUNT(*)::int FROM governance_vote_weights gvw JOIN governance_votes gv ON gv.id = gvw.vote_id WHERE gv.epoch_id = $2) AS "aggregateLongTableRows"`,
    [did, epochId]
  );
  const row = reconciliation.rows[0];
  if (row === undefined) {
    throw new Error('rate-limit reconciliation query returned no rows');
  }

  return {
    requests: RATE_LIMIT_REQUESTS,
    accepted: statusCodes['200'] ?? 0,
    rateLimited: statusCodes['429'] ?? 0,
    unexpectedStatuses,
    statusCodes,
    voteRowsForDid: row.voteRowsForDid,
    auditRowsForDid: row.auditRowsForDid,
    aggregateVoteRows: row.aggregateVoteRows,
    aggregateAuditRows: row.aggregateAuditRows,
    aggregateLongTableRows: row.aggregateLongTableRows,
    expectedAggregateVoteRows: validReconciliation.voteRows + 1,
    expectedAggregateAuditRows: validReconciliation.auditRows + RATE_LIMIT_ACCEPTED,
    expectedAggregateLongTableRows: validReconciliation.longTableRows + 5,
  };
}

function serializeCleanupError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function cleanupVoteLoad(
  app: VoteApp | null,
  dbClient: VoteDb | null,
  redisClient: VoteRedis | null,
  target: VoteTarget | null
): Promise<string[]> {
  const failures: string[] = [];
  const cleanupStep = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error: unknown) {
      failures.push(`${label}: ${serializeCleanupError(error)}`);
    }
  };

  await cleanupStep('app.close', async () => {
    if (app !== null) {
      await app.close();
    }
  });
  await cleanupStep('db.end', async () => {
    if (dbClient !== null) {
      await dbClient.end();
    }
  });
  await cleanupStep('redis.disconnect', async () => {
    redisClient?.disconnect();
  });
  await cleanupStep('target.stop', async () => {
    if (target !== null) {
      await target.stop();
    }
  });
  return failures;
}

function envAllowlist(target: VoteTarget | null): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? '',
    CORGI_SIM_ALLOW: process.env.CORGI_SIM_ALLOW ?? '',
    RATE_LIMIT_GLOBAL_MAX: process.env.RATE_LIMIT_GLOBAL_MAX ?? '',
    RATE_LIMIT_VOTE_MAX: process.env.RATE_LIMIT_VOTE_MAX ?? '',
    DB_POOL_MAX: process.env.DB_POOL_MAX ?? '',
    DB_STATEMENT_TIMEOUT: process.env.DB_STATEMENT_TIMEOUT ?? '',
    DATABASE_URL_SHA256: target === null ? '' : sha256Text(target.databaseUrl),
    REDIS_URL_SHA256: target === null ? '' : sha256Text(target.redisUrl),
  };
}

function validLoadPassed(summary: VoteLoadSummary): boolean {
  if (summary.validLoad === null || summary.reconciliation === null) {
    return false;
  }
  return (
    summary.validLoad.errors === 0 &&
    summary.validLoad.timeouts === 0 &&
    summary.validLoad.unexpectedStatuses === 0 &&
    summary.validLoad.statusBuckets.s5xx === 0 &&
    summary.validLoad.latency.p95 < 250 &&
    summary.validLoad.latency.p99 < 1000 &&
    summary.validLoad.latency.max < 5000 &&
    summary.validLoad.statusCodes['200'] === summary.validRequests &&
    summary.reconciliation.subscriberRows >= summary.userCount &&
    summary.reconciliation.voteRows === summary.reconciliation.expectedVoteRows &&
    summary.reconciliation.distinctVoters === summary.userCount &&
    summary.reconciliation.auditRows === summary.reconciliation.expectedAuditRows &&
    summary.reconciliation.longTableRows === summary.reconciliation.expectedLongTableRows
  );
}

function rateLimitPassed(summary: VoteLoadSummary): boolean {
  if (summary.rateLimit === null) {
    return false;
  }
  return (
    summary.rateLimit.accepted === RATE_LIMIT_ACCEPTED &&
    summary.rateLimit.rateLimited === RATE_LIMIT_REQUESTS - RATE_LIMIT_ACCEPTED &&
    Object.keys(summary.rateLimit.unexpectedStatuses).length === 0 &&
    summary.rateLimit.voteRowsForDid === 1 &&
    summary.rateLimit.auditRowsForDid === RATE_LIMIT_ACCEPTED &&
    summary.rateLimit.aggregateVoteRows === summary.rateLimit.expectedAggregateVoteRows &&
    summary.rateLimit.aggregateAuditRows === summary.rateLimit.expectedAggregateAuditRows &&
    summary.rateLimit.aggregateLongTableRows === summary.rateLimit.expectedAggregateLongTableRows
  );
}

function summaryPassed(summary: VoteLoadSummary): boolean {
  return validLoadPassed(summary) && rateLimitPassed(summary) && summary.cleanupFailures.length === 0;
}

function buildClaims(summaryPath: string, validLoadStatus: boolean, rateLimitStatus: boolean): LabClaim[] {
  return [
    {
      claim: 'Real HTTP governance voting accepts valid authenticated subscriber votes at load thresholds',
      status: validLoadStatus ? 'pass' : 'fail',
      evidencePaths: [summaryPath],
    },
    {
      claim: 'Per-DID vote rate limit returns 429 after the configured threshold without corrupting aggregate vote state',
      status: rateLimitStatus ? 'pass' : 'fail',
      evidencePaths: [summaryPath],
    },
  ];
}

function serializeVoteLoadError(error: unknown): string {
  if (error instanceof AggregateError) {
    return `${error.message}: ${error.errors.map((nested) => serializeVoteLoadError(nested)).join('; ')}`;
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function buildThresholds(options: CliOptions): Record<string, unknown> {
  return {
    validP95Ms: '<250',
    validP99Ms: '<1000',
    validMaxMs: '<5000',
    validErrors: 0,
    validTimeouts: 0,
    validUnexpectedStatuses: 0,
    expectedValidStatus200: options.validRequests,
    expectedVoteRows: options.users,
    expectedAuditRows: options.validRequests,
    expectedRateLimitAccepted: RATE_LIMIT_ACCEPTED,
    expectedRateLimit429: RATE_LIMIT_REQUESTS - RATE_LIMIT_ACCEPTED,
    expectedRateLimitAggregateVoteRows: options.users + 1,
    expectedRateLimitAggregateAuditRows: options.validRequests + RATE_LIMIT_ACCEPTED,
    expectedRateLimitAggregateLongTableRows: options.users * 5 + 5,
  };
}

async function runVoteLoad(options: CliOptions): Promise<void> {
  const startedAt = new Date();
  const runId = createLabRunId(startedAt);
  const runDirectory = resolveLabRunDirectory(path.resolve(options.artifactsRoot), ISSUE_KEY, runId);
  const phaseDirectory = path.join(runDirectory, 'vote-load');

  if (options.dryRun) {
    const dryRunReceipt = {
      issue: ISSUE_KEY,
      validRequests: options.validRequests,
      users: options.users,
      connections: options.connections,
      dbPoolMax: dbPoolMaxForVoteLoad(options.connections),
      runDirectory,
    };
    await ensureDirectory(phaseDirectory);
    await writeJsonArtifact(phaseDirectory, 'dry-run.json', dryRunReceipt);
    console.log(JSON.stringify(dryRunReceipt, null, 2));
    return;
  }

  const thresholds = buildThresholds(options);
  let target: VoteTarget | null = null;
  let dbClient: VoteDb | null = null;
  let redisClient: VoteRedis | null = null;
  let app: VoteApp | null = null;
  let primaryError: unknown = null;
  let validLoad: HttpLoadResult | null = null;
  let reconciliation: VoteReconciliation | null = null;
  let rateLimit: RateLimitSummary | null = null;
  let cleanupFailures: string[] = [];

  try {
    target = await startTarget(options);
    const dbModule = await import('../src/db/client.js');
    const redisModule = await import('../src/db/redis.js');
    const serverModule = await import('../src/feed/server.js');
    dbClient = dbModule.db;
    redisClient = redisModule.redis;
    await resetVoteTables(dbClient);
    const epochId = await seedVotingEpoch(dbClient);
    await seedUsers(dbClient, redisClient, options.users);

    app = await serverModule.createServer();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error(`server address was not a TCP address: ${String(address)}`);
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    validLoad = await runHttpLoad({
      baseUrl,
      amount: options.validRequests,
      durationMs: null,
      connections: options.connections,
      timeoutMs: 30_000,
      requests: buildValidRequests(options.validRequests, options.users),
    });
    reconciliation = await readReconciliation(dbClient, epochId, options.users, options.validRequests);
    rateLimit = await runRateLimitPhase(baseUrl, dbClient, redisClient, epochId, reconciliation);
  } catch (error: unknown) {
    primaryError = error;
  } finally {
    cleanupFailures = await cleanupVoteLoad(app, dbClient, redisClient, target);
  }

  const summary: VoteLoadSummary = {
    userCount: options.users,
    validRequests: options.validRequests,
    connections: options.connections,
    validLoad,
    reconciliation,
    rateLimit,
    cleanupFailures,
    error: primaryError === null ? null : serializeVoteLoadError(primaryError),
    passed: false,
    thresholds,
  };
  summary.passed = primaryError === null && summaryPassed(summary);
  const validLoadStatus = validLoadPassed(summary);
  const rateLimitStatus = rateLimitPassed(summary);

  await ensureDirectory(phaseDirectory);
  const summaryPath = await writeJsonArtifact(phaseDirectory, 'summary.json', summary);
  const summaryDescriptor = await collectArtifactDescriptor(
    runDirectory,
    summaryPath,
    'application/json',
    'scripts/vote-load.ts'
  );
  const artifacts: LabArtifactDescriptor[] = [summaryDescriptor];
  const checksumsPath = await writeChecksums(runDirectory, artifacts);
  artifacts.push(
    await collectArtifactDescriptor(runDirectory, checksumsPath, 'text/plain', 'src/harness/lab-artifacts.ts')
  );

  const endedAt = new Date();
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
    envAllowlist: envAllowlist(target),
    runtime: await collectRuntimeState(process.cwd()),
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    artifacts,
    thresholds,
    claims: buildClaims(summaryDescriptor.path, validLoadStatus, rateLimitStatus),
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
  if (summary.cleanupFailures.length > 0) {
    console.error(`vote-load cleanup had ${summary.cleanupFailures.length} failure(s)`);
  }
  if (!summary.passed) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runVoteLoad(options);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('vote load failed with non-Error thrown');
  }
  process.exit(1);
});
