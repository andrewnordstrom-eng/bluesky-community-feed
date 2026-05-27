/**
 * Backfill Score Components Script
 *
 * Projects every existing post_scores row into N rows in post_score_components
 * (migration 021). Idempotent: INSERT ... ON CONFLICT DO NOTHING. Safe to run
 * repeatedly; safe to run while the live pipeline is dual-writing new rows.
 *
 * Pairs with PROJ-814 / P1. Once PROJ-817 (P4) flips read flags and PROJ-819
 * (P5) drops the wide columns, this script becomes obsolete and can be removed.
 *
 * Usage:
 *   npx tsx scripts/backfill-score-components.ts                    # all rows, batches of 1000
 *   npx tsx scripts/backfill-score-components.ts --batch-size 500
 *   npx tsx scripts/backfill-score-components.ts --epoch-id 7
 *   npx tsx scripts/backfill-score-components.ts --dry-run --limit 5000
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

/** Wide-column suffix → component_key mapping. Mirrors the 5 columns defined
 * in migration 002_scoring_tables.sql. Hard-coded because the columns themselves
 * are hard-coded; PROJ-819 (P5) deletes both the columns and this script. */
const COMPONENT_PROJECTION = [
  { key: 'recency', col: 'recency' },
  { key: 'engagement', col: 'engagement' },
  { key: 'bridging', col: 'bridging' },
  { key: 'sourceDiversity', col: 'source_diversity' },
  { key: 'relevance', col: 'relevance' },
] as const;

interface CliArgs {
  batchSize: number;
  epochId: number | null;
  limit: number | null;
  dryRun: boolean;
}

/** Parse a positive integer CLI value, exiting with a clear error on bad input.
 *
 * `Number.parseInt` is intentionally lenient: it accepts `"10foo"` (returns 10),
 * `"1.5"` (returns 1), `"2e3"` (returns 2), etc. by stopping at the first
 * non-numeric character. We pre-reject anything that isn't purely digits so the
 * validator actually catches typos and malformed flags. */
function parsePositiveInt(flag: string, raw: string, opts: { min?: number } = {}): number {
  const min = opts.min ?? 1;
  if (!/^\d+$/.test(raw)) {
    console.error(
      `Invalid value for ${flag}: ${JSON.stringify(raw)} — expected a positive integer.`
    );
    process.exit(2);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min) {
    console.error(
      `Invalid value for ${flag}: ${JSON.stringify(raw)} — expected an integer >= ${min}.`
    );
    process.exit(2);
  }
  return value;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let batchSize = 1000;
  let epochId: number | null = null;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size') {
      // Use `?? ''` so a missing or empty value flows into parsePositiveInt
      // and surfaces a clear "--batch-size requires a value" style error
      // instead of silently falling back to the default.
      batchSize = parsePositiveInt('--batch-size', args[i + 1] ?? '', { min: 1 });
      i++;
    } else if (args[i] === '--epoch-id') {
      // epoch_id is SERIAL PRIMARY KEY in governance_epochs (>=1).
      epochId = parsePositiveInt('--epoch-id', args[i + 1] ?? '', { min: 1 });
      i++;
    } else if (args[i] === '--limit') {
      limit = parsePositiveInt('--limit', args[i + 1] ?? '', { min: 1 });
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else {
      console.error(`Unknown argument: ${JSON.stringify(args[i])}`);
      console.error(
        'Usage: npx tsx scripts/backfill-score-components.ts [--batch-size N] [--epoch-id N] [--limit N] [--dry-run]'
      );
      process.exit(2);
    }
  }

  return { batchSize, epochId, limit, dryRun };
}

interface WideRow {
  post_uri: string;
  epoch_id: number;
  recency_score: number;
  engagement_score: number;
  bridging_score: number;
  source_diversity_score: number;
  relevance_score: number;
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
  recency_weighted: number;
  engagement_weighted: number;
  bridging_weighted: number;
  source_diversity_weighted: number;
  relevance_weighted: number;
  scored_at: string;
}

