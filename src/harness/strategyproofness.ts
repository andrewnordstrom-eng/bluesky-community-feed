/**
 * Strategyproofness Experiment (A4 / PROJ-1485)
 *
 * Motivation (bounded — see "What this does NOT claim" below): Freeman,
 * Pennock, Vaughan et al.'s result on trimmed-mean-style moving-knife/
 * median-style aggregators (EC 2019) shows that some voting-weight
 * aggregators are manipulable — a voter can, in some population
 * configurations, get an outcome CLOSER to their own true preference by
 * reporting something other than that true preference. That literature is
 * about idealized aggregators in the abstract; it is cited here purely as
 * the reason this experiment is worth running, not as a proof about this
 * specific codebase.
 *
 * What this module actually does: drives the REAL, unmodified
 * `aggregateVotes` (`src/governance/aggregation.ts` — component-wise 10%
 * trim for n >= 10, plain mean below that, then `normalizeWeights`'s
 * largest-remainder rounding to a 1000-scale) against a fixed, hand-specified
 * population, twice — once with one "focal" voter reporting their true
 * preference sincerely, once with that same focal voter reporting a corner
 * vote (all weight on one component) instead — and measures which report
 * leaves the focal voter's OWN true preference closer to the aggregate
 * outcome (`l1Distance`/`l2Distance`, convergence.ts). Every other voter's
 * report is held fixed across both runs, so the only thing that ever changes
 * between the "sincere" and "strategic" trial is the focal voter's own vote.
 *
 * This never re-implements trim/mean/normalize — every trial inserts real
 * `governance_votes` rows (mirroring `tests/harness/invariants.sim.ts`'s
 * low-level pattern) into a real epoch and calls the real `aggregateVotes`,
 * reading back whatever it actually returns.
 *
 * The population design (`OTHER_VOTER_CYCLE` below) is this repo's own
 * construction, not a reproduction of an external fixture — no prior
 * artifact in this repo pinned the specific "other N-1 voters" a target
 * 0.313 -> 0.146 result was computed against, so one had to be designed from
 * scratch. It reuses the four voter archetypes already defined as
 * `PERSONAS` base vectors (`personas.ts`) — chronological-purist,
 * engagement-maximizer, bridge-builder, balanced — copied here as
 * jitter-free literals so the population is exactly reproducible without
 * depending on an injected `Rng`. See `tests/harness/strategyproofness.sim.ts`
 * for the n=10 headline reproduction and the population-size sweep.
 *
 * Methods: for a population of size n, the focal voter is always subscriber
 * index 0; the other n-1 reports are `buildOtherVoterReports(n - 1)` (a
 * fixed cycle through the four archetypes above, ratio 3:3:2:1 at n=10).
 * Two isolated epochs are seeded with IDENTICAL other-voter reports — one
 * where the focal voter casts `SEED_FOCAL_TRUE` (sincere), one where it
 * casts `SEED_FOCAL_CORNER` (strategic) — and the real `aggregateVotes` is
 * called once per epoch. The focal voter's L1/L2 distance from
 * `SEED_FOCAL_TRUE` to each of the two real outcomes is the displacement
 * metric; `deltaL1`/`deltaL2` (sincere minus strategic) being positive is
 * "manipulation paid".
 *
 * Results (measured against this population, real `aggregateVotes`,
 * `tests/harness/strategyproofness.sim.ts`):
 *
 * | n  | trim | sincereL1 | strategicL1 | deltaL1 | manipulation paid? |
 * |----|------|-----------|-------------|---------|---------------------|
 * | 6  | 0    | 0.502     | 0.510       | -0.008  | no                  |
 * | 8  | 0    | 0.308     | 0.326       | -0.018  | no                  |
 * | 10 | 1    | 0.302     | 0.236       | +0.066  | yes                 |
 * | 15 | 1    | 0.402     | 0.378       | +0.024  | yes                 |
 * | 20 | 2    | 0.364     | 0.332       | +0.032  | yes                 |
 * | 30 | 3    | 0.386     | 0.364       | +0.022  | yes                 |
 * | 50 | 5    | 0.366     | 0.352       | +0.014  | yes                 |
 *
 * The n=10 seed case does NOT reproduce the external 0.313 -> 0.146 target
 * byte for byte — this repo's own population produces 0.302 -> 0.236, a
 * smaller (but still real, still measured-on-real-code) improvement. The
 * sweep shows the effect is not a one-off at n=10: every trim-eligible
 * population size tested (n >= 10) shows the same direction, while the two
 * untrimmed populations (n=6, n=8, plain mean, no trim) show the OPPOSITE
 * direction for this same population design — sincere reporting is at least
 * as good there. That split lines up with the mechanism: reporting the
 * corner puts the focal voter's report at the extreme on every component, so
 * once trimming is active it gets trimmed away entirely on 4 of 5
 * components, and the outcome on those components becomes a function of the
 * other n-1 voters alone rather than a blend that dilutes the focal voter's
 * own (moderate, non-extreme) sincere vote with more extreme peers.
 *
 * Population choice — not a cherry-pick: an exploration over principled
 * population variants (alternative archetype mixes and perturbations of the
 * 3:3:2:1 ratio) found none that robustly improved on this baseline's n=10
 * effect. Populations polarized AGAINST the focal voter's own
 * engagement-leaning preference reverse the sign entirely — manipulation
 * stops paying — see `buildPolarizedAgainstEngagementOtherVoterReports` and
 * `tests/harness/strategyproofness.sim.ts`'s population-robustness test,
 * which pins both directions (baseline pays, polarized doesn't) against the
 * real `aggregateVotes`. That reversal is consistent with the trim mechanism
 * above: the exploit's leverage comes precisely from the focal's corner vote
 * displacing an engagement-maximizer peer out of the top-trim slot; with no
 * such peer left in the population to displace, the focal's own extreme vote
 * is simply trimmed and nothing is gained. This baseline is reported as the
 * effect found, not as the largest of an unreproducible search.
 *
 * What this does NOT claim: this is evidence about THIS aggregator against
 * THESE populations, not a general strategyproofness theorem about trimmed
 * means. A different population, a different focal preference, or a
 * different corner choice could easily land on the other side of the
 * decision, and the untrimmed (n < 10) rows above already show the direction
 * is not universal even within this one experiment. The population-size
 * sweep exists specifically to show the n=10 result is not a one-off
 * coincidence, but it is still a finite set of populations, not a proof over
 * all of them.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { QueryableDb } from './simulation.js';
import { l1Distance, l2Distance } from './convergence.js';
import { GOVERNANCE_WEIGHT_KEYS } from '../config/votable-params.js';
import type { GovernanceWeights } from '../shared/api-types.js';

/**
 * Deferred import of the governance modules this experiment drives — same
 * rationale as `simulation.ts`'s `loadGovernanceModules`: these transitively
 * import `src/config.ts` (parses `process.env` at import time) and
 * `src/db/client.ts`/`redis.ts` (open connections as an import side effect).
 * Deferring means importing this file never has that side effect; only
 * calling one of the exported `run*` functions below does.
 */
