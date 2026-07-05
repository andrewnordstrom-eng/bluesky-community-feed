# 2026-07-04 Pipeline Prod-Grade Audit

## Scope

Issue scope: restore the Corgi `secret-scan` CI lane without reducing scan coverage, then audit whether the repository pipelines are production-grade.

Repository baseline: `andrewnordstrom-eng/bluesky-community-feed` at `08115eafde9f25aa4a064c7d264bcfa3c2d1f92c`.

Measurement window:

- Most recent 1,000 completed GitHub Actions runs for workflow health.
- Most recent 100 `secret-scan.yml` runs for the failing lane baseline.
- Most recent 50 deploy workflow runs for delivery history.
- Live public smoke probes against `https://feed.corgi.network`.

External basis:

- [GitHub Actions reusable workflow access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
- [SLSA producing artifacts requirements](https://slsa.dev/spec/v1.0/requirements)
- [DORA software delivery metrics](https://dora.dev/guides/dora-metrics/)
- [Brown, Cai, and DasGupta, Interval Estimation for a Binomial Proportion](https://doi.org/10.1214/ss/1009213286)

## Method

Binary pass-rate estimates use Wilson 95% confidence intervals instead of naive Wald intervals because several lanes sit near 0% or 100%, where Wald intervals are misleading. For the zero-success `secret-scan` lane, the rule-of-three upper bound is also recorded as a simple rare-event sanity check.

Duration summaries use p50 and p90 elapsed time from GitHub Actions `createdAt` to `updatedAt`. Delivery quality is interpreted with the DORA lens: deployment frequency, lead time, change failure rate, and recovery evidence. Supply-chain posture is interpreted with the SLSA lens: consistent build process, hosted build isolation, least-privilege tokens, provenance/traceability, and secret handling.

## Executive Verdict

The pipelines are not fully production-grade yet. They have a solid core: pinned Actions, least-privilege permissions in most workflows, deterministic CI jobs, recent successful deploys, rollback logic, public runtime health checks, and daily operational health checks. But four gaps block a clean prod-grade verdict:

1. `secret-scan` was permanently red before this patch: 0 successes in the most recent 100 runs.
2. Active branch rulesets do not require `secret-scan`, CI, CodeQL, or deploy as independent required contexts.
3. The deploy workflow does not run `npm run migrate`, while the repo contract's deploy path includes migrations.
4. The transparency stats endpoint is functional but slow: first 20s probe timed out; retry returned `200` in 16.073s.

This patch fixes the immediate `secret-scan` dispatch failure by moving the caller from the private `.github` reusable workflow to the public `.github-public` reusable workflow pinned at `5be6b1ba47fe3f338447eea17e6b5c465fc979f3`.

## Secret-Scan Finding

Baseline sample:

| Metric | Value |
| --- | ---: |
| Sample size | 100 completed runs |
| Successes | 0 |
| Failures | 100 |
| Cancellations | 0 |
| Observed pass rate | 0.0% |
| Wilson 95% interval | 0.0% to 3.7% |
| Rule-of-three upper bound | 3.0% |
| Latest failing run | `28720218791` on `main` at `08115ea` |

The latest failing run reported a workflow-file issue and had no job log, which is consistent with GitHub failing the run before job creation. GitHub's reusable workflow access rules explain the failure mode: a public caller repository can access public reusable workflows, but not private reusable workflows.

The previous caller referenced:

```yaml
uses: andrewnordstrom-eng/.github/.github/workflows/secret-scan.yml@384b05853d9fdde266479e2ebe23112819d0269b
```

That called workflow is in the private `.github` control-plane repository. The fixed caller references:

```yaml
uses: andrewnordstrom-eng/.github-public/.github/workflows/secret-scan.yml@5be6b1ba47fe3f338447eea17e6b5c465fc979f3
```

Coverage comparison:

- The public `.github-public` scanner at `5be6b1b` matches the old pinned private scanner's six-pattern coverage.
- The private `.github` `origin/main` scanner is stronger than both: it includes broader GitHub token patterns, OpenAI/Anthropic-style key patterns, Linear, DigitalOcean, npm, Snyk, JWT, and committed `.env` checks.
- Therefore this patch does not reduce coverage relative to the failing pinned caller, but the public control-plane scanner should be advanced to parity with private `origin/main` as a follow-up.

Local emulation of the public scanner against the current repo scanned 609 non-Markdown/non-text tracked files and found 0 matching files. The local emulation reported file paths only and did not print candidate secret values.

## Workflow Health

Recent workflow health from the latest 1,000 completed runs:

| Workflow | Runs | Success | Failure | Cancelled | Pass rate | Wilson 95% | p50 | p90 | Latest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Aikido thread check | 275 | 129 | 0 | 146 | 46.9% | 41.1% to 52.8% | 0.1m | 93.5m | success |
| CodeRabbit freshness | 143 | 57 | 44 | 41 | 39.9% | 32.2% to 48.0% | 0.1m | 159.7m | success |
| CodeRabbit thread check | 142 | 71 | 26 | 45 | 50.0% | 41.9% to 58.1% | 0.1m | 91.8m | success |
| Linear state sync | 51 | 51 | 0 | 0 | 100.0% | 93.0% to 100.0% | 0.1m | 0.1m | success |
| Secret scan | 48 | 0 | 48 | 0 | 0.0% | 0.0% to 7.4% | 0.0m | 0.0m | failure |
| CodeQL | 48 | 48 | 0 | 0 | 100.0% | 92.6% to 100.0% | 1.5m | 1.6m | success |
| Quality gate | 48 | 48 | 0 | 0 | 100.0% | 92.6% to 100.0% | 0.4m | 0.5m | success |
| Security gate | 48 | 48 | 0 | 0 | 100.0% | 92.6% to 100.0% | 0.2m | 0.8m | success |
| CI | 47 | 46 | 0 | 1 | 97.9% | 88.9% to 99.6% | 0.9m | 0.9m | success |
| Deploy to VPS | 8 | 5 | 3 | 0 | 62.5% | 30.6% to 86.3% | 1.9m | 14.1m | success |
| Release notes | 8 | 8 | 0 | 0 | 100.0% | 67.6% to 100.0% | 0.1m | 0.2m | success |
| Daily Health Check | 2 | 2 | 0 | 0 | 100.0% | 34.2% to 100.0% | 0.2m | 0.2m | success |

Interpretation:

- CI, CodeQL, quality, security, Linear state sync, release notes, and daily health are healthy in the recent sample.
- `secret-scan` is the clear red lane and is not a scanner-content failure; it is a workflow access/dispatch failure.
- CodeRabbit and Aikido have high cancellation counts. Latest runs are green, but cancellation-heavy required gates make aggregate pass-rate misleading. They need event-level cancellation analysis before treating their raw pass rates as reliability indicators.
- Deploy has a poor 50-run history but a good current regime: the five most recent deploys all succeeded. Recent deploy durations were 2.0m, 2.3m, 1.9m, 1.9m, and 41.4m.

Latest `main` push at `08115ea`:

| Workflow | Result |
| --- | --- |
| CI | success |
| CodeQL | success |
| Deploy to VPS | success |
| Quality gate | success |
| Release notes | success |
| Security gate | success |
| Secret scan | failure |

## Branch Protection and Rulesets

Active default-branch rulesets:

| Ruleset | Required checks |
| --- | --- |
| Aikido thread gate | `aikido-thread-check / aikido-thread-check` |
| bluesky-community-feed-private-hardening | `internal-tooling-hygiene / internal-tooling-hygiene`, `linear-policy / linear-policy`, `quality-gate / quality-gate`, `security-gate / security-gate`, `coderabbit-freshness / coderabbit-freshness`, `coderabbit-thread-check / coderabbit-thread-check` |

The hardening ruleset also requires pull request flow, review thread resolution, squash-only merges, non-fast-forward protection, deletion protection, and signed commits.

Gap: `secret-scan`, CI, CodeQL, and deploy are not independently required by the active default-branch rulesets. A permanently red `secret-scan` lane can therefore coexist with otherwise mergeable PRs unless covered indirectly by another required gate.

## Runtime Smoke

Live public smoke probes on 2026-07-04:

| Endpoint | Result | Time |
| --- | ---: | ---: |
| `/health` | 200 | 1.781s |
| `/health/live` | 200 | 1.678s |
| `/health/ready` | 200 | 1.783s |
| `/xrpc/app.bsky.feed.describeFeedGenerator` | 200 | 1.678s |
| `/api/governance/weights` | 200 | 1.672s |
| `/xrpc/app.bsky.feed.getFeedSkeleton?limit=3` | 200 | 1.672s |
| `/api/transparency/stats` | timeout at 20s, then 200 on retry | 16.073s |

The feed generator returned DID `did:plc:amzyknmm4auxijvykyfgznw2` and feed URI `at://did:plc:amzyknmm4auxijvykyfgznw2/app.bsky.feed.generator/community-gov`. The skeleton endpoint returned three posts and a cursor. Governance weights returned epoch 2 as active with five component weights.

The runtime is up, but `/api/transparency/stats` is too slow to call "production-grade" without either a documented latency budget or query optimization.

## Design Strengths

- Workflows pin third-party actions by SHA.
- Most workflows run with `contents: read` and scoped permissions.
- CI separates docs, backend, frontend, and report-script verification.
- Deploy uses `script_stop: true`, deterministic test environment restoration, build/test before restart, post-restart readiness probes, and rollback on failed health checks.
- Daily health checks validate secrets, SSH host keys, epoch status, disk space, local readiness, feed freshness, and public liveness.
- Weekly export validates required secrets, writes artifacts with retention, and derives the current epoch from the local production API.
- Runtime has clear public liveness/readiness endpoints and feed-level smoke probes.

## Design Gaps

1. Secret scanning was red for every sampled run.
   - Fixed in this patch by moving the caller to `.github-public`.
   - Fresh PR and `main` runs must still prove the fix.

2. Public secret-scan coverage lags private control-plane coverage.
   - The public workflow matches the old pinned private scanner but not private `.github` `origin/main`.
   - Follow-up should publish the expanded scanner to `.github-public` and repin callers.

3. Required checks do not include every critical lane.
   - Missing independent required contexts: `secret-scan`, CI, CodeQL.
   - Deploy is post-merge and cannot protect PRs directly, but deployment failure should be tracked as a release-health signal.

4. Deploy workflow omits migrations.
   - `docs/agent/REPO_CONTRACT.md` lists `npm run migrate` in the production deploy path.
   - `.github/workflows/deploy.yml` currently builds, tests, builds frontends/CLI, restarts systemd, and probes health, but does not run migrations.
   - This is a schema drift risk because this repo has active migration files.

5. Weekly export has weaker SSH host-key discipline than daily health.
   - Daily health requires `VPS_SSH_HOST_KEY`.
   - Weekly export falls back to `StrictHostKeyChecking=accept-new` if the host key secret is absent.

6. Transparency stats latency is high.
   - A 20s probe timed out once; a 60s retry returned in 16.073s.
   - This should get a latency budget and either query optimization or caching.

7. Cancellation-heavy required review gates need separate analysis.
   - Raw pass rates for CodeRabbit and Aikido are distorted by cancellation behavior.
   - A prod-grade scorecard should distinguish superseded cancellation from true failed required checks.

## Follow-Up Queue

1. Confirm `secret-scan` passes on a fresh PR and on `main` after merge.
2. Publish the expanded private `.github` scanner coverage to `.github-public` and repin Corgi if the public SHA changes.
3. Add `secret-scan`, CI, and CodeQL to active default-branch required checks, or document the exact required gate that subsumes each one.
4. Decide and implement the deploy migration policy: run `npm run migrate` before restart or update the repo contract if migrations are intentionally manual.
5. Require `VPS_SSH_HOST_KEY` in weekly export, matching daily health.
6. Add latency budget and monitoring for `/api/transparency/stats`; target should be explicit before rating the transparency pipeline as prod-grade.
7. Split CodeRabbit/Aikido cancellation metrics by trigger/event and failure class.

## Closeout Standard

This lane is not done until:

- The PR run shows `secret-scan / secret-scan` passing.
- The post-merge `main` run shows `secret-scan` passing.
- The public workflow's scanned file scope and pattern set are compared against the previous private pinned workflow target and show no coverage reduction.
- Any delta versus the expanded private `.github` `origin/main` scanner is called out as follow-up work, not represented as scanner parity.
- The final PR notes explicitly state that this fixes dispatch/accessibility, not expanded scanner parity.
