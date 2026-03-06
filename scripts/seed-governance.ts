/**
 * Seed Governance Script
 *
 * Creates the first governance epoch with default weights.
 * Run this once after migrations to bootstrap the governance system.
 *
 * Default weights (sum to 1.0):
 * - Recency: 0.30 (newer posts rank higher)
 * - Engagement: 0.25 (likes/reposts/replies)
 * - Bridging: 0.20 (cross-cluster appeal)
 * - Source Diversity: 0.15 (prevent author domination)
 * - Relevance: 0.10 (placeholder for ML upgrade)
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_WEIGHTS = {
  recency: 0.30,
  engagement: 0.25,
  bridging: 0.20,
  source_diversity: 0.15,
  relevance: 0.10,
};

/** Safety-net exclude keywords for new epochs. AT Protocol labels handle NSFW; these catch the rest. */
const DEFAULT_CONTENT_RULES = {
  includeKeywords: [] as string[],
  excludeKeywords: ['spam', 'nsfw', 'onlyfans'],
};

async function seedGovernance(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    // Check if an epoch already exists
    const existing = await pool.query('SELECT COUNT(*) FROM governance_epochs');
    if (parseInt(existing.rows[0].count) > 0) {
      console.log('Governance epoch already exists. Skipping seed.');
      return;
    }

    // Create first epoch with default weights and safety-net content rules
    const epochResult = await pool.query(
      `INSERT INTO governance_epochs (
        status, recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight, content_rules, vote_count, description
      ) VALUES (
        'active', $1, $2, $3, $4, $5, $6, 0, 'Initial epoch with default weights'
      ) RETURNING id`,
      [
        DEFAULT_WEIGHTS.recency,
        DEFAULT_WEIGHTS.engagement,
        DEFAULT_WEIGHTS.bridging,
        DEFAULT_WEIGHTS.source_diversity,
        DEFAULT_WEIGHTS.relevance,
        JSON.stringify(DEFAULT_CONTENT_RULES),
      ]
    );

    const epochId = epochResult.rows[0].id;

    // Log to audit trail
    await pool.query(
      `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
       VALUES ('epoch_created', NULL, $1, $2)`,
      [
        epochId,
        JSON.stringify({
          weights: DEFAULT_WEIGHTS,
          reason: 'Initial bootstrap - default weights',
        }),
      ]
    );

    console.log(`Created governance epoch ${epochId} with weights:`);
    console.log(`  Recency:          ${DEFAULT_WEIGHTS.recency}`);
    console.log(`  Engagement:       ${DEFAULT_WEIGHTS.engagement}`);
    console.log(`  Bridging:         ${DEFAULT_WEIGHTS.bridging}`);
    console.log(`  Source Diversity: ${DEFAULT_WEIGHTS.source_diversity}`);
    console.log(`  Relevance:        ${DEFAULT_WEIGHTS.relevance}`);
    console.log(`  Sum:              ${Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)}`);
  } catch (err) {
    console.error('Failed to seed governance:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedGovernance();
