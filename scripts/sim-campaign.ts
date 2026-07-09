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
  SIMULATED_EPOCH_CAMPAIGN,
  campaignManifest,
  collectArtifactDescriptor,
  collectGitBranch,
  collectGitStateWithDefaultBase,
  collectRuntimeState,
  requireCampaignRunsForSelection,
  selectCampaignStages,
  scenarioForCampaignRun,
  sha256Text,
  writeChecksums,
  writeCampaignAnalysisArtifacts,
  writeLabManifest,
  type CampaignFeedImpactReceipt,
  type CampaignRunReceipt,
  type CampaignSummary,
  type CampaignStageId,
  type LabArtifactDescriptor,
  type LabClaim,
  type LabManifest,
  type WrittenCampaignAnalysisPaths,
} from '../src/harness/index.js';

interface CliOptions {
  dryRun: boolean;
  ephemeral: boolean;
  onlyStageId: string | null;
  maxStageId: string | null;
  onlyFamilyId: string | null;
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

const DEFAULT_ARTIFACTS_DIR = 'artifacts/sim-campaign';
const ISSUE_KEY = 'PROJ-1551';
const PIPELINE_STEP_TIMEOUT_MS = 240_000;
const FEED_IMPACT_SEED = 90210;
const FEED_IMPACT_TOP_K = 50;
const FEED_IMPACT_TAIL_THRESHOLD = 0.15;
const BOOLEAN_FLAGS = new Set(['--dry-run', '--ephemeral']);
const VALUE_FLAGS = new Set(['--stage', '--max-stage', '--family', '--artifacts-dir', '--clock-ms']);

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
  const family = readFlagValue(args, '--family');
  const artifactsDir = readFlagValue(args, '--artifacts-dir');
  const clockMs = readFlagValue(args, '--clock-ms');