async function main(): Promise<void> {
  const { batchSize, epochId, limit, dryRun } = parseArgs();

  // Require DATABASE_URL explicitly. The pg Pool would otherwise silently
  // fall back to PGHOST/PGUSER/PGDATABASE env vars (or localhost defaults),
  // which is dangerous in a backfill context — a typo could rewrite a
  // local dev DB or fail with a cryptic connection error.
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required. Set it in .env or your shell.');
    process.exit(2);
  }

  console.log(
    `Backfill score components: batchSize=${batchSize}, epochId=${epochId ?? 'all'}, limit=${limit ?? 'none'}, dryRun=${dryRun}`
  );

  const pool = new Pool({ connectionString });

  let totalRowsScanned = 0;
  let totalRowsInserted = 0;
  let lastSeen: { post_uri: string; epoch_id: number } | null = null;
  let batchNumber = 0;

  try {
    while (true) {
      if (limit !== null && totalRowsScanned >= limit) {
        console.log(`Reached --limit ${limit}; stopping.`);
        break;
      }

      const remaining = limit !== null ? limit - totalRowsScanned : batchSize;
      const currentBatchSize = Math.min(batchSize, remaining);

      // Keyset-paginate by (post_uri, epoch_id) so we don't OFFSET-scan a growing table.
      const params: unknown[] = [];
      const where: string[] = [];

      if (epochId !== null) {
        params.push(epochId);
        where.push(`epoch_id = $${params.length}`);
      }
      if (lastSeen !== null) {
        params.push(lastSeen.post_uri, lastSeen.epoch_id);
        where.push(
          `(post_uri, epoch_id) > ($${params.length - 1}, $${params.length})`
        );
      }
      params.push(currentBatchSize);

      const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      const result = await pool.query<WideRow>(
        `SELECT post_uri, epoch_id,
                recency_score, engagement_score, bridging_score,
                source_diversity_score, relevance_score,
                recency_weight, engagement_weight, bridging_weight,
                source_diversity_weight, relevance_weight,
                recency_weighted, engagement_weighted, bridging_weighted,
                source_diversity_weighted, relevance_weighted,
                scored_at
         FROM post_scores
         ${whereSql}
         ORDER BY post_uri, epoch_id
         LIMIT $${params.length}`,
        params
      );

      if (result.rows.length === 0) {
        console.log('No more rows to scan.');
        break;
      }

      batchNumber++;
      totalRowsScanned += result.rows.length;

      // Project each wide row into N component rows.
      const projected: Array<{
        post_uri: string;
        epoch_id: number;
        component_key: string;
        raw: number;
        weight: number;
        weighted: number;
        scored_at: string;
      }> = [];

      for (const row of result.rows) {
        for (const { key, col } of COMPONENT_PROJECTION) {
          projected.push({
            post_uri: row.post_uri,
            epoch_id: row.epoch_id,
            component_key: key,
            raw: row[`${col}_score` as keyof WideRow] as number,
            weight: row[`${col}_weight` as keyof WideRow] as number,
            weighted: row[`${col}_weighted` as keyof WideRow] as number,
            scored_at: row.scored_at,
          });
        }
        lastSeen = { post_uri: row.post_uri, epoch_id: row.epoch_id };
      }

      if (!dryRun && projected.length > 0) {
        // Batch insert via unnest(...) for one round-trip per batch.
        const insertResult = await pool.query<{ count: string }>(
          `WITH inserted AS (
             INSERT INTO post_score_components (post_uri, epoch_id, component_key, raw, weight, weighted, scored_at)
             SELECT * FROM UNNEST(
               $1::text[],
               $2::int[],
               $3::text[],
               $4::float[],
               $5::float[],
               $6::float[],
               $7::timestamptz[]
             )
             ON CONFLICT (post_uri, epoch_id, component_key) DO NOTHING
             RETURNING 1
           )
           SELECT COUNT(*)::text AS count FROM inserted`,
          [
            projected.map((p) => p.post_uri),
            projected.map((p) => p.epoch_id),
            projected.map((p) => p.component_key),
            projected.map((p) => p.raw),
            projected.map((p) => p.weight),
            projected.map((p) => p.weighted),
            projected.map((p) => p.scored_at),
          ]
        );
        const insertedCount = parseInt(insertResult.rows[0]?.count ?? '0', 10);
        totalRowsInserted += insertedCount;
        console.log(
          `[batch ${batchNumber}] scanned=${result.rows.length} projected=${projected.length} inserted=${insertedCount} (skipped=${projected.length - insertedCount})`
        );
      } else {
        console.log(
          `[batch ${batchNumber}] scanned=${result.rows.length} projected=${projected.length} (dry-run; no writes)`
        );
      }
    }

    console.log('---');
    console.log(`Total batches: ${batchNumber}`);
    console.log(`Total post_scores rows scanned: ${totalRowsScanned}`);
    console.log(`Total post_score_components rows inserted: ${totalRowsInserted}`);
    console.log(
      `Expected projection: ${totalRowsScanned} × ${COMPONENT_PROJECTION.length} = ${totalRowsScanned * COMPONENT_PROJECTION.length} rows`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
