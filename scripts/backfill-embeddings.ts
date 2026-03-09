/**
 * Backfill Embeddings Script
 *
 * Reclassifies existing posts in the 72-hour scoring window using the
 * embedding classifier. Replaces keyword-only topic vectors (0.2/1.0 scores)
 * with semantically accurate embedding vectors.
 *
 * Only replaces a post's topic_vector when the embedding produces a non-empty
 * result. Posts where the embedding matches no topic above the similarity
 * threshold keep their existing keyword vector.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts
 *   npx tsx scripts/backfill-embeddings.ts --dry-run
 *   npx tsx scripts/backfill-embeddings.ts --hours 24 --batch-size 64
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';
import { initEmbedder, embedTexts, cosineSimilarity } from '../src/scoring/topics/embedder.js';
import { loadTaxonomy, loadTopicEmbeddings, getTopicsWithEmbeddings } from '../src/scoring/topics/taxonomy.js';

dotenv.config();

const EMBED_BATCH_SIZE = 32;
const LOG_INTERVAL = 100;

/** Parse CLI args. */
function parseArgs(): { batchSize: number; dryRun: boolean; hours: number; minSimilarity: number } {
  const args = process.argv.slice(2);
  let batchSize = EMBED_BATCH_SIZE;
  let dryRun = false;
  let hours = 72;
  let minSimilarity = parseFloat(process.env.TOPIC_EMBEDDING_MIN_SIMILARITY ?? '0.35');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--hours' && args[i + 1]) {
      hours = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--min-similarity' && args[i + 1]) {
      minSimilarity = parseFloat(args[i + 1]);
      i++;
    }
  }

  return { batchSize, dryRun, hours, minSimilarity };
}

async function main() {
  const { batchSize, dryRun, hours, minSimilarity } = parseArgs();

  console.log(`Backfill embeddings: batchSize=${batchSize}, hours=${hours}, minSimilarity=${minSimilarity}, dryRun=${dryRun}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Initialize embedding infrastructure
    console.log('Loading embedding model...');
    await initEmbedder();

    console.log('Loading taxonomy...');
    await loadTaxonomy();

    console.log('Loading topic embeddings...');
    await loadTopicEmbeddings();

    const topics = getTopicsWithEmbeddings();
    if (!topics || topics.length === 0) {
      console.error('No topic embeddings available. Cannot proceed.');
      return;
    }
    console.log(`Loaded ${topics.length} topic embeddings`);

    // Count candidates
    const countResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM posts
       WHERE created_at > NOW() - INTERVAL '${hours} hours'
         AND deleted = FALSE
         AND text IS NOT NULL
         AND LENGTH(text) > 0
         AND topic_vector IS NOT NULL
         AND topic_vector::text != '{}'`
    );
    const totalCandidates = parseInt(countResult.rows[0].cnt, 10);
    console.log(`Found ${totalCandidates} candidate posts in ${hours}-hour window`);

    if (totalCandidates === 0) {
      console.log('No candidates to process.');
      return;
    }

    // Fetch all candidates (sorted by created_at DESC so newest first)
    const postsResult = await pool.query(
      `SELECT uri, text FROM posts
       WHERE created_at > NOW() - INTERVAL '${hours} hours'
         AND deleted = FALSE
         AND text IS NOT NULL
         AND LENGTH(text) > 0
         AND topic_vector IS NOT NULL
         AND topic_vector::text != '{}'
       ORDER BY created_at DESC`
    );

    const posts = postsResult.rows as Array<{ uri: string; text: string }>;

    let totalProcessed = 0;
    let totalReplaced = 0;
    let totalKept = 0;
    let totalEmptyText = 0;
    const startTime = Date.now();

    // Process in batches
    for (let offset = 0; offset < posts.length; offset += batchSize) {
      const batch = posts.slice(offset, offset + batchSize);
      const texts = batch.map(p => p.text);

      // Embed all texts in this batch
      const embeddings = await embedTexts(texts);

      const updates: Array<{ uri: string; vector: string }> = [];

      for (let i = 0; i < batch.length; i++) {
        const post = batch[i];
        const postEmbedding = embeddings[i];
        totalProcessed++;

        if (!post.text || post.text.trim().length === 0) {
          totalEmptyText++;
          continue;
        }

        // Score against all topic centroids
        const vector: Record<string, number> = {};
        for (const topic of topics) {
          const similarity = cosineSimilarity(postEmbedding, topic.embedding);
          if (similarity >= minSimilarity) {
            vector[topic.slug] = Math.round(similarity * 100) / 100;
          }
        }

        // Only replace if embedding produced a non-empty vector
        if (Object.keys(vector).length > 0) {
          totalReplaced++;
          updates.push({ uri: post.uri, vector: JSON.stringify(vector) });
        } else {
          totalKept++;
        }

        // Log progress
        if (totalProcessed % LOG_INTERVAL === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const rate = (totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(0);
          console.log(
            `Progress: ${totalProcessed}/${posts.length} (${elapsed}s, ${rate} posts/s) — ` +
            `replaced=${totalReplaced}, kept=${totalKept}`
          );
        }
      }

      // Batch UPDATE
      if (!dryRun && updates.length > 0) {
        const uris = updates.map(u => u.uri);
        const vectors = updates.map(u => u.vector);

        await pool.query(
          `UPDATE posts AS p SET topic_vector = v.vector::jsonb
           FROM (SELECT unnest($1::text[]) AS uri, unnest($2::text[]) AS vector) AS v
           WHERE p.uri = v.uri`,
          [uris, vectors]
        );
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nBackfill complete in ${elapsed}s:`);
    console.log(`  Total processed: ${totalProcessed}`);
    console.log(`  Replaced with embedding vector: ${totalReplaced}`);
    console.log(`  Kept keyword vector (embedding empty): ${totalKept}`);
    console.log(`  Skipped (empty text): ${totalEmptyText}`);
    if (dryRun) console.log(`  (dry run — no DB updates made)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