async function loadGovernanceModules() {
  const { aggregateVotes } = await import('../governance/aggregation.js');
  const { writeVoteWeights } = await import('../governance/weight-longtable.js');
  const { config } = await import('../config.js');
  return { aggregateVotes, writeVoteWeights, config };
}

type GovernanceModules = Awaited<ReturnType<typeof loadGovernanceModules>>;

/**
 * Trim count `aggregateVotes` applies for a given population size — mirrors
 * `src/governance/aggregation.ts`'s `effectiveTrimCount` exactly (component-wise
 * 10% trim from each end once n >= 10, no trim below that). Not used to
 * compute the aggregate here (the real `aggregateVotes` does that) — only to
 * label sweep rows with the trim regime each `n` fell into.
 *
 * MUST stay in sync with `src/governance/aggregation.ts`'s private trim
 * formula (`aggregateVotes`, the `trimCount`/`effectiveTrimCount` locals
 * around line 96-99: `Math.floor(n * 0.1)`, applied only when `n >= 10`).
 * That formula isn't exported, and `aggregateVotes`'s return value doesn't
 * expose how many votes it trimmed, so this harness has no way to read the
 * real trim count back — it can only assert this hand-copy matches it. If
 * `aggregation.ts` ever changes its trim percentage or threshold, this
 * function (and the hardcoded expected-trim-count table in
 * `tests/harness/strategyproofness.sim.ts`'s sweep test) must be updated too,
 * or the sweep's trim-count labels will silently go stale.
 */
