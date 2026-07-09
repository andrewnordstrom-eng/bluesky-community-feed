/**
 * Simulation
 *
 * Drives the REAL Corgi governance/scoring engine (aggregateVotes, an epoch
 * transition, runScoringPipeline) against injected Postgres/Redis. This is
 * the "drive" half of the harness — `metrics.ts` is the "measure" half.
 * Keeping them separate mirrors the DST system/simulator/observer split:
 * `Simulation` never computes metrics itself, it only produces a raw event
 * log that `measure()` turns into a `RunMetrics` snapshot.
 *
 * The governance/scoring modules (`src/governance/*`, `src/scoring/pipeline.js`)
 * are imported dynamically inside `run()`, AFTER the prod-guard check, rather
 * than statically at module top. Two reasons:
 *   1. Those modules transitively import `src/config.ts` (parses `process.env`
 *      at import time) and `src/db/redis.ts` (opens a TCP connection as an
 *      import side effect — see docs/agent build-bible §6). Deferring the
 *      import means constructing a `Simulation` never has that side effect;
 *      only calling `.run()` does, and only after the guard has already
 *      passed.
 *   2. It keeps `src/harness/index.ts` — not this file — as the sole
 *      externally-imported surface: nothing outside the harness needs to
 *      know these modules exist.
 */

import type { Rng, Clock } from './rng.js';
import type { Scenario, PersonaMix } from './scenario.js';
import {
  generatePopulation,
  generateVotes,
  TOPIC_SLUGS,
  type Population,
  type VoteSeed,
} from './population.js';
import { validateVote, type RawVotePayload, type VoteValidationContext } from './vote-validation.js';
import { assertEphemeralPostgresUrl, assertEphemeralRedisUrl, type GuardOptions } from './prod-guard.js';
import { createDefaultGovernanceWeightRecord } from '../config/votable-params.js';
import { weightsToVotePayload } from '../governance/governance.types.js';
import { l2Distance } from './convergence.js';
import type { GovernanceWeights } from '../shared/api-types.js';

/** Minimal query surface `Simulation` needs to seed its own synthetic data. */
export interface QueryableDb {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SimulationDeps {
  rng: Rng;
  clock: Clock;
  /** Used only for the harness's own population-seeding queries. */
  db: QueryableDb;
  /** Connection string backing `db` — checked by the prod-guard. */
  databaseUrl: string;
  /** Connection string backing the production Redis singleton — checked by the prod-guard. */
  redisUrl: string;
  guard?: GuardOptions;
  /**
   * Bounded timeout (ms) applied to each of the three real-pipeline steps
   * (aggregateVotes / forceEpochTransition / runScoringPipeline). Defaults to
   * `DEFAULT_PIPELINE_STEP_TIMEOUT_MS`. A hung call against a misbehaving
   * Testcontainers instance fails fast with a diagnosable error instead of
   * blocking the whole run (and any CI job driving it) indefinitely.
   */
  pipelineStepTimeoutMs?: number;
}

/** Default bound for `SimulationDeps.pipelineStepTimeoutMs` — see its doc. */
export const DEFAULT_PIPELINE_STEP_TIMEOUT_MS = 30_000;

/**
 * Race `promise` against a timer. Rejects with a diagnosable error naming
 * `label` if `promise` hasn't settled within `timeoutMs` — never silently
 * swallows the underlying error, and never leaves a dangling timer.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Simulation.run(): "${label}" did not complete within ${timeoutMs}ms — it may be hung ` +
            'against a misbehaving Postgres/Redis/Testcontainers instance. Failing fast instead of ' +
            'blocking indefinitely.'
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface SimulationEvent {
  /** Simulated-time ISO timestamp (from the injected Clock, not wall clock). */
  at: string;
  type: string;
  data?: Record<string, unknown>;
}

export interface TopScoredPost {
  uri: string;
  rank: number;
  totalScore: number;
}

/**
 * One row of `governance_audit_log`, surfaced from a `multi-epoch-cycle`
 * run's underlying audit trail (see `Simulation.runMultiEpochCycle`) so
 * callers/tests can assert on the REAL production audit rows
 * `forceEpochTransition` wrote, not a harness-side reconstruction of them.
 *
 * The row's `created_at` (DB `NOW()` at insert — real wall-clock, not the
 * harness's seeded domain clock) is intentionally NOT surfaced: it is not part
 * of the governance signal (id/action/epoch/details are), and including it
 * would make the emitted `audit-log.json` non-reproducible across runs. The
 * ordering that matters is by `id`, which `fetchAuditLogSince` uses.
 */
export interface AuditLogRow {
  id: number;
  action: string;
  epochId: number | null;
  details: Record<string, unknown> | null;
}

/**
 * One round of a `multi-epoch-cycle` run: the epoch that received this
 * round's persona votes (`epochBeforeId`), the epoch `forceEpochTransition`
 * created from aggregating them (`epochAfterId`), how many votes were cast,
 * the resulting normalized 5-component weight vector (read back from the
 * REAL `governance_epochs` row `forceEpochTransition` wrote, not recomputed
 * here), its topic-weight summary (same provenance), and the L2 displacement
 * of `weights` from the PREVIOUS round's weight vector — round 1 measures
 * displacement from the harness's own bootstrap default (see
 * `ensureActiveEpoch`), the same reference point every voter's first vote is
 * actually cast against.
 */
