/**
 * Metrics
 *
 * Pure measurement over a completed `SimulationResult` — never drives the
 * simulated system itself (that's `Simulation`'s job). Every run's output is
 * a schema-validated, serializable artifact keyed by scenario + seed + code
 * version, not console noise: this is what makes a run diffable/greppable
 * and gives golden-snapshot tests something stable to assert against.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { SimulationResult, SimulationEvent, AuditLogRow } from './simulation.js';
import { TOPIC_SLUGS } from './population.js';

const GovernanceWeightsSchema = z.record(z.string(), z.number());

export const RunMetricsSchema = z.object({
  scenarioKind: z.string(),
  scenarioVersion: z.number().int(),
  seed: z.number().int(),
  codeVersion: z.string(),
  population: z.object({
    subscriberCount: z.number().int(),
    postCount: z.number().int(),
    voteCount: z.number().int(),
  }),
  aggregation: z.object({
    epochId: z.number().int(),
    weights: GovernanceWeightsSchema,
    weightSum: z.number(),
  }),
  transition: z.object({
    fromEpochId: z.number().int(),
    toEpochId: z.number().int(),
  }),
  scoring: z.object({
    epochId: z.number().int(),
    scoredPostCount: z.number().int(),
    topPosts: z.array(
      z.object({
        uri: z.string(),
        rank: z.number().int(),
        totalScore: z.number(),
      })
    ),
  }),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

const SimulationEventSchema = z.object({
  at: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const RunArtifactsSchema = z.object({
  runId: z.string(),
  /** Wall-clock generation time. Informational only — never part of the
   *  deterministic surface a golden-snapshot test should assert on. */
  generatedAt: z.string(),
  metrics: RunMetricsSchema,
  events: z.array(SimulationEventSchema),
});
export type RunArtifacts = z.infer<typeof RunArtifactsSchema>;

/** One row of the raw `governance_audit_log` trail a `multi-epoch-cycle` run
 *  surfaced (`SimulationResult.auditLog`) — schema-validated the same way
 *  every other harness artifact is before it's written to disk. */
