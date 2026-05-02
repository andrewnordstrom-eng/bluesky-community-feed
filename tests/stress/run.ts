import type { ScenarioResult } from './_helpers.js';
import { runConcurrentWritesStress } from './concurrent-writes.stress.js';
import { runFeedSkeletonStress } from './feed-skeleton.stress.js';

type ScenarioName = 'all' | 'feed-skeleton' | 'concurrent-writes';

interface Scenario {
  name: Exclude<ScenarioName, 'all'>;
  run: () => Promise<ScenarioResult>;
}

const SCENARIOS: Scenario[] = [
  { name: 'feed-skeleton', run: runFeedSkeletonStress },
  { name: 'concurrent-writes', run: runConcurrentWritesStress },
];

function parseScenarioName(args: readonly string[]): ScenarioName {
  const scenarioFlagIndex = args.indexOf('--scenario');
  if (scenarioFlagIndex !== -1) {
    const flagValue = args[scenarioFlagIndex + 1];
    if (isScenarioName(flagValue)) {
      return flagValue;
    }

    throw new RangeError(`unsupported --scenario value: ${flagValue ?? '<missing>'}`);
  }

  const firstArg = args[0];
  if (typeof firstArg === 'string' && isScenarioName(firstArg)) {
    return firstArg;
  }

  if (typeof firstArg === 'string') {
    throw new RangeError(`unsupported scenario: ${firstArg}`);
  }

  return 'all';
}

function isScenarioName(value: string | undefined): value is ScenarioName {
  return value === 'all' || value === 'feed-skeleton' || value === 'concurrent-writes';
}

function selectScenarios(scenarioName: ScenarioName): Scenario[] {
  if (scenarioName === 'all') {
    return SCENARIOS;
  }

  return SCENARIOS.filter((scenario) => scenario.name === scenarioName);
}

async function runSelectedScenarios(scenarios: readonly Scenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  // Await each scenario.run() before starting the next stress case so ports, memory, and DB/cache pressure stay isolated.
  for (const scenario of scenarios) {
    const result = await scenario.run();
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  return results;
}

async function main(): Promise<void> {
  const scenarioName = parseScenarioName(process.argv.slice(2));
  const results = await runSelectedScenarios(selectScenarios(scenarioName));
  const success = results.every((result) => result.success);
  process.exit(success ? 0 : 1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