export function effectiveTrimCount(n: number): number {
  return n >= 10 ? Math.floor(n * 0.1) : 0;
}

/**
 * Insert one real `governance_votes` row for `voterDid` in `epochId` with the
 * given weight report, then (mirroring `src/governance/routes/vote.ts`'s
 * dual-write, gated the same way production is) dual-write it into the
 * `governance_vote_weights` long table — otherwise the vote would be invisible
 * to `aggregateVotes` whenever `GOVERNANCE_LONGTABLE_READ_ENABLED` is on (the
 * production default). Identical shape to the inline block in
 * `tests/harness/invariants.sim.ts`, factored out here since this module
 * casts many such votes per trial.
 */
async function insertWeightVote(
  db: QueryableDb,
  modules: Pick<GovernanceModules, 'writeVoteWeights' | 'config'>,
  epochId: number,
  voterDid: string,
  weights: GovernanceWeights
): Promise<void> {
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO governance_votes (
      voter_did, epoch_id, recency_weight, engagement_weight,
      bridging_weight, source_diversity_weight, relevance_weight
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      voterDid,
      epochId,
      weights.recency,
      weights.engagement,
      weights.bridging,
      weights.sourceDiversity,
      weights.relevance,
    ]
  );

  if (modules.config.GOVERNANCE_LONGTABLE_DUALWRITE_ENABLED) {
    await modules.writeVoteWeights(inserted.rows[0].id, weights);
  }
}

export interface StrategyproofnessDeps {
  db: QueryableDb;
}

/**
 * One "cast every vote in `epochId`, then read back the real aggregate"
 * pass. `subscriberDids[0]` is always the focal voter (cast as
 * `focalReport`); `subscriberDids[1..]` line up positionally with
 * `otherReports`. Caller (`runStrategyproofnessTrial`) is responsible for
 * `epochId` being a fresh, isolated epoch — casting both a "sincere" and a
 * "strategic" trial into the SAME epoch would let the focal voter's two
 * reports collide on `governance_votes`' `(voter_did, epoch_id)` uniqueness
 * constraint, and would no longer isolate "only the focal report changed".
 */
async function castTrialVotes(
  deps: StrategyproofnessDeps,
  modules: GovernanceModules,
  options: {
    epochId: number;
    subscriberDids: readonly string[];
    focalReport: GovernanceWeights;
    otherReports: readonly GovernanceWeights[];
  }
): Promise<GovernanceWeights> {
  const { epochId, subscriberDids, focalReport, otherReports } = options;

  if (subscriberDids.length !== otherReports.length + 1) {
    throw new Error(
      `castTrialVotes: subscriberDids (${subscriberDids.length}) must be exactly ` +
        `otherReports (${otherReports.length}) + 1 (the focal voter)`
    );
  }

  // `epochId` comes from `insertActiveEpoch` (tests/harness/helpers.ts), which
  // leaves `phase` at the schema default `'running'` (see
  // `src/db/migrations/009_governance_phases.sql`). The REAL vote route
  // (`src/governance/routes/vote.ts`) only accepts votes into an epoch whose
  // `phase` is `'voting'` — anything else 409s with `VotingClosed`. Flip the
  // epoch to `'voting'` before casting any votes into it so every seeded vote
  // below is genuinely route-valid: a real voter, hitting the real route,
  // could only ever have cast into an epoch in this same phase. This does not
  // affect `aggregateVotes` (it reads by `epoch_id` alone, not `phase`), but
  // `'voting'` is the honest phase for votes that are meant to look real.
  await deps.db.query(`UPDATE governance_epochs SET phase = 'voting' WHERE id = $1`, [epochId]);

  await insertWeightVote(deps.db, modules, epochId, subscriberDids[0], focalReport);
  for (const [index, report] of otherReports.entries()) {
    await insertWeightVote(deps.db, modules, epochId, subscriberDids[index + 1], report);
  }

  const outcome = await modules.aggregateVotes(epochId);
  if (!outcome) {
    throw new Error(`castTrialVotes: aggregateVotes(${epochId}) returned null — no votes were seeded`);
  }
  return outcome;
}

