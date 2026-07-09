import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CAMPAIGN_SCENARIO_FAMILY_IDS, CAMPAIGN_STAGE_IDS } from './campaign.js';
import {
  REGIME_NAMES,
  type WrittenBaselineComparisonPaths,
} from './baseline-comparison.js';
import {
  GOVERNANCE_WEIGHT_KEYS,
  type GovernanceWeightKey,
} from '../config/votable-params.js';
import type { GovernanceWeights } from '../shared/api-types.js';

type WeightMeanField = `${GovernanceWeightKey}Mean`;
type WeightVarianceField = `${GovernanceWeightKey}Variance`;

function governanceWeightSchemaShape(): Record<GovernanceWeightKey, z.ZodNumber> {
  return Object.fromEntries(
    GOVERNANCE_WEIGHT_KEYS.map((key) => [key, z.number()] as const)
  ) as Record<GovernanceWeightKey, z.ZodNumber>;
}

const GovernanceWeightsSummarySchema = z
  .object(governanceWeightSchemaShape())
  .strict() as z.ZodType<GovernanceWeights>;

function meanFieldForKey(key: GovernanceWeightKey): WeightMeanField {
  return `${key}Mean` as WeightMeanField;
}

function varianceFieldForKey(key: GovernanceWeightKey): WeightVarianceField {
  return `${key}Variance` as WeightVarianceField;
}

function regimeSchema() {
  return z.enum(REGIME_NAMES);
}

export const CampaignRunReceiptSchema = z
  .object({
    stageId: z.enum(CAMPAIGN_STAGE_IDS),
    label: z.string(),
    familyId: z.enum(CAMPAIGN_SCENARIO_FAMILY_IDS),
    variantId: z.string(),
    scenarioId: z.string(),
    scenarioKind: z.string(),
    scenarioVersion: z.number().int(),
    seed: z.number().int(),
    subscriberCount: z.number().int(),
    postCount: z.number().int(),
    expectation: z.enum(['gate', 'capacity']),
    durationMs: z.number().int().nonnegative(),
    scoreRowCount: z.number().int().nonnegative(),
    redisFeedCount: z.number().int().nonnegative().nullable(),
    topPostsFetched: z.number().int().nonnegative(),
    voteCount: z.number().int().nonnegative(),
    weightSum: z.number(),
    weights: GovernanceWeightsSummarySchema,
    artifactJsonPath: z.string().nullable(),
    artifactCsvPath: z.string().nullable(),
    epochSeriesCsvPath: z.string().nullable(),
    auditLogJsonPath: z.string().nullable(),
  })
  .strict();
export type CampaignRunReceipt = z.infer<typeof CampaignRunReceiptSchema>;

export const FeedImpactReceiptSchema = z
  .object({
    seed: z.number().int(),
    topK: z.number().int().positive(),
    summaryCsvPath: z.string(),
    pairwiseCsvPath: z.string(),
    summaryRows: z.array(
      z
        .object({
          regime: regimeSchema(),
          epochId: z.number().int(),
          weights: GovernanceWeightsSummarySchema,
          authorHHI: z.number().nullable(),
          authorGini: z.number().nullable(),
          minorityTopicExposure: z.number(),
        })
        .strict()
    ),
    pairwiseRows: z.array(
      z
        .object({
          regimeA: regimeSchema(),
          regimeB: regimeSchema(),
          rankDisplacement: z.number().nullable(),
          kendallTau: z.number().nullable(),
          sharedCount: z.number().int().nonnegative(),
        })
        .strict()
    ),
  })
  .strict();
export type CampaignFeedImpactReceipt = z.infer<typeof FeedImpactReceiptSchema>;
type CampaignFeedImpactSummaryRow = CampaignFeedImpactReceipt['summaryRows'][number];
type CampaignFeedImpactPairwiseRow = CampaignFeedImpactReceipt['pairwiseRows'][number];

