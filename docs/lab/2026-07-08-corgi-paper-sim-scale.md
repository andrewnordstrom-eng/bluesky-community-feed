# Corgi Paper Simulation And Scale Receipt

Date: 2026-07-08 snapshot; 2026-07-09 current-main confirmation
Linear: PROJ-1551
Branch: dev/PROJ-1551-corgi-paper-sim-scale
Current-main base: `13d99eb21a925b24d62d36382f85356dbd3254a0`

## Boundary

All write/load evidence in this pass used local ephemeral Postgres/Redis targets. Production was touched only through read-only public GET smokes.

## Simulation Methodology

This simulation packet is not a substitute for Corgi's real voting path. It is a scale lab for that path: the campaign drives the same local aggregation, epoch transition, scoring, Redis feed materialization, and counterfactual/feed-impact measurement code that Corgi uses outside the harness. The question is not "can simulated users prove adoption?" The question is "when the real voting mechanism is subjected to large, repeatable electorates and stress regimes, what happens to governance weights, ranked-feed outcomes, and attack sensitivity?"

Primary research question:

> When many users vote under different electorate structures and participation conditions, how does Corgi's governance-weighted recommender behave in weight space, feed space, and adversarial stress conditions?

The paper-safe framing is:

> Corgi supports real user voting today; simulations evaluate how the same mechanism behaves at scale under declared electorate, turnout, and adversarial assumptions.

### Scenario Families

The manifested S0-S3 paper-core campaign includes deterministic named families:

| Family | Purpose | Paper interpretation |
| --- | --- | --- |
| `baseline` | Equal persona mix at staged user/post counts | Correctness and scale sanity for the synthetic harness |
| `turnout` | Low-to-high participation rates | Sensitivity to inactive or partially active communities |
| `trim-threshold` | Exact voter-count bands around the trimmed-mean cutoff | Behavior at `n = 9`, `n = 10`, and `n = 11`, where trimming turns on |
| `persona-skew` | Electorates dominated by one voting archetype | Whether electorate composition visibly moves governance weights |
| `polarization` | Two-bloc electorates with opposed preferences | Whether aggregation blends blocs or produces volatile outcomes |
| `multi-epoch` | Repeated epochs under drift | Convergence and epoch-to-epoch displacement |
| `adversarial` | Engagement-seeking attacker share sweeps | Bounded sensitivity evidence under configured attacks |

S4 and S5 are intentionally narrower capacity receipts. They run the baseline family at 5,000 / 20,000 and 10,000 / 50,000 scale to show local harness execution headroom, not democratic legitimacy or production saturation.

### Hypotheses

The campaign evaluates these falsifiable hypotheses:

- **H1 Scale stability:** aggregate weight variance decreases as voter count grows.
- **H2 Trim-threshold discontinuity:** outcomes change measurably across the `n = 9`, `n = 10`, and `n = 11` voter band because component trimming activates at `n >= 10`.
- **H3 Feed impact:** community-governed weights produce measurable top-k churn versus default and engagement-only rankings.
- **H4 Persona composition:** dominant electorates move their target component enough to be visible in the aggregated weight vector and ranked feed.
- **H5 Low-turnout fragility:** small exact-voter regimes are more sensitive to single-voter, small-bloc, and seed effects.
- **H6 Bounded but not strategyproof:** trimmed mean dampens simple outliers in configured high-turnout regimes, but optimized or coordinated attacks can still move outcomes.
- **H7 Multi-epoch convergence:** stable electorates should show decreasing L2 displacement over repeated epochs; drift should keep displacement visible.
- **H8 Polarization tradeoff:** polarized electorates should produce interpretable blended weights or increased volatility, depending on bloc share and drift.

### Quantitative Metrics

Each run should be interpreted through three metric layers.

Weight-space metrics:

- aggregated weight vector and normalized weight sum
- vote count, exact weight-voter count, and trim count
- per-component displacement from the baseline or sincere comparison vector
- cross-seed variance by family and variant
- epoch-to-epoch L2 displacement for multi-epoch runs

Feed-space metrics:

- top-k overlap across no-governance, engagement-only, and community-governed regimes
- normalized rank displacement and Kendall tau distance over shared posts
- author concentration via HHI and Gini
- minority-topic exposure when the fixed corpus contains tail-topic candidates
- representative post receipts where rank movement can be explained from stored component scores

Adversarial metrics:

- attacker share versus target-component displacement
- attacker share versus feed churn
- whether near-threshold or high-share attacks move more than simple outlier ballots
- whether keyword-only votes remain excluded from component-weight aggregation

### Analysis Rules

Use only rerun-successful artifacts for paper claims. Treat S0-S3 as paper-core simulation evidence, and S4/S5 as local capacity evidence. Report exact seeds, code version, user count, post count, vote count, and artifact root for every cited number. If a metric is undefined, report why; for example, Kendall tau is undefined when fewer than two posts overlap across compared feeds.

Safe claims:

- The harness exercises real local governance/scoring code against throwaway infrastructure.
- Corgi's governance process produces quantifiable weight and feed changes under declared electorates.
- Low-turnout, trim-threshold, persona-skew, polarization, multi-epoch, and adversarial regimes expose measurable sensitivity patterns.

Not-proven claims:

- real-user preference, satisfaction, adoption, or retention
- production write capacity or production saturation headroom
- general Sybil resistance, strategyproofness, or manipulation-proof governance
- democratic legitimacy across all communities or all turnout regimes

## Evidence Status

The July 8 artifact roots below are snapshot receipts from the original paper-sim pass. They remain useful for provenance, but they are superseded for paper claims because the branch was refreshed onto current `origin/main` after scoring and retention changes landed.

Use the July 9 current-main roots as the paper-ready evidence:

- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S4/`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S5/`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/post-review-s0-smoke/`

## Current-Main Confirmation

Commands:

```bash
git stash push --include-untracked -m PROJ-1551-paper-sim-pre-main-refresh
git merge --ff-only origin/main
git stash pop
npm run build
npm run docs:verify
npm run sim:preflight
npm run sim:core
npm run sim:campaign -- --dry-run --max-stage S3
npm run sim:campaign -- --ephemeral --max-stage S3 --artifacts-dir artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign
npm run sim:campaign -- --ephemeral --stage S4 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S4
npm run sim:campaign -- --ephemeral --stage S5 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S5
npm run sim:campaign -- --ephemeral --stage S0 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/post-review-s0-smoke
```

Verification results:

- `npm run build`: pass.
- `npm run docs:verify`: pass, 14 tracked docs and 32 markdown files scanned.
- `npm run sim:preflight`: pass, including Docker 29.4.3 and migrations 001-030.
- `npm run sim:core`: pass, 19 files and 210 tests.
- `npm run sim:campaign -- --dry-run --max-stage S3`: pass, 99 planned runs.
- All four new `checksums.sha256` files verified with `shasum -a 256 -c checksums.sha256`.

Current-main campaign result:

- S0-S3 campaign passed, 99/99 runs, 217781 ms.
- S4 capacity passed, 2/2 runs, 5000 subscribers, 20000 posts, 4000 votes per run, 10000 score rows per run, Redis feed count 1000, 15211 ms total.
- S5 capacity passed, 2/2 runs, 10000 subscribers, 50000 posts, 8000 votes per run, 10000 score rows per run, Redis feed count 1000, 16288 ms total.
- Post-review S0 smoke passed, 1/1 run, 3341 ms total.

Primary current-main artifacts:

- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/checksums.sha256`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/campaign-summary.json`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/campaign-results.csv`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/campaign-aggregates.csv`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/paper-safe-claims.md`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/baseline-comparison/regime-summary.csv`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/sim-campaign/baseline-comparison/pairwise-churn.csv`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S4/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S4/checksums.sha256`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S5/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/capacity-S5/checksums.sha256`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/post-review-s0-smoke/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-09-current-main-confirmation/post-review-s0-smoke/checksums.sha256`

Current-main feed-impact comparison on the fixed synthetic corpus:

- no-governance vs engagement-only: overlap 3/50, normalized displacement 0.246667, Kendall tau 0.
- no-governance vs community-governed: overlap 40/50, normalized displacement 0.245, Kendall tau 0.3051282051.
- engagement-only vs community-governed: overlap 1/50, normalized displacement 0.02, Kendall tau undefined because fewer than two posts overlapped.
- Regime concentration stayed low in this fixed corpus: no-governance HHI 0.02 / Gini 0, engagement-only HHI 0.0208 / Gini 0.0195918367, community-governed HHI 0.02 / Gini 0.
- Minority-topic exposure is 0 in the fixed corpus for all three regimes; do not claim positive minority-tail exposure from this corpus.

Current-main high-signal findings:

- The branch refreshed cleanly onto current `origin/main` at `13d99eb` after the scoring/retention changes.
- Baseline S0-S3 remains green across the planned seeds, with S0 on seed 42 only.
- S4/S5 are faster than the July 8 snapshot after the current-main scoring/retention changes, but they are still capacity receipts, not production saturation proof.
- The synthetic democratic-process findings remain directionally stable: low exact-voter regimes are noisy, dominant personas move their target components, polarization produces interpretable blended weights, and adversarial displacement remains bounded only for this configured synthetic sweep.

## July 8 Snapshot Campaign

Command:

```bash
npm run sim:campaign -- --ephemeral --max-stage S3 --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign
```

Superseding manifested rerun:

```bash
npm run sim:campaign -- --ephemeral --max-stage S3 --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested
```

Snapshot result: passed, 99/99 runs, 448024 ms. Superseded for paper claims by the current-main campaign above.

Primary artifacts:

- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/checksums.sha256`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/campaign-summary.json`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/campaign-results.csv`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/campaign-aggregates.csv`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/paper-safe-claims.md`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/baseline-comparison/regime-summary.csv`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/sim-campaign-manifested/baseline-comparison/pairwise-churn.csv`

