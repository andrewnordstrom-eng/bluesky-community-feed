/**
 * Simulated Epoch Campaign
 *
 * A typed ladder of reproducible governance simulation runs. This module is
 * deliberately pure: it defines what to run, but never touches Postgres,
 * Redis, Docker, or the filesystem. Entrypoints such as scripts/sim-campaign.ts
 * perform the actual I/O after applying the production guard.
 */

import { z } from 'zod';
import { DEFAULT_PERSONA_MIX, PERSONA_IDS, type PersonaId } from './personas.js';
import type { PersonaMix, PopulationConfig, Scenario } from './scenario.js';

export const CAMPAIGN_STAGE_IDS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;
export const CampaignStageIdSchema = z.enum(CAMPAIGN_STAGE_IDS);
export type CampaignStageId = (typeof CAMPAIGN_STAGE_IDS)[number];

export const CAMPAIGN_SCENARIO_FAMILY_IDS = [
  'baseline',
  'turnout',
  'trim-threshold',
  'persona-skew',
  'polarization',
  'multi-epoch',
  'adversarial',
] as const;
export const CampaignScenarioFamilyIdSchema = z.enum(CAMPAIGN_SCENARIO_FAMILY_IDS);
export type CampaignScenarioFamilyId = (typeof CAMPAIGN_SCENARIO_FAMILY_IDS)[number];

export interface CampaignStage {
  id: CampaignStageId;
  label: string;
  subscriberCount: number;
  postCount: number;
  seeds: readonly number[];
  expectation: 'gate' | 'capacity';
}

export interface CampaignSelection {
  onlyStageId: string | null;
  maxStageId: string | null;
  onlyFamilyId?: string | null;
}

export interface CampaignScenarioRun {
  id: string;
  stageId: CampaignStageId;
  stageLabel: string;
  familyId: CampaignScenarioFamilyId;
  variantId: string;
  label: string;
  seed: number;
  subscriberCount: number;
  postCount: number;
  expectation: CampaignStage['expectation'];
  scenario: Scenario;
}

export interface CampaignManifestScenario {
  id: string;
  familyId: CampaignScenarioFamilyId;
  variantId: string;
  label: string;
  seed: number;
  expectation: CampaignStage['expectation'];
  scenario: Scenario;
}

export interface CampaignManifestStage {
  id: CampaignStageId;
  label: string;
  subscriberCount: number;
  postCount: number;
  seeds: number[];
  expectation: CampaignStage['expectation'];
  scenarios: CampaignManifestScenario[];
}

export interface CampaignManifest {
  generatedAt: string;
  totalRuns: number;
  stages: CampaignManifestStage[];
}

const GATE_STAGE_SEEDS = [42, 1337, 20260705] as const;
const SELECTED_S3_SWEEP_SEEDS = [42, 1337] as const;
const MULTI_EPOCH_SEEDS = [42] as const;

export const SIMULATED_EPOCH_CAMPAIGN: readonly CampaignStage[] = [
  {
    id: 'S0',
    label: 'smoke',
    subscriberCount: 30,
    postCount: 50,
    seeds: [42],
    expectation: 'gate',
  },
  {
    id: 'S1',
    label: 'small',
    subscriberCount: 100,
    postCount: 500,
    seeds: GATE_STAGE_SEEDS,
    expectation: 'gate',
  },
  {
    id: 'S2',
    label: 'medium',
    subscriberCount: 500,
    postCount: 2_000,
    seeds: GATE_STAGE_SEEDS,
    expectation: 'gate',
  },
  {
    id: 'S3',
    label: 'legacy-ceiling',
    subscriberCount: 2_000,
    postCount: 5_000,
    seeds: GATE_STAGE_SEEDS,
    expectation: 'gate',
  },
  {
    id: 'S4',
    label: 'stretch',
    subscriberCount: 5_000,
    postCount: 20_000,
    seeds: [42, 1337],
    expectation: 'capacity',
  },
  {
    id: 'S5',
    label: 'target-ceiling',
    subscriberCount: 10_000,
    postCount: 50_000,
    seeds: [42, 1337],
    expectation: 'capacity',
  },
] as const;

function cloneCampaignStage(stage: CampaignStage): CampaignStage {
  return {
    ...stage,
    seeds: [...stage.seeds],
  };
}

export function parseCampaignStageId(value: string): CampaignStageId {
  const parsed = CampaignStageIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new RangeError(
      `Unknown campaign stage "${value}". Expected one of: ${CAMPAIGN_STAGE_IDS.join(', ')}`
    );
  }
  return parsed.data;
}

export function parseCampaignScenarioFamilyId(value: string): CampaignScenarioFamilyId {
  const parsed = CampaignScenarioFamilyIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new RangeError(
      `Unknown campaign scenario family "${value}". Expected one of: ${CAMPAIGN_SCENARIO_FAMILY_IDS.join(', ')}`
    );
  }
  return parsed.data;
}

