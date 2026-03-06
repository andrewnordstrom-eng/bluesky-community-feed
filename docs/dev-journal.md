# Dev Journal

## 2026-03-06 — Phase 1: Cleanup & Polish

- Removed unused `bullmq` and `@fastify/jwt` dependencies (confirmed zero imports in src/)
- Fixed web/package.json name, index.html title, replaced Vite README boilerplate
- Stripped Vite template remnants from web/src/App.css
- Enhanced polis.ts JSDoc with `@status` and `@planned` tags; fixed `process.env` → `config` access
- Added `npm ci`, `npm run build`, `npm run test`, and web build to CI deploy workflow
- Created `src/db/queries/` with subscriber upsert and epoch lookup extractions as reuse pattern
- All 162 tests pass, backend and frontend builds clean

## 2026-03-06 — Phase 2: acceptsInteractions Support

- Added `acceptsInteractions: true` to feed publication record in `scripts/publish-feed.ts`
- Created migration 015 for `feed_interactions` table with indexes on time, user, post, and epoch
- Implemented `POST /xrpc/app.bsky.feed.sendInteractions` endpoint with mandatory JWT auth, Zod validation (max 100 items), batch parameterized INSERT, and `ON CONFLICT DO NOTHING`
- Registered route in server.ts after `registerFeedSkeleton`
- Added configurable rate limiting (60 req/min default via `RATE_LIMIT_INTERACTIONS_MAX/WINDOW_MS`)
- Added `GET /api/admin/interactions/feed-signals` analytics endpoint: totals by type (today/yesterday/7-day), per-epoch breakdown, top posts by requestMore/requestLess ratio
- All 162 tests pass, build clean

## 2026-03-06 — Phase 3: Scoring Component Interface

- Defined `ScoringComponent` interface and `ScoringContext` in `src/scoring/component.interface.ts`
- Added `ScoringComponent` wrappers to all 5 components (recency, engagement, bridging, source-diversity, relevance) alongside existing functions — zero breaking changes
- Created `src/scoring/registry.ts` with `DEFAULT_COMPONENTS` array and `validateRegistry()` that cross-checks against votable-params at module load
- Refactored `scorePost()` in pipeline.ts to iterate `DEFAULT_COMPONENTS` with type-safe `WEIGHT_ACCESSORS` lookup map (no `as any`)
- `scoreAllPosts()` now creates `ScoringContext` once per run with fresh `authorCounts`
- `storeScore()` unchanged — Golden Rule preserved
- All 162 tests pass, build clean

## 2026-03-06 — Phase 4: Private Feed Access Gating

- Created migration 016 for `approved_participants` table with soft delete (`removed_at`) and partial index on active DIDs
- Added `FEED_PRIVATE_MODE` config toggle (default false) to Zod config schema
- Created `src/feed/access-control.ts` with Redis-cached `isParticipantApproved()` (300s TTL) and `invalidateParticipantCache()`
- Gated feed access in `feed-skeleton.ts`: returns empty `{ feed: [] }` for unapproved users when private mode active
- Gated governance voting in `vote.ts`: throws `Errors.FORBIDDEN()` for unapproved participants
- Added admin participant management routes (GET/POST/DELETE `/api/admin/participants`) with Bluesky handle resolution via `@atproto/api`, audit logging, and Redis cache invalidation
- Exposed `feedPrivateMode` in admin status response for frontend conditional rendering
- Created `ParticipantsPanel` component with add-by-DID-or-handle form, participant table, and remove confirmation
- Participants tab conditionally visible in admin dashboard only when private mode is active
- All 162 tests pass, backend and frontend builds clean

## 2026-03-06 — Phase 5: Test Fixtures & Helpers
**Branch:** `dev/stack-cleanup-features`
**Commits:** `2bfed92`, earlier session commits
**Files changed:** `tests/helpers/fixtures.ts`, `tests/helpers/app.ts`, `tests/helpers/index.ts`, `tests/feed-skeleton-hot-path.test.ts`

### What changed
Created shared test fixture factories (`buildPost`, `buildEpoch`, `buildVotePayload`) and a `buildTestApp()` helper that creates a Fastify instance with routes registered. Refactored feed-skeleton hot-path tests to use the shared fixtures.

### Why
Reduce boilerplate across 43 test files and establish a consistent pattern for test setup.

### Measurements
162 tests pass. No test files removed.

### Decisions & alternatives
`vi.hoisted()` / `vi.mock()` are hoisted to module scope — helpers can only be used in test bodies, not mock callbacks. Each test file keeps its own `vi.mock()` calls inline.

### Open questions
None.

## 2026-03-06 — Phase 2 (Infra): Pre-commit Hooks
**Branch:** `dev/stack-cleanup-features`
**Commits:** `2bfed92`
**Files changed:** `.husky/pre-commit`, `lint-staged.config.js`, `package.json`

### What changed
Added husky + lint-staged for pre-commit type-checking. Uses function syntax `() => 'tsc --noEmit'` to prevent lint-staged from appending file paths to the tsc command.

### Why
Prevent broken commits from reaching the remote. Type errors are caught before commit.

