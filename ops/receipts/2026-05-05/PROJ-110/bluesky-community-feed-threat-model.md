# Bluesky Community Feed Threat Model

Date: 2026-05-05
Scope: incident-focused threat model for the production Bluesky feed service and
operator/CI credential surfaces.

## Assumptions

- Deployment model: single production VPS running `bluesky-feed.service` behind
  nginx at `https://feed.corgi.network`.
- Trust boundary: public HTTP traffic terminates at nginx, then reaches the
  Node/Fastify service on localhost.
- Trust boundary: GitHub Actions uses repository secrets to SSH to the VPS for
  health/export/deploy workflows.
- Trust boundary: ATProto/Bluesky credentials are app passwords, not account main
  passwords.
- This report intentionally excludes a full product auth review; it focuses on
  the May 5 secret exposure and immediate hardening.

## Assets

- PostgreSQL data and connection credentials.
- Research export anonymization salt.
- Bluesky app password and bot app password.
- GitHub Actions SSH key and host-key verification state.
- Redis bot session cache.
- Incident receipts and operator transcript artifacts.

## Entry Points And Boundaries

- Public feed endpoints: `/health`, `/health/ready`, `/health/live`, feed routes,
  transparency routes, governance routes.
- Operator shell over SSH to `corgi-vps`.
- GitHub Actions workflows using `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`,
  `VPS_SSH_HOST_KEY`, and `DATABASE_URL`.
- ATProto app-password APIs used by local scripts and bot login.
- Receipt sanitizer before evidence is committed.

## Threats

### T1: Transcript Or Receipt Secret Disclosure

Likelihood: high. Impact: high. Priority: critical.

The concrete incident was a production `.env` value dump into the operator
transcript. Any value copied into receipts, chat, shell history, or PR artifacts
could be reused by an attacker or future tooling.

Existing controls:

- `.env` is not committed.
- Receipt sanitizer existed for stable provider/disk identifiers.

New controls:

- Receipt sanitizer now redacts dotenv-style secret assignments and
  credential-bearing URLs.
- Security guide now requires key-name-only env inspection.
- Production `.env` and secret backups are root-only `0600`.

### T2: Database Or Export-Salt Reuse After Exposure

Likelihood: medium. Impact: high. Priority: high.

The exposed database URL could allow data read/write if combined with network
path access. The exposed export salt could weaken anonymized export privacy.

Mitigation applied:

- Database password and `DATABASE_URL` rotated.
- PostgreSQL role password changed and TCP auth verified.
- Export anonymization salt rotated in GitHub Actions and deployed env.

### T3: Bluesky App-Password Abuse

Likelihood: medium. Impact: medium. Priority: high.

An attacker with the exposed app password could authenticate to the Bluesky
account with the app-password scope. This could affect bot posting or feed
publishing operations.

Mitigation applied:

- App password named `Corgi` revoked through ATProto.
- Same-password login probe rejected after revocation.
- Active deployed env scrubbed to a placeholder.
- Bot password cleared, bot disabled, and Redis cached bot session deleted.

Residual risk:

- Bot posting remains off until a new app password is created and installed
  through a channel that does not expose the generated password to screenshots,
  logs, shell history, or chat.

### T4: CI SSH Credential Drift Or MITM

Likelihood: medium. Impact: high. Priority: high.

Daily Health Check was failing on SSH public-key authentication, and the workflow
fell back to `StrictHostKeyChecking=accept-new` when no host-key secret existed.

Mitigation applied:

- Repo-level `VPS_SSH_KEY` replaced with a fresh key.
- New public key installed only for existing `andrew` user on the VPS.
- Repo-level `VPS_SSH_HOST_KEY` added.
- Hosted Daily Health Check passed after rotation.

### T5: Runtime Availability Regression During Credential Response

Likelihood: medium. Impact: medium. Priority: medium.

Credential scrubbing and restart could break service boot, bot initialization, or
health checks.

Mitigation applied:

- Startup checks passed.
- Systemd active/running after restart.
- Local `/health/ready`, `/health/live`, and `/health` passed.
- Public `/health` passed.
- Hosted Daily Health Check passed after final scrub.

## Follow-Ups

- Create a new Bluesky app password out of band, then update deployed env without
  exposing the value in chat, screenshots, shell history, or receipts.
- Track persistent Jetstream saturation separately if it continues after the
  service settles.
- Keep sanitizer coverage in the docs verification lane so future receipts fail
  closed on dotenv-style secrets.