export const CampaignSummarySchema = z
  .object({
    startedAt: z.string(),
    endedAt: z.string(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(['passed', 'failed']),
    error: z.string().nullable(),
    totalRuns: z.number().int().nonnegative(),
    feedImpact: FeedImpactReceiptSchema.nullable(),
    runs: z.array(CampaignRunReceiptSchema),
  })
  .strict();
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

interface CampaignAggregateRowBase {
  stageId: string;
  familyId: string;
  variantId: string;
  label: string;
  expectation: 'gate' | 'capacity';
  runCount: number;
  seeds: number[];
  status: 'passed' | 'failed';
  avgDurationMs: number;
  avgVoteCount: number;
  avgScoreRowCount: number;
  avgRedisFeedCount: number | null;
  weightVarianceMean: number;
}

export type CampaignAggregateRow = CampaignAggregateRowBase &
  Record<WeightMeanField, number> &
  Record<WeightVarianceField, number>;

export interface WrittenCampaignAnalysisPaths {
  runCsvPath: string;
  aggregateCsvPath: string;
  paperNotesPath: string;
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const raw = String(value);
  if (!/[",\n]/.test(raw)) {
    return raw;
  }
  return `"${raw.replaceAll('"', '""')}"`;
}

function csvNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('mean: values must be non-empty');
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nullableMean(values: readonly (number | null)[]): number | null {
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length === 0) {
    return null;
  }
  return mean(presentValues);
}

function variance(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
}

function groupKey(run: CampaignRunReceipt): string {
  return `${run.stageId}\u0000${run.familyId}\u0000${run.variantId}`;
}

export function aggregateCampaignRuns(runs: readonly CampaignRunReceipt[]): CampaignAggregateRow[] {
  const groups = new Map<string, CampaignRunReceipt[]>();
  for (const run of runs) {
    const key = groupKey(run);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [run]);
    } else {
      group.push(run);
    }
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    if (first === undefined) {
      throw new Error('aggregateCampaignRuns: internal empty group');
    }
    const componentStats = GOVERNANCE_WEIGHT_KEYS.map((key) => {
      const values = group.map((run) => run.weights[key]);
      return {
        key,
        mean: mean(values),
        variance: variance(values),
      };
    });
    const componentVariances = componentStats.map((stat) => stat.variance);

    const row: CampaignAggregateRow = {
      stageId: first.stageId,
      familyId: first.familyId,
      variantId: first.variantId,
      label: first.label,
      expectation: first.expectation,
      runCount: group.length,
      seeds: [...group.map((run) => run.seed)].sort((a, b) => a - b),
      status: group.every((run) => run.scoreRowCount > 0 && run.topPostsFetched > 0) ? 'passed' : 'failed',
      avgDurationMs: mean(group.map((run) => run.durationMs)),
      avgVoteCount: mean(group.map((run) => run.voteCount)),
      avgScoreRowCount: mean(group.map((run) => run.scoreRowCount)),
      avgRedisFeedCount: nullableMean(group.map((run) => run.redisFeedCount)),
      weightVarianceMean: mean(componentVariances),
    };
    for (const stat of componentStats) {
      row[meanFieldForKey(stat.key)] = stat.mean;
      row[varianceFieldForKey(stat.key)] = stat.variance;
    }
    return row;
  });
}

export function campaignRunsToCsv(runs: readonly CampaignRunReceipt[]): string {
  const header = [
    'stageId',
    'familyId',
    'variantId',
    'seed',
    'expectation',
    'subscriberCount',
    'postCount',
    'voteCount',
    'scoreRowCount',
    'redisFeedCount',
    'durationMs',
    ...GOVERNANCE_WEIGHT_KEYS,
    'weightSum',
    'artifactJsonPath',
    'artifactCsvPath',
  ];
  const lines = runs.map((run) =>
    [
      run.stageId,
      run.familyId,
      run.variantId,
      run.seed,
      run.expectation,
      run.subscriberCount,
      run.postCount,
      run.voteCount,
      run.scoreRowCount,
      run.redisFeedCount,
      run.durationMs,
      ...GOVERNANCE_WEIGHT_KEYS.map((key) => csvNumber(run.weights[key], 6)),
      csvNumber(run.weightSum, 6),
      run.artifactJsonPath,
      run.artifactCsvPath,
    ]
      .map(csvCell)
      .join(',')
  );
  return `${header.join(',')}\n${lines.join('\n')}\n`;
}

export function campaignAggregatesToCsv(rows: readonly CampaignAggregateRow[]): string {
  const header = [
    'stageId',
    'familyId',
    'variantId',
    'label',
    'expectation',
    'runCount',
    'seeds',
    'status',
    'avgDurationMs',
    'avgVoteCount',
    'avgScoreRowCount',
    'avgRedisFeedCount',
    ...GOVERNANCE_WEIGHT_KEYS.map(meanFieldForKey),
    ...GOVERNANCE_WEIGHT_KEYS.map(varianceFieldForKey),
    'weightVarianceMean',
  ];
  const lines = rows.map((row) =>
    [
      row.stageId,
      row.familyId,
      row.variantId,
      row.label,
      row.expectation,
      row.runCount,
      row.seeds.join('|'),
      row.status,
      csvNumber(row.avgDurationMs, 2),
      csvNumber(row.avgVoteCount, 2),
      csvNumber(row.avgScoreRowCount, 2),
      row.avgRedisFeedCount === null ? null : csvNumber(row.avgRedisFeedCount, 2),
      ...GOVERNANCE_WEIGHT_KEYS.map((key) => csvNumber(row[meanFieldForKey(key)], 6)),
      ...GOVERNANCE_WEIGHT_KEYS.map((key) => csvNumber(row[varianceFieldForKey(key)], 9)),
      csvNumber(row.weightVarianceMean, 9),
    ]
      .map(csvCell)
      .join(',')
  );
  return `${header.join(',')}\n${lines.join('\n')}\n`;
}