### Measurements
Pre-commit hook runs tsc in ~3s on the full project.

### Decisions & alternatives
No formatter (Prettier) added — the project doesn't use one. Can be added separately. Function syntax required because lint-staged appends matched file paths to string commands but tsc needs the whole project.

### Open questions
None.

## 2026-03-06 — Phase 3 (Infra): CI Hardening
**Branch:** `dev/stack-cleanup-features`
**Commits:** `80098f5`, `b699ed4`
**Files changed:** `.github/workflows/deploy.yml`, `.github/dependabot.yml`

### What changed
Added `npm audit --audit-level=high` to CI pipeline (blocks deploy on high/critical vulnerabilities). Created Dependabot configuration for npm (root + web) and GitHub Actions updates on weekly cadence.

### Why
Automated vulnerability detection and dependency freshness.

### Measurements
N/A.

### Decisions & alternatives
Audit level set to `high` — moderate vulnerabilities don't block deploy. Force-push or comment-out is the escape hatch for known vulns that must ship.

### Open questions
None.

## 2026-03-06 — Phase 1 (Infra): OpenAPI Spec
**Branch:** `dev/stack-cleanup-features`
**Commits:** `81e831c`, `7a01a31`
**Files changed:** `src/feed/server.ts`, `src/feed/routes/feed-skeleton.ts`, `src/feed/routes/send-interactions.ts`, `tests/helpers/app.ts`, `package.json`

### What changed
Added `@fastify/swagger`, `@fastify/swagger-ui`, and `zod-to-json-schema` for auto-generated OpenAPI docs at `/docs`. Route schemas use `zodToJsonSchema()` for documentation; actual validation stays in Zod `safeParse()` handlers. Added no-op `validatorCompiler` so Fastify doesn't reject requests before handlers run.

### Why
Self-documenting API reduces onboarding friction. `fastify-type-provider-zod@5.1.0` was incompatible with Zod v3 (requires v4's `safeParse(schema, data)` shape), so `zod-to-json-schema` was used instead.

### Measurements
162 tests pass. `/docs` serves Swagger UI. `/api/openapi.json` returns schema.

### Decisions & alternatives
Rejected `fastify-type-provider-zod` — incompatible with Zod v3. Accepted double-validation (JSON Schema for docs, safeParse for actual validation). No-op validator ensures Fastify doesn't interfere with handler-level validation.

### Open questions
Migrate remaining routes to include JSON Schema for OpenAPI docs incrementally.

## 2026-03-06 — Phase 6 (Infra): Shared API Types
**Branch:** `dev/stack-cleanup-features`
**Commits:** `a21173a`, `587c202`
**Files changed:** `src/shared/api-types.ts`, `src/shared/index.ts`, `src/config/votable-params.ts`, `src/governance/governance.types.ts`, `web/vite.config.ts`, `web/tsconfig.app.json`, `web/src/config/votable-params.ts`, `web/src/api/admin.ts`

### What changed
Created `src/shared/api-types.ts` as single source of truth for `GovernanceWeightKey`, `GovernanceWeights`, `VotableWeightParam`, and `ContentRules`. Backend imports and extends (adding `voteField`). Frontend uses Vite alias `@shared` and tsconfig paths to import from the same file.

### Why
Eliminate type duplication between backend and frontend. Changes to governance types now only need to happen in one place.

### Measurements
162 tests pass. Both backend and frontend builds clean.

### Decisions & alternatives
`src/shared/` exports type-only code — no runtime values. This prevents bundling backend modules into the frontend. Vite alias + `server.fs.allow: ['..']` lets dev mode access files outside `web/`.

### Open questions
None.

## 2026-03-06 — Phase 7 (Infra): Code Generators
**Branch:** `dev/stack-cleanup-features`
**Commits:** `7619443`, `9296640`
**Files changed:** `src/scoring/registry.ts`, `src/config/votable-params.ts`, `scripts/generate-scoring-component.ts`, `scripts/generate-route.ts`, `package.json`

### What changed
Added anchor comments to `registry.ts` and `votable-params.ts` for stable insertion points. Created two generator scripts: `generate:component` scaffolds a scoring component and wires it into registry + params; `generate:route` scaffolds a Fastify route with Zod validation and OpenAPI schema.

### Why
Reduce boilerplate when extending the scoring pipeline or adding API routes. Generators enforce project patterns (AppError, Zod, JSDoc).

### Measurements
162 tests pass. Generator tested with dummy component, verified output, cleaned up.

### Decisions & alternatives
Generators print manual follow-up steps (shared types, DB migration, frontend params) rather than attempting full automation — those steps require judgment.

### Open questions
None.

## 2026-03-06 — Phase 4 (Infra): Version 1.0.0
**Branch:** `dev/stack-cleanup-features`
**Commits:** `cd33c4a`
**Files changed:** `package.json`, `CHANGELOG.md`

### What changed
Bumped `package.json` version to 1.0.0. Created `CHANGELOG.md` documenting all features in the initial release.

### Why
Mark the first stable release milestone after all governance, scoring, admin, and infrastructure work.

### Measurements
N/A.

### Decisions & alternatives
Git tag deferred until merge to main.

### Open questions
None.
