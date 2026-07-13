/**
 * Epoch Scheduler
 *
 * Handles phase-cycle automation:
 * - Start scheduled votes (running -> voting)
 * - Close expired voting windows (voting -> results)
 * - Send 24h voting reminders
 */

import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import {
  aggregateContentVotes,
  aggregateTopicWeights,
  aggregateVotes,
} from '../governance/aggregation.js';
import { readEpochWeights } from '../governance/weight-longtable.js';
import { toContentRules, type ContentRules, type GovernanceWeights } from '../governance/governance.types.js';
import { parseStoredTopicWeights } from '../governance/topic-weights.js';
import {
  announceVotingClosed,
  announceVotingOpen,
  announceVotingReminder,
} from '../bot/governance-announcements.js';
import { logger } from '../lib/logger.js';

interface ActiveEpochRow {
  id: number;
  phase: string | null;
  voting_ends_at: string | null;
  content_rules: unknown;
  topic_weights: unknown;
  recency_weight: number | string;
  engagement_weight: number | string;
  bridging_weight: number | string;
  source_diversity_weight: number | string;
  relevance_weight: number | string;
}

interface ScheduledVoteRow {
  id: number;
  starts_at: string;
  duration_hours: number;
}

let schedulerTask: ScheduledTask | null = null;
let isSchedulerTickRunning = false;

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : parseFloat(value);
}

/**
 * Fallback projection for the current row's wide weight columns. Kept until
 * PROJ-819 (P5) drops the wide columns — by then every caller uses
 * readEpochWeights and this helper is removed.
 */
function toWeights(epoch: ActiveEpochRow): GovernanceWeights {
  return {
    recency: toNumber(epoch.recency_weight),
    engagement: toNumber(epoch.engagement_weight),
    bridging: toNumber(epoch.bridging_weight),
    sourceDiversity: toNumber(epoch.source_diversity_weight),
    relevance: toNumber(epoch.relevance_weight),
  };
}

function toPhase(phase: string | null): 'running' | 'voting' | 'results' {
  if (phase === 'voting' || phase === 'results') {
    return phase;
  }
  return 'running';
}

function toDbContentRules(rules: ContentRules): { include_keywords: string[]; exclude_keywords: string[] } {
  return {
    include_keywords: rules.includeKeywords,
    exclude_keywords: rules.excludeKeywords,
  };
}

async function getVoteCounts(
  client: PoolClient,
  epochId: number
): Promise<{ total: number; content: number; topic: number }> {
  const result = await client.query<{ total: string; content: string; topic: string }>(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE
          (include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0)
          OR
          (exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0)
      )::int AS content,
      COUNT(*) FILTER (
        WHERE topic_weight_votes IS NOT NULL
          AND topic_weight_votes != '{}'::jsonb
      )::int AS topic
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  return {
    total: parseInt(result.rows[0]?.total ?? '0', 10),
    content: parseInt(result.rows[0]?.content ?? '0', 10),
    topic: parseInt(result.rows[0]?.topic ?? '0', 10),
  };
}

async function startDueScheduledVotes(): Promise<{ started: number; errors: number }> {
  const dueVotes = await db.query<ScheduledVoteRow>(
    `SELECT id, starts_at, duration_hours
     FROM scheduled_votes
     WHERE starts_at <= NOW()
     ORDER BY starts_at ASC
     LIMIT 20`
  );

  let started = 0;
  let errors = 0;

  for (const scheduled of dueVotes.rows) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const epochResult = await client.query<ActiveEpochRow>(
        `SELECT *
         FROM governance_epochs
         WHERE status = 'active'
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`
      );

      const epoch = epochResult.rows[0];
      if (!epoch) {
        await client.query('ROLLBACK');
        errors++;
        continue;
      }

      if (toPhase(epoch.phase) !== 'running') {
        await client.query('ROLLBACK');
        continue;
      }

      await client.query(
        `UPDATE governance_epochs
         SET phase = 'voting',
             voting_started_at = NOW(),
             voting_closed_at = NULL,
             voting_ends_at = NOW() + make_interval(hours => $1),
             auto_transition = TRUE,
             proposed_weights = NULL,
             proposed_topic_weights = NULL,
             proposed_content_rules = NULL
         WHERE id = $2`,
        [scheduled.duration_hours, epoch.id]
      );

      await client.query(`DELETE FROM scheduled_votes WHERE id = $1`, [scheduled.id]);

      await client.query(
        `INSERT INTO governance_audit_log (action, epoch_id, details)
         VALUES ('scheduled_vote_started', $1, $2)`,
        [
          epoch.id,
          JSON.stringify({
            scheduled_vote_id: scheduled.id,
            starts_at: scheduled.starts_at,
            duration_hours: scheduled.duration_hours,
          }),
        ]
      );

      await client.query('COMMIT');
      started++;

      await announceVotingOpen({ id: epoch.id }, `${scheduled.duration_hours} hour(s)`);
    } catch (error) {
      await client.query('ROLLBACK');
      errors++;
      logger.error({ error, scheduledVoteId: scheduled.id }, 'Failed to start scheduled vote');
    } finally {
      client.release();
    }
  }

  return { started, errors };
}