export interface EpochRoundResult {
  round: number;
  epochBeforeId: number;
  epochAfterId: number;
  voteCount: number;
  weights: GovernanceWeights;
  topicWeights: Record<string, number>;
  l2Displacement: number;
}

export interface SimulationResult {
  scenario: Scenario;
  population: Population;
  epochBeforeId: number;
  epochAfterId: number;
  aggregatedWeights: GovernanceWeights;
  scoredPostCount: number;
  topPosts: TopScoredPost[];
  events: SimulationEvent[];
  /**
   * Present only for `kind: 'multi-epoch-cycle'` — one entry per round, in
   * order. Every other top-level field above still describes the FINAL
   * round (so single-cycle consumers like `measure()` in metrics.ts keep
   * working unchanged as a summary of a multi-epoch run), matching the last
   * element of this array.
   */
  rounds?: EpochRoundResult[];
  /**
   * Present only for `kind: 'multi-epoch-cycle'` — every `governance_audit_log`
   * row this run's `forceEpochTransition` calls actually wrote, in id order.
   */
  auditLog?: AuditLogRow[];
}

/**
 * Seed the first governance epoch with equal default weights (mirrors
 * `scripts/seed-governance.ts`'s bootstrap, but driven from the
 * registry-derived default record so a 6th registered component doesn't
 * silently drift). Reuses an active/voting epoch if one already exists.
 *
 * Always leaves the epoch in `phase = 'voting'` (explicitly set on INSERT,
 * forced on reuse too) — `POST /api/governance/vote` (src/governance/routes/
 * vote.ts) only accepts votes for an epoch in that phase (see
 * vote-validation.ts), and this harness exists to seed votes a real voter
 * could actually have cast.
 */
async function ensureActiveEpoch(db: QueryableDb): Promise<number> {
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM governance_epochs WHERE status IN ('active', 'voting') ORDER BY id DESC LIMIT 1`
  );
  if (existing.rows[0]) {
    await db.query(`UPDATE governance_epochs SET phase = 'voting' WHERE id = $1`, [existing.rows[0].id]);
    return existing.rows[0].id;
  }

  const defaults = createDefaultGovernanceWeightRecord() as GovernanceWeights;
  const payload = weightsToVotePayload(defaults);

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status, phase, recency_weight, engagement_weight, bridging_weight,
      source_diversity_weight, relevance_weight, vote_count, description
    ) VALUES ('active', 'voting', $1, $2, $3, $4, $5, 0, 'A1 simulation harness bootstrap epoch')
    RETURNING id`,
    [
      payload.recency_weight,
      payload.engagement_weight,
      payload.bridging_weight,
      payload.source_diversity_weight,
      payload.relevance_weight,
    ]
  );

  return inserted.rows[0].id;
}

/** Human-readable label for a topic slug, e.g. `software-development` -> `Software Development`. */
function topicSlugLabel(slug: string): string {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function interpolatePersonaMix(from: PersonaMix, to: PersonaMix, progress: number): PersonaMix {
  return {
    'engagement-maximizer':
      from['engagement-maximizer'] + (to['engagement-maximizer'] - from['engagement-maximizer']) * progress,
    'chronological-purist':
      from['chronological-purist'] + (to['chronological-purist'] - from['chronological-purist']) * progress,
    'bridge-builder': from['bridge-builder'] + (to['bridge-builder'] - from['bridge-builder']) * progress,
    balanced: from.balanced + (to.balanced - from.balanced) * progress,
  };
}

/**
 * Register `slugs` as active rows in `topic_catalog` (creating them if
 * missing, reactivating them if a prior run left one inactive). Idempotent
 * via `ON CONFLICT (slug) DO UPDATE`, mirroring `scripts/seed-topics.ts`'s
 * convention — but seeding only the harness's own synthetic slug set
 * (population.ts's `TOPIC_SLUGS`), not the real curated catalog.
 *
 * Without this, every persona topic-weight vote (population.ts) would be
 * rejected by vote-validation.ts's slug check (mirroring the real route's
 * `topic_catalog WHERE is_active = TRUE` check) and invisible to the real
 * `aggregateTopicWeights`, which reads active slugs from the same table —
 * there would be no active topic for either to see.
 */
async function ensureActiveTopics(db: QueryableDb, slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) {
    return;
  }
  await insertBatched(db, slugs, (batch, offset) => ({
    text: `INSERT INTO topic_catalog (slug, name, is_active)
           VALUES ${valuesClause(batch.length, 3, offset)}
           ON CONFLICT (slug) DO UPDATE SET is_active = TRUE`,
    params: batch.flatMap((slug) => [slug, topicSlugLabel(slug), true]),
  }));
}

/** Max rows per batched `INSERT ... VALUES (...),(...)` — keeps a single
 *  query's parameter count (`rows * columnsPerRow`) well under Postgres's
 *  65535 bound and query text to a sane size, even at this harness's max
 *  population sizes (10000 subscribers / 50000 posts). */
