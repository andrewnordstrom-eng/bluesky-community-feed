# Security Guide

This document covers operational and contributor security expectations for this project.

## Current secure defaults

- Governance/admin web auth uses HttpOnly session cookies.
- Browser CORS should use explicit allowlists (`CORS_ALLOWED_ORIGINS`).
- Proxy trust is explicit via `TRUST_PROXY` (avoid blanket trust in forwarded headers).
- Public transparency audit output redacts participant identity and sensitive vote payload details.
- Research exports include only subscribers with explicit `research_consent = TRUE`.

## Threat model highlights

- Governance integrity is critical: voting and epoch transitions must be hard to manipulate.
- Feed availability matters: ingestion/scoring outages affect trust and demos.
- Operator mistakes (bad env, permissive network rules, leaked app password) are the largest practical risk.

## Operator checklist

## Secrets and credentials

- Never commit `.env`.
- Use Bluesky **app passwords** only; never use account main passwords.
- Keep database/Redis credentials unique and strong.
- Rotate `BSKY_APP_PASSWORD`/`BOT_APP_PASSWORD` if leaked.
- Set a long, random `EXPORT_ANONYMIZATION_SALT` (minimum 32 chars in production).

## Network and infrastructure

- Publicly expose only `80/443`.
- Keep PostgreSQL and Redis bound to private interfaces.
- Enforce TLS for all external traffic.
- Use firewall rules (`ufw`/cloud firewall) to restrict admin access where possible.

## Governance controls

- Keep `BOT_ADMIN_DIDS` minimal.
- Review `governance_audit_log` regularly.
- Investigate repeated `429`, auth failures, or rejected transition/rescore attempts.
- Extend voting only during the voting phase.

## Runtime health

- Monitor `/health`, `/health/ready`, `/health/live`.
- Alert on:
  - Redis or PostgreSQL unhealthy
  - Jetstream disconnected
  - scoring scheduler failures
  - unexpected audit mutation attempts

## Contributor checklist

- Do not hardcode secrets, DIDs, or production domains.
- Validate untrusted input (Zod for routes).
- Use parameterized SQL only.
- Preserve soft-delete patterns and append-only audit log behavior.
- Keep admin/auth checks on privileged routes.
- Avoid external API calls in `getFeedSkeleton`.

## Pre-release security checklist

- [ ] `.env` ignored by git
- [ ] `.env.example` contains placeholders only
- [ ] No hardcoded credentials in source
- [ ] CORS allowlist configured for production
- [ ] Rate limiting enabled
- [ ] Health endpoints verified
- [ ] Admin DID allowlist reviewed

## Reporting vulnerabilities

If you find a vulnerability:

1. Do not open a public issue with exploit details.
2. Report privately to the project maintainer (or use GitHub private vulnerability reporting if enabled).
3. Include reproduction steps, impact, and suggested mitigation.