async function closeExpiredVotingWindows(): Promise<{ transitioned: number; errors: number }> {
  const dueEpochs = await db.query<{ id: number }>(
    `SELECT id
     FROM governance_epochs
     WHERE status = 'active'
       AND phase = 'voting'
       AND auto_transition = TRUE
       AND voting_ends_at IS NOT NULL
       AND voting_ends_at <= NOW()
     ORDER BY voting_ends_at ASC
     LIMIT 20`
  );

  let transitioned = 0;
  let errors = 0;

  for (const row of dueEpochs.rows) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const epochResult = await client.query<ActiveEpochRow>(
        `SELECT *
         FROM governance_epochs
         WHERE id = $1
           AND status = 'active'
           AND phase = 'voting'
           AND auto_transition = TRUE
           AND voting_ends_at IS NOT NULL
           AND voting_ends_at <= NOW()
         FOR UPDATE`,
        [row.id]
      );

      const epoch = epochResult.rows[0];
      if (!epoch || toPhase(epoch.phase) !== 'voting') {
        await client.query('ROLLBACK');
        continue;
      }

      const voteCounts = await getVoteCounts(client, epoch.id);
      // Read current epoch weights via the storage-agnostic helper. Behind
      // GOVERNANCE_LONGTABLE_READ_ENABLED this queries governance_epoch_weights;
      // off, it projects from the wide columns. The autocommit pool used by
      // readEpochWeights reads committed state — the FOR UPDATE lock on the
      // governance_epochs row above does not affect the unrelated long-table
      // rows being read here; both writes for the current epoch were
      // committed atomically by the previous scheduler tick / PATCH route.
      const currentWeights = (await readEpochWeights({ epochId: epoch.id })) ?? toWeights(epoch);
      const currentRules = toContentRules((epoch.content_rules ?? null) as any);
      const currentTopicWeights = parseStoredTopicWeights(
        epoch.topic_weights,
        `governance epoch ${epoch.id} active policy`
      );

      let proposedWeights = currentWeights;
      let proposedRules = currentRules;
      let proposedTopicWeights = currentTopicWeights;

      if (voteCounts.total > 0) {
        const aggregatedWeights = await aggregateVotes(epoch.id);
        if (aggregatedWeights) {
          proposedWeights = aggregatedWeights;
        }
      }

      if (voteCounts.content > 0) {
        proposedRules = await aggregateContentVotes(epoch.id);
      }

      if (voteCounts.topic > 0) {
        proposedTopicWeights = await aggregateTopicWeights(epoch.id);
      }

      await client.query(
        `UPDATE governance_epochs
         SET phase = 'results',
             voting_closed_at = NOW(),
             auto_transition = FALSE,
             proposed_weights = $1,
             proposed_content_rules = $2,
             proposed_topic_weights = $3
         WHERE id = $4`,
        [
          JSON.stringify(proposedWeights),
          JSON.stringify(toDbContentRules(proposedRules)),
          JSON.stringify(proposedTopicWeights),
          epoch.id,
        ]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, epoch_id, details)
         VALUES ('auto_end_voting', $1, $2)`,
        [
          epoch.id,
          JSON.stringify({
            vote_count: voteCounts.total,
            content_vote_count: voteCounts.content,
            topic_vote_count: voteCounts.topic,
            proposed_weights: proposedWeights,
            proposed_topic_weights: proposedTopicWeights,
            proposed_content_rules: toDbContentRules(proposedRules),
          }),
        ]
      );

      await client.query('COMMIT');
      transitioned++;

      await announceVotingClosed({ id: epoch.id }, voteCounts.total);
    } catch (error) {
      await client.query('ROLLBACK');
      errors++;
      logger.error({ error, epochId: row.id }, 'Failed to auto-close voting window');
    } finally {
      client.release();
    }
  }

  return { transitioned, errors };
}

async function sendVotingReminders(): Promise<{ reminders: number; errors: number }> {
  const candidates = await db.query<{ id: number; voting_ends_at: string }>(
    `SELECT id, voting_ends_at
     FROM governance_epochs
     WHERE status = 'active'
       AND phase = 'voting'
       AND voting_ends_at > NOW() + INTERVAL '23 hours'
       AND voting_ends_at <= NOW() + INTERVAL '25 hours'`
  );

  let reminders = 0;
  let errors = 0;

  for (const epoch of candidates.rows) {
    try {
      const alreadySent = await db.query(
        `SELECT 1
         FROM governance_audit_log
         WHERE epoch_id = $1
           AND action = 'voting_reminder_24h'
         LIMIT 1`,
        [epoch.id]
      );

      if (alreadySent.rows.length > 0) {
        continue;
      }

      await announceVotingReminder({ id: epoch.id, votingEndsAt: epoch.voting_ends_at }, 24);

      await db.query(
        `INSERT INTO governance_audit_log (action, epoch_id, details)
         VALUES ('voting_reminder_24h', $1, $2)`,
        [
          epoch.id,
          JSON.stringify({
            voting_ends_at: epoch.voting_ends_at,
          }),
        ]
      );

      reminders++;
    } catch (error) {
      errors++;
      logger.error({ error, epochId: epoch.id }, 'Failed to send voting reminder');
    }
  }

  return { reminders, errors };
}

export async function checkScheduledTransitions(): Promise<{
  startedVotes: number;
  transitionedToResults: number;
  remindersSent: number;
  errors: number;
}> {
  const started = await startDueScheduledVotes();
  const transitioned = await closeExpiredVotingWindows();
  const reminders = await sendVotingReminders();

  return {
    startedVotes: started.started,
    transitionedToResults: transitioned.transitioned,
    remindersSent: reminders.reminders,
    errors: started.errors + transitioned.errors + reminders.errors,
  };
}

/**
 * Start the epoch scheduler.
 * Runs every 5 minutes to check for scheduled vote and phase transitions.
 */
export function startEpochScheduler(): void {
  if (schedulerTask) {
    logger.warn('Epoch scheduler already running');
    return;
  }

  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    if (isSchedulerTickRunning) {
      logger.warn('Skipping scheduler tick because previous tick is still running');
      return;
    }

    isSchedulerTickRunning = true;
    try {
      const result = await checkScheduledTransitions();
      logger.debug(result, 'Epoch scheduler tick complete');
    } catch (error) {
      logger.error({ error }, 'Epoch scheduler tick failed');
    } finally {
      isSchedulerTickRunning = false;
    }
  });

  logger.info('Epoch scheduler started (runs every 5 minutes)');

  void (async () => {
    try {
      const result = await checkScheduledTransitions();
      logger.info(result, 'Initial epoch scheduler check complete');
    } catch (error) {
      logger.error({ error }, 'Initial scheduler check failed');
    }
  })();
}

/**
 * Stop the epoch scheduler.
 */
export function stopEpochScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Epoch scheduler stopped');
  }
}

/**
 * Manually trigger a scheduler check (for testing/admin use).
 */
export async function runSchedulerCheck(): Promise<{
  checked: boolean;
  transitioned: number;
  errors: number;
}> {
  try {
    const result = await checkScheduledTransitions();
    return {
      checked: true,
      transitioned: result.startedVotes + result.transitionedToResults,
      errors: result.errors,
    };
  } catch (error) {
    logger.error({ error }, 'Manual scheduler check failed');
    return {
      checked: false,
      transitioned: 0,
      errors: 1,
    };
  }
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus(): { running: boolean; schedule: string } {
  return {
    running: schedulerTask !== null,
    schedule: 'Every 5 minutes (*/5 * * * *)',
  };
}
