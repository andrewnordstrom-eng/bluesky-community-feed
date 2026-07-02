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
import type { SimulationResult, SimulationEvent } from './simulation.js';

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