const INSERT_BATCH_SIZE = 500;

/** Max concurrent `writeVoteWeights` dual-writes in flight. Each is an
 *  independent autocommit-pool query (weight-longtable.ts), so they're safe to
 *  run in parallel; bounded (not a flat `Promise.all` over all N) to cap
 *  concurrent pool connections and pending-promise memory on large-N runs. */
const DUAL_WRITE_CONCURRENCY = 25;

/** Compile-time exhaustiveness guard: reaching this with a non-`never` value is
 *  a type error, so an unhandled discriminated-union case fails the build. */
function assertNever(value: never, message: string): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Build a `($1, $2), ($3, $4), ...` VALUES clause for `rowCount` rows of
 *  `colCount` columns each, numbered starting at `offset + 1`. */
function valuesClause(rowCount: number, colCount: number, offset: number): string {
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const base = offset + r * colCount;
    const placeholders = Array.from({ length: colCount }, (_, c) => `$${base + c + 1}`);
    rows.push(`(${placeholders.join(', ')})`);
  }
  return rows.join(', ');
}

/**
 * Insert `items` in chunks of `INSERT_BATCH_SIZE`, each chunk as one
 * multi-row `INSERT ... VALUES (...),(...)` round trip instead of one
 * round trip per row. `buildQuery` receives the chunk and its param offset
 * (always 0 here — kept as a parameter so `valuesClause` stays reusable if
 * a caller ever needs to combine a batch with other leading params).
 */
async function insertBatched<T>(
  db: QueryableDb,
  items: readonly T[],
  buildQuery: (batch: T[], offset: number) => { text: string; params: unknown[] }
): Promise<void> {
  for (const batch of chunk(items, INSERT_BATCH_SIZE)) {
    if (batch.length === 0) {
      continue;
    }
    const { text, params } = buildQuery(batch, 0);
    await db.query(text, params);
  }
}

/**
 * Convert a `VoteSeed` into the same wire-shaped payload
 * `POST /api/governance/vote` would receive as a request body, so
 * `validateVote` (vote-validation.ts) can check it exactly as the real
 * route would. Reuses the REAL `weightsToVotePayload` production helper for
 * the weight fields rather than re-deriving the snake_case names here.
 */
function voteSeedToRawPayload(vote: VoteSeed): RawVotePayload {
  const weightFields = vote.weights ? weightsToVotePayload(vote.weights) : {};
  return {
    voterDid: vote.voterDid,
    ...weightFields,
    include_keywords: vote.includeKeywords,
    exclude_keywords: vote.excludeKeywords,
    topic_weights: vote.topicWeights,
  };
}

/**
 * Deferred import of the governance/scoring modules driven by BOTH
 * `runEpochVoteCycle` and `runMultiEpochCycle` — see the file header for why
 * these must not be static imports. A free function (not a `Simulation`
 * method): it never touches `this`, and `Simulation.run()` calls it exactly
 * once per run — including for a multi-round `multi-epoch-cycle` run, so
 * `__resetPipelineState()` resets the scoring pipeline's module-level state
 * exactly once per simulated run, matching the semantics a single real
 * process boot would have (not once per round).
 */
async function loadGovernanceModules() {
  const { aggregateVotes } = await import('../governance/aggregation.js');
  const { forceEpochTransition } = await import('../governance/epoch-manager.js');
  const { runScoringPipeline, __resetPipelineState } = await import('../scoring/pipeline.js');
  const { writeVoteWeights } = await import('../governance/weight-longtable.js');
  const { config } = await import('../config.js');
  return {
    aggregateVotes,
    forceEpochTransition,
    runScoringPipeline,
    __resetPipelineState,
    writeVoteWeights,
    config,
  };
}

type GovernanceModules = Awaited<ReturnType<typeof loadGovernanceModules>>;

export class Simulation {
  constructor(
    private readonly scenario: Scenario,
    private readonly deps: SimulationDeps
  ) {}

  async run(): Promise<SimulationResult> {
    assertEphemeralPostgresUrl(this.deps.databaseUrl, this.deps.guard);
    assertEphemeralRedisUrl(this.deps.redisUrl, this.deps.guard);

    const modules = await loadGovernanceModules();
    modules.__resetPipelineState();

    // Exhaustive dispatch (not a ternary): a future third scenario kind must
    // fail to compile here rather than silently fall through to the
    // single-cycle path — the exact "a multi-epoch scenario silently runs one
    // round = a convincing but wrong signal" foot-gun the original guard existed
    // to prevent.
    switch (this.scenario.kind) {
      case 'epoch-vote-cycle':
        return this.runEpochVoteCycle(modules);
      case 'multi-epoch-cycle':
        return this.runMultiEpochCycle(modules);
      default:
        return assertNever(this.scenario, 'Simulation.run(): unhandled scenario kind');
    }
  }

