# Security Best-Practices Summary

Date: 2026-05-05

Scope: incident response plus nearby secure-by-default controls for the
TypeScript/Node/Fastify service and browser frontend.

## Findings

### SBP-1: Receipt Sanitizer Did Not Catch Dotenv Secrets

Severity: High.

Evidence: before the May 5 patch, `scripts/sanitize-receipts.mjs` redacted
provider IDs, disk identifiers, UUIDs, and action IDs, but not `.env` assignment
lines or credential-bearing URLs.

Impact: an operator mistake could become a committed receipt with live secrets.

Fix: added sanitizer coverage for dotenv-style secret assignments and basic-auth
URLs; added regression tests in `tests/sanitize-receipts.test.ts`.

### SBP-2: Operator Runbook Allowed Ambiguous Env Inspection

Severity: Medium.

Evidence: `docs/SECURITY.md` warned never to commit `.env` and to rotate leaked
app passwords, but did not give a key-name-only inspection pattern.

Impact: responders could use `cat`, `grep`, or broad shell snippets that expose
values while trying to inventory configuration.

Fix: added a key-name-only command and receipt-verification requirement to
`docs/SECURITY.md`.

### SBP-3: CI SSH Health Gate Was Failing And Host-Key Pin Was Missing

Severity: High.

Evidence: latest scheduled Daily Health Check runs before this response failed,
and `.github/workflows/daily-health.yml` used `StrictHostKeyChecking=accept-new`
when `VPS_SSH_HOST_KEY` was absent.

Impact: production health evidence was stale/red, and future SSH probes could
trust a first-seen host key.

Fix: rotated repo-level `VPS_SSH_KEY`, added repo-level `VPS_SSH_HOST_KEY`, and
proved two successful hosted Daily Health Check runs.

### SBP-4: Bot Credential Is Intentionally Disabled Pending Secure Re-Enrollment

Severity: Medium.

Evidence: the exposed Bluesky app password was revoked and deployed env now has
`BOT_ENABLED=false`, empty `BOT_APP_PASSWORD`, and a placeholder
`BSKY_APP_PASSWORD`.

Impact: bot posting is unavailable until a new app password is generated and
installed through a non-leaking path.

Fix: leave bot disabled rather than creating/copying a new app password through
browser screenshots, shell history, chat, or receipts.

## Positive Controls Observed

- Public health response includes CSP, HSTS, frame protections, nosniff, and
  rate-limit headers.
- Startup logs show PostgreSQL, migrations, and Redis checks passed before
  `READY=1`.
- Daily Health Check verifies epoch status, disk, local readiness, feed
  freshness, and public health from hosted CI.
- Security ownership map found no orphaned sensitive code in the last 12 months.

## Remaining Actions

- Create and install a fresh Bluesky app password out of band if bot posting or
  feed publish scripts are needed.
- Keep the sanitizer in `npm run docs:verify`.
- Track repeated Jetstream queue-saturation warnings separately if they persist.