export interface StrategyproofnessTrialInput {
  /** Total voter count (focal + others). Must equal `otherReports.length + 1`. */
  n: number;
  /** The focal voter's true preference — the point every displacement is measured against. */
  focalTrue: GovernanceWeights;
  /** The corner report the focal voter casts instead, to test manipulability. */
  focalCorner: GovernanceWeights;
  /** The other n-1 voters' reports, held IDENTICAL across the sincere and strategic runs. */
  otherReports: readonly GovernanceWeights[];
  /** Real subscriber DIDs, length n. Index 0 is the focal voter. */
  subscriberDids: readonly string[];
  /** A fresh, empty 'active' epoch to cast the sincere trial's votes into. */
  sincereEpochId: number;
  /** A second fresh, empty 'active' epoch to cast the strategic trial's votes into. */
  strategicEpochId: number;
}

export interface StrategyproofnessTrialResult {
  n: number;
  trimCount: number;
  focalTrue: GovernanceWeights;
  focalCorner: GovernanceWeights;
  sincereEpochId: number;
  strategicEpochId: number;
  sincereOutcome: GovernanceWeights;
  strategicOutcome: GovernanceWeights;
  sincereL1: number;
  sincereL2: number;
  strategicL1: number;
  strategicL2: number;
  /**
   * `sincereL1 - strategicL1`. Positive means the corner report left the
   * focal voter's true preference CLOSER to the outcome than sincere
   * reporting did — i.e. misreporting paid. Zero or negative means sincere
   * reporting was at least as good.
   */
  deltaL1: number;
  /** Same comparison in L2. */
  deltaL2: number;
}

/**
 * Run one sincere-vs-strategic trial pair for a single population: cast the
 * focal voter's TRUE preference into `sincereEpochId`, cast the focal
 * voter's CORNER report into `strategicEpochId` (same other-voter reports
 * both times), read back the real `aggregateVotes` outcome for each, and
 * measure the focal voter's own L1/L2 displacement from each outcome.
 *
 * Drives the real `aggregateVotes` exactly twice — one real Postgres
 * round-trip pair per trial — and never re-implements trim/mean/normalize.
 */
export async function runStrategyproofnessTrial(
  deps: StrategyproofnessDeps,
  input: StrategyproofnessTrialInput
): Promise<StrategyproofnessTrialResult> {
  const { n, focalTrue, focalCorner, otherReports, subscriberDids, sincereEpochId, strategicEpochId } = input;

  if (otherReports.length !== n - 1) {
    throw new Error(
      `runStrategyproofnessTrial: otherReports must have length n-1 (${n - 1}), got ${otherReports.length}`
    );
  }
  if (subscriberDids.length !== n) {
    throw new Error(`runStrategyproofnessTrial: subscriberDids must have length n (${n}), got ${subscriberDids.length}`);
  }

  const modules = await loadGovernanceModules();

  const sincereOutcome = await castTrialVotes(deps, modules, {
    epochId: sincereEpochId,
    subscriberDids,
    focalReport: focalTrue,
    otherReports,
  });
  const strategicOutcome = await castTrialVotes(deps, modules, {
    epochId: strategicEpochId,
    subscriberDids,
    focalReport: focalCorner,
    otherReports,
  });

  const sincereL1 = l1Distance(focalTrue, sincereOutcome);
  const sincereL2 = l2Distance(focalTrue, sincereOutcome);
  const strategicL1 = l1Distance(focalTrue, strategicOutcome);
  const strategicL2 = l2Distance(focalTrue, strategicOutcome);

  return {
    n,
    trimCount: effectiveTrimCount(n),
    focalTrue,
    focalCorner,
    sincereEpochId,
    strategicEpochId,
    sincereOutcome,
    strategicOutcome,
    sincereL1,
    sincereL2,
    strategicL1,
    strategicL2,
    deltaL1: sincereL1 - strategicL1,
    deltaL2: sincereL2 - strategicL2,
  };
}

// ============================================================================
// Fixed "other voters" population (documented, deterministic — see the file
// header for why this is this repo's own construction rather than a
// recovered fixture).
// ============================================================================