  private async runEpochVoteCycle(modules: GovernanceModules): Promise<SimulationResult> {
    const { aggregateVotes, forceEpochTransition, runScoringPipeline, writeVoteWeights, config } = modules;

    const events: SimulationEvent[] = [];
    const record = (type: string, data?: Record<string, unknown>): void => {
      events.push({ at: this.deps.clock.now().toISOString(), type, data });
    };

    const epochBeforeId = await ensureActiveEpoch(this.deps.db);
    await ensureActiveTopics(this.deps.db, TOPIC_SLUGS);
    record('epoch_ensured', { epochId: epochBeforeId, topicSlugsSeeded: TOPIC_SLUGS.length });

    const population = generatePopulation(this.deps.rng, this.deps.clock, this.scenario.population);
    record('population_generated', {
      subscriberCount: population.subscribers.length,
      postCount: population.posts.length,
      voteCount: population.votes.length,
    });

    await this.seedPopulation(population, epochBeforeId, {
      writeVoteWeights,
      dualWriteEnabled: config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED,
    });
    record('population_seeded', { epochId: epochBeforeId });

    const timeoutMs = this.deps.pipelineStepTimeoutMs ?? DEFAULT_PIPELINE_STEP_TIMEOUT_MS;

    // 1. Drive the REAL vote aggregation so the harness observes exactly
    //    what the production governance engine computes from the seeded votes.
    const aggregatedWeights = await withTimeout(
      aggregateVotes(epochBeforeId),
      timeoutMs,
      'aggregateVotes'
    );
    if (!aggregatedWeights) {
      throw new Error(
        `aggregateVotes(${epochBeforeId}) returned null — no eligible weight votes were seeded. ` +
          'Increase population.subscriberCount / voteParticipationRate.'
      );
    }
    record('votes_aggregated', { epochId: epochBeforeId, weights: aggregatedWeights });

    // 2. Drive the REAL epoch-transition op. `forceEpochTransition` (rather
    //    than the vote-count-gated `triggerEpochTransition`) is used so small
    //    synthetic populations still transition deterministically; it
    //    internally re-runs aggregateVotes/aggregateContentVotes and, on a
    //    best-effort basis, one scoring pass for its transition-impact audit.
    const epochAfterId = await withTimeout(forceEpochTransition(), timeoutMs, 'forceEpochTransition');
    record('epoch_transitioned', { fromEpochId: epochBeforeId, toEpochId: epochAfterId });

    // 3. Drive the REAL scoring pipeline as its own explicit, awaited step —
    //    decoupled from step 2's best-effort internal invocation, so a
    //    scoring failure here surfaces as a simulation failure rather than
    //    a swallowed warning.
    await withTimeout(runScoringPipeline(), timeoutMs, 'runScoringPipeline');
    record('scoring_pipeline_run', { epochId: epochAfterId });

    const topPosts = await this.fetchTopScoredPosts(epochAfterId, 50);
    record('top_posts_fetched', { epochId: epochAfterId, count: topPosts.length });

    return {
      scenario: this.scenario,
      population,
      epochBeforeId,
      epochAfterId,
      aggregatedWeights,
      scoredPostCount: topPosts.length,
      topPosts,
      events,
    };
  }