function safeClaimsMarkdown(summary: CampaignSummary, aggregateRows: readonly CampaignAggregateRow[]): string {
  const gateRows = aggregateRows.filter((row) => row.expectation === 'gate');
  const capacityRows = aggregateRows.filter((row) => row.expectation === 'capacity');
  const highestVarianceRows = [...aggregateRows]
    .sort((a, b) => b.weightVarianceMean - a.weightVarianceMean)
    .slice(0, 8);
  const feedImpact = summary.feedImpact;
  const feedImpactLines =
    feedImpact === null
      ? ['- Feed-impact comparison was not run for this campaign selection.']
      : feedImpact.pairwiseRows.map((row) => {
          const rankDisplacement = row.rankDisplacement === null ? 'NA' : csvNumber(row.rankDisplacement, 3);
          const kendallTau = row.kendallTau === null ? 'NA' : csvNumber(row.kendallTau, 3);
          return `- ${row.regimeA} vs ${row.regimeB}: overlap ${row.sharedCount}/${feedImpact.topK}, displacement ${rankDisplacement}, Kendall tau ${kendallTau}.`;
        });

  return [
    '# Corgi Paper Simulation Notes',
    '',
    `Campaign status: ${summary.status}`,
    `Completed runs: ${summary.runs.length}/${summary.totalRuns}`,
    `Gate aggregate rows: ${gateRows.length}`,
    `Capacity aggregate rows: ${capacityRows.length}`,
    '',
    '## Safe Claims',
    '',
    '- These results drive Corgi production governance/scoring code against local ephemeral Postgres/Redis targets.',
    '- Baseline S0-S3 rows are correctness evidence for the synthetic harness and configured electorates.',
    '- S4/S5 rows are capacity evidence only; they are not a production saturation proof.',
    '- Feed-impact rows compare default, engagement-only, and community-governed rankings on one fixed synthetic corpus.',
    '',
    '## Not Proven',
    '',
    '- Real user preference, adoption, retention, or satisfaction.',
    '- Production write capacity or saturation.',
    '- Sybil resistance.',
    '- General strategyproofness beyond the bounded sweep and synthetic electorates.',
    '- Democratic legitimacy for all communities or all turnout regimes.',
    '',
    '## Feed Impact',
    '',
    ...feedImpactLines,
    '',
    '## Highest Cross-Seed Weight Variance',
    '',
    ...highestVarianceRows.map(
      (row) =>
        `- ${row.stageId}/${row.familyId}/${row.variantId}: variance ${csvNumber(row.weightVarianceMean, 6)} across seeds ${row.seeds.join(', ')}.`
    ),
    '',
  ].join('\n');
}

export async function writeCampaignAnalysisArtifacts(
  artifactsDir: string,
  summaryInput: unknown
): Promise<WrittenCampaignAnalysisPaths> {
  const summary = CampaignSummarySchema.parse(summaryInput);
  const aggregateRows = aggregateCampaignRuns(summary.runs);
  await mkdir(artifactsDir, { recursive: true });

  const runCsvPath = path.join(artifactsDir, 'campaign-results.csv');
  const aggregateCsvPath = path.join(artifactsDir, 'campaign-aggregates.csv');
  const paperNotesPath = path.join(artifactsDir, 'paper-safe-claims.md');

  await writeFile(runCsvPath, campaignRunsToCsv(summary.runs), 'utf8');
  await writeFile(aggregateCsvPath, campaignAggregatesToCsv(aggregateRows), 'utf8');
  await writeFile(paperNotesPath, safeClaimsMarkdown(summary, aggregateRows), 'utf8');

  return { runCsvPath, aggregateCsvPath, paperNotesPath };
}

export function feedImpactReceipt(
  seed: number,
  topK: number,
  paths: WrittenBaselineComparisonPaths,
  summaryRows: readonly CampaignFeedImpactSummaryRow[],
  pairwiseRows: readonly CampaignFeedImpactPairwiseRow[]
): CampaignFeedImpactReceipt {
  return FeedImpactReceiptSchema.parse({
    seed,
    topK,
    summaryCsvPath: paths.summaryCsvPath,
    pairwiseCsvPath: paths.pairwiseCsvPath,
    summaryRows,
    pairwiseRows,
  });
}