/**
 * Four fixed voter archetypes, copied from `personas.ts`'s `PERSONAS` base
 * vectors (jitter stripped — `personas.ts` applies a +/-0.05 `Rng` jitter per
 * component around these same numbers; this experiment needs exact,
 * hand-auditable reproducibility instead, not a realistic spread) so the
 * "other voters" read as recognizable community strategies rather than
 * arbitrary numbers, while staying fully independent of any `Rng` seed.
 * Each sums to exactly 1.0.
 */
const ARCHETYPE_CHRONOLOGICAL_PURIST: GovernanceWeights = {
  recency: 0.7,
  engagement: 0.05,
  bridging: 0.05,
  sourceDiversity: 0.05,
  relevance: 0.15,
};
const ARCHETYPE_ENGAGEMENT_MAXIMIZER: GovernanceWeights = {
  recency: 0.05,
  engagement: 0.7,
  bridging: 0.05,
  sourceDiversity: 0.05,
  relevance: 0.15,
};
const ARCHETYPE_BRIDGE_BUILDER: GovernanceWeights = {
  recency: 0.05,
  engagement: 0.05,
  bridging: 0.7,
  sourceDiversity: 0.15,
  relevance: 0.05,
};
const ARCHETYPE_BALANCED: GovernanceWeights = {
  recency: 0.2,
  engagement: 0.2,
  bridging: 0.2,
  sourceDiversity: 0.2,
  relevance: 0.2,
};

/**
 * The fixed 9-voter "other reports" pattern used for the n=10 seed trial:
 * 3 chronological-purist, 3 engagement-maximizer, 2 bridge-builder, 1
 * balanced. This 3:3:2:1 ratio is a deliberate design choice (not derived
 * from any external source): it gives recency and engagement a symmetric,
 * equally-weighted "pull" away from the focal voter's true preference in
 * both directions, a slightly weaker pull on bridging (2 voters instead of
 * 3), and exactly one dissenting "balanced" vote so the population isn't
 * purely bimodal. `buildOtherVoterReports` below cycles through this same
 * 9-length pattern to build the "other n-1 voters" for any sweep point,
 * so every `n` in the sweep is a population built the same documented way,
 * not a one-off per n.
 */
const OTHER_VOTER_CYCLE: readonly GovernanceWeights[] = [
  ARCHETYPE_CHRONOLOGICAL_PURIST,
  ARCHETYPE_CHRONOLOGICAL_PURIST,
  ARCHETYPE_CHRONOLOGICAL_PURIST,
  ARCHETYPE_ENGAGEMENT_MAXIMIZER,
  ARCHETYPE_ENGAGEMENT_MAXIMIZER,
  ARCHETYPE_ENGAGEMENT_MAXIMIZER,
  ARCHETYPE_BRIDGE_BUILDER,
  ARCHETYPE_BRIDGE_BUILDER,
  ARCHETYPE_BALANCED,
];

/**
 * Build the fixed "other voters" report list for a population of `otherCount`
 * non-focal voters, by cycling through `OTHER_VOTER_CYCLE` (repeating it as
 * many times as needed, truncating the last repetition). Deterministic and
 * pure — same `otherCount` always yields the same list, byte for byte.
 */
export function buildOtherVoterReports(otherCount: number): GovernanceWeights[] {
  if (!Number.isInteger(otherCount) || otherCount < 0) {
    throw new Error(`buildOtherVoterReports: otherCount must be a non-negative integer, got ${otherCount}`);
  }
  return Array.from({ length: otherCount }, (_, i) => OTHER_VOTER_CYCLE[i % OTHER_VOTER_CYCLE.length]);
}

/**
 * An alternative "other voters" population for the population-robustness
 * test (PROJ-1485 fix C, see `tests/harness/strategyproofness.sim.ts`): every
 * other voter reports `ARCHETYPE_CHRONOLOGICAL_PURIST`
 * (recency 0.7 / engagement 0.05 / bridging 0.05 / sourceDiversity 0.05 /
 * relevance 0.15) instead of the documented 3:3:2:1 mix — i.e. the community
 * is polarized AGAINST the focal voter's own engagement-leaning true
 * preference (`SEED_FOCAL_TRUE`'s largest component), with no
 * engagement-favoring peer left in the population at all.
 *
 * This backs the qualitative claim in this file's header: polarizing the
 * population against the focal voter's preference reverses the
 * manipulation-pays sign, because the exploit's leverage over the baseline
 * population comes from the focal's corner vote displacing an
 * engagement-maximizer peer out of the top-trim slot — with no such peer to
 * displace, the focal's own extreme corner vote is simply trimmed and
 * nothing is gained.
 */
