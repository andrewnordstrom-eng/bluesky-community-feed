# Security Best-Practices Summary

Date: 2026-05-05

Scope: incident response plus nearby secure-by-default controls for the
TypeScript/Node/Fastify service and browser frontend.

Related incident documents:

- `ops/receipts/2026-05-05/PROJ-110/secret-exposure-response.md`
- `ops/receipts/2026-05-05/PROJ-110/validation-summary.md`

Incident timeline:

- Detection: `2026-05-05T08:35Z`, during live production env inspection.
- Initial containment: `2026-05-05T08:35Z`, database credential and export salt rotated.
- Full credential containment: `2026-05-05T08:54Z`, post-scrub hosted Daily Health Check passed.

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

Fix: added this key-name-only command and receipt-verification requirement to
`docs/SECURITY.md`:

```sh
sudo awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {print $1}' /opt/bluesky-feed/.env
```

### SBP-3: CI SSH Health Gate Was Failing And Host-Key Pin Was Missing

Severity: High.

Evidence: latest scheduled Daily Health Check runs before this response failed,
and `.github/workflows/daily-health.yml` used `StrictHostKeyChecking=accept-new`
when `VPS_SSH_HOST_KEY` was absent.

Impact: production health evidence was stale/red. The `accept-new` fallback also
meant an attacker who intercepted the first connection, or a case where ephemeral
runner storage lost the known-hosts cache, could impersonate the VPS and inject
false health evidence or capture SSH-authenticated workflow activity.

Fix: rotated repo-level `VPS_SSH_KEY`, added repo-level `VPS_SSH_HOST_KEY`, and
proved two successful hosted Daily Health Check runs:

- `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366648561`
- `https://github.com/andrewnordstrom-eng/bluesky-community-feed/actions/runs/25366964265`

Follow-up hardening in this PR made `.github/workflows/daily-health.yml` fail
the `Validate required secrets` step when `VPS_SSH_HOST_KEY` is missing and
removed the `accept-new` branch from `Configure SSH access`.

### SBP-4: Bot Credential Is Intentionally Disabled Pending Secure Re-Enrollment

Severity: Medium.

Evidence: the exposed Bluesky app password was revoked and deployed env now has
`BOT_ENABLED=false`, empty `BOT_APP_PASSWORD`, and a placeholder
`BSKY_APP_PASSWORD`.

Impact: bot posting is unavailable until a new app password is generated and
installed through a non-leaking path.

Fix: leave bot disabled rather than creating/copying a new app password through
browser screenshots, shell history, chat, or receipts. The approved re-enrollment
path is:

1. Generate the new Bluesky app password in the account UI.
2. Store it directly in a password manager or vault without screenshots.
3. Deploy `BOT_APP_PASSWORD`, `BSKY_APP_PASSWORD`, and `BOT_ENABLED` via an
   encrypted secret path such as a CI secret store, HashiCorp Vault, Ansible
   Vault, or an encrypted `scp` handoff that does not persist in shell history.
4. Verify service health and bot behavior.
5. Record only key names, timestamps, and success/failure receipts.

### SBP-5: Frontend Axios Audit Debt Blocked Hosted Verification

Severity: High.

Evidence: hosted `frontend-verify` failed on `npm audit --audit-level=moderate`
for `axios 1.15.0`, and local `cd web && npm audit --audit-level=moderate`
reproduced the same high-severity advisory set.

Impact: the PR could not satisfy fail-closed frontend security verification.

Fix: updated the `web` dependency and lockfile to `axios 1.16.0`; local frontend
lint, build, and audit passed after the update.

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
- Track Jetstream queue-saturation warnings separately under operations if they
  persist; they were observed during post-restart logs, but readiness, public
  health, and hosted Daily Health Check all passed.