Manifest status:

- Scenario generation: pass.
- Baseline S0-S3 paper-core gate: pass.
- Democratic-process S2 sweeps: pass.
- Feed-impact comparison: pass.
- Capacity baseline: not run in this artifact root; S4/S5 capacity manifests below carry that claim.

High-signal findings:

- Baseline S0-S3 passed across the planned seeds, with S0 on seed 42 only.
- Low exact weight-voter counts are the noisiest democratic-process regime: the highest cross-seed variance was S2 trim-threshold with 1, 2, 3, 10, and S3 11 exact weight voters.
- Persona-skew behaves as expected in the synthetic electorates: dominant engagement, chronological, and bridge electorates move their target component near 0.58 to 0.60 at S2/S3.
- Polarization scenarios produce interpretable compromise weights: S3 50/50 engagement-vs-chronological yields recency 0.369 and engagement 0.379; S3 60/40 shifts toward engagement at 0.4545.
- The adversarial sweep shows displacement is bounded in this configured scenario, not generally strategyproof: S2 10 percent engagement-attacker still leaves bridging at 0.694667, while 40 percent shifts engagement to 0.289333 and bridging to 0.457.

Feed-impact comparison on the fixed synthetic corpus:

- no-governance vs engagement-only: overlap 3/50, normalized displacement 0.246667, Kendall tau 0.
- no-governance vs community-governed: overlap 40/50, normalized displacement 0.245, Kendall tau 0.3064102564.
- engagement-only vs community-governed: overlap 1/50, normalized displacement 0.02, Kendall tau undefined because fewer than two posts overlapped.

## July 8 Snapshot Capacity Runs

Commands:

```bash
npm run sim:campaign -- --ephemeral --stage S4 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S4
npm run sim:campaign -- --ephemeral --stage S5 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S5
```

Superseding manifested reruns:

```bash
npm run sim:campaign -- --ephemeral --stage S4 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S4-manifested
npm run sim:campaign -- --ephemeral --stage S5 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S5-manifested
```

Results:

- S4 passed, 2/2 runs, 5000 subscribers, 20000 posts, 4000 votes per run, 10000 score rows per run, Redis feed count 1000, 29016 ms total.
- S5 passed, 2/2 runs, 10000 subscribers, 50000 posts, 8000 votes per run, 10000 score rows per run, Redis feed count 1000, 32673 ms total.

Primary artifacts:

- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S4-manifested/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S4-manifested/checksums.sha256`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S5-manifested/manifest.json`
- `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/capacity-S5-manifested/checksums.sha256`