export function selectCampaignStages(selection: CampaignSelection): CampaignStage[] {
  if (selection.onlyStageId !== null && selection.maxStageId !== null) {
    throw new RangeError('Campaign selection cannot set both onlyStageId and maxStageId');
  }

  if (selection.onlyStageId !== null) {
    const onlyStageId = parseCampaignStageId(selection.onlyStageId);
    const matches = SIMULATED_EPOCH_CAMPAIGN.filter((stage) => stage.id === onlyStageId);
    if (matches.length === 0) {
      throw new RangeError(`Campaign stage "${onlyStageId}" is not configured in SIMULATED_EPOCH_CAMPAIGN`);
    }
    return matches.map((stage) => cloneCampaignStage(stage));
  }

  if (selection.maxStageId !== null) {
    const maxStageId = parseCampaignStageId(selection.maxStageId);
    const maxIndex = SIMULATED_EPOCH_CAMPAIGN.findIndex((stage) => stage.id === maxStageId);
    if (maxIndex === -1) {
      throw new RangeError(`Campaign stage "${maxStageId}" is not configured in SIMULATED_EPOCH_CAMPAIGN`);
    }
    return SIMULATED_EPOCH_CAMPAIGN.slice(0, maxIndex + 1).map((stage) => cloneCampaignStage(stage));
  }

  return SIMULATED_EPOCH_CAMPAIGN.map((stage) => cloneCampaignStage(stage));
}

export function scenarioForCampaignRun(stage: CampaignStage, seed: number): Scenario {
  return epochScenario(stage, seed, {});
}

function basePopulation(stage: CampaignStage): PopulationConfig {
  return {
    subscriberCount: stage.subscriberCount,
    postCount: stage.postCount,
    voteParticipationRate: 0.8,
    contentVoteRate: 0.2,
    castsWeightVoteRate: 0.9,
    castsTopicVoteRate: 0.5,
    personaMix: { ...DEFAULT_PERSONA_MIX },
  };
}

function epochScenario(
  stage: CampaignStage,
  seed: number,
  overrides: Partial<PopulationConfig>
): Scenario {
  return {
    kind: 'epoch-vote-cycle',
    version: 1,
    seed,
    population: { ...basePopulation(stage), ...overrides },
  };
}

function scenarioRun(
  stage: CampaignStage,
  familyId: CampaignScenarioFamilyId,
  variantId: string,
  label: string,
  seed: number,
  scenario: Scenario
): CampaignScenarioRun {
  return {
    id: `${stage.id}:${familyId}:${variantId}:${seed}`,
    stageId: stage.id,
    stageLabel: stage.label,
    familyId,
    variantId,
    label,
    seed,
    subscriberCount: scenario.population.subscriberCount,
    postCount: scenario.population.postCount,
    expectation: stage.expectation,
    scenario,
  };
}

function personaMixFromValues(valueForPersona: (personaId: PersonaId) => number): PersonaMix {
  return Object.fromEntries(
    PERSONA_IDS.map((personaId) => [personaId, valueForPersona(personaId)] as const)
  ) as PersonaMix;
}

function personaMixWithDominantPersona(dominantPersonaId: PersonaId): PersonaMix {
  return personaMixFromValues((personaId) => (personaId === dominantPersonaId ? 70 : 10));
}

function twoBlocMix(engagementShare: number): PersonaMix {
  return personaMixFromValues((personaId) => {
    if (personaId === 'engagement-maximizer') {
      return engagementShare;
    }
    if (personaId === 'chronological-purist') {
      return 1 - engagementShare;
    }
    return 0;
  });
}

function trimThresholdScenario(stage: CampaignStage, seed: number, voterCount: number): Scenario {
  return epochScenario(stage, seed, {
    subscriberCount: voterCount,
    voteParticipationRate: 1,
    castsWeightVoteRate: 1,
    castsTopicVoteRate: 0.5,
  });
}

function stageSeedsForSweep(stage: CampaignStage): readonly number[] {
  return stage.id === 'S3' ? SELECTED_S3_SWEEP_SEEDS : stage.seeds;
}

