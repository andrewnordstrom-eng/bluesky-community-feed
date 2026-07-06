import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STAGE_IDS,
  SIMULATED_EPOCH_CAMPAIGN,
  campaignManifest,
  parseCampaignStageId,
  scenarioForCampaignRun,
  selectCampaignStages,
  totalCampaignRuns,
} from '../../src/harness/campaign.js';
import { parseScenario } from '../../src/harness/scenario.js';

describe('simulated epoch campaign ladder', () => {
  const manifestGeneratedAt = '2026-07-05T00:00:00.000Z';

  it('pins the requested 10k subscriber / 50k post campaign ceiling', () => {
    const target = SIMULATED_EPOCH_CAMPAIGN[SIMULATED_EPOCH_CAMPAIGN.length - 1];

    expect(target.id).toBe('S5');
    expect(target.subscriberCount).toBe(10_000);
    expect(target.postCount).toBe(50_000);
    expect(target.expectation).toBe('capacity');
  });

  it('builds route-valid ScenarioV1 inputs for every stage and seed', () => {
    for (const stage of SIMULATED_EPOCH_CAMPAIGN) {
      for (const seed of stage.seeds) {
        const scenario = scenarioForCampaignRun(stage, seed);
        const parsed = parseScenario(scenario);

        expect(parsed.success).toBe(true);
        if (!parsed.success) {
          continue;
        }
        expect(parsed.data.seed).toBe(seed);
        expect(parsed.data.population.subscriberCount).toBe(stage.subscriberCount);
        expect(parsed.data.population.postCount).toBe(stage.postCount);
      }
    }
  });

  it('selects stages by max-stage or exact stage, but not both', () => {
    expect(selectCampaignStages({ onlyStageId: null, maxStageId: 'S2' }).map((stage) => stage.id)).toEqual([
      'S0',
      'S1',
      'S2',
    ]);
    expect(selectCampaignStages({ onlyStageId: 'S4', maxStageId: null }).map((stage) => stage.id)).toEqual([
      'S4',
    ]);
    expect(selectCampaignStages({ onlyStageId: null, maxStageId: null })).toEqual(
      SIMULATED_EPOCH_CAMPAIGN
    );
    expect(selectCampaignStages({ onlyStageId: null, maxStageId: 'S5' })).toEqual(
      SIMULATED_EPOCH_CAMPAIGN
    );
    expect(() => selectCampaignStages({ onlyStageId: 'S1', maxStageId: 'S2' })).toThrow(
      /cannot set both/
    );
    expect(() =>
      selectCampaignStages({ onlyStageId: 'S99', maxStageId: null })
    ).toThrow(/Unknown campaign stage/);
    expect(() =>
      selectCampaignStages({ onlyStageId: null, maxStageId: 'S99' })
    ).toThrow(/Unknown campaign stage/);
  });

  it('rejects unknown stage IDs at the CLI boundary', () => {
    expect(parseCampaignStageId('S3')).toBe('S3');
    expect(() => parseCampaignStageId('S6')).toThrow(/Unknown campaign stage/);
    expect(() => parseCampaignStageId('')).toThrow(/Unknown campaign stage/);
    expect(() => parseCampaignStageId('s3')).toThrow(/Unknown campaign stage/);
    expect(() => parseCampaignStageId(' S3')).toThrow(/Unknown campaign stage/);
    expect(() => parseCampaignStageId('S3 ')).toThrow(/Unknown campaign stage/);
    expect(() => parseCampaignStageId(undefined as unknown as string)).toThrow(
      /Unknown campaign stage/
    );
    expect(() => parseCampaignStageId(null as unknown as string)).toThrow(/Unknown campaign stage/);
  });

  it('emits a manifest with one scenario per seed', () => {
    const stages = selectCampaignStages({ onlyStageId: null, maxStageId: 'S1' });
    const manifest = campaignManifest(stages, manifestGeneratedAt);

    expect(manifest.generatedAt).toBe(manifestGeneratedAt);
    expect(manifest.totalRuns).toBe(totalCampaignRuns(stages));
    expect(manifest.totalRuns).toBe(4);

    const expectedPairs = stages.flatMap((stage) =>
      stage.seeds.map((seed) => `${stage.id}:${seed}`)
    );
    const manifestPairs = manifest.stages.flatMap((stage) =>
      stage.scenarios.map((scenario) => `${stage.id}:${scenario.seed}`)
    );

    expect(manifestPairs).toEqual(expectedPairs);
    expect(new Set(manifestPairs).size).toBe(expectedPairs.length);
  });

  it('emits a manifest for exact single-stage selections', () => {
    const stages = selectCampaignStages({ onlyStageId: 'S4', maxStageId: null });
    const manifest = campaignManifest(stages, manifestGeneratedAt);

    expect(manifest.stages.map((stage) => stage.id)).toEqual(['S4']);
    expect(manifest.totalRuns).toBe(2);
    expect(manifest.stages[0]?.scenarios.map((scenario) => scenario.seed)).toEqual([42, 1337]);
  });

  it('returns cloned stages and seed arrays from campaign selection', () => {
    const selected = selectCampaignStages({ onlyStageId: 'S0', maxStageId: null });
    const stage = selected[0];
    if (stage === undefined) {
      throw new Error('expected S0 stage');
    }

    expect(stage).toEqual(SIMULATED_EPOCH_CAMPAIGN[0]);
    expect(stage).not.toBe(SIMULATED_EPOCH_CAMPAIGN[0]);
    expect(stage.seeds).not.toBe(SIMULATED_EPOCH_CAMPAIGN[0]?.seeds);
  });

  it('emits manifest seed arrays that are not shared with selected stages', () => {
    const stages = selectCampaignStages({ onlyStageId: 'S0', maxStageId: null });
    const manifest = campaignManifest(stages, manifestGeneratedAt);

    expect(manifest.stages[0]?.seeds).toEqual(stages[0]?.seeds);
    expect(manifest.stages[0]?.seeds).not.toBe(stages[0]?.seeds);
  });

  it('emits an empty manifest for an empty campaign stage list', () => {
    const manifest = campaignManifest([], manifestGeneratedAt);

    expect(totalCampaignRuns([])).toBe(0);
    expect(manifest).toEqual({
      generatedAt: manifestGeneratedAt,
      totalRuns: 0,
      stages: [],
    });
  });

  it('keeps campaign stage ID order aligned with the configured campaign ladder', () => {
    expect(SIMULATED_EPOCH_CAMPAIGN.map((stage) => stage.id)).toEqual(CAMPAIGN_STAGE_IDS);
  });
});
