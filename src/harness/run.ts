/**
 * Run Orchestration
 *
 * `runScenario` is the harness's top-level entrypoint: validate config →
 * drive the simulation → measure → (optionally) write artifacts. This is the
 * "config → run → artifacts" pipeline the DST-style architecture calls for.
 */

import { randomUUID } from 'node:crypto';
import { parseScenario } from './scenario.js';
import { Simulation, type SimulationDeps } from './simulation.js';
import { measure, toArtifacts, writeArtifacts, type RunMetrics, type RunArtifacts } from './metrics.js';

export interface RunScenarioOptions {
  deps: SimulationDeps;
  /** When set, writes metrics.json + summary.csv under this directory. */
  artifactsDir?: string;
}

export interface RunScenarioResult {
  metrics: RunMetrics;
  artifacts: RunArtifacts;
  artifactPaths?: { jsonPath: string; csvPath: string };
}

/**
 * Validate `input` as a Scenario, run it, and return schema-validated
 * metrics + artifacts. Throws on invalid scenario input or simulation
 * failure — callers that need a non-throwing boundary should call
 * `parseScenario` themselves first.
 */
export async function runScenario(input: unknown, options: RunScenarioOptions): Promise<RunScenarioResult> {
  const parsed = parseScenario(input);
  if (!parsed.success) {
    throw new Error(`Invalid scenario: ${parsed.error.message}`);
  }
  const scenario = parsed.data;

  const simulation = new Simulation(scenario, options.deps);
  const result = await simulation.run();

  const metrics = measure(result);
  const runId = randomUUID();
  const generatedAt = options.deps.clock.now().toISOString();
  const artifacts = toArtifacts(runId, generatedAt, metrics, result.events);

  const artifactPaths = options.artifactsDir
    ? await writeArtifacts(options.artifactsDir, artifacts)
    : undefined;

  return { metrics, artifacts, artifactPaths };
}