  /**
   * Drive `rounds` back-to-back aggregate -> transition -> score cycles —
   * each round is the EXACT SAME real drive `runEpochVoteCycle` does
   * (`forceEpochTransition` then `runScoringPipeline`, both real production
   * code), looped, with per-round measurement layered on top rather than a
   * second implementation of the cycle itself.
   *
   * The community is FIXED and its votes CHURN: the corpus (subscribers,
   * posts, engagement) is generated + seeded once up front via `seedCorpus`;
   * each round then re-draws only a fresh set of persona votes from the SAME
   * continuing `Rng` — so the whole K-round run is one deterministic sequence,
   * not K independent ones — and seeds only those votes (`insertVotes`) into a
   * fresh `phase = 'voting'` epoch (`ensureActiveEpoch` reuses the epoch
   * `forceEpochTransition` just created and forces it to `'voting'`). Because
   * only `governance_votes` (one fresh row per voter per round) and the audit
   * trail grow with `rounds`, a long run stays cheap — no per-round corpus
   * re-insert, and `post_engagement` is not rewritten each round.
   */
  private async runMultiEpochCycle(modules: GovernanceModules): Promise<SimulationResult> {
    if (this.scenario.kind !== 'multi-epoch-cycle') {
      throw new Error('Simulation.runMultiEpochCycle(): internal error — scenario kind mismatch');
    }
    const scenario = this.scenario;
    const { aggregateVotes, forceEpochTransition, runScoringPipeline, writeVoteWeights, config } =
      modules;

    const events: SimulationEvent[] = [];
    const record = (type: string, data?: Record<string, unknown>): void => {
      events.push({ at: this.deps.clock.now().toISOString(), type, data });
    };

    const auditLogWatermarkId = await this.fetchAuditLogWatermarkId();
    const timeoutMs = this.deps.pipelineStepTimeoutMs ?? DEFAULT_PIPELINE_STEP_TIMEOUT_MS;
    const dualWrite = {
      writeVoteWeights,
      dualWriteEnabled: config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED,
    };

    // Seed the fixed corpus ONCE. Stable runs reuse this population's round-1
    // votes; drifted runs re-draw round-1 votes from the interpolated starting
    // mix. Later rounds always re-draw votes from the continuing Rng. Only votes
    // are seeded, so members/posts/engagement stay fixed for the whole run.
    const population = generatePopulation(this.deps.rng, this.deps.clock, scenario.population);
    await this.seedCorpus(population);
    record('corpus_seeded', {
      subscriberCount: population.subscribers.length,
      postCount: population.posts.length,
    });

    // Round 1's displacement baseline is the ACTUAL weights of the epoch it
    // transitions from — set once epochBeforeId is known below. `ensureActiveEpoch`
    // may create that epoch at the bootstrap defaults OR reuse a pre-existing
    // one with different weights, so read it back rather than assuming the
    // default (else convergence would be measured from the wrong reference point).
    let previousWeights: GovernanceWeights | undefined;

    const rounds: EpochRoundResult[] = [];
    let epochBeforeId = -1;
    let epochAfterId = -1;
    let firstRoundVotes: VoteSeed[] | undefined;

    for (let round = 1; round <= scenario.rounds; round++) {
      epochBeforeId = await ensureActiveEpoch(this.deps.db);
      await ensureActiveTopics(this.deps.db, TOPIC_SLUGS);
      record('epoch_ensured', { round, epochId: epochBeforeId });

      if (previousWeights === undefined) {
        previousWeights = (await this.fetchEpochWeightsAndTopics(epochBeforeId)).weights;
      }

      // Fresh votes each round from the same continuing Rng. Round 1 uses the
      // corpus population's own votes; later rounds re-draw VOTES ONLY via
      // generateVotes (not a full generatePopulation), so the redraw doesn't
      // consume post-generation RNG — otherwise postCount would perturb
      // later-round votes even though the corpus is fixed. Only votes are
      // seeded (the fixed corpus is already in place).
      const roundPopulation =
        scenario.personaDrift === undefined
          ? scenario.population
          : {
              ...scenario.population,
              personaMix: interpolatePersonaMix(
                scenario.personaDrift.from,
                scenario.personaDrift.to,
                scenario.rounds === 1 ? 1 : (round - 1) / (scenario.rounds - 1)
              ),
            };
      const roundVotes =
        round === 1 && scenario.personaDrift === undefined
          ? population.votes
          : generateVotes(this.deps.rng, population.subscribers, roundPopulation);
      if (round === 1) {
        firstRoundVotes = roundVotes;
      }
      record('votes_generated', { round, voteCount: roundVotes.length });

      await this.insertVotes(this.deps.db, { ...population, votes: roundVotes }, epochBeforeId, dualWrite);
      record('votes_seeded', { round, epochId: epochBeforeId });

      // Guard the exact failure the single-cycle path guards (the aggregateVotes
      // null-check in runEpochVoteCycle): a round with zero eligible weight votes
      // makes aggregateVotes return null, and forceEpochTransition then silently
      // keeps the prior epoch's weights — which this loop would record as
      // l2Displacement 0, a *false* "converged" signal. Fail loud instead.
      // (forceEpochTransition re-aggregates internally; this explicit call
      // mirrors the single-cycle path and is what makes the convergence metric
      // trustworthy.)
      const roundAgg = await withTimeout(
        aggregateVotes(epochBeforeId),
        timeoutMs,
        `aggregateVotes[round ${round}]`
      );
      if (!roundAgg) {
        throw new Error(
          `Simulation.runMultiEpochCycle(): aggregateVotes(${epochBeforeId}) returned null in round ${round} — ` +
            `no eligible weight votes were seeded, so this round carries no convergence signal (keyword/topic ` +
            `votes alone cannot move the weight vector). Increase castsWeightVoteRate / subscriberCount / ` +
            `voteParticipationRate.`
        );
      }

      // Drive the REAL epoch-transition op — identical call to step 2 of
      // runEpochVoteCycle, just inside the loop. It internally aggregates
      // this round's votes (aggregateVotes/aggregateContentVotes/
      // aggregateTopicWeights) and writes the result onto the new epoch row,
      // plus the 'epoch_closed'/'epoch_created'/'epoch_transition_impact'
      // governance_audit_log rows fetchAuditLogSince picks up below.
      epochAfterId = await withTimeout(
        forceEpochTransition(),
        timeoutMs,
        `forceEpochTransition[round ${round}]`
      );
      record('epoch_transitioned', { round, fromEpochId: epochBeforeId, toEpochId: epochAfterId });

      // Drive the REAL scoring pipeline, same as runEpochVoteCycle step 3.
      await withTimeout(runScoringPipeline(), timeoutMs, `runScoringPipeline[round ${round}]`);
      record('scoring_pipeline_run', { round, epochId: epochAfterId });

      // Read back what forceEpochTransition itself just persisted, rather
      // than recomputing aggregation here — "drive, don't reimplement"
      // applies to per-round measurement too.
      const { weights, topicWeights } = await this.fetchEpochWeightsAndTopics(epochAfterId);
      const l2Displacement = l2Distance(previousWeights, weights);

      rounds.push({
        round,
        epochBeforeId,
        epochAfterId,
        voteCount: roundVotes.length,
        weights,
        topicWeights,
        l2Displacement,
      });
      record('round_measured', { round, epochId: epochAfterId, l2Displacement });

      previousWeights = weights;
    }

    if (rounds.length === 0) {
      // Unreachable: ScenarioV1Schema enforces rounds >= 1, so the loop above
      // always executes at least once — this guards against a silent bad read
      // below if that invariant is ever loosened without updating this.
      throw new Error('Simulation.runMultiEpochCycle(): scenario.rounds produced zero rounds');
    }

    const topPosts = await this.fetchTopScoredPosts(epochAfterId, 50);
    record('top_posts_fetched', { epochId: epochAfterId, count: topPosts.length });

    const auditLog = await this.fetchAuditLogSince(auditLogWatermarkId);

    const lastRound = rounds[rounds.length - 1];
    const resultPopulation =
      firstRoundVotes === undefined ? population : { ...population, votes: firstRoundVotes };
    return {
      scenario,
      population: resultPopulation,
      epochBeforeId,
      epochAfterId,
      aggregatedWeights: lastRound.weights,
      scoredPostCount: topPosts.length,
      topPosts,
      events,
      rounds,
      auditLog,
    };
  }

