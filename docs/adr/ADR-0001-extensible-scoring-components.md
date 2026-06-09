# ADR-0001 — Extensible scoring components via a registry-driven, long-table-backed contract

Status: Accepted
Owner: bluesky-feed
Date: 2026-05-26
Linear: PROJ-814, PROJ-815, PROJ-816, PROJ-817, PROJ-818, PROJ-819, PROJ-820

## Context

The pre-refactor system carried the *vocabulary* of a plug-in scoring
architecture — there was a `ScoringComponent` interface, a `registry.ts`
with module-load drift validation, and a clean
`for (const component of DEFAULT_COMPONENTS)` loop in the pipeline —
but the *implementation* fossilized exactly five components into the
schema, types, and most consumers:

- `post_scores` carried 15 wide columns (`recency_score`,
  `recency_weight`, `recency_weighted`, × 5).
- `governance_epochs` and `governance_votes` each had 5 named weight
  columns plus CHECK constraints that hard-coded those names in
  arithmetic.
- `GovernanceWeightKey` was a string-literal union of 5; `GovernanceWeights`
  was a 5-field interface.
- `storeScore` used a 17-column positional INSERT.
- Three transparency routes, five admin routes, four governance internals,
  and two Python report generators all SELECTed named columns.
- The component generator script printed 7 manual steps after running.

The end-to-end effect: adding a sixth component meant ~24 file edits
plus DDL plus a rewritten INSERT — and the maintainer's own honest
receipt in the generator script said scaffolding got you 30% of the
way.

The pluggability promise made in the README, PRD, and ARCHITECTURE
documents was therefore false. A third party could not "drop in their
own recsys" without forking the monolith.

## Decision

Refactor the system so adding, replacing, or removing a scoring
component is a true plug-in: implement the `ScoringComponent`
interface, append to `DEFAULT_COMPONENTS`, optionally seed an initial
weight, ship. The refactor is sequenced across seven Linear packets
applying the Expand-Migrate-Contract pattern; this ADR captures the
architectural shape that emerges at the end.

### The contract surface

A scoring component is a stable triple:

```ts
interface ScoringComponent {
  readonly key: string;
  readonly name: string;
  score(post: PostForScoring, context: ScoringContext): Promise<number>;
}
```

Component keys are validated **at runtime against the registry**, not
at compile time. The registry's `validateRegistry()` function runs at
module load and rejects any drift between `DEFAULT_COMPONENTS` and
`VOTABLE_WEIGHT_PARAMS`. Adding a sixth component is now a single-file
edit to `DEFAULT_COMPONENTS` plus a corresponding entry in
`VOTABLE_WEIGHT_PARAMS` — both of which the drift check ensures stay
in sync.

The type system reflects this: `GovernanceWeights = Record<string, number>`
and `ScoreComponents extends GovernanceWeights`. The 5-key literal
union is gone; nothing in TypeScript still assumes a fixed cardinality.

### The schema

Per-component data lives in two normalized side tables:

- `post_score_components(post_uri, epoch_id, component_key, raw, weight, weighted, scored_at)`
- `governance_epoch_weights(epoch_id, component_key, weight)` and
  `governance_vote_weights(vote_id, component_key, weight)`

The wide-column legacy is dropped in PROJ-819 (P5). The sum-to-one
invariant that used to live in two CHECK constraints (which enumerated
the 5 names in arithmetic) is replaced by a constraint-trigger that
SUMs whatever long-table rows are present — N-agnostic.

The serving hot path (`writeToRedisFromDb`) reads only `total_score`
from `post_scores`, so the schema normalization adds no latency to the
Redis snapshot write.

### The SDK boundary

The public type surface is published as the `@corgi/feed-sdk`
workspace package (`packages/feed-sdk/`). A third-party component
author depends on the SDK, implements `ScoringComponent`, and writes
a unit test — without cloning the monolith or touching internal paths.
The `createComponent({ key, name, score })` helper wraps the common
case.

The SDK lives in this monorepo. Publishing to the npm registry is an
explicit follow-up; the workspace symlink resolution is sufficient for
the contribution flow.

### The contribution flow

External component proposals follow this path (codified in PROJ-820 / P7):

1. Author implements `ScoringComponent` against `@corgi/feed-sdk` in
   their fork or workspace.
2. Author writes a unit test that exercises the component without DB
   dependencies.
3. Author opens a Linear issue under `bluesky-feed` describing the
   component (purpose, expected score distribution, any external
   dependencies, governance implications).
4. Author opens a PR that registers the component in
   `DEFAULT_COMPONENTS` and adds the matching `VOTABLE_WEIGHT_PARAMS`
   entry. The drift check at module load proves the wiring.
