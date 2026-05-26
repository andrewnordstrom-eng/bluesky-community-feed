/**
 * Backfill Governance Weights Script (PROJ-815 / P2)
 *
 * Projects every existing governance_epochs and governance_votes row's wide
 * weight columns into the long-table side tables governance_epoch_weights
 * and governance_vote_weights (migration 022). Idempotent: INSERT ... ON
 * CONFLICT DO NOTHING. Safe to run repeatedly; safe to run while the live
 * server is dual-writing new rows.
 *
 * Pairs with PROJ-815 / P2. Once PROJ-817 (P4) flips the read flag and
 * PROJ-819 (P5) drops the wide columns, this script becomes obsolete.
 *
 * Usage:
 *   npx tsx scripts/backfill-governance-weights.ts                    # all rows, batches of 500
 *   npx tsx scripts/backfill-governance-weights.ts --batch-size 200
 *   npx tsx scripts/backfill-governance-weights.ts --table votes      # just votes
 *   npx tsx scripts/backfill-governance-weights.ts --table epochs     # just epochs
 *   npx tsx scripts/backfill-governance-weights.ts --dry-run --limit 1000
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/** Wide-column suffix → component_key mapping. Mirrors the 5 columns defined
 * in migration 003_governance_tables.sql. Hard-coded because the columns
 * themselves are hard-coded; PROJ-819 (P5) deletes both the columns and this
 * script. */
const COMPONENT_PROJECTION = [
  { key: 'recency', col: 'recency_weight' },
  { key: 'engagement', col: 'engagement_weight' },
  { key: 'bridging', col: 'bridging_weight' },
  { key: 'sourceDiversity', col: 'source_diversity_weight' },
  { key: 'relevance', col: 'relevance_weight' },
] as const;

type TargetTable = 'epochs' | 'votes' | 'both';

interface CliArgs {
  batchSize: number;
  limit: number | null;
  dryRun: boolean;
  table: TargetTable;
}

function parsePositiveInt(flag: string, raw: string, opts: { min?: number } = {}): number {
  const value = Number.parseInt(raw, 10);
  const min = opts.min ?? 1;
  if (!Number.isFinite(value) || Number.isNaN(value) || value < min) {
    console.error(
      `Invalid value for ${flag}: ${JSON.stringify(raw)} — expected an integer >= ${min}.`
    );
    process.exit(2);
  }
  return value;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let batchSize = 500;
  let limit: number | null = null;
  let dryRun = false;
  let table: TargetTable = 'both';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parsePositiveInt('--batch-size', args[i + 1], { min: 1 });
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parsePositiveInt('--limit', args[i + 1], { min: 1 });
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--table' && args[i + 1]) {
      const candidate = args[i + 1] as TargetTable;
      if (candidate !== 'epochs' && candidate !== 'votes' && candidate !== 'both') {
        console.error(`Invalid --table value: ${JSON.stringify(candidate)} — expected epochs|votes|both.`);
        process.exit(2);
      }
      table = candidate;
      i++;
    } else {
      console.error(`Unknown argument: ${JSON.stringify(args[i])}`);
      console.error(
        'Usage: npx tsx scripts/backfill-governance-weights.ts [--batch-size N] [--limit N] [--dry-run] [--table epochs|votes|both]'
      );
      process.exit(2);
    }
  }

  return { batchSize, limit, dryRun, table };
}

interface BackfillStats {
  scanned: number;
  inserted: number;
  batches: number;
}