  private async seedPopulation(
    population: Population,
    epochId: number,
    voteWeightDualWrite: {
      writeVoteWeights: (voteId: string, weights: GovernanceWeights) => Promise<void>;
      dualWriteEnabled: boolean;
    }
  ): Promise<void> {
    await this.seedCorpus(population);
    await this.insertVotes(this.deps.db, population, epochId, voteWeightDualWrite);
  }

  /**
   * Seed the fixed community + content — subscribers, posts, and post
   * engagement — WITHOUT any votes. The single-cycle path runs it once via
   * `seedPopulation`; the multi-epoch path calls it once up front and then
   * re-seeds only votes each round, because a community's members and posts
   * don't change epoch to epoch — only their votes do. All three inserts use
   * `ON CONFLICT`, so a re-seed against an already-populated corpus is a
   * no-op for a fixed, deterministic corpus.
   */
  private async seedCorpus(population: Population): Promise<void> {
    const { db } = this.deps;

    // Subscribers and posts/engagement are batched (multi-row `INSERT ...
    // VALUES (...),(...)`) rather than one awaited round trip per row — see
    // `insertBatched` below.
    await insertBatched(
      db,
      population.subscribers,
      (batch, offset) => ({
        text: `INSERT INTO subscribers (did) VALUES ${valuesClause(batch.length, 1, offset)} ON CONFLICT (did) DO NOTHING`,
        params: batch.map((subscriber) => subscriber.did),
      })
    );

    await insertBatched(db, population.posts, (batch, offset) => ({
      // PROJ-917: posts' PK widened to (uri, created_at) — partitioned
      // tables require the partition key in every unique constraint.
      text: `INSERT INTO posts (uri, cid, author_did, text, created_at, has_media, embed_url, topic_vector)
             VALUES ${valuesClause(batch.length, 8, offset)}
             ON CONFLICT (uri, created_at) DO NOTHING`,
      params: batch.flatMap((post) => [
        post.uri,
        post.cid,
        post.authorDid,
        post.text,
        post.createdAt.toISOString(),
        post.hasMedia,
        post.embedUrl,
        JSON.stringify(post.topicVector),
      ]),
    }));

    await insertBatched(db, population.posts, (batch, offset) => ({
      text: `INSERT INTO post_engagement (post_uri, like_count, repost_count, reply_count)
             VALUES ${valuesClause(batch.length, 4, offset)}
             ON CONFLICT (post_uri) DO UPDATE SET
               like_count = EXCLUDED.like_count,
               repost_count = EXCLUDED.repost_count,
               reply_count = EXCLUDED.reply_count`,
      params: batch.flatMap((post) => [post.uri, post.likeCount, post.repostCount, post.replyCount]),
    }));
  }

