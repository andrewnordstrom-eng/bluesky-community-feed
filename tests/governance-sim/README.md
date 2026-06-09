# Governance test suite

Layered, deterministic-first tests for the community-governance logic. The design
follows the hexagonal pattern already used in this repo: **decision policy is
separated from I/O** so it can be exhaustively tested without a database.

## Layers

1. **Property / unit — pure, fast, CI-trivial**
   - `tests/governance-aggregation.property.test.ts` — `combineVoteWeights` invariants
     (sum-to-1, valid bounds, unanimity, trimmed-mean **outlier resistance**) plus a
     10,000-ballot scale smoke, via `fast-check`.
   - `tests/governance-decisions.property.test.ts` — the quorum policy
     (`quorumMet` / `quorumStatus`): boundary, monotonicity, shortfall.

   Pure cores extracted from the DB-coupled code:
   `src/governance/aggregation-core.ts` (trimmed-mean aggregation) and
   `src/governance/governance-decisions.ts` (quorum).

2. **Integration — mock-DB (the repo's pattern), no external Postgres**
   - `tests/governance-aggregation.integration.test.ts` — drives the **real**
     `aggregateVotes` over synthetic vote rows (`vi.mock` of `db/client`), confirming
     the DB query path agrees with the pure core, excludes keyword-only votes,
     scales to 1,000 votes, and engages the 10% trim.

3. **Simulation — deterministic agent-based (NOT LLM agents)**
   - `tests/governance-sim/harness.ts` + `tests/governance-sim.test.ts` — seeded
     synthetic voter populations + adversarial models (Sybil sockpuppets, strategic
     extremes) run through the real aggregation core. Reproducible.

## Running

- Whole suite: `npx vitest run governance`
- Sim report + Sybil break-even (console output): `npx vitest run tests/governance-sim.test.ts --disableConsoleIntercept`

## Findings the sim pins down

- The trimmed mean **absorbs a Sybil flood within its ~10% trim** but not beyond:
  the **break-even is ~13% of the electorate** (K=15 sockpuppets vs 100 honest flips
  the dominant component recency → relevance).

## Known gaps — characterized here, fixed separately

- **PROJ-1045** — quorum bypass on the admin phase-apply path. The quorum *policy*
  is now single-source (`quorumMet`, used by `epoch-manager`); routing the admin
  apply path through it is the next fix (see the `it.todo` in the integration test).
  We do **not** change governance behavior in this change set.
- **PROJ-1048** — Sybil (N DIDs ⇒ N votes). >~13% sockpuppet control flips the
  outcome; an eligibility / anti-Sybil design is the mitigation.

## Adding tests

- New pure logic → extract a `*-core` / `*-decisions` module and property-test it.
- New apply-path behavior → mock-DB integration test (copy the pattern in
  `governance-aggregation.integration.test.ts`).
- New mechanism question (manipulation, coalitions) → add a scenario to `harness.ts`.