async function backfillTable(
  pool: Pool,
  args: CliArgs,
  source: 'governance_epochs' | 'governance_votes'
): Promise<BackfillStats> {
  const isEpoch = source === 'governance_epochs';
  const idColumn = isEpoch ? 'id' : 'id';
  const targetTable = isEpoch ? 'governance_epoch_weights' : 'governance_vote_weights';
  const targetIdColumn = isEpoch ? 'epoch_id' : 'vote_id';
  const idType = isEpoch ? 'int' : 'uuid';

  const stats: BackfillStats = { scanned: 0, inserted: 0, batches: 0 };
  let lastSeen: number | string | null = null;

  while (true) {
    if (args.limit !== null && stats.scanned >= args.limit) {
      console.log(`[${source}] Reached --limit ${args.limit}; stopping.`);
      break;
    }

    const remaining = args.limit !== null ? args.limit - stats.scanned : args.batchSize;
    const currentBatchSize = Math.min(args.batchSize, remaining);

    const params: unknown[] = [];
    const where: string[] = [];

    if (lastSeen !== null) {
      params.push(lastSeen);
      where.push(`${idColumn} > $${params.length}`);
    }
    params.push(currentBatchSize);

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT ${idColumn},
              ${COMPONENT_PROJECTION.map((c) => c.col).join(', ')}
       FROM ${source}
       ${whereSql}
       ORDER BY ${idColumn}
       LIMIT $${params.length}`,
      params
    );

    if (result.rows.length === 0) {
      console.log(`[${source}] No more rows to scan.`);
      break;
    }

    stats.batches++;
    stats.scanned += result.rows.length;

    // Project each wide row into N long-table rows. Skip rows where every
    // weight column is NULL (keyword-only votes; nothing to project).
    const projectedIds: Array<number | string> = [];
    const projectedKeys: string[] = [];
    const projectedWeights: number[] = [];

    for (const row of result.rows) {
      const rowId = row[idColumn] as number | string;
      lastSeen = rowId;

      let projectedAny = false;
      for (const { key, col } of COMPONENT_PROJECTION) {
        const weight = row[col];
        if (typeof weight === 'number' && Number.isFinite(weight)) {
          projectedIds.push(rowId);
          projectedKeys.push(key);
          projectedWeights.push(weight);
          projectedAny = true;
        }
      }
      // Useful for debugging: log keyword-only votes that get skipped.
      if (!projectedAny && !isEpoch) {
        // Common case for keyword-only votes — quiet.
      }
    }

    if (projectedIds.length === 0) {
      console.log(`[${source} batch ${stats.batches}] scanned=${result.rows.length} projected=0 (all keyword-only)`);
      continue;
    }

    if (!args.dryRun) {
      const insertResult = await pool.query<{ count: string }>(
        `WITH inserted AS (
           INSERT INTO ${targetTable} (${targetIdColumn}, component_key, weight)
           SELECT * FROM UNNEST(
             $1::${idType}[],
             $2::text[],
             $3::float[]
           )
           ON CONFLICT (${targetIdColumn}, component_key) DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM inserted`,
        [projectedIds, projectedKeys, projectedWeights]
      );
      const insertedCount = parseInt(insertResult.rows[0]?.count ?? '0', 10);
      stats.inserted += insertedCount;
      console.log(
        `[${source} batch ${stats.batches}] scanned=${result.rows.length} projected=${projectedIds.length} inserted=${insertedCount} (skipped=${projectedIds.length - insertedCount})`
      );
    } else {
      console.log(
        `[${source} batch ${stats.batches}] scanned=${result.rows.length} projected=${projectedIds.length} (dry-run; no writes)`
      );
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(
    `Backfill governance weights: batchSize=${args.batchSize}, table=${args.table}, limit=${args.limit ?? 'none'}, dryRun=${args.dryRun}`
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    let epochStats: BackfillStats | null = null;
    let voteStats: BackfillStats | null = null;

    if (args.table === 'epochs' || args.table === 'both') {
      epochStats = await backfillTable(pool, args, 'governance_epochs');
    }
    if (args.table === 'votes' || args.table === 'both') {
      voteStats = await backfillTable(pool, args, 'governance_votes');
    }

    console.log('---');
    if (epochStats) {
      console.log(`Epochs: ${epochStats.scanned} scanned, ${epochStats.inserted} inserted, ${epochStats.batches} batches`);
    }
    if (voteStats) {
      console.log(`Votes:  ${voteStats.scanned} scanned, ${voteStats.inserted} inserted, ${voteStats.batches} batches`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