  /**
   * Validate every generated vote exactly as `POST /api/governance/vote`
   * would (vote-validation.ts), then bulk-insert all of them (weight-only,
   * keyword-only, topic-weight-only, and any combination) in one batched
   * `INSERT ... SELECT FROM jsonb_to_recordset(...)` per chunk, and finally
   * dual-write each inserted weight vote into the `governance_vote_weights`
   * long table (still one `writeVoteWeights` call per vote — see below).
   *
   * A single JSONB blob per chunk (rather than `unnest($1::text[], ...)`
   * over parallel arrays) sidesteps a real correctness hazard for the
   * `include_keywords`/`exclude_keywords` TEXT[] columns: `unnest` on a
   * `text[][]` parameter flattens BOTH dimensions into one row set, so it
   * can't carry "one TEXT[] per output row" the way this insert needs.
   * `jsonb_to_recordset` converts each JSON array (including a `[]`) into
   * the declared native array/jsonb column type per row, with no such
   * flattening hazard.
   *
   * Rows are correlated back to their `VoteSeed` by `voter_did` (unique per
   * epoch — `one_vote_per_epoch`) via `RETURNING id, voter_did`, not by
   * assuming the batch's output row order matches its input order — this is
   * what actually resolves the correctness hazard the previous per-row loop
   * called out (a batched `INSERT ... RETURNING` doesn't reliably preserve
   * positional correlation once `ON CONFLICT DO NOTHING` can skip rows).
   */
  private async insertVotes(
    db: QueryableDb,
    population: Population,
    epochId: number,
    voteWeightDualWrite: {
      writeVoteWeights: (voteId: string, weights: GovernanceWeights) => Promise<void>;
      dualWriteEnabled: boolean;
    }
  ): Promise<void> {
    if (population.votes.length === 0) {
      return;
    }

    this.assertVotesAreRouteValid(population);

    const rows = population.votes.map((vote) => ({
      voter_did: vote.voterDid,
      recency_weight: vote.weights?.recency ?? null,
      engagement_weight: vote.weights?.engagement ?? null,
      bridging_weight: vote.weights?.bridging ?? null,
      source_diversity_weight: vote.weights?.sourceDiversity ?? null,
      relevance_weight: vote.weights?.relevance ?? null,
      // Mirror routes/vote.ts:379-380 exactly: an empty keyword list is stored
      // as NULL, not `{}`. Harmless today (every consumer filters with
      // `array_length(...) > 0`, and `array_length('{}', 1) IS NULL`), but a
      // future `IS NULL` consumer would see `{}` and NULL differently — so keep
      // the harness byte-for-byte faithful to what the real route writes.
      include_keywords: vote.includeKeywords.length > 0 ? vote.includeKeywords : null,
      exclude_keywords: vote.excludeKeywords.length > 0 ? vote.excludeKeywords : null,
      topic_weight_votes: Object.keys(vote.topicWeights).length > 0 ? vote.topicWeights : null,
    }));

    const voteIdByVoterDid = new Map<string, string>();
    for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
      const inserted = await db.query<{ id: string; voter_did: string }>(
        `INSERT INTO governance_votes (
          voter_did, epoch_id,
          recency_weight, engagement_weight, bridging_weight,
          source_diversity_weight, relevance_weight,
          include_keywords, exclude_keywords, topic_weight_votes
        )
        SELECT
          x.voter_did, $2::int,
          x.recency_weight, x.engagement_weight, x.bridging_weight,
          x.source_diversity_weight, x.relevance_weight,
          x.include_keywords, x.exclude_keywords, x.topic_weight_votes
        FROM jsonb_to_recordset($1::jsonb) AS x(
          voter_did text,
          recency_weight float8,
          engagement_weight float8,
          bridging_weight float8,
          source_diversity_weight float8,
          relevance_weight float8,
          include_keywords text[],
          exclude_keywords text[],
          topic_weight_votes jsonb
        )
        ON CONFLICT (voter_did, epoch_id) DO NOTHING
        RETURNING id, voter_did`,
        [JSON.stringify(batch), epochId]
      );
      for (const row of inserted.rows) {
        voteIdByVoterDid.set(row.voter_did, row.id);
      }
    }

    // Fail loud if any row was silently skipped. `ON CONFLICT (voter_did,
    // epoch_id) DO NOTHING` drops a row (absent from RETURNING) when a vote
    // already exists for that DID+epoch — e.g. a second Simulation.run()
    // reusing an active/voting epoch (ensureActiveEpoch does reuse) with
    // overlapping index-derived subscriber DIDs. A dropped row means its
    // dual-write below no-ops and `population.votes` diverges from what's
    // actually in Postgres / what aggregateVotes reads, with zero signal —
    // exactly the untrustworthy-output failure this harness exists to prevent.
    // Same fail-loud convention as assertVotesAreRouteValid.
    if (voteIdByVoterDid.size !== rows.length) {
      const missing = rows
        .map((row) => row.voter_did)
        .filter((did) => !voteIdByVoterDid.has(did));
      throw new Error(
        `Simulation.insertVotes(): ${rows.length - voteIdByVoterDid.size} of ${rows.length} generated ` +
          `vote(s) were not inserted into governance_votes for epoch ${epochId} — ON CONFLICT ` +
          `(voter_did, epoch_id) skipped them, so a vote already existed for that DID+epoch (a reused ` +
          `epoch across runs, or a duplicate voter_did in the generated population). Downstream ` +
          `dual-write and aggregation would silently diverge from population.votes. ` +
          `Missing DIDs (first 10): ${missing.slice(0, 10).join(', ') || '(none — duplicate DIDs in batch)'}`
      );
    }

    if (!voteWeightDualWrite.dualWriteEnabled) {
      return;
    }

    // Mirror src/governance/routes/vote.ts's dual-write: aggregateVotes reads
    // from the governance_vote_weights long table (not the wide columns just
    // inserted above) whenever GOVERNANCE_LONGTABLE_READ_ENABLED is on (the
    // production default) — without this, seeded votes would be invisible to
    // the real aggregateVotes the harness is driving. Keyword-only votes
    // (`weights: null`) have nothing to dual-write and are skipped, matching
    // the route (writeVoteWeights no-ops on all-null weights anyway).
    const dualWrites: Array<{ voteId: string; weights: GovernanceWeights }> = [];
    for (const vote of population.votes) {
      if (!vote.weights) {
        continue;
      }
      const voteId = voteIdByVoterDid.get(vote.voterDid);
      if (voteId) {
        dualWrites.push({ voteId, weights: vote.weights });
      }
    }

