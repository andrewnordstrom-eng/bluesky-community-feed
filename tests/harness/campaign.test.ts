import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_SCENARIO_FAMILY_IDS,
  CAMPAIGN_STAGE_IDS,
  SIMULATED_EPOCH_CAMPAIGN,
  campaignManifest,
  campaignRunsForStage,
  campaignRunsForStages,
  parseCampaignScenarioFamilyId,
  parseCampaignStageId,
  scenarioForCampaignRun,
  selectCampaignStages,
  totalCampaignRuns,
} from '../../src/harness/campaign.js';
import { PERSONA_IDS } from '../../src/harness/personas.js';
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
      for (const run of campaignRunsForStage(stage)) {
        const scenario = run.scenario;
        const parsed = parseScenario(scenario);

        expect(parsed.success).toBe(true);
        if (!parsed.success) {
          continue;
        }
        expect(parsed.data.seed).toBe(run.seed);
        expect(parsed.data.population.subscriberCount).toBe(run.subscriberCount);
        expect(parsed.data.population.postCount).toBe(run.postCount);
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

  it('rejects unknown scenario family IDs at the CLI boundary', () => {
    expect(parseCampaignScenarioFamilyId('baseline')).toBe('baseline');
    expect(() => parseCampaignScenarioFamilyId('rank-choice')).toThrow(/Unknown campaign scenario family/);
    expect(() => parseCampaignScenarioFamilyId('')).toThrow(/Unknown campaign scenario family/);
    expect(() => parseCampaignScenarioFamilyId('Baseline')).toThrow(/Unknown campaign scenario family/);
    expect(() => parseCampaignScenarioFamilyId(' baseline')).toThrow(/Unknown campaign scenario family/);
    expect(() => parseCampaignScenarioFamilyId('baseline ')).toThrow(/Unknown campaign scenario family/);
    expect(() => parseCampaignScenarioFamilyId(undefined as unknown as string)).toThrow(
      /Unknown campaign scenario family/
    );
    expect(() => parseCampaignScenarioFamilyId(null as unknown as string)).toThrow(
      /Unknown campaign scenario family/
    );
  });

  it('emits a manifest with one scenario per seed', () => {
    const stages = selectCampaignStages({ onlyStageId: null, maxStageId: 'S1' });
    const manifest = campaignManifest(stages, manifestGeneratedAt, { onlyFamilyId: null });

    expect(manifest.generatedAt).toBe(manifestGeneratedAt);
    expect(manifest.totalRuns).toBe(totalCampaignRuns(stages));
    expect(manifest.totalRuns).toBe(4);

    const expectedPairs = stages.flatMap((stage) =>
      stage.seeds.map((seed) => `${stage.id}:${seed}`)
    );
    const manifestPairs = manifest.stages.flatMap((stage) =>
      stage.scenarios.map((scenario) => `${stage.id}:${scenario.scenario.seed}`)
    );

    expect(manifestPairs).toEqual(expectedPairs);
    expect(new Set(manifestPairs).size).toBe(expectedPairs.length);
  });

  it('emits a manifest for exact single-stage selections', () => {
    const stages = selectCampaignStages({ onlyStageId: 'S4', maxStageId: null });
    const manifest = campaignManifest(stages, manifestGeneratedAt, { onlyFamilyId: null });

    expect(manifest.stages.map((stage) => stage.id)).toEqual(['S4']);
    expect(manifest.totalRuns).toBe(2);
    expect(manifest.stages[0]?.scenarios.map((scenario) => scenario.scenario.seed)).toEqual([42, 1337]);
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
    const manifest = campaignManifest(stages, manifestGeneratedAt, { onlyFamilyId: null });

    expect(manifest.stages[0]?.seeds).toEqual(stages[0]?.seeds);
    expect(manifest.stages[0]?.seeds).not.toBe(stages[0]?.seeds);
  });

  it('emits an empty manifest for an empty campaign stage list', () => {
    const manifest = campaignManifest([], manifestGeneratedAt, { onlyFamilyId: null });

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

  it('keeps campaign family IDs explicit and sorted by the paper plan surface', () => {
    expect(CAMPAIGN_SCENARIO_FAMILY_IDS).toEqual([
      'baseline',
      'turnout',
      'trim-threshold',
      'persona-skew',
      'polarization',
      'multi-epoch',
      'adversarial',
    ]);
  });

  it('emits deterministic named scenario families for the S2 paper sweep', () => {
    const [stage] = selectCampaignStages({ onlyStageId: 'S2', maxStageId: null });
    if (stage === undefined) {
      throw new Error('expected S2 stage');
    }
    const runsA = campaignRunsForStage(stage);
    const runsB = campaignRunsForStage(stage);

    expect(runsB).toEqual(runsA);
    expect(new Set(runsA.map((run) => run.id)).size).toBe(runsA.length);
    expect(new Set(runsA.map((run) => run.familyId))).toEqual(new Set(CAMPAIGN_SCENARIO_FAMILY_IDS));
    expect(runsA.some((run) => run.familyId === 'turnout' && run.variantId === 'participation-5p')).toBe(true);
    expect(runsA.some((run) => run.familyId === 'trim-threshold' && run.variantId === 'weight-voters-9')).toBe(true);
    expect(runsA.some((run) => run.familyId === 'polarization' && run.variantId.includes('60-40'))).toBe(true);
    expect(runsA.some((run) => run.familyId === 'multi-epoch' && run.variantId === 'drift-engagement-to-bridge-20')).toBe(true);
  });

  it('uses the restricted S3 sweep matrix for follow-up democratic cases', () => {
    const [stage] = selectCampaignStages({ onlyStageId: 'S3', maxStageId: null });
    if (stage === undefined) {
      throw new Error('expected S3 stage');
    }

    const runs = campaignRunsForStage(stage);
    const familyIds = new Set(runs.map((run) => run.familyId));
    const trimVariants = runs
      .filter((run) => run.familyId === 'trim-threshold')
      .map((run) => run.variantId);
    const personaVariants = runs
      .filter((run) => run.familyId === 'persona-skew')
      .map((run) => run.variantId);
    const turnoutSeeds = runs
      .filter((run) => run.familyId === 'turnout')
      .map((run) => run.seed);

    expect(new Set(trimVariants)).toEqual(
      new Set(['weight-voters-9', 'weight-voters-10', 'weight-voters-11'])
    );
    expect(new Set(personaVariants)).toEqual(
      new Set(['dominant-engagement-maximizer', 'dominant-bridge-builder'])
    );
    expect(new Set(turnoutSeeds)).toEqual(new Set([42, 1337]));
    expect(familyIds.has('multi-epoch')).toBe(false);
    expect(familyIds.has('adversarial')).toBe(false);
  });

  it('keeps generated persona mixes aligned with the configured persona IDs', () => {
    const [stage] = selectCampaignStages({ onlyStageId: 'S2', maxStageId: null });
    if (stage === undefined) {
      throw new Error('expected S2 stage');
    }

    const personaRuns = campaignRunsForStage(stage).filter((run) =>
      ['persona-skew', 'polarization', 'adversarial'].includes(run.familyId)
    );
    for (const run of personaRuns) {
      expect(Object.keys(run.scenario.population.personaMix).sort()).toEqual([...PERSONA_IDS].sort());
    }
  });

  it('filters manifests by scenario family without changing the stage selection', () => {
    const stages = selectCampaignStages({ onlyStageId: null, maxStageId: 'S2' });
    const runs = campaignRunsForStages(stages, { onlyFamilyId: 'turnout' });
    const manifest = campaignManifest(stages, manifestGeneratedAt, { onlyFamilyId: 'turnout' });

    expect(manifest.totalRuns).toBe(runs.length);
    expect(manifest.stages.map((stage) => stage.id)).toEqual(['S0', 'S1', 'S2']);
    expect(manifest.stages[0]?.scenarios).toEqual([]);
    expect(manifest.stages[1]?.scenarios).toEqual([]);
    expect(manifest.stages[2]?.scenarios.length).toBeGreaterThan(0);
    expect(manifest.stages[2]?.scenarios.every((scenario) => scenario.familyId === 'turnout')).toBe(true);
  });

  it('keeps the baseline helper as the equal-mix 80% participation scenario', () => {
    const [stage] = selectCampaignStages({ onlyStageId: 'S2', maxStageId: null });
    if (stage === undefined) {
      throw new Error('expected S2 stage');
    }
    const scenario = scenarioForCampaignRun(stage, 42);

    expect(scenario.kind).toBe('epoch-vote-cycle');
    expect(scenario.population.voteParticipationRate).toBe(0.8);
    expect(scenario.population.personaMix).toEqual({
      'engagement-maximizer': 1,
      'chronological-purist': 1,
      'bridge-builder': 1,
      balanced: 1,
    });
  });
});
