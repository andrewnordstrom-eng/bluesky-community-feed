import { db } from '../src/db/client.js';
import { canonicalJson } from '../src/governance/policy-version.js';
import {
  decodeCompressedRankingInput,
  loadRankingRunInput,
} from '../src/scoring/ranking-run-contracts.js';

function parseRunId(argv: string[]): string {
  const index = argv.indexOf('--run-id');
  const runId = index >= 0 ? argv[index + 1] : undefined;
  if (!runId || runId.trim().length === 0) {
    throw new Error('Usage: tsx scripts/replay-ranking-run.ts --run-id <uuid>');
  }
  return runId;
}

async function main(argv: string[]): Promise<void> {
  const runId = parseRunId(argv);
  const client = await db.connect();
  try {
    const compressed = await loadRankingRunInput(client, runId);
    const envelope = decodeCompressedRankingInput(compressed);
    process.stdout.write(`${canonicalJson(envelope)}\n`);
  } finally {
    client.release();
    await db.end();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Ranking-run replay failed: ${message}\n`);
  process.exitCode = 1;
});