    // Run the per-vote long-table writes with bounded concurrency rather than
    // one-await-at-a-time: writeVoteWeights uses its own autocommit pool, so
    // these are independent queries (order-invariant — each keyed by a distinct
    // voteId), and a serial round-trip-per-vote loop would dominate wall-clock
    // on the large-N runs this harness targets. Chunked to cap concurrent pool
    // connections (see DUAL_WRITE_CONCURRENCY).
    for (const batch of chunk(dualWrites, DUAL_WRITE_CONCURRENCY)) {
      await Promise.all(
        batch.map(({ voteId, weights }) => voteWeightDualWrite.writeVoteWeights(voteId, weights))
      );
    }
  }

  /**
   * Fail loud, before any vote ever reaches Postgres, if a generated vote
   * would not survive `POST /api/governance/vote`'s real validation (see
   * vote-validation.ts). A failure here means a bug in population.ts /
   * personas.ts — the whole point of this harness is that every seeded vote
   * is one the real route would have accepted, not merely one the DB schema
   * tolerates.
   */
  private assertVotesAreRouteValid(population: Population): void {
    const ctx: VoteValidationContext = {
      subscriberDids: new Set(population.subscribers.map((subscriber) => subscriber.did)),
      activeTopicSlugs: new Set(TOPIC_SLUGS),
      epochPhase: 'voting',
    };

    const failures: string[] = [];
    for (const vote of population.votes) {
      const result = validateVote(voteSeedToRawPayload(vote), ctx);
      if (!result.valid) {
        failures.push(`${vote.voterDid}: ${result.errors.join('; ')}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Simulation.seedPopulation(): ${failures.length} generated vote(s) would be rejected by the ` +
          `real POST /api/governance/vote route (see vote-validation.ts). This is a population.ts/` +
          `personas.ts generation bug, not a data problem:\n${failures.slice(0, 10).join('\n')}`
      );
    }
  }

  private async fetchTopScoredPosts(epochId: number, limit: number): Promise<TopScoredPost[]> {
    const result = await this.deps.db.query<{ post_uri: string; total_score: number | string }>(
      `SELECT post_uri, total_score FROM post_scores WHERE epoch_id = $1 ORDER BY total_score DESC, post_uri ASC LIMIT $2`,
      [epochId, limit]
    );

    return result.rows.map((row, index) => ({
      uri: row.post_uri,
      rank: index + 1,
      totalScore: Number(row.total_score),
    }));
  }

  /**
   * Read back the 5-component weight vector and topic-weight summary
   * `forceEpochTransition` just persisted onto `epochId` (the epoch it
   * created), rather than recomputing aggregation in the harness — mirrors
   * `fetchTopScoredPosts` reading back `post_scores` instead of re-scoring.
   */
  private async fetchEpochWeightsAndTopics(
    epochId: number
  ): Promise<{ weights: GovernanceWeights; topicWeights: Record<string, number> }> {
    const result = await this.deps.db.query<{
      recency_weight: number;
      engagement_weight: number;
      bridging_weight: number;
      source_diversity_weight: number;
      relevance_weight: number;
      topic_weights: Record<string, number> | null;
    }>(
      `SELECT recency_weight, engagement_weight, bridging_weight,
              source_diversity_weight, relevance_weight, topic_weights
       FROM governance_epochs
       WHERE id = $1`,
      [epochId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `Simulation.runMultiEpochCycle(): epoch ${epochId} not found immediately after ` +
          'forceEpochTransition() created it — this should be unreachable.'
      );
    }

    return {
      weights: {
        recency: Number(row.recency_weight),
        engagement: Number(row.engagement_weight),
        bridging: Number(row.bridging_weight),
        sourceDiversity: Number(row.source_diversity_weight),
        relevance: Number(row.relevance_weight),
      },
      topicWeights: row.topic_weights ?? {},
    };
  }

  /** Highest `governance_audit_log.id` at the moment a multi-epoch run starts
   *  — the watermark `fetchAuditLogSince` uses to isolate exactly the rows
   *  THIS run's `forceEpochTransition` calls wrote, from a table that's
   *  append-only across the whole test process. */
  private async fetchAuditLogWatermarkId(): Promise<number> {
    const result = await this.deps.db.query<{ id: number | null }>(
      `SELECT MAX(id) AS id FROM governance_audit_log`
    );
    return result.rows[0]?.id ?? 0;
  }

  private async fetchAuditLogSince(watermarkId: number): Promise<AuditLogRow[]> {
    const result = await this.deps.db.query<{
      id: number;
      action: string;
      epoch_id: number | null;
      details: Record<string, unknown> | null;
    }>(
      // created_at is deliberately not selected — see AuditLogRow's docstring
      // (wall-clock insert time, excluded so the audit-log artifact is reproducible).
      `SELECT id, action, epoch_id, details
       FROM governance_audit_log
       WHERE id > $1
       ORDER BY id ASC`,
      [watermarkId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      action: row.action,
      epochId: row.epoch_id,
      details: row.details,
    }));
  }
}