export const AuditLogRowSchema = z.object({
  id: z.number().int(),
  action: z.string(),
  epochId: z.number().int().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

/** One row of a `multi-epoch-cycle` run's per-epoch series: the 5-component
 *  weight vector, a topic-weight summary, vote count, and this round's L2
 *  displacement from the previous round's weight vector (see
 *  `Simulation.runMultiEpochCycle` / `convergence.ts`'s `l2Distance`). */
export const EpochSeriesRowSchema = z.object({
  round: z.number().int().min(1),
  fromEpochId: z.number().int(),
  toEpochId: z.number().int(),
  voteCount: z.number().int(),
  weights: GovernanceWeightsSchema,
  weightSum: z.number(),
  topicWeights: z.record(z.string(), z.number()),
  l2Displacement: z.number().min(0),
});
export type EpochSeriesRow = z.infer<typeof EpochSeriesRowSchema>;

/** Round to reduce float noise from Postgres round-trips; inputs are already deterministic. */
function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function readCodeVersion(): string {
  return process.env.npm_package_version ?? '0.0.0-unknown';
}

/** Pure measurement: turns a completed run into a schema-validated RunMetrics snapshot. */
export function measure(result: SimulationResult): RunMetrics {
  const weightSum = Object.values(result.aggregatedWeights).reduce((sum, value) => sum + value, 0);

  const roundedWeights = Object.fromEntries(
    Object.entries(result.aggregatedWeights).map(([key, value]) => [key, round(value)])
  );

  return RunMetricsSchema.parse({
    scenarioKind: result.scenario.kind,
    scenarioVersion: result.scenario.version,
    seed: result.scenario.seed,
    codeVersion: readCodeVersion(),
    population: {
      subscriberCount: result.population.subscribers.length,
      postCount: result.population.posts.length,
      voteCount: result.population.votes.length,
    },
    aggregation: {
      epochId: result.epochBeforeId,
      weights: roundedWeights,
      weightSum: round(weightSum),
    },
    transition: {
      fromEpochId: result.epochBeforeId,
      toEpochId: result.epochAfterId,
    },
    scoring: {
      epochId: result.epochAfterId,
      scoredPostCount: result.scoredPostCount,
      topPosts: result.topPosts.map((post) => ({ ...post, totalScore: round(post.totalScore) })),
    },
  });
}

/**
 * Pure measurement: turn a completed `multi-epoch-cycle` run's `rounds` into
 * one schema-validated `EpochSeriesRow` per epoch. Empty for an
 * `epoch-vote-cycle` result, where `rounds` is undefined.
 */
export function measureEpochSeries(result: SimulationResult): EpochSeriesRow[] {
  if (!result.rounds) {
    return [];
  }

  return result.rounds.map((epochRound) => {
    const weightSum = Object.values(epochRound.weights).reduce((sum, value) => sum + value, 0);

    return EpochSeriesRowSchema.parse({
      round: epochRound.round,
      fromEpochId: epochRound.epochBeforeId,
      toEpochId: epochRound.epochAfterId,
      voteCount: epochRound.voteCount,
      weights: Object.fromEntries(
        Object.entries(epochRound.weights).map(([key, value]) => [key, round(value)])
      ),
      weightSum: round(weightSum),
      topicWeights: Object.fromEntries(
        Object.entries(epochRound.topicWeights).map(([key, value]) => [key, round(value)])
      ),
      // Finer precision than the default 6dp: a converged/homogeneous run's
      // displacement can legitimately sit well under 1e-4, and 6dp would
      // flatten meaningful differences between rounds down to 0.
      l2Displacement: round(epochRound.l2Displacement, 9),
    });
  });
}

/** Build the full artifact envelope (metrics + raw event trace) for a run. */
export function toArtifacts(
  runId: string,
  generatedAt: string,
  metrics: RunMetrics,
  events: SimulationEvent[]
): RunArtifacts {
  return RunArtifactsSchema.parse({ runId, generatedAt, metrics, events });
}

export interface WrittenArtifactPaths {
  jsonPath: string;
  csvPath: string;
}

const CSV_HEADER = [
  'scenarioKind',
  'seed',
  'codeVersion',
  'subscriberCount',
  'postCount',
  'voteCount',
  'fromEpochId',
  'toEpochId',
  'scoredPostCount',
  'weightSum',
] as const;

function toCsvSummary(metrics: RunMetrics): string {
  const row = [
    metrics.scenarioKind,
    metrics.seed,
    metrics.codeVersion,
    metrics.population.subscriberCount,
    metrics.population.postCount,
    metrics.population.voteCount,
    metrics.transition.fromEpochId,
    metrics.transition.toEpochId,
    metrics.scoring.scoredPostCount,
    metrics.aggregation.weightSum,
  ];
  return `${CSV_HEADER.join(',')}\n${row.join(',')}\n`;
}

/**
 * Persist a run's artifacts to `<baseDir>/<scenarioKind>/<seed>/<codeVersion>/`:
 * `metrics.json` (schema-validated JSON, full artifact envelope) and
 * `summary.csv` (one-row tabular summary, easy to diff in PR review).
 */
export async function writeArtifacts(baseDir: string, artifacts: RunArtifacts): Promise<WrittenArtifactPaths> {
  const dir = path.join(
    baseDir,
    artifacts.metrics.scenarioKind,
    String(artifacts.metrics.seed),
    artifacts.metrics.codeVersion
  );
  await mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, 'metrics.json');
  const csvPath = path.join(dir, 'summary.csv');

  await writeFile(jsonPath, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8');
  await writeFile(csvPath, toCsvSummary(artifacts.metrics), 'utf8');

  return { jsonPath, csvPath };
}

/** One column per registered topic slug — `TOPIC_SLUGS` (population.ts) is
 *  this harness's fixed synthetic taxonomy, so the header stays in sync with
 *  whatever slugs `aggregateTopicWeights` could actually have voted on,
 *  without hardcoding a stale copy of the list here. */
const EPOCH_SERIES_CSV_HEADER = [
  'round',
  'fromEpochId',
  'toEpochId',
  'voteCount',
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
  'weightSum',
  ...TOPIC_SLUGS.map((slug) => `topic_${slug}`),
  'l2Displacement',
] as const;

function toEpochSeriesCsv(rows: readonly EpochSeriesRow[]): string {
  const lines = rows.map((row) =>
    [
      row.round,
      row.fromEpochId,
      row.toEpochId,
      row.voteCount,
      row.weights.recency,
      row.weights.engagement,
      row.weights.bridging,
      row.weights.sourceDiversity,
      row.weights.relevance,
      row.weightSum,
      // Blank (not 0) when a topic had no votes that round — 0 is a valid
      // weight, so writing it here would misrepresent "no opinion cast" as
      // "the electorate voted this topic to zero".
      ...TOPIC_SLUGS.map((slug) => row.topicWeights[slug] ?? ''),
      row.l2Displacement,
    ].join(',')
  );
  return `${EPOCH_SERIES_CSV_HEADER.join(',')}\n${lines.join('\n')}\n`;
}

export interface WrittenEpochSeriesPaths {
  csvPath: string;
  auditLogPath: string;
}

/**
 * Persist a `multi-epoch-cycle` run's per-epoch series and raw audit trail,
 * alongside the standard `metrics.json`/`summary.csv` `writeArtifacts`
 * already writes (for the run's FINAL round) — same
 * `<baseDir>/<scenarioKind>/<seed>/<codeVersion>/` directory (derived from
 * the same `RunMetrics` `writeArtifacts` uses), so a run's whole artifact
 * set lives in one place:
 *   - `epochs.csv` — one row per epoch (`EpochSeriesRow`, see `toEpochSeriesCsv`).
 *   - `audit-log.json` — every real `governance_audit_log` row the run wrote.
 */
export async function writeEpochSeriesArtifacts(
  baseDir: string,
  metrics: RunMetrics,
  rows: EpochSeriesRow[],
  auditLog: AuditLogRow[]
): Promise<WrittenEpochSeriesPaths> {
  const dir = path.join(baseDir, metrics.scenarioKind, String(metrics.seed), metrics.codeVersion);
  await mkdir(dir, { recursive: true });

  const csvPath = path.join(dir, 'epochs.csv');
  const auditLogPath = path.join(dir, 'audit-log.json');

  const validatedAuditLog = auditLog.map((row) => AuditLogRowSchema.parse(row));

  await writeFile(csvPath, toEpochSeriesCsv(rows), 'utf8');
  await writeFile(auditLogPath, `${JSON.stringify(validatedAuditLog, null, 2)}\n`, 'utf8');

  return { csvPath, auditLogPath };
}
