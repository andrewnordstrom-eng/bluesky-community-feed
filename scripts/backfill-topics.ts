/**
 * Backfill Topics Script
 *
 * Classifies existing posts that have empty topic_vector.
 * Runs standalone with its own DB connection (no server dependencies).
 *
 * Usage:
 *   npm run backfill-topics -- --batch-size 500
 *   npm run backfill-topics -- --batch-size 100 --dry-run
 *   npm run backfill-topics -- --batch-size 500 --limit 5000
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { classifyPost } from '../src/scoring/topics/classifier.js';
import type { Topic } from '../src/scoring/topics/taxonomy.js';

dotenv.config();

/** Parse CLI args from process.argv. */
function parseArgs(): { batchSize: number; dryRun: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  let batchSize = 500;
  let dryRun = false;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { batchSize, dryRun, limit };
}

async function main() {
  const { batchSize, dryRun, limit } = parseArgs();

  console.log(`Backfill topics: batchSize=${batchSize}, dryRun=${dryRun}, limit=${limit ?? 'none'}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Load taxonomy from DB (same query as taxonomy module)
    const taxonomyResult = await pool.query(
      `SELECT slug, name, description, parent_slug, terms, context_terms, anti_terms
       FROM topic_catalog
       WHERE is_active = TRUE
       ORDER BY slug`
    );

    const taxonomy: Topic[] = taxonomyResult.rows.map((row: Record<string, unknown>) => ({
      slug: row.slug as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      parentSlug: (row.parent_slug as string) ?? null,
      terms: (row.terms as string[]) ?? [],
      contextTerms: (row.context_terms as string[]) ?? [],
      antiTerms: (row.anti_terms as string[]) ?? [],
    }));

    console.log(`Loaded ${taxonomy.length} topics from taxonomy`);

    if (taxonomy.length === 0) {
      console.log('No topics in taxonomy. Run seed-topics first.');
      return;
    }

    let totalProcessed = 0;
    let totalClassified = 0;
    let totalEmpty = 0;
    let batchNumber = 0;

    while (true) {
      // Check limit
      if (limit !== null && totalProcessed >= limit) {
        console.log(`Reached limit of ${limit} posts`);
        break;
      }

      const remaining = limit !== null ? limit - totalProcessed : batchSize;
      const currentBatchSize = Math.min(batchSize, remaining);

      // Fetch unclassified posts
      const postsResult = await pool.query(
        `SELECT uri, text FROM posts
         WHERE topic_vector = '{}' OR topic_vector IS NULL
         ORDER BY created_at DESC
         LIMIT $1`,
        [currentBatchSize]
      );

      if (postsResult.rows.length === 0) {
        console.log('No more unclassified posts');
        break;
      }

      batchNumber++;
      const batchClassified: Array<{ uri: string; vector: string }> = [];

      for (const row of postsResult.rows) {
        const result = classifyPost(row.text ?? '', taxonomy);
        totalProcessed++;

        if (result.matchedTopics.length > 0) {
          totalClassified++;
          batchClassified.push({ uri: row.uri, vector: JSON.stringify(result.vector) });
        } else {
          totalEmpty++;
          // Still mark as processed (set to empty object so we don't re-process)
          batchClassified.push({ uri: row.uri, vector: '{}' });
        }
      }

      if (!dryRun && batchClassified.length > 0) {
        // Batch UPDATE using unnest for efficiency
        const uris = batchClassified.map(r => r.uri);
        const vectors = batchClassified.map(r => r.vector);

        await pool.query(
          `UPDATE posts AS p SET topic_vector = v.vector::jsonb
           FROM (SELECT unnest($1::text[]) AS uri, unnest($2::text[]) AS vector) AS v
           WHERE p.uri = v.uri`,
          [uris, vectors]
        );
      }

      const matchedInBatch = batchClassified.filter(r => r.vector !== '{}').length;
      console.log(
        `Batch ${batchNumber}: ${postsResult.rows.length} posts, ` +
        `${matchedInBatch} matched topics` +
        (dryRun ? ' (dry run)' : '')
      );

      // If we got fewer than batchSize, we've exhausted unclassified posts
      if (postsResult.rows.length < currentBatchSize) break;
    }

    console.log(`\nBackfill complete:`);
    console.log(`  Total processed: ${totalProcessed}`);
    console.log(`  Classified (1+ topic): ${totalClassified}`);
    console.log(`  No matches: ${totalEmpty}`);
    if (dryRun) console.log(`  (dry run — no DB updates made)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
