/**
 * Simulated Epoch Campaign
 *
 * A typed ladder of reproducible governance simulation runs. This module is
 * deliberately pure: it defines what to run, but never touches Postgres,
 * Redis, Docker, or the filesystem. Entrypoints such as scripts/sim-campaign.ts
 * perform the actual I/O after applying the production guard.
 */

import { z } from 'zod';
import { DEFAULT_PERSONA_MIX } from './personas.js';
import type { Scenario } from './scenario.js';

export const CAMPAIGN_STAGE_IDS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5'] as const;
export const CampaignStageIdSchema = z.enum(CAMPAIGN_STAGE_IDS);
export type CampaignStageId = (typeof CAMPAIGN_STAGE_IDS)[number];

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
}

export interface CampaignManifestStage {
  id: CampaignStageId;
  label: string;
  subscriberCount: number;
  postCount: number;
  seeds: number[];
  expectation: CampaignStage['expectation'];
  scenarios: Scenario[];
}

export interface CampaignManifest {
  generatedAt: string;
  totalRuns: number;
  stages: CampaignManifestStage[];
}

const GATE_STAGE_SEEDS = [42, 1337, 20260705] as const;

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
  return {
    kind: 'epoch-vote-cycle',
    version: 1,
    seed,
    population: {
      subscriberCount: stage.subscriberCount,
      postCount: stage.postCount,
      voteParticipationRate: 0.8,
      contentVoteRate: 0.2,
      castsWeightVoteRate: 0.9,
      castsTopicVoteRate: 0.5,
      personaMix: { ...DEFAULT_PERSONA_MIX },
    },
  };
}

export function totalCampaignRuns(stages: readonly CampaignStage[]): number {
  return stages.reduce((sum, stage) => sum + stage.seeds.length, 0);
}

export function campaignManifest(
  stages: readonly CampaignStage[],
  generatedAt: string
): CampaignManifest {
  return {
    generatedAt,
    totalRuns: totalCampaignRuns(stages),
    stages: stages.map((stage) => ({
      ...stage,
      seeds: [...stage.seeds],
      scenarios: stage.seeds.map((seed) => scenarioForCampaignRun(stage, seed)),
    })),
  };
}
