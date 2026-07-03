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

export { Simulation } from './simulation.js';
export type {
  SimulationDeps,
  SimulationResult,
  SimulationEvent,
  TopScoredPost,
  QueryableDb,
} from './simulation.js';

export { runScenario } from './run.js';
export type { RunScenarioOptions, RunScenarioResult } from './run.js';

export { measure, toArtifacts, writeArtifacts, RunMetricsSchema, RunArtifactsSchema } from './metrics.js';
export type { RunMetrics, RunArtifacts, WrittenArtifactPaths } from './metrics.js';

export { createRng, SeededClock } from './rng.js';
export type { Rng, Clock } from './rng.js';

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
