import { describe, expect, it } from 'vitest';
import {
  CampaignRunReceiptSchema,
  CampaignSummarySchema,
  aggregateCampaignRuns,
  campaignAggregatesToCsv,
  campaignRunsToCsv,
  type CampaignRunReceipt,
  type CampaignSummary,
} from '../../src/harness/campaign-summary.js';
import { FeedImpactReceiptSchema as PublicFeedImpactReceiptSchema } from '../../src/harness/index.js';

function runReceipt(seed: number, engagement: number): CampaignRunReceipt {
  return {
    stageId: 'S2',
    label: 'equal persona mix, 80% voter participation',
    familyId: 'baseline',
    variantId: 'equal-mix-80p',
    scenarioId: `S2:baseline:equal-mix-80p:${seed}`,
    scenarioKind: 'epoch-vote-cycle',
    scenarioVersion: 1,
    seed,
    subscriberCount: 500,
    postCount: 2000,
    expectation: 'gate',
    durationMs: 1234,
    scoreRowCount: 2000,
    redisFeedCount: 50,
    topPostsFetched: 50,
    voteCount: 400,
    weightSum: 1,
    weights: {
      recency: 0.25,
      engagement,
      bridging: 0.25,
      sourceDiversity: 0.15,
      relevance: 0.15,
    },
    artifactJsonPath: 'artifacts/run/metrics.json',
    artifactCsvPath: 'artifacts/run/summary.csv',
    epochSeriesCsvPath: null,
    auditLogJsonPath: null,
  };
}

function campaignSummary(runs: CampaignRunReceipt[]): CampaignSummary {
  return {
    startedAt: '2026-07-08T00:00:00.000Z',
    endedAt: '2026-07-08T00:00:01.000Z',
    durationMs: 1000,
    status: 'passed',
    error: null,
    totalRuns: runs.length,
    feedImpact: null,
    runs,
  };
}

describe('campaign summary artifacts', () => {
  it('parses the campaign summary schema with typed run receipts', () => {
    const summary = campaignSummary([runReceipt(42, 0.2)]);

    expect(CampaignRunReceiptSchema.parse(summary.runs[0])).toEqual(summary.runs[0]);
    expect(CampaignSummarySchema.parse(summary)).toEqual(summary);
  });

  it('exports the feed-impact receipt schema through the public harness barrel', () => {
    const receipt = {
      seed: 90210,
      topK: 50,
      summaryCsvPath: 'baseline-comparison/regime-summary.csv',
      pairwiseCsvPath: 'baseline-comparison/pairwise-churn.csv',
      summaryRows: [
        {
          regime: 'community-governed',
          epochId: 4,
          weights: runReceipt(42, 0.2).weights,
          authorHHI: 0.02,
          authorGini: 0,
          minorityTopicExposure: 0,
        },
      ],
      pairwiseRows: [
        {
          regimeA: 'engagement-only',
          regimeB: 'community-governed',
          rankDisplacement: 0.02,
          kendallTau: null,
          sharedCount: 1,
        },
      ],
    };

    expect(PublicFeedImpactReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it('rejects malformed run receipts before writing paper artifacts', () => {
    const malformed = {
      ...runReceipt(42, 0.2),
      familyId: 'rank-choice',
    };

    expect(() => CampaignRunReceiptSchema.parse(malformed)).toThrow();
  });

  it('aggregates cross-seed variance for the same scenario family and variant', () => {
    const rows = aggregateCampaignRuns([runReceipt(42, 0.2), runReceipt(1337, 0.3)]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.seeds).toEqual([42, 1337]);
    expect(rows[0]?.engagementMean).toBeCloseTo(0.25, 12);
    expect(rows[0]?.engagementVariance).toBeCloseTo(0.0025, 12);
    expect(rows[0]?.weightVarianceMean).toBeGreaterThan(0);
  });

  it('handles empty, single-run, and separate-family aggregation boundaries', () => {
    const baseline = runReceipt(42, 0.2);
    const turnout = {
      ...runReceipt(42, 0.8),
      familyId: 'turnout' as const,
      variantId: 'participation-5p',
      scenarioId: 'S2:turnout:participation-5p:42',
    };

    expect(aggregateCampaignRuns([])).toEqual([]);
    expect(aggregateCampaignRuns([baseline])[0]?.engagementVariance).toBe(0);
    expect(aggregateCampaignRuns([baseline, turnout]).map((row) => row.familyId)).toEqual([
      'baseline',
      'turnout',
    ]);
  });

  it('serializes run and aggregate CSVs with paper-facing fields', () => {
    const runs = [runReceipt(42, 0.2), runReceipt(1337, 0.3)];
    const runCsv = campaignRunsToCsv(runs);
    const aggregateCsv = campaignAggregatesToCsv(aggregateCampaignRuns(runs));

    expect(runCsv.split('\n')[0]).toContain('familyId,variantId,seed');
    expect(runCsv).toContain('baseline,equal-mix-80p,42');
    expect(aggregateCsv.split('\n')[0]).toContain('weightVarianceMean');
    expect(aggregateCsv).toContain('42|1337');
  });
});