export function campaignRunsForStage(stage: CampaignStage): CampaignScenarioRun[] {
  const runs: CampaignScenarioRun[] = stage.seeds.map((seed) =>
    scenarioRun(stage, 'baseline', 'equal-mix-80p', 'equal persona mix, 80% voter participation', seed, scenarioForCampaignRun(stage, seed))
  );

  if (stage.expectation === 'capacity' || (stage.id !== 'S2' && stage.id !== 'S3')) {
    return runs;
  }

  for (const participationRate of [0.05, 0.1, 0.25, 0.5, 0.8] as const) {
    for (const seed of stageSeedsForSweep(stage)) {
      runs.push(
        scenarioRun(
          stage,
          'turnout',
          `participation-${Math.round(participationRate * 100)}p`,
          `${Math.round(participationRate * 100)}% weight-voter participation`,
          seed,
          epochScenario(stage, seed, {
            voteParticipationRate: participationRate,
            castsWeightVoteRate: 1,
          })
        )
      );
    }
  }

  for (const voterCount of [1, 2, 3, 5, 9, 10, 11] as const) {
    const seeds =
      stage.id === 'S3' && voterCount !== 9 && voterCount !== 10 && voterCount !== 11
        ? []
        : stageSeedsForSweep(stage);
    for (const seed of seeds) {
      runs.push(
        scenarioRun(
          stage,
          'trim-threshold',
          `weight-voters-${voterCount}`,
          `${voterCount} exact weight voter(s)`,
          seed,
          trimThresholdScenario(stage, seed, voterCount)
        )
      );
    }
  }

  for (const personaId of PERSONA_IDS) {
    const seeds = stage.id === 'S3' && personaId !== 'engagement-maximizer' && personaId !== 'bridge-builder'
      ? []
      : stageSeedsForSweep(stage);
    for (const seed of seeds) {
      runs.push(
        scenarioRun(
          stage,
          'persona-skew',
          `dominant-${personaId}`,
          `${personaId} electorate at 70%`,
          seed,
          epochScenario(stage, seed, {
            personaMix: personaMixWithDominantPersona(personaId),
          })
        )
      );
    }
  }

  for (const engagementShare of [0.5, 0.6] as const) {
    for (const seed of stageSeedsForSweep(stage)) {
      runs.push(
        scenarioRun(
          stage,
          'polarization',
          `engagement-vs-chronological-${Math.round(engagementShare * 100)}-${Math.round((1 - engagementShare) * 100)}`,
          `engagement-maximizer vs chronological-purist ${Math.round(engagementShare * 100)}/${Math.round((1 - engagementShare) * 100)}`,
          seed,
          epochScenario(stage, seed, {
            personaMix: twoBlocMix(engagementShare),
          })
        )
      );
    }
  }

  if (stage.id === 'S2') {
    for (const seed of MULTI_EPOCH_SEEDS) {
      runs.push(
        scenarioRun(
          stage,
          'multi-epoch',
          'stable-20',
          '20 stable-preference epochs',
          seed,
          {
            kind: 'multi-epoch-cycle',
            version: 1,
            seed,
            rounds: 20,
            population: basePopulation(stage),
          }
        )
      );
      runs.push(
        scenarioRun(
          stage,
          'multi-epoch',
          'drift-engagement-to-bridge-20',
          '20 epochs drifting from engagement-heavy to bridge-heavy',
          seed,
          {
            kind: 'multi-epoch-cycle',
            version: 1,
            seed,
            rounds: 20,
            personaDrift: {
              from: personaMixWithDominantPersona('engagement-maximizer'),
              to: personaMixWithDominantPersona('bridge-builder'),
            },
            population: {
              ...basePopulation(stage),
              personaMix: personaMixWithDominantPersona('engagement-maximizer'),
            },
          }
        )
      );
    }

    for (const attackerFraction of [0.1, 0.25, 0.4] as const) {
      for (const seed of stage.seeds) {
        runs.push(
          scenarioRun(
            stage,
            'adversarial',
            `engagement-attacker-${Math.round(attackerFraction * 100)}p`,
            `${Math.round(attackerFraction * 100)}% engagement-maximizer attacker bloc`,
            seed,
            epochScenario(stage, seed, {
              personaMix: personaMixFromValues((personaId) => {
                if (personaId === 'engagement-maximizer') {
                  return attackerFraction;
                }
                if (personaId === 'bridge-builder') {
                  return 1 - attackerFraction;
                }
                return 0;
              }),
            })
          )
        );
      }
    }
  }

  return runs;
}

export function campaignRunsForStages(
  stages: readonly CampaignStage[],
  selection: Pick<CampaignSelection, 'onlyFamilyId'>
): CampaignScenarioRun[] {
  const onlyFamilyId =
    selection.onlyFamilyId === undefined || selection.onlyFamilyId === null
      ? null
      : parseCampaignScenarioFamilyId(selection.onlyFamilyId);
  const runs = stages.flatMap((stage) => campaignRunsForStage(stage));
  if (onlyFamilyId === null) {
    return runs;
  }
  return runs.filter((run) => run.familyId === onlyFamilyId);
}

export function totalCampaignRuns(stages: readonly CampaignStage[]): number {
  return campaignRunsForStages(stages, { onlyFamilyId: null }).length;
}

export function campaignManifest(
  stages: readonly CampaignStage[],
  generatedAt: string,
  selection: Pick<CampaignSelection, 'onlyFamilyId'>
): CampaignManifest {
  const runs = campaignRunsForStages(stages, selection);
  return {
    generatedAt,
    totalRuns: runs.length,
    stages: stages.map((stage) => ({
      ...stage,
      seeds: [...stage.seeds],
      scenarios: runs
        .filter((run) => run.stageId === stage.id)
        .map((run) => ({
          id: run.id,
          familyId: run.familyId,
          variantId: run.variantId,
          label: run.label,
          seed: run.seed,
          expectation: run.expectation,
          scenario: run.scenario,
        })),
    })),
  };
}