  return {
    dryRun: args.includes('--dry-run'),
    ephemeral: args.includes('--ephemeral'),
    onlyStageId: stage,
    maxStageId: maxStage,
    onlyFamilyId: family,
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

function envAllowlist(target: CampaignTarget | null): Record<string, string> {
  return {
    NODE_ENV: process.env.NODE_ENV ?? '',
    LOG_LEVEL: process.env.LOG_LEVEL ?? '',
    CORGI_SIM_ALLOW: process.env.CORGI_SIM_ALLOW ?? '',
    TOPIC_EMBEDDING_ENABLED: process.env.TOPIC_EMBEDDING_ENABLED ?? '',
    DATABASE_URL_SHA256: target === null ? '' : sha256Text(target.databaseUrl),
    REDIS_URL_SHA256: target === null ? '' : sha256Text(target.redisUrl),
  };
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

function shouldRunFeedImpactPass(options: CliOptions, stageIds: readonly CampaignStageId[]): boolean {
  const familyAllowsFeedImpact = options.onlyFamilyId === null || options.onlyFamilyId === 'baseline';
  return familyAllowsFeedImpact && stageIds.includes('S2');
}

function s2StageForFeedImpact() {
  const stage = SIMULATED_EPOCH_CAMPAIGN.find((candidate) => candidate.id === 'S2');
  if (stage === undefined) {
    throw new Error('S2 stage is required for the feed-impact baseline comparison but is not configured');
  }
  return stage;
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

function combineCampaignAndArtifactError(campaignError: unknown | undefined, artifactError: unknown): unknown {
  if (campaignError === undefined) {
    return artifactError;
  }
  return new AggregateError(
    [campaignError, artifactError],
    'Simulation campaign failed and artifact/manifest writing also failed'
  );
}

function mediaTypeForArtifactPath(artifactPath: string): string {
  if (artifactPath.endsWith('.json')) {
    return 'application/json';
  }
  if (artifactPath.endsWith('.csv')) {
    return 'text/csv';
  }
  if (artifactPath.endsWith('.md')) {
    return 'text/markdown';
  }
  if (artifactPath.endsWith('.sha256')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}

function artifactPathsForCampaignSummary(
  summaryPath: string,
  analysisPaths: WrittenCampaignAnalysisPaths,
  summary: CampaignSummary
): string[] {
  const artifactPaths = [
    summaryPath,
    analysisPaths.runCsvPath,
    analysisPaths.aggregateCsvPath,
    analysisPaths.paperNotesPath,
    summary.feedImpact?.summaryCsvPath ?? null,
    summary.feedImpact?.pairwiseCsvPath ?? null,
    ...summary.runs.flatMap((run) => [
      run.artifactJsonPath,
      run.artifactCsvPath,
      run.epochSeriesCsvPath,
      run.auditLogJsonPath,
    ]),
  ];
  const uniquePaths = new Set<string>();
  for (const artifactPath of artifactPaths) {
    if (artifactPath !== null) {
      uniquePaths.add(artifactPath);
    }
  }
  return [...uniquePaths].sort();
}

async function collectCampaignArtifacts(
  artifactsDir: string,
  summaryPath: string,
  analysisPaths: WrittenCampaignAnalysisPaths,
  summary: CampaignSummary
): Promise<LabArtifactDescriptor[]> {
  const descriptors: LabArtifactDescriptor[] = [];
  for (const artifactPath of artifactPathsForCampaignSummary(summaryPath, analysisPaths, summary)) {
    descriptors.push(
      await collectArtifactDescriptor(
        artifactsDir,
        artifactPath,
        mediaTypeForArtifactPath(artifactPath),
        'scripts/sim-campaign.ts'
      )
    );
  }
  return descriptors;
}

function evidenceStatusForRuns(
  summary: CampaignSummary,
  predicate: (run: CampaignRunReceipt) => boolean
): 'pass' | 'fail' | 'not-run' {
  const matchingRuns = summary.runs.filter(predicate);
  if (matchingRuns.length === 0) {
    return 'not-run';
  }
  if (summary.status !== 'passed') {
    return 'fail';
  }
  return matchingRuns.every((run) => run.scoreRowCount > 0 && run.topPostsFetched > 0) ? 'pass' : 'fail';
}

function evidenceStatusForRequiredValues(
  summary: CampaignSummary,
  predicate: (run: CampaignRunReceipt) => boolean,
  valueForRun: (run: CampaignRunReceipt) => string,
  requiredValues: readonly string[]
): 'pass' | 'fail' | 'not-run' {
  const matchingRuns = summary.runs.filter(predicate);
  const coveredValues = new Set(matchingRuns.map(valueForRun));
  const hasRequiredCoverage = requiredValues.every((requiredValue) => coveredValues.has(requiredValue));
  if (!hasRequiredCoverage) {
    return summary.status === 'failed' && matchingRuns.length > 0 ? 'fail' : 'not-run';
  }
  return evidenceStatusForRuns(summary, predicate);
}

function claimWithOptionalEvidence(
  claim: string,
  status: 'pass' | 'fail' | 'not-run',
  evidencePath: string
): LabClaim {
  if (status === 'not-run') {
    return { claim, status };
  }
  return { claim, status, evidencePaths: [evidencePath] };
}

function buildCampaignClaims(summary: CampaignSummary, summaryArtifactPath: string): LabClaim[] {
  const baselineS0ToS3Status = evidenceStatusForRequiredValues(
    summary,
    (run) =>
      run.familyId === 'baseline' &&
      run.expectation === 'gate' &&
      ['S0', 'S1', 'S2', 'S3'].includes(run.stageId),
    (run) => run.stageId,
    ['S0', 'S1', 'S2', 'S3']
  );
  const democraticSweepStatus = evidenceStatusForRequiredValues(
    summary,
    (run) =>
      run.stageId === 'S2' &&
      ['turnout', 'trim-threshold', 'persona-skew', 'polarization'].includes(run.familyId),
    (run) => run.familyId,
    ['turnout', 'trim-threshold', 'persona-skew', 'polarization']
  );
  const capacityStatus = evidenceStatusForRuns(
    summary,
    (run) => run.familyId === 'baseline' && run.expectation === 'capacity'
  );
  const feedImpactStatus =
    summary.feedImpact === null ? 'not-run' : summary.status === 'passed' ? 'pass' : 'fail';

  return [
    {
      claim: 'Simulation campaign generated the requested scenario runs without zero-score feed outputs',
      status: summary.status === 'passed' ? 'pass' : 'fail',
      evidencePaths: [summaryArtifactPath],
    },
    claimWithOptionalEvidence(
      'Baseline S0-S3 gate runs completed as paper-core correctness evidence',
      baselineS0ToS3Status,
      summaryArtifactPath
    ),
    claimWithOptionalEvidence(
      'Democratic-process S2 sweeps completed across turnout, trim-threshold, persona-skew, and polarization families',
      democraticSweepStatus,
      summaryArtifactPath
    ),
    claimWithOptionalEvidence(
      'Capacity baseline stages completed as implementation-scale evidence only',
      capacityStatus,
      summaryArtifactPath
    ),
    claimWithOptionalEvidence(
      'Feed-impact comparison produced default, engagement-only, and community-governed ranking churn metrics',
      feedImpactStatus,
      summaryArtifactPath
    ),
  ];
}

function buildCampaignThresholds(options: CliOptions): Record<string, unknown> {
  return {
    pipelineStepTimeoutMs: PIPELINE_STEP_TIMEOUT_MS,
    minimumScoreRowsPerRun: 1,
    feedImpactSeed: FEED_IMPACT_SEED,
    feedImpactTopK: FEED_IMPACT_TOP_K,
    feedImpactTailThreshold: FEED_IMPACT_TAIL_THRESHOLD,
    onlyStageId: options.onlyStageId,
    maxStageId: options.maxStageId,
    onlyFamilyId: options.onlyFamilyId,
    ephemeral: options.ephemeral,
  };
}

async function runCampaign(options: CliOptions): Promise<void> {
  const stages = selectCampaignStages({
    onlyStageId: options.onlyStageId,
    maxStageId: options.maxStageId,
    onlyFamilyId: options.onlyFamilyId,
  });
  const campaignRuns = requireCampaignRunsForSelection(stages, { onlyFamilyId: options.onlyFamilyId });

  if (options.dryRun) {
    await writeStdout(
      `${JSON.stringify(campaignManifest(stages, new Date().toISOString(), { onlyFamilyId: options.onlyFamilyId }), null, 2)}\n`
    );
    return;
  }

  const startedAtMs = Date.now();
  const runs: CampaignRunReceipt[] = [];
  let target: CampaignTarget | null = null;
  let dbClient: CampaignDb | null = null;
  let redisClient: CampaignRedis | null = null;
  let feedImpact: CampaignFeedImpactReceipt | null = null;
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
    const {
      buildBaselineComparisonArtifactRows: buildRows,
      createRng,
      feedImpactReceipt: createFeedImpactReceipt,
      runBaselineComparison,
      runScenario,
      SeededClock,
      writeBaselineComparisonArtifacts: writeFeedImpactArtifacts,
    } = harnessModule;
    const campaignClockMs = options.clockMs === null ? Date.now() : options.clockMs;

    for (const run of campaignRuns) {
      await resetCampaignData(db, redis);
      const runStartedAtMs = Date.now();
      const clockMs = campaignClockMs;
      const scenarioArtifactsDir = path.join(
        options.artifactsDir,
        'runs',
        run.stageId,
        run.familyId,
        run.variantId,
        `seed-${run.seed}`
      );
      const result = await runScenario(run.scenario, {
        deps: {
          rng: createRng(run.seed),
          clock: new SeededClock(clockMs),
          db,
          databaseUrl: target.databaseUrl,
          redisUrl: target.redisUrl,
          pipelineStepTimeoutMs: PIPELINE_STEP_TIMEOUT_MS,
        },
        artifactsDir: scenarioArtifactsDir,
      });
      const scoreRowCount = await fetchScoreRowCount(db, result.metrics.scoring.epochId);
      if (scoreRowCount < 1) {
        throw new Error(
          `campaign run produced zero score rows: stage=${run.stageId} family=${run.familyId} variant=${run.variantId} seed=${run.seed} epoch=${result.metrics.scoring.epochId} clockMs=${clockMs}`
        );
      }
      const redisFeedCount = await fetchRedisFeedCount(redis);

      runs.push({
        stageId: run.stageId,
        label: run.label,
        familyId: run.familyId,
        variantId: run.variantId,
        scenarioId: run.id,
        scenarioKind: result.metrics.scenarioKind,
        scenarioVersion: result.metrics.scenarioVersion,
        seed: run.seed,
        subscriberCount: run.subscriberCount,
        postCount: run.postCount,
        expectation: run.expectation,
        durationMs: Date.now() - runStartedAtMs,
        scoreRowCount,
        redisFeedCount,
        topPostsFetched: result.metrics.scoring.topPosts.length,
        voteCount: result.metrics.population.voteCount,
        weightSum: result.metrics.aggregation.weightSum,
        weights: {
          recency: result.metrics.aggregation.weights.recency,
          engagement: result.metrics.aggregation.weights.engagement,
          bridging: result.metrics.aggregation.weights.bridging,
          sourceDiversity: result.metrics.aggregation.weights.sourceDiversity,
          relevance: result.metrics.aggregation.weights.relevance,
        },
        artifactJsonPath: result.artifactPaths?.jsonPath ?? null,
        artifactCsvPath: result.artifactPaths?.csvPath ?? null,
        epochSeriesCsvPath: result.epochSeriesPaths?.csvPath ?? null,
        auditLogJsonPath: result.epochSeriesPaths?.auditLogPath ?? null,
      });
    }

    if (shouldRunFeedImpactPass(options, stages.map((stage) => stage.id))) {
      await resetCampaignData(db, redis);
      const s2Stage = s2StageForFeedImpact();
      const baselineScenario = scenarioForCampaignRun(s2Stage, FEED_IMPACT_SEED);
      const baselineResult = await runBaselineComparison(
        {
          db,
          rng: createRng(FEED_IMPACT_SEED),
          clock: new SeededClock(campaignClockMs),
        },
        {
          populationConfig: baselineScenario.population,
          topK: FEED_IMPACT_TOP_K,
          pipelineStepTimeoutMs: PIPELINE_STEP_TIMEOUT_MS,
        }
      );
      const rows = buildRows(baselineResult, FEED_IMPACT_TAIL_THRESHOLD);
      const paths = await writeFeedImpactArtifacts(options.artifactsDir, rows.summaryRows, rows.pairwiseRows);
      feedImpact = createFeedImpactReceipt(
        FEED_IMPACT_SEED,
        FEED_IMPACT_TOP_K,
        paths,
        rows.summaryRows,
        rows.pairwiseRows
      );
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
    totalRuns: campaignRuns.length,
    feedImpact,
    runs,
  };

  try {
    const artifactsDir = path.resolve(options.artifactsDir);
    const summaryPath = await writeSummary(artifactsDir, summary);
    const analysisPaths = await writeCampaignAnalysisArtifacts(artifactsDir, summary);
    const artifacts = await collectCampaignArtifacts(artifactsDir, summaryPath, analysisPaths, summary);
    const summaryDescriptor = artifacts.find((artifact) => artifact.path === 'campaign-summary.json');
    if (summaryDescriptor === undefined) {
      throw new Error(`Campaign summary descriptor was not collected for ${summaryPath}`);
    }
    const checksumsPath = await writeChecksums(artifactsDir, artifacts);
    artifacts.push(
      await collectArtifactDescriptor(artifactsDir, checksumsPath, 'text/plain', 'src/harness/lab-artifacts.ts')
    );

    const manifest: LabManifest = {
      schemaVersion: '1.0.0',
      issue: ISSUE_KEY,
      branch: await collectGitBranch(process.cwd()),
      git: await collectGitStateWithDefaultBase(process.cwd()),
      command: {
        argv: process.argv,
        cwd: process.cwd(),
        exitCode: finalError === undefined ? 0 : 1,
        stdoutPath: null,
        stderrPath: null,
      },
      envAllowlist: envAllowlist(target),
      runtime: await collectRuntimeState(process.cwd()),
      startedAt: summary.startedAt,
      endedAt: new Date().toISOString(),
      artifacts,
      thresholds: buildCampaignThresholds(options),
      claims: buildCampaignClaims(summary, summaryDescriptor.path),
    };
    const manifestPath = await writeLabManifest(artifactsDir, manifest);

    await writeStdout(
      `${JSON.stringify({ ...summary, summaryPath, analysisPaths, checksumsPath, manifestPath }, null, 2)}\n`
    );
  } catch (artifactError: unknown) {
    throw combineCampaignAndArtifactError(finalError, artifactError);
  }

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