These are superseded snapshot capacity receipts. The July 9 current-main S4/S5 roots above are the paper-ready capacity receipts. Both generations are capacity evidence only, not production saturation proof.

## Load Gates

Jetstream replay:

```bash
npm run lab:jetstream-replay -- --ephemeral --events 1200
```

Passed. The run processed 1200 events at 1316.89 events/s, p95 handler latency 1.47 ms, p99 1.94 ms, with 0 dropped events, 0 handler errors, 0 state mismatches, and 0 outcome mismatches. The 63 parse errors were expected fixture outcomes.

HTTP vote load:

```bash
npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100
```

Passed. The run issued 8000 valid vote POSTs with 500 users and 100 connections. It recorded p95 44.99 ms, p99 91.38 ms, max 332.03 ms, 0 errors, 0 timeouts, 0 non-2xx responses, 500 final vote rows, 8000 audit rows, and 2500 long-table vote-weight rows.

Compiled prod-parity memory:

Boundary refusal check:

```bash
npm run lab:memory-prod-parity
```

Result: refused before running because `DATABASE_URL` was absent, preserving the throwaway-target boundary.

```bash
npm run lab:memory-prod-parity -- --ephemeral
```

Passed. The ephemeral rerun completed 5 compiled runs per mode at 10000 requests and 100 connections. Normal mode reported median after-GC delta 44.27 MB, p95 44.67 MB, max peak RSS 223.86 MB. Noop mode reported median after-GC delta 47.1 MB, p95 51.58 MB, max peak RSS 226.67 MB.

## Public Read-Only Smoke

Commands used `curl -sS` against `https://feed.corgi.network`. This is read-only smoke only, not a production load test.

Results:

- `/health`: 200, `{"status":"ok"}`, 0.348416 s.
- `/health/ready`: 200, `{"status":"ready"}`, 0.309684 s.
- `/api/governance/weights`: 200, epoch 2 active, vote_count 0, weights `{recency:0.25, engagement:0.2, bridging:0.1, sourceDiversity:0.1, relevance:0.35}`, 0.296185 s.

Partial / known failure:

- `/api/transparency/stats`: timed out after 20.009379 s with HTTP status 000 and no bytes. Do not use public transparency stats as live reviewer evidence until this endpoint is fixed or its latency/error budget is documented.

## Post-Review Verification

CodeRabbit was attempted on the uncommitted paper-sim diff. It emitted only minor/trivial findings before stalling in heartbeat-only review and being interrupted, so this is not a clean vendor approval. Valid findings were addressed:

- Multi-epoch drift runs now return the same round-1 votes they insert, preventing stale pre-drift `population.votes` from appearing in artifacts.
- `FeedImpactReceiptSchema` is exported through the public harness barrel.
- The baseline campaign helper inherits shared defaults.
- The lab receipt now separates manifested evidence roots and public transparency-stats partial failure.

Verification after the July 8 post-review fixes:

- `npm run build`: pass.
- `npm run docs:verify`: pass, 14 tracked docs and 32 markdown files scanned.
- `npm run sim:core`: pass, 19 files and 210 tests.
- Focused post-review slice: pass, 3 files and 26 tests.
- `npm run sim:campaign -- --ephemeral --stage S0 --family baseline --artifacts-dir artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/post-review-s0-smoke`: pass, manifest written at `artifacts/lab/PROJ-1551/2026-07-08-paper-sim-scale/post-review-s0-smoke/manifest.json`.
- `git diff --check`: pass.

## Safe Paper Claims

- The campaign exercises Corgi's real local governance aggregation, epoch transition, scoring, Redis feed materialization, and load harnesses against ephemeral infrastructure.
- The run supports bounded claims about synthetic democratic-process behavior across turnout, trim-threshold, persona-skew, polarization, multi-epoch, and adversarial scenario families.
- The load gates support a bounded claim that the current implementation survived the specified local load profile.
- The results do not prove real user preference, adoption, retention, production write capacity, Sybil resistance, democratic legitimacy for all communities, or general strategyproofness.
- Production transparency stats should be caveated until the public endpoint is fixed or its latency/error budget is documented.