5. Optionally, author seeds an initial weight in
   `governance_epoch_weights` for epoch 1 so the component starts
   contributing immediately.

CI exercises the contribution flow via an example external component
fixture (`tests/fixtures/example-external-component.ts`) that imports
only from `@corgi/feed-sdk`. If the SDK ever loses an export the
external surface needs, CI breaks.

## Consequences

### Positive

- **The pluggability claim becomes honest.** What the docs promise is
  what the code does. README, PRD, and ARCHITECTURE.md are updated in
  PROJ-820.
- **N-agnostic governance.** Adding `civility` or removing `bridging`
  is a single-file edit plus a backfill — no DDL, no
  constraint-juggling, no consumer migrations.
- **Audit invariant preserved.** The "every ranking decision is
  decomposed and persisted" rule moves from 15 wide columns to a
  3-tuple per `(post, epoch, component)`. Transparency, post-explain,
  and counterfactual surfaces continue to work.
- **Type-system honesty.** `Record<string, number>` says exactly what
  the system supports. The runtime validator in `registry.ts` enforces
  the actual constraint (registered keys only); the compiler no
  longer makes a false promise about a closed cardinality.
- **SDK surface gives external contributors a stable import path.**
  No more "fork the monolith and edit shared types."

### Negative

- **Two writes per component per scored post** during the long-table
  window (P1, before P5 cutover). Mitigated by batching the inserts
  inside one transaction; measured pipeline duration unchanged.
- **Read paths must handle both shapes** during the P4 bake-in. A
  feature flag controls the switch; parity tests verify equivalence.
  Removed in P5.
- **The CHECK constraints become triggers.** Triggers are heavier than
  CHECK constraints and slightly harder to reason about. Mitigated by
  keeping the trigger logic dead-simple (sum and compare) and adding
  unit tests in PROJ-819.
- **The cutover (P5) is irreversible without backup restore.** Rollback
  SOP captured in the packet body and `REPO_CONTRACT.md §6`. A 7-day
  production bake-in between P4 and P5 is non-negotiable.

### Neutral

- **The component_details JSONB column on `post_scores` is preserved.**
  Per-component free-form metadata (e.g., bridging's `engager_count`)
  continues to live there; the long-table holds only the numeric triple.
- **AT Protocol XRPC contract is unchanged.** `getFeedSkeleton`,
  `describeFeedGenerator`, and `sendInteractions` are not affected.
  External Bluesky clients see no difference.
- **Governance model unchanged.** Polis-style epochs and trimmed-mean
  aggregation remain. Only the *shape* of the weight vector changes,
  not the tallying logic.

## Alternatives considered

### Keep the wide columns; add a JSONB sidecar for arbitrary components

The `post_scores.component_details` JSONB column was already present
and could store per-component metadata. But JSONB columns don't index
well for per-component aggregation queries (`SELECT AVG(bridging_score)
FROM post_scores WHERE epoch_id = $1`), and the wide-column INSERT
would still need to be rewritten for any component change. Rejected:
solves only the metadata problem, not the schema-rigidity problem.

### Use a single "components" JSONB column to replace the 15 wide columns

Tighter than the sidecar but worsens query ergonomics. Aggregation
queries become `(component_details->>'recency_score')::float` which is
unindexable in practice and pushes shape-parsing into every reader.
The long-table option keeps queries idiomatic and indexable. Rejected.

### Make the SDK a separate repo with its own release cadence

Adds release-coordination overhead for what is fundamentally a
type-only package. The monorepo workspace gives external contributors
the same import path (`@corgi/feed-sdk`) without the version-skew risk.
A separate repo is a reasonable future move if the SDK grows runtime
helpers that need independent versioning. Deferred.

### Defer the type widening; just add the long tables

Half-measure. Without `Record<>`-shaped types, the consumers still
have to know about 5 specific keys, and the type system still rejects
a 6th. The whole point of the refactor is honest pluggability;
deferring the type change defeats it. Rejected.

## References

- Packets: PROJ-814 (P1 score long-table), PROJ-815 (P2 governance
  long-table), PROJ-816 (P3 Record-ify types), PROJ-817 (P4 reader
  migration), PROJ-819 (P5 cutover), PROJ-818 (P6 SDK extraction —
  this ADR), PROJ-820 (P7 contribution flow + docs).
- Session plan: `~/.claude/plans/please-make-a-plan-starry-scott.md`
  (operator-local; mirrors packet structure).
- Repo contract: `docs/agent/REPO_CONTRACT.md`.
- ARCHITECTURE: `docs/ARCHITECTURE.md` (updated in PROJ-820 to match
  the post-refactor reality).
- SDK package: `packages/feed-sdk/`.
- Example external component: `tests/fixtures/example-external-component.ts`.
