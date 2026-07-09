/**
 * Simulation Harness — Public API
 *
 * This is the ONLY file outside `src/harness/**` should import from. Every
 * other file in this directory is an internal implementation detail; the
 * exports below are the harness's stable, versioned contract (PROJ-1482 /
 * A1 — headless simulation core).
 */

export { ScenarioV1Schema, PopulationConfigSchema, PersonaMixSchema, parseScenario } from './scenario.js';
export type { Scenario, ScenarioV1, PopulationConfig, PersonaMix, ParseScenarioResult } from './scenario.js';

export {
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
} from './campaign.js';
export type {
  CampaignManifest,
  CampaignManifestScenario,
  CampaignManifestStage,
  CampaignSelection,
  CampaignScenarioFamilyId,
  CampaignScenarioRun,
  CampaignStage,
  CampaignStageId,
} from './campaign.js';

export {
  CampaignRunReceiptSchema,
  FeedImpactReceiptSchema,
  CampaignSummarySchema,
  aggregateCampaignRuns,
  campaignAggregatesToCsv,
  campaignRunsToCsv,
  feedImpactReceipt,
  writeCampaignAnalysisArtifacts,
} from './campaign-summary.js';
export type {
  CampaignAggregateRow,
  CampaignFeedImpactReceipt,
  CampaignRunReceipt,
  CampaignSummary,
  WrittenCampaignAnalysisPaths,
} from './campaign-summary.js';

export {
  collectArtifactDescriptor,
  collectGitBranch,
  collectGitState,
  collectGitStateWithDefaultBase,
  collectRuntimeState,
  createLabRunId,
  ensureDirectory,
  resolveLabRunDirectory,
  sha256File,
  sha256Text,
  writeChecksums,
  writeJsonArtifact,
  writeLabManifest,
} from './lab-artifacts.js';
export type {
  LabArtifactDescriptor,
  LabClaim,
  LabCommandReceipt,
  LabGitState,
  LabManifest,
  LabRuntimeState,
} from './lab-artifacts.js';

export { Simulation } from './simulation.js';
export type {
  SimulationDeps,
  SimulationResult,
  SimulationEvent,
  TopScoredPost,
  QueryableDb,
  EpochRoundResult,
  AuditLogRow,
} from './simulation.js';

export { runScenario } from './run.js';
export type { RunScenarioOptions, RunScenarioResult } from './run.js';

export {
  measure,
  measureEpochSeries,
  toArtifacts,
  writeArtifacts,
  writeEpochSeriesArtifacts,
  RunMetricsSchema,
  RunArtifactsSchema,
  EpochSeriesRowSchema,
  AuditLogRowSchema,
} from './metrics.js';
export type { RunMetrics, RunArtifacts, WrittenArtifactPaths, EpochSeriesRow, WrittenEpochSeriesPaths } from './metrics.js';

export { l2Distance, l1Distance, weightVectorVariance, hasConverged } from './convergence.js';

export {
  effectiveTrimCount,
  buildOtherVoterReports,
  runStrategyproofnessTrial,
  writeStrategyproofnessArtifacts,
  sumsToOne,
  SEED_FOCAL_TRUE,
  SEED_FOCAL_CORNER,
} from './strategyproofness.js';
export type {
  StrategyproofnessDeps,
  StrategyproofnessTrialInput,
  StrategyproofnessTrialResult,
  WrittenStrategyproofnessArtifactPaths,
} from './strategyproofness.js';

export { createRng, SeededClock } from './rng.js';
export type { Rng, Clock } from './rng.js';

export {
  buildBaselineComparisonArtifactRows,
  runBaselineComparison,
  writeBaselineComparisonArtifacts,
  REGIME_NAMES,
} from './baseline-comparison.js';
export type {
  RegimeName,
  BaselineComparisonDeps,
  RegimeResult,
  BaselineComparisonResult,
  RunBaselineComparisonOptions,
  BaselineComparisonArtifactRows,
  BaselineComparisonCsvRow,
  RegimeSummaryCsvRow,
  WrittenBaselineComparisonPaths,
} from './baseline-comparison.js';

export {
  normalizedRankDisplacement,
  kendallTauDistance,
  dominantTopic,
  minorityTopicExposure,
  buildCorpusTopicSupport,
  authorHHI,
  authorGini,
  distortionRatio,
} from './feed-metrics.js';
export type { FeedEntry, FeedPostInfo } from './feed-metrics.js';

export { generatePopulation, TOPIC_SLUGS } from './population.js';
export type { Population, SubscriberSeed, PostSeed, VoteSeed } from './population.js';

export { PERSONA_IDS, PERSONAS, DEFAULT_PERSONA_MIX, pickPersona, castPersonaVote } from './personas.js';
export type { PersonaId, Persona, PersonaVote } from './personas.js';

export { validateVote } from './vote-validation.js';
export type { RawVotePayload, VoteValidationContext, ValidatedVote, VoteValidationResult } from './vote-validation.js';

export {
  assertEphemeralPostgresUrl,
  assertEphemeralRedisUrl,
  assertEphemeralTarget,
  ProdGuardError,
} from './prod-guard.js';
export type { GuardOptions } from './prod-guard.js';