export function buildPolarizedAgainstEngagementOtherVoterReports(otherCount: number): GovernanceWeights[] {
  if (!Number.isInteger(otherCount) || otherCount < 0) {
    throw new Error(
      `buildPolarizedAgainstEngagementOtherVoterReports: otherCount must be a non-negative integer, got ${otherCount}`
    );
  }
  return Array.from({ length: otherCount }, () => ARCHETYPE_CHRONOLOGICAL_PURIST);
}

/**
 * The n=10 headline reproduction fixture (see the file header + PROJ-1485).
 *
 * `focalTrue` sums to exactly 1.0 (0.160 + 0.377 + 0.161 + 0.174 + 0.128).
 * `focalCorner` is the all-engagement corner of the simplex — the most
 * extreme report available under `normalizeWeights`' clamp to [0, 1] per
 * component.
 */
export const SEED_FOCAL_TRUE: GovernanceWeights = {
  recency: 0.16,
  engagement: 0.377,
  bridging: 0.161,
  sourceDiversity: 0.174,
  relevance: 0.128,
};

export const SEED_FOCAL_CORNER: GovernanceWeights = {
  recency: 0,
  engagement: 1,
  bridging: 0,
  sourceDiversity: 0,
  relevance: 0,
};

/** Sanity-check helper: does `weights` sum to 1 within `tolerance`? Exported for tests. */
export function sumsToOne(weights: GovernanceWeights, tolerance = 1e-9): boolean {
  const sum = GOVERNANCE_WEIGHT_KEYS.reduce((total, key) => total + weights[key], 0);
  return Math.abs(sum - 1) < tolerance;
}

// ============================================================================
// CSV artifact writer — mirrors `metrics.ts`'s `writeArtifacts` /
// `writeEpochSeriesArtifacts` convention: a `<baseDir>/strategyproofness/`
// subdirectory, one `mkdir(recursive)` + one `writeFile`, plain CSV.
// ============================================================================

const SWEEP_CSV_HEADER = [
  'n',
  'trimCount',
  'sincereL1',
  'sincereL2',
  'strategicL1',
  'strategicL2',
  'deltaL1',
  'deltaL2',
  'manipulationPaid',
] as const;

function csvNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

function toSweepCsv(rows: readonly StrategyproofnessTrialResult[]): string {
  const lines = rows.map((row) =>
    [
      row.n,
      row.trimCount,
      csvNumber(row.sincereL1, 9),
      csvNumber(row.sincereL2, 9),
      csvNumber(row.strategicL1, 9),
      csvNumber(row.strategicL2, 9),
      csvNumber(row.deltaL1, 9),
      csvNumber(row.deltaL2, 9),
      row.deltaL1 > 0 ? 'true' : 'false',
    ].join(',')
  );
  return `${SWEEP_CSV_HEADER.join(',')}\n${lines.join('\n')}\n`;
}

export interface WrittenStrategyproofnessArtifactPaths {
  csvPath: string;
}

/**
 * Persist a sweep's rows to `<baseDir>/strategyproofness/sweep.csv` — same
 * `mkdir(recursive) + writeFile` shape as `writeArtifacts`/
 * `writeEpochSeriesArtifacts` (metrics.ts), so callers that already have a
 * scenario `artifactsDir` (`runScenario`'s `RunScenarioOptions`) can reuse it
 * unchanged for this experiment's output too.
 */
export async function writeStrategyproofnessArtifacts(
  baseDir: string,
  rows: readonly StrategyproofnessTrialResult[]
): Promise<WrittenStrategyproofnessArtifactPaths> {
  const dir = path.join(baseDir, 'strategyproofness');
  await mkdir(dir, { recursive: true });

  const csvPath = path.join(dir, 'sweep.csv');
  await writeFile(csvPath, toSweepCsv(rows), 'utf8');

  return { csvPath };
}
