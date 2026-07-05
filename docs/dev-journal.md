# Dev Journal

<!-- ORDERING RULE: Entries are strictly chronological. Each entry has a
     sequence number (e.g., #01, #02) within its date. New entries go at
     the bottom with the next sequence number. Never prepend. Use
     `date -u +%Y-%m-%dT%H:%MZ` for the timestamp. -->

## 2026-03-06 #01 — Phase 1: Cleanup & Polish
**Branch:** `dev/stack-cleanup-features`

- Removed unused `bullmq` and `@fastify/jwt` dependencies (confirmed zero imports in src/)
- Fixed web/package.json name, index.html title, replaced Vite README boilerplate
- Stripped Vite template remnants from web/src/App.css
- Enhanced polis.ts JSDoc with `@status` and `@planned` tags; fixed `process.env` → `config` access
- Added `npm ci`, `npm run build`, `npm run test`, and web build to CI deploy workflow
- Created `src/db/queries/` with subscriber upsert and epoch lookup extractions as reuse pattern
- All 162 tests pass, backend and frontend builds clean

## 2026-03-06 #02 — Phase 2: acceptsInteractions Support
**Branch:** `dev/stack-cleanup-features`

- Added `acceptsInteractions: true` to feed publication record in `scripts/publish-feed.ts`
- Created migration 015 for `feed_interactions` table with indexes on time, user, post, and epoch
- Implemented `POST /xrpc/app.bsky.feed.sendInteractions` endpoint with mandatory JWT auth, Zod validation (max 100 items), batch parameterized INSERT, and `ON CONFLICT DO NOTHING`
- Registered route in server.ts after `registerFeedSkeleton`
- Added configurable rate limiting (60 req/min default via `RATE_LIMIT_INTERACTIONS_MAX/WINDOW_MS`)
- Added `GET /api/admin/interactions/feed-signals` analytics endpoint: totals by type (today/yesterday/7-day), per-epoch breakdown, top posts by requestMore/requestLess ratio
- All 162 tests pass, build clean

## 2026-03-06 #03 — Phase 3: Scoring Component Interface
**Branch:** `dev/stack-cleanup-features`

- Defined `ScoringComponent` interface and `ScoringContext` in `src/scoring/component.interface.ts`
- Added `ScoringComponent` wrappers to all 5 components (recency, engagement, bridging, source-diversity, relevance) alongside existing functions — zero breaking changes
- Created `src/scoring/registry.ts` with `DEFAULT_COMPONENTS` array and `validateRegistry()` that cross-checks against votable-params at module load
- Refactored `scorePost()` in pipeline.ts to iterate `DEFAULT_COMPONENTS` with type-safe `WEIGHT_ACCESSORS` lookup map (no `as any`)
- `scoreAllPosts()` now creates `ScoringContext` once per run with fresh `authorCounts`
- `storeScore()` unchanged — Golden Rule preserved
- All 162 tests pass, build clean

## 2026-03-06 #04 — Phase 4: Private Feed Access Gating
**Branch:** `dev/stack-cleanup-features`

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

## 2026-03-06 #05 — Phase 5: Test Fixtures & Helpers
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

## 2026-03-06 #06 — Phase 1 (Infra): OpenAPI Spec
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

## 2026-03-06 #07 — Phase 2 (Infra): Pre-commit Hooks
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

## 2026-03-06 #08 — Phase 3 (Infra): CI Hardening
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

## 2026-03-06 #09 — Phase 6 (Infra): Shared API Types
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

## 2026-03-06 #10 — Phase 7 (Infra): Code Generators
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

## 2026-03-06 #11 — Phase 4 (Infra): Version 1.0.0
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

## 2026-03-06 #12 — Security Audit & Merge to Main
**Branch:** `dev/stack-cleanup-features` → `main`
**Commits:** `edcb9ed`, `942961c`
**Tag:** `v1.0.0`
**Files changed:** `package-lock.json`, `web/package-lock.json`, `web/package.json` (audit fix); 58 files in merge

### What changed
Ran comprehensive security audit (auth/access control, SQL injection/input validation, infrastructure/dependencies) across all OWASP Top 10 categories. Fixed 5 dependency vulnerabilities via npm audit fix (axios, rollup, minimatch, dompurify, ajv). Merged 41 commits from dev/stack-cleanup-features to main with --no-ff. Tagged v1.0.0.

### Why
Pre-release security gate before merging infrastructure hardening work (Phases 1-7) to main and deploying to production.

### Measurements
162 tests pass. Zero high/critical dependency vulnerabilities. Zero application-level security issues found. Backend and frontend builds clean.

### Decisions & alternatives
Remaining moderate vulns (esbuild/vite/vitest chain) are dev-only and require breaking major version bumps — deferred. Debug routes left unprotected in dev mode (protected in prod via requireAdmin) — acceptable tradeoff.

### Open questions
Re-run `npm run publish-feed` on VPS after deploy to push acceptsInteractions flag live.

## 2026-03-06 #13 — Admin CLI & Research Export API
**Branch:** `dev/admin-cli-export`
**Commits:** `1477344`, `131bade`, `40617f6`, `2a772d8`
**Files changed:** `src/config.ts`, `src/lib/anonymize.ts`, `src/lib/csv-stream.ts`, `src/shared/export-types.ts`, `src/admin/routes/export.ts`, `src/admin/routes/index.ts`, `tests/anonymize.test.ts`, `tests/admin-export.test.ts`, `cli/` (15 files), `.github/workflows/weekly-export.yml`, `.github/workflows/daily-health.yml`, `.github/workflows/deploy.yml`, `.gitignore`, `package.json`

### What changed
Added 6 anonymized research export API endpoints (votes, scores, engagement, epochs, audit, full-dataset ZIP) under `/api/admin/export/`. Built a complete CLI tool (`feed-cli`) with commander.js wrapping all admin endpoints — auth, epochs, rules, votes, participants, feed ops, announcements, and exports. Added CI/CD workflows for weekly automated exports and daily health checks.

### Why
Admin operations required direct HTTP requests. Researchers need anonymized data exports. CI automation enables recurring health monitoring and data collection without manual intervention.

### Measurements
178 tests pass (16 new: 4 anonymize + 12 export route tests). Server build clean. CLI builds independently via separate tsconfig. Frontend build unaffected.

### Decisions & alternatives
- DID anonymization uses SHA-256 truncated to 16 hex chars (deterministic per salt, irreversible). Considered full hash — 16 chars sufficient for collision resistance in this context.
- CLI uses separate `cli/` directory with own package.json and tsconfig to avoid pulling server dependencies. Direct mode uses its own pg Pool from DATABASE_URL rather than importing server's config-dependent db client.
- CSV streaming uses `reply.raw.writeHead()` to bypass Fastify serialization. Full-dataset ZIP uses `reply.hijack()` + archiver piped to reply.raw.
- Export routes use chunked queries (LIMIT 5000 OFFSET N) to avoid hitting 10s statement_timeout on large datasets.

### Open questions
- Weekly export workflow uses `--epoch=current` which needs the CLI to resolve the active epoch first — this requires the direct mode epoch status query to work correctly.
- Production `EXPORT_ANONYMIZATION_SALT` secret needs to be set in GitHub Actions and on VPS.

## 2026-03-06 #14 — MCP Server for Feed Administration
**Branch:** `dev/admin-cli-export`
**Commits:** `fd333d4`, `9d9797a`
**Files changed:** `src/mcp/server.ts`, `src/mcp/transport.ts`, `src/mcp/tools/format.ts`, `src/mcp/tools/governance.ts`, `src/mcp/tools/feed.ts`, `src/mcp/tools/participants.ts`, `src/mcp/tools/export.ts`, `src/mcp/tools/announce.ts`, `src/mcp/tools/index.ts`, `src/feed/server.ts`, `tests/mcp-server.test.ts`, `docs/MCP_SETUP.md`

### What changed
Added an MCP (Model Context Protocol) Streamable HTTP endpoint at `/mcp` with 23 admin tools across 5 categories: governance (10), feed/scoring (5), participants (3), export (3), and announcements (2). All tools delegate to existing admin API endpoints via `app.inject()` — zero business logic duplication.

### Why
Enable programmatic management of feed operations through MCP tool calling with full auth, validation, and audit logging preserved.

### Measurements
185 tests pass (7 new MCP tests). Build clean. All 23 tools verified via tool listing test.

### Decisions & alternatives
- Stateless per-request McpServer (no session tracking) — simpler than stateful mode with no UX tradeoff for admin use cases.
- Bearer token extracted at transport level, converted to Cookie for `app.inject()` calls so `requireAdmin` middleware works unchanged.
- `reply.hijack()` hands raw HTTP response to MCP SDK transport — same pattern as export ZIP endpoint.
- Export tools always use `format=json` since MCP returns text, not binary streams.

### Open questions
None.

## 2026-03-06 #15 — Topic Engine Phase 1: Content Labels & Topic Taxonomy
**Branch:** `dev/topic-engine`
**Commits:** `f8ae16e`, `05ac5ef`
**Files changed:** `src/ingestion/handlers/post-handler.ts`, `src/config.ts`, `.env.example`, `scripts/seed-governance.ts`, `src/governance/aggregation.ts`, `src/db/migrations/017_topic_taxonomy.sql`, `src/scoring/topics/taxonomy.ts`, `scripts/seed-topics.ts`, `tests/post-handler-label-filtering.test.ts`, `tests/taxonomy.test.ts`, `package.json`

### What changed
Replaced the 20+ keyword NSFW exclude list with Bluesky AT Protocol content labels (`porn`, `sexual`, `graphic-media`, `nudity`) for pre-ingestion filtering. Gated behind `FILTER_NSFW_LABELS` config toggle. Trimmed default exclude keywords for new epochs to safety-net set: `spam`, `nsfw`, `onlyfans`. Created topic taxonomy schema (migration 017) with `topic_catalog` table, added `topic_vector` JSONB to posts, `topic_weights` to epochs, `topic_weight_votes` to votes. Built taxonomy module with 5-minute memory cache. Seeded 25 topics with terms, context_terms, and anti_terms for disambiguation.

### Why
AT Protocol labels are more reliable than keyword whack-a-mole — users self-label and Bluesky's moderation service auto-labels. Topic taxonomy is the data foundation for Phase 2 (classifier) through Phase 5 (admin CRUD).

### Measurements
199 tests pass (14 new: 6 label filtering + 8 taxonomy). Backend and frontend builds clean.

### Decisions & alternatives
Label check runs before content rules filter (fail-open). Aggregation fallback defaults added so new epochs without content votes still get safety-net excludes. Taxonomy uses memory cache (not Redis) since topic catalog is small and rarely changes.

### Open questions
None.

## 2026-03-06 #16 — Topic Engine Phase 2: winkNLP Classifier & Ingestion Integration
**Branch:** `dev/topic-engine`
**Commits:** `7288e85`, `25af698`, `36ea140`
**Files changed:** `src/scoring/topics/classifier.ts`, `src/types/wink-eng-lite-web-model.d.ts`, `tests/topic-classifier.test.ts`, `src/ingestion/handlers/post-handler.ts`, `src/index.ts`, `scripts/backfill-topics.ts`, `package.json`

### What changed
Built winkNLP-based topic classifier that runs at ingestion time. Tokenizes post text via winkNLP singleton, filters stopwords/punctuation, matches against pre-processed taxonomy lookup structures (WeakMap-cached per taxonomy load). 5-rule co-occurrence scoring: anti-terms disqualify weak matches, no primary = no match, single primary without context = fixed 0.2 (absolute, not normalized), primary+context = confirmed, 3+ primary = 1.2x bonus. Dynamic scores normalized relative to max; threshold at 0.1. Integrated into post handler as column 10 ($10 topic_vector JSONB). loadTaxonomy() called at startup before Jetstream. Backfill script batch-classifies existing posts with unnest-based UPDATE.

### Why
Phase 2 of 5: every new post now gets a sparse topic_vector stored in PostgreSQL. This is the classification layer that Phase 3 (topic scoring component) and Phase 4 (topic voting) build on.

### Measurements
216 tests pass (17 new classifier tests across basic classification, co-occurrence disambiguation, multi-word terms, edge cases, and performance). 1000-post classification completes in <2s. Backend and frontend builds clean.

### Decisions & alternatives
winkNLP chosen over compromise/natural for zero native dependencies and 650K tokens/sec throughput. WeakMap caching auto-invalidates when taxonomy reloads (new array reference). Rule 3 fixed scores kept absolute (not normalized) — prevents single ambiguous term from inflating to 1.0. Multi-word matching uses substring check on lowercased text (simpler than bigram-only approach, catches hyphenated terms). Backfill uses unnest-based batch UPDATE for efficiency over row-by-row.

### Open questions
None.

## 2026-03-06 #17 — Topic Engine Phase 3: Community Topic Voting & Relevance Scoring
**Branch:** `dev/topic-engine`
**Commits:** `c761f93`, `7c9c6ec`, `5ee6bce`, `8510c34`, `5fe35c5`
**Files changed:** `src/governance/routes/vote.ts`, `src/governance/routes/topics.ts` (new), `src/governance/server.ts`, `src/governance/aggregation.ts`, `src/governance/epoch-manager.ts`, `src/scoring/score.types.ts`, `src/scoring/pipeline.ts`, `src/scoring/components/relevance.ts`, `src/transparency/transparency.types.ts`, `src/transparency/routes/post-explain.ts`, `tests/topic-voting.test.ts` (new), `tests/topic-aggregation.test.ts` (new), `tests/topic-relevance.test.ts` (new)

### What changed
Closed the loop on community-steered topic scoring. (1) Extended existing vote endpoint to accept `topic_weights` (Record<slug, 0.0-1.0>) alongside weight and keyword votes; Zod validation, slug validation against `topic_catalog`, COALESCE UPSERT preserves independent vote types. Added public GET /api/governance/topics returning catalog with current epoch weights. (2) Added `aggregateTopicWeights()` using same trimmed mean algorithm as component weight aggregation (trim 10% when ≥10 voters); integrated into both `closeCurrentEpochAndCreateNext()` and `forceEpochTransition()`, storing result in `governance_epochs.topic_weights` JSONB. (3) Replaced relevance component's `return 0.5` placeholder with topic-weighted dot product: `Σ(post_topic × community_weight) / Σ(post_topic)`. Added `topicVector` to `PostForScoring` and `topicWeights` to `GovernanceEpoch`, updated mappers and pipeline SELECT queries. (4) Added per-topic breakdown to transparency post-explain endpoint. (5) 26 new tests across 3 files.

### Why
Phase 3 of 5: the feed now actually ranks posts differently based on community topic preferences. Previously relevance was hardcoded to 0.5 for all posts. Now subscribers vote on per-topic weights, those votes aggregate into epochs, and the relevance score reflects how well a post's topics match community preferences.

### Measurements
242 tests pass across 52 files (26 new). Backend builds clean. Topic relevance scores now vary 0.0-1.0 when topic data is present; backward compatible (returns 0.5 when either post has no topic vector or epoch has no topic weights).

### Decisions & alternatives
Reused existing vote endpoint rather than creating a separate one — voters submit any combination of weight/keyword/topic votes in a single request. COALESCE UPSERT pattern ensures updating one vote type doesn't overwrite others. Trimmed mean matches component weight aggregation for consistency. Topics with zero votes excluded from aggregated result (defaults to 0.5 at scoring time) rather than storing explicit 0.5 — keeps the JSONB sparse. Topic breakdown in transparency is non-fatal (try/catch with warn log) to avoid blocking the main explanation if topic query fails.

### Open questions
None.

## 2026-03-06 #18 — Topic Engine Phase 4: Frontend Topic Voting & Dashboard
**Branch:** `dev/topic-engine`
**Commits:** `eb59f07`, `e5943f6`, `bf725b6`
**Files changed:** `web/src/api/client.ts`, `web/src/components/TopicSliders.tsx` (new), `web/src/components/TopicWeightChart.tsx` (new), `web/src/pages/Vote.tsx`, `web/src/pages/Dashboard.tsx`, `web/src/pages/PostExplain.tsx`

### What changed
Built the frontend for community topic voting and visualization. (1) Extended API client with `TopicCatalogEntry`/`TopicCatalogResponse` types, `getTopicCatalog()`, extended `submitVote()` to accept optional `topicWeights`, and added `TopicBreakdownEntry` type for post explanations. (2) Created `TopicSliders` component with independent per-topic sliders (0.0–1.0), red/grey/green gradient tracks, community average markers, grouping by parentSlug, touched vs untouched visual states, and reset functionality. (3) Added "Topics" tab to Vote page with catalog loading, graceful degradation if fetch fails, touched-only submission, and confirmation showing boosted/reduced topics. (4) Created `TopicWeightChart` using recharts horizontal BarChart with color-coded bars, neutral reference line, and most-boosted/penalized summary; integrated into Dashboard as "Community topic preferences" section. (5) Added topic breakdown table to PostExplain page showing per-topic match scores and community weights with color-coded bars.

### Why
Phase 4 of 5: users can now actually vote on topic preferences through the UI and see topic data on the transparency dashboard. Previously the backend supported topic voting but there was no frontend to use it. This closes the user-facing loop for the topic engine.

### Measurements
242 tests pass across 52 files (unchanged from Phase 3). Backend and frontend builds clean. Three new frontend components, three page modifications.

### Decisions & alternatives
Used independent sliders (each 0.0–1.0) rather than linked sliders that sum to 1.0 — topics are independent preferences, not a budget to allocate. Added Topics as a 3rd tab on the Vote page (consistent with existing weights/content tab architecture) rather than a separate section on the same page. Only touched topics are submitted to avoid noise from default 0.5 values. Graceful degradation throughout: topic tab hidden if catalog fetch fails, topic breakdown hidden if data not present.

### Open questions
None.

## 2026-03-06 #19 — Topic Engine Phase 5: Admin Tooling, CLI, MCP & Export Integration
**Branch:** `dev/topic-engine`
**Commits:** `057324b`, `a0cc6b4`, `b2fe74b`, `322b796`, `5c17689`
**Files changed:** `src/admin/routes/topics.ts` (new), `src/admin/routes/index.ts`, `cli/src/http.ts`, `cli/src/commands/topics.ts` (new), `cli/src/index.ts`, `src/mcp/tools/topics.ts` (new), `src/mcp/tools/index.ts`, `tests/mcp-server.test.ts`, `web/src/components/admin/TopicsPanel.tsx` (new), `web/src/api/admin.ts`, `web/src/pages/Admin.tsx`, `src/shared/export-types.ts`, `src/admin/routes/export.ts`, `tests/admin-export.test.ts`

### What changed
Final phase of the topic engine — admin tooling across all four interfaces. (1) Admin CRUD API routes: GET/POST/PATCH/DELETE for topic catalog with Zod validation, audit logging, classify endpoint, and backfill endpoint for re-classifying posts in batches. Route ordering critical: POST /topics/classify registered before :slug routes. (2) CLI commands: 8 commands (list, add, update, deactivate, stats, backfill, backfill-all, classify) with apiPatch helper added to http client. Update supports --add-terms/--remove-terms with Set-based merging. (3) MCP tools: 5 tools (list_topics, add_topic, update_topic, get_topic_stats, classify_text) delegating via app.inject(). (4) Frontend admin panel: TopicsPanel component with table view, inline add/edit forms, deactivate/reactivate, and classification preview tool. Topics tab always visible in admin (not gated on private mode). (5) Export integration: topic_weight_votes in vote records, topic_vector in score records (LEFT JOIN posts), topic_weights in epoch records, plus topics/catalog.json and topics/community-weights.json in full-dataset ZIP.

### Why
Phase 5 of 5: the topic engine is now feature-complete. Admins can manage the topic catalog from the dashboard, terminal, or natural language (MCP), and topic data flows through research exports for analysis.

### Measurements
242 tests pass across 52 files. Backend and frontend builds clean. MCP tool count increased from 23 to 28. 14 files changed across 5 commits.

### Decisions & alternatives
Backfill processes 500 posts per batch with unnest() UPDATE pattern for efficiency. Post counts computed via jsonb_each(topic_vector) GROUP BY rather than per-topic queries. Reactivation implemented as a PATCH with the same name (no separate endpoint) rather than adding a PUT /topics/:slug/activate route. Export score queries use LEFT JOIN posts to access topic_vector without duplicating the column into post_scores.

### Open questions
Consider merging dev/topic-engine to main and tagging as v1.1.0.

## 2026-03-07 #01 — Comprehensive Security Audit
**Branch:** `dev/security-audit`
**Commits:** `9bb9937`, `65bbf7d`, `47a3e69`, `c629f4b`, `25ce7c8`, `9273d4d`, `ed36a20`, `df661b7`, `97673ce`, `c444f71`, `22fedf7`, `210930a`, `9104da3`
**Files changed:** `src/feed/routes/send-interactions.ts`, `src/feed/routes/debug.ts`, `src/feed/server.ts`, `src/maintenance/cleanup.ts`, `src/maintenance/interaction-aggregator.ts`, `src/admin/routes/export.ts`, `src/admin/routes/participants.ts`, `src/auth/admin.ts`, `src/config.ts`, `.env.example`, `.github/workflows/deploy.yml`, `.github/workflows/daily-health.yml`, `.github/workflows/weekly-export.yml`, `docs/SECURITY.md`, `docs/SECURITY_AUDIT.md`, `tests/send-interactions-security.test.ts`, `tests/admin-export.test.ts`, `tests/rate-limit-config.test.ts`, `tests/cleanup.test.ts`, `tests/interaction-aggregator.test.ts`, `tests/config-defaults-security.test.ts`, `tests/debug-routes-access.test.ts`

### What changed
Full-repository security audit covering 316 tracked files (62,965 lines). Found and fixed 9 HIGH, 4 MEDIUM issues. Key remediations: unconditional admin auth on debug routes, OpenAPI docs gated behind admin in production, recursive DID scrubbing in audit export JSONB, private-mode enforcement on sendInteractions, SQL interval parameterization in maintenance jobs, production-only export salt validation, MCP rate limiting, research consent filtering in exports, admin DID parsing at startup, participant DELETE param validation, Fastify bodyLimit, and SHA-pinned GitHub Actions. Zero CRITICAL findings.

### Why
Production research-ready system handling governance integrity and participant data. Privacy policy and consent model require anonymization guarantees and consent filtering. Defense-in-depth against misconfiguration (debug routes, OpenAPI exposure) and supply-chain attacks (CI pinning).

### Measurements
248 tests pass across 53 files. Backend and frontend builds clean. `npm audit`: 0 high/critical, 5 moderate (dev-only vitest/esbuild chain — accepted risk). Full findings in `docs/SECURITY_AUDIT.md`.

### Decisions & alternatives
Elevated OpenAPI docs from MEDIUM to HIGH — combined with debug route exposure, provides full system reconnaissance on misconfigured instances. Accepted 16-hex-char anonymization truncation (64 bits, sufficient for ~20M DIDs) over 32-char — salt secrecy is the primary control. Dev-only vitest CVEs deferred to next major vitest upgrade.

### Open questions
None.

## 2026-03-07 #02 — Fix stale recency scores in feed ranking
**Branch:** `dev/fix-stale-recency`
**Commits:** `79fdfc2`
**Files changed:** `src/scoring/pipeline.ts`, `src/config.ts`, `.env.example`, `tests/scoring-pipeline-rescore.test.ts`

### What changed
Added periodic full rescore to the scoring pipeline. The incremental scoring mode only rescored posts with new engagement or no prior score — it never refreshed recency decay. A 10-day-old post with a frozen recency score of 0.86 (should have been ~0.00006) was ranked #1 in the feed. New `SCORING_FULL_RESCORE_INTERVAL` config (default 6) forces a full rescore every 6th run (~30 minutes), ensuring recency decay is applied to all posts at a predictable interval.

### Why
The incremental scoring query (`getPostsForIncrementalScoring`) uses a UNION ALL of (a) posts never scored and (b) posts with engagement changes since last score. Neither leg captures time-based recency decay. `writeToRedisFromDb` reads stale `total_score` values from `post_scores` and writes them to the Redis feed, so old posts with high initial recency scores permanently dominated the ranking.

### Measurements
255 tests passing across 54 files. TypeScript compilation clean. At default interval (every 30 min), recency scores are at most 30 minutes stale — with an 18-hour half-life, that's a maximum error of ~2% on the recency component.

### Decisions & alternatives
Chose periodic full rescore over computing recency at Redis-write time. The alternative (recomputing recency in `writeToRedisFromDb`) would cause stored scores to diverge from served scores, breaking the Golden Rule and making exported research data unreliable. Periodic full rescore keeps stored = served = exported scores consistent.

### Open questions
None. Server restart needed on VPS to pick up this fix (first run after restart is always full mode).

## 2026-03-07 #03 — Upgrade Topic Classifier: Semantic Embeddings via Transformers.js
**Branch:** `dev/embedding-classifier`
**Commits:** `04bc07d`, `b6e1fcc`, `f3b6c3f`, `1b7a547`, `d18a852`, `7be10a1`, `c964216`
**Files changed:** `src/config.ts`, `.env.example`, `src/db/migrations/018_topic_embeddings.sql`, `src/scoring/topics/embedder.ts`, `src/scoring/topics/taxonomy.ts`, `src/scoring/topics/embedding-classifier.ts`, `src/scoring/pipeline.ts`, `src/index.ts`, `src/transparency/transparency.types.ts`, `src/transparency/routes/post-explain.ts`, `src/shared/export-types.ts`, `src/admin/routes/export.ts`, `src/admin/routes/topics.ts`, `tests/embedding-classifier.test.ts`, `tests/scoring-pipeline-embeddings.test.ts`, `package.json`

### What changed
Added a second-tier semantic embedding classifier to the topic engine. When `TOPIC_EMBEDDING_ENABLED=true`, the scoring pipeline batch-embeds post texts via `all-MiniLM-L6-v2` (384-dim, ONNX q8 quantized, ~23MB) and computes cosine similarity against pre-computed topic embeddings. Topics above `TOPIC_EMBEDDING_MIN_SIMILARITY` (default 0.25) threshold are included in the topic vector. The winkNLP keyword classifier remains as the fast path at ingestion; the embedding classifier runs at batch scoring time (every 5 min) and overrides the topic vector for scoring only. Each score row records `classification_method` ("keyword" or "embedding") for research analysis. Transparency and export endpoints include the classification method. The admin classify endpoint shows both keyword and embedding results side-by-side when available.

### Why
The winkNLP keyword classifier produces false positives because it matches individual words without understanding meaning (e.g., "Trump Tower developer" → `software-development`). Sentence embeddings capture semantic meaning and produce more accurate topic assignments. The two-tier architecture keeps ingestion fast (<1ms/post with winkNLP) while improving accuracy at scoring time (~20ms/post with embeddings).

### Measurements
274 tests pass across 56 files (19 new: 12 embedding-classifier unit tests + 7 pipeline integration tests). Backend builds clean. Feature flag OFF by default — zero behavior change on deploy.

### Decisions & alternatives
- `all-MiniLM-L6-v2` chosen for small size (23MB quantized), Apache 2.0 license, and good sentence-level semantics. Larger models rejected for VPS memory constraints (~200MB ONNX runtime overhead is acceptable on 4GB VPS).
- Topic embeddings computed from 3 anchor sentences (description, name template, terms template) averaged and L2-normalized — ~30% accuracy improvement over single-label embedding.
- Embeddings cached in `topic_catalog.topic_embedding` REAL[] column to survive restarts without recomputation.
- Graceful degradation: embedding failure falls back to winkNLP vectors silently (logged but no crash). Feature flag OFF = zero code path change.
- Empty embedding vectors (no topics above threshold) fall back to the winkNLP vector for that post rather than producing an empty relevance score.

### Open questions
None.

## 2026-03-07 #04 — Feed Tuning: Relevance Weights & UPSERT Fix
**Branch:** `main`
**Commits:** `d23fc7d`, `af10bef`
**Files changed:** `src/scoring/components/relevance.ts`, `tests/topic-relevance.test.ts`, `src/scoring/pipeline.ts`

### What changed
Lowered `DEFAULT_RELEVANCE_SCORE` from 0.5 to 0.2 so classified posts outrank unclassified ones when community topic preferences are active. Set meaningful topic weights on epoch 2 (decentralized-social: 0.9, dogs-pets: 0.7, open-source: 0.8, etc.) and rebalanced component weights (relevance: 0.35, recency: 0.25, engagement: 0.2, bridging: 0.1, source_diversity: 0.1). Fixed UPSERT bug in pipeline.ts where weight columns were not updated in the `ON CONFLICT` clause, causing stale audit data on re-scored posts.

### Why
Feed was showing random content because all topic weights were 0.04 (no votes), relevance component had only 10.8% weight, and unclassified posts scored higher (0.5) than classified ones against the near-zero community weights. The backwards incentive meant the classifier was penalizing topical posts.

### Measurements
- 274 tests pass (7 test expectations updated for new default)
- Feed top 10 posts: 8/10 are ATproto/decentralized-social, 1 open source (Wine 11.4), 1 high-engagement (cat photo with 651 likes)
- Relevance component now contributes 0.315 weighted score for decentralized-social posts (was 0.054 before)
- Transparency endpoint confirms correct weights, topic breakdown, and classification_method

### Decisions & alternatives
- DEFAULT_RELEVANCE_SCORE = 0.2 (below midpoint) chosen so posts with no topic data don't outrank classified posts. Considered 0.1 but 0.2 still provides some visibility for truly unclassified content.
- Topic weights set manually via SQL to bootstrap the community governance — will be replaced by actual subscriber votes over time.
- UPSERT fix: Added weight columns ($8-$12) to ON CONFLICT UPDATE. The scoring computation was already correct (weights computed fresh each run), but stored weight values were stale for audit purposes.

### Open questions
- Keyword classifier false positives still inflate some posts (matching "developer" in non-tech contexts). The embedding classifier returns empty vectors for these, causing fallback to keyword. May need to trust empty embedding over keyword in future iteration.

## 2026-03-07 #05 — Feed Audit: Layered NSFW Filtering + Content Quality Fixes
**Branch:** `dev/content-filter-hardening`
**Commits:** `7188460`, `7f0e4f2`, `27e8fdb`, `d3610d4`
**Files changed:** `src/governance/content-filter.ts`, `src/scoring/pipeline.ts`, `scripts/seed-governance.ts`, `tests/content-filter.test.ts`

### What changed
Implemented three-layer NSFW defense after feed audit found 2 explicit posts leaking through. Layer 1 (AT Protocol self-labels) already existed. Layer 2 adds `adult-content` topic to taxonomy with community weight 0.0 — the embedding classifier handles NSFW semantically, scoring matching posts to relevance 0.0 via existing `scoreRelevance()` formula. Layer 3 expands exclude keywords (3→14 terms) with prefix matching so "kink" catches "kinks"/"kinky" and "porn" catches "pornographic". Pipeline timeout increased from 120s→180s to accommodate embedding-enriched scoring runs (~144s).

### Why
Posts with explicit sexual content slipped through because authors didn't self-label and the keyword list was too short (only "spam", "nsfw", "onlyfans"). Word boundary regex prevented "kink" from matching "kinks". Rather than playing keyword whack-a-mole, the primary fix leverages existing embedding infrastructure — adding an `adult-content` topic with weight 0.0 lets the semantic classifier bury NSFW content naturally.

### Measurements
- 286 tests pass (up from 274 — 12 new prefix-matching tests)
- Build clean, no type errors
- Pipeline timeout race condition eliminated (180s > ~144s actual)

### Decisions & alternatives
- Chose embedding-based Layer 2 over Bluesky external labeler API (would add external dependency to scoring hot path). Layer 2 uses zero new code — just a data operation via admin API + taxonomy auto-loader.
- Prefix matching only for excludes (catch variants) — includes keep strict boundaries (precision matters for topic filtering).
- "nude" and "nudity" kept as separate exclude keywords — they're different stems (n-u-d-e vs n-u-d-i-t-y), not prefix-related.

### Open questions
- Need to deploy and test `adult-content` topic embedding quality via classify endpoint (scores > 0.25 threshold).
- Monitor for false positives on sex ed / reproductive health content (anti-terms should prevent this).
- Consider Bluesky external labeler subscription as future Layer 4 if embedding approach proves insufficient.

## 2026-03-07 #06 — Complete OpenAPI Documentation for All Routes
**Branch:** `dev/api-docs` (branched from main pre-topic-engine; 185+ tests on branch)
**Commits:** `887ad21`–`8dc3e87` (13 commits)
**Files changed:** 33 files — `src/lib/openapi.ts` (new), `src/feed/server.ts`, 30 route files, `web/public/api-reference.html` (new), `scripts/generate-openapi.ts` (new)

### What changed
Added full OpenAPI 3.0 schema objects to every route in the codebase. Created `src/lib/openapi.ts` with shared helpers (`ErrorResponseSchema`, `RateLimitResponseSchema`, `governanceSecurity`, `adminSecurity`). Enhanced swagger config with tags, security schemes, and extended API description. Added Redoc reference page and a static spec generator script with `--public-only` flag to strip admin routes.

Route groups documented (12 groups, ~80 routes total):
1. Health (3 routes)
2. Feed / AT Protocol (4 routes)
3. Governance auth (3 routes)
4. Governance vote + weights (5 routes)
5. Topics + content-rules + epochs (11 routes)
6. Polis + research consent (5 routes)
7. Transparency (4 routes)
8. Admin status + scheduler (5 routes)
9. Admin governance + participants + topics (23 routes)
10. Admin export + interactions + audit (14 routes)
11. Bot + legal + debug (12 routes)
12. Redoc page + generator script

### Why
The OpenAPI spec was nearly empty — only `feed-skeleton.ts` had proper schemas. The `/docs` endpoint existed but showed almost no route documentation. Every route needed `schema` objects for request validation docs, response shapes, tags, summaries, descriptions, and security annotations.

### Measurements
- 33 files changed, +3181 lines
- All 185+ tests pass (on branch; main had 286 at merge time)
- Build clean after every commit (13 consecutive green builds)
- Pre-commit hook (tsc --noEmit) passed on every commit

### Decisions & alternatives
- **Schema-only changes**: Never modified handler logic — only added `schema` objects to route registrations.
- **Two-schema pattern for Zod refinements**: Routes with `.refine()`/`.superRefine()` use inline JSON Schema for OpenAPI (Ajv can't compile Zod effects).
- **Validator compiler disabled**: `app.setValidatorCompiler(() => () => true)` — schemas are documentation-only, Zod still handles actual validation in handlers.
- **Reusable schema fragments**: File-level constants for DRY response schemas (e.g., `componentDetailSchema`, `announcementItemSchema`, `legalDocResponseSchema`).
- **CSV/ZIP routes**: Documented JSON response as primary with notes about alternative formats. ZIP uses `produces: ['application/zip']`.
- **Redoc over Swagger UI for public docs**: Swagger UI stays at `/docs` (admin-gated), Redoc at `/api-reference.html` loads from the same `/api/openapi.json`.
- **Static spec generator**: Uses `app.inject()` to fetch spec without external HTTP — clean and testable. `--public-only` strips Admin/Export tagged routes for public consumption.

### Open questions
- Should the static spec be generated in CI and committed to `docs/openapi.json`? Currently manual via `npx tsx scripts/generate-openapi.ts`.

## 2026-03-08 #01 — Governance-Driven Ingestion Gate, Media Filter & Relevance Floor
**Branch:** `dev/ingestion-gate`
**Commits:** `979c640`, `511f120`, `5ed2cc5`, `3043e9f`, `2651f11`, `7e0908f`, `bb90526`
**Files changed:** `src/config.ts`, `src/ingestion/governance-gate.ts` (new), `src/ingestion/handlers/post-handler.ts`, `src/scoring/pipeline.ts`, `src/index.ts`, `tests/governance-gate.test.ts` (new), `tests/governance-gate-integration.test.ts` (new), `tests/relevance-floor.test.ts` (new)

### What changed
Three-layer content quality system to eliminate off-topic posts from the feed. (1) **Governance gate** at ingestion: rejects posts whose `topicVector × communityWeights` weighted average falls below `INGESTION_MIN_RELEVANCE` (0.10). Same formula as `relevance.ts` but applied as binary pass/reject. Empty topic vectors are rejected (no classification = no community topic match). Fail-open: gate disabled until weights loaded, passes all posts on Redis/DB failure. Weights cached in Redis (5-min TTL) with DB fallback. (2) **Media-without-text gate**: rejects image/video posts with text shorter than `INGESTION_MIN_TEXT_FOR_MEDIA` (10 chars). Runs before topic classification to save CPU. (3) **Relevance floor** in feed output: `writeToRedisFromDb` SQL adds `AND ps.relevance_score >= $4` clause with `FEED_MIN_RELEVANCE` (0.15), excluding low-relevance posts from Redis feed even if they were scored.

Also set community topic weights on VPS production database (epoch 2) and initialized governance gate at startup in `index.ts`.

### Why
99%+ of ingested posts were irrelevant (furry art, conspiracy theories, NSFW, spam). The topic classifier already ran at ingestion and produced `topic_vector`, and community topic weights existed in `governance_epochs.topic_weights`, but they were never connected at ingestion time. Posts were stored unconditionally, and viral noise dominated the feed ranking.

### Measurements
- 339 tests pass across 60 files (43 new: 17 governance gate unit + 17 integration + 7 relevance floor + 2 existing governance-gate caching)
- Governance gate initialized at startup: "Governance gate initialized with topic weights" (topicCount: 26)
- Health endpoint: OK after deployment
- Build clean, pre-commit hooks pass on all 7 commits

### Decisions & alternatives
- Reused exact weighted-average formula from `relevance.ts` for the gate (same code path, same default weight 0.2 for unknown topics). Key difference: empty topicVector = reject at gate (not default 0.2 like scoring).
- Caching pattern mirrors `content-filter.ts`: Redis GET → parse → DB fallback → cache write → fail-open. 5-minute TTL matches scoring interval.
- Media gate placed BEFORE topic classification to avoid running winkNLP on posts that will be rejected anyway.
- Relevance floor implemented in SQL rather than application code — DB handles the filtering, fewer rows transferred.
- Topic weights stored in `governance_epochs.topic_weights` JSONB (not `topic_catalog.community_weight` column) — discovered during VPS setup that the kickoff's assumed schema was wrong.

### Open questions
- Feed initially returns 0 posts after deployment until the next scoring cycle runs and repopulates Redis with posts that pass the relevance floor. This is expected transient behavior.
- Monitor gate rejection rate over 24 hours to calibrate `INGESTION_MIN_RELEVANCE` threshold (0.10 may be too aggressive or too lenient).

## 2026-03-08 #02 — Jetstream Death Loop & Scoring Pipeline Throughput Fix
**Branch:** `dev/jetstream-throughput`, `dev/scoring-tuning`
**Commits:** `c26a9f2`, `cf2c7f9`
**Files changed:** `src/config.ts`, `src/db/client.ts`, `src/ingestion/jetstream.ts`, `src/scoring/pipeline.ts`, `docker-compose.prod.yml`, `tests/pipeline-empty-feed.test.ts`

### What changed
Made Jetstream concurrency, DB pool, and scoring pipeline limits configurable via env vars instead of hardcoded constants. Increased defaults: `JETSTREAM_MAX_CONCURRENT` 10→50, `JETSTREAM_MAX_PENDING` 5000→10000, `DB_POOL_MAX` 20→50, `DB_STATEMENT_TIMEOUT` 10s→30s. Reduced `SCORING_CANDIDATE_LIMIT` 10000→5000 (VPS set to 2500). Added `shm_size: 256m` to postgres Docker container.

### Why
Post-ingestion-gate deployment, feed still showed irrelevant posts. Root cause chain: (1) Jetstream death loop — `MAX_CONCURRENT_EVENTS=10` saturated in ~500ms against Bluesky firehose, causing reconnect every 2 seconds. (2) DB pool exhaustion — 20 connections shared between 50 concurrent Jetstream ops + scoring pipeline. (3) Scoring pipeline timeout — 10,000 posts scored with individual DB round-trips couldn't complete in 180s under contention. (4) PostgreSQL VACUUM OOM — Docker default 64MB /dev/shm too small. Net effect: scoring pipeline never completed → Redis feed never refreshed → stale pre-gate posts kept serving.

### Measurements
- 339 tests pass (1 test updated for new default candidate limit)
- Jetstream saturation delay: 500ms → 20+ seconds (40x improvement)
- Full rescore: 2,500 posts in 51s (was: 5,000 posts timing out at 180s)
- Incremental scoring: 5,000 posts in 113s (was: 10,000 posts timing out at 240s)
- Feed refresh: every 5 minutes (was: never completing)
- Governance gate verified: 100% of new posts have topic vectors (was: 13%)

### Decisions & alternatives
- Chose to make limits configurable rather than optimizing the per-post DB INSERT loop (batch inserts would be a larger refactor touching the golden rule of storing all score components). Candidate limit reduction is a pragmatic fix.
- Set VPS `SCORING_CANDIDATE_LIMIT=2500` (not the code default of 5000) because incremental mode fetches 2×limit via UNION ALL. This keeps incremental runs at ~5000 posts total.
- Primary Jetstream instance (`15.204.205.x`) was intermittently ETIMEDOUT from VPS — fallback mechanism worked correctly, switching after 5 failures.
- Legacy posts with empty `{}` topic_vector still score relevance=0.5 (default from relevance.ts). These will age out of the 72h scoring window naturally.

## 2026-03-08 #03 — Feed Quality Fixes: Keyword Poisoning, Embedding Override, Alt Text
**Branch:** `dev/feed-quality-fixes`
**Commits:** `e5f82db`, `c018ba0`, `62af733`
**Files changed:** `scripts/seed-topics.ts`, `tests/topic-classifier.test.ts`, `src/ingestion/handlers/post-handler.ts`, `tests/post-handler-alt-text.test.ts` (new)

### What changed
Three targeted fixes for feed quality issues identified in audit:
1. Removed "bluesky" from `decentralized-social` topic terms — was matching every post on the platform and amplifying to 0.9 relevance via weighted average formula.
2. Disabled embedding classifier override on VPS (`TOPIC_EMBEDDING_ENABLED` commented out, defaults to `false`) — was replacing keyword-based topic vectors at scoring time, undoing governance gate filtering. Discovered `z.coerce.boolean()` treats the string "false" as truthy; must omit the env var entirely for default.
3. Added alt text extraction from image embeds for topic classification. Alt text is concatenated with post text for the classifier but intentionally NOT used for content keyword filtering or media-without-text gate (those check user-written text only).

### Why
Post-deployment audit of the governance gate showed the feed was still 90%+ irrelevant content. Root cause analysis traced it to "bluesky" keyword giving every post a weak match that the relevance formula amplified, plus the embedding classifier overriding filtered vectors.

### Measurements
- 347 tests pass (8 new: 6 alt text handler tests, 2 classifier regression tests)
- Scoring pipeline: 9s for 2500 posts with keyword-only (vs 53s with embedding — 6x improvement)
- Post-deployment: 0 new embedding classifications, all recent scores use `keyword` method
- Relevance distribution: 79.7% low (0.01-0.49), 16.6% medium, 3.6% high

### Decisions & alternatives
- Removed "bluesky" but did NOT add it to antiTerms — that would suppress genuine protocol discussions mentioning the platform name alongside technical terms.
- "handle" (AT Protocol username term) identified as the new top false positive. Deferred to next fix — requires either removal from terms, addition to contextTerms (requiring co-occurrence), or a deeper relevance formula fix.
- Alt text design: deliberately separated from content gates. Image alt text is accessibility metadata, not user-intentional content. A post with no text but detailed alt text should still be rejected by the media-without-text gate.
- `z.coerce.boolean()` Zod bug: `Boolean("false") === true` in JS. Must comment out the env var instead of setting it to "false". Filed as a tech debt item — should add a custom transform.

### Open questions
- The relevance formula `weightedSum / scoreSum` is the systemic root cause of false-positive amplification. A single weak keyword match at 0.2 gets amplified to 0.65-0.90 because the weighted average treats it as a 100% match to a high-weight topic. Needs a formula redesign (e.g., minimum match threshold, penalize single-term matches, or cap relevance for low-confidence classifications).
- "handle" in `decentralized-social` terms causes the same amplification pattern as "bluesky" did. Other common words causing false matches: "code", "fork", "training", "security", "developer" (real estate).
- Consider requiring minimum 2 primary term matches before a topic qualifies for the relevance formula, or demoting single-match topics from the relevance calculation entirely.

### Open questions
- Scoring pipeline still uses per-post DB inserts (10,000 round-trips for full incremental). Batch insert refactor would significantly improve throughput.
- Jetstream drops ~40k-80k events/minute — expected for firehose volume, but means we miss engagement updates. Acceptable since we score on 5-minute intervals.
- Legacy posts with default 0.5 relevance still dominate feed until they age out of the 72h window.

## 2026-03-08 #04 — Relevance Confidence Multiplier, Zod Boolean Fix, Ambiguous Terms
**Branch:** `dev/relevance-confidence`
**Commits:** `3d70f3b`, `6d2c553`, `5762256`, `b3aef49`
**Files changed:** `src/config.ts`, `src/scoring/components/relevance.ts`, `src/ingestion/governance-gate.ts`, `scripts/seed-topics.ts`, `tests/config-boolean.test.ts`, `tests/topic-relevance.test.ts`, `tests/governance-gate.test.ts`, `tests/topic-classifier.test.ts`

### What changed
Three independent fixes in one branch:

1. **Zod boolean coercion bug:** `z.coerce.boolean()` uses JS `Boolean()` which treats any non-empty string as true — including `"false"`. Replaced all 6 boolean env vars with `zodEnvBool()` helper that correctly parses `"true"`/`"1"` as true and everything else as false.

2. **Confidence multiplier on relevance formula:** The weighted-average formula `Σ(postScore × weight) / Σ(postScore)` normalized away the classifier's confidence signal. A single weak keyword match (scoreSum=0.2) produced the same relevance as a strong multi-term match. Fix: multiply baseRelevance by `confidence = min(1.0, scoreSum / 0.5)`. Weak match now scores 0.34 instead of 0.85; strong matches unchanged. Applied to both `relevance.ts` and `governance-gate.ts`.

3. **Ambiguous term removal:** Removed 7 common English words from topic primary terms: "code"/"bug" (software-development), "training"/"model" (ai-machine-learning), "fork" (open-source), "handle" (decentralized-social), "security" (cybersecurity). These caused false-positive topic matches on posts about cooking, sports, employment, etc.

### Why
Post-deployment audit (entry #03) identified the relevance formula as the systemic root cause of false-positive amplification. The confidence multiplier directly addresses the open question from that session. The Zod boolean bug was discovered during deployment when `TOPIC_EMBEDDING_ENABLED=false` was silently treated as true. The ambiguous terms were the most frequent false-positive triggers identified in feed audits.

### Measurements
- 371 tests pass (24 new: 13 boolean coercion, 7 relevance confidence, 4 governance gate confidence)
- Weak match relevance: 0.85 → 0.34 (60% reduction for scoreSum=0.2)
- Strong match relevance: 0.85 → 0.85 (zero regression for scoreSum≥0.5)
- Multi-topic matches: unaffected (scoreSum naturally exceeds threshold)

### Decisions & alternatives
- Chose confidence multiplier over minimum match count — multiplier preserves the continuous nature of scores and is backward-compatible (zero regression for well-classified posts).
- CONFIDENCE_THRESHOLD=0.5 chosen because the classifier's Rule 3 assigns 0.2 for single weak matches and Rule 4+ assigns 0.5+ for multiple matches. Threshold at 0.5 cleanly separates the two.
- Exported CONFIDENCE_THRESHOLD from relevance.ts and imported in governance-gate.ts to keep the two formulas in sync from a single constant.
- Removed ambiguous terms rather than moving them to contextTerms — even as context terms, these words would still contribute to co-occurrence scoring for unrelated posts.

### Open questions
- CONFIDENCE_THRESHOLD is a hardcoded constant. Could be made configurable via env var if the community needs to tune sensitivity.
- VPS production DB topic_catalog needs SQL UPDATE to remove the same terms (seed script only affects fresh seeds).
- After deployment, need to audit top 50 feed posts to verify no more cooking/sports/employment false positives.

## 2026-03-09 #01 — Move Embedding Classifier to Ingestion Time
**Branch:** `dev/embedding-at-ingestion`
**Commits:** `4b179b6`, `28ee672`, `689712a`, `e743288`, `539f5e7`
**Files changed:** `src/ingestion/embedding-gate.ts` (new), `src/ingestion/handlers/post-handler.ts`, `src/scoring/pipeline.ts`, `src/config.ts`, `tests/embedding-ingestion.test.ts` (new), `tests/scoring-pipeline-embeddings.test.ts`

### What changed
Moved the embedding-based topic classifier from scoring time (every 5 min in the pipeline) to ingestion time (after the governance gate). The pipeline no longer re-classifies posts — it reads the stored topic vector as-is. Created `embedding-gate.ts` with a single-post classifier that wraps the existing `embedTexts()` and `cosineSimilarity()` infrastructure. Raised `TOPIC_EMBEDDING_MIN_SIMILARITY` default from 0.25 to 0.35.

### Why
The pipeline's batch embedding override was causing re-inflation: posts that entered the DB with `{}` (correctly rejected by the governance gate) got re-classified at scoring time and suddenly had topic vectors that passed the relevance floor. Also, embedding 2,500 posts at ~20ms each took ~50 seconds per pipeline run — half the runtime for no benefit since keyword vectors were already stored.

### Measurements
- 379 tests pass (9 new embedding-ingestion tests, rewrote 6 pipeline-no-override tests)
- Embedding at ingestion costs ~20ms/post × ~12 posts/sec = 240ms/sec total (0.5% of 50-slot capacity)
- Pipeline should drop from ~50s to ~9s per run (no batch embedding step)

### Decisions & alternatives
- Single-post `classifyPostByEmbedding()` wrapper over `embedTexts([text])` rather than adapting the batch classifier — keeps the ingestion path simple and avoids batch overhead for single posts.
- Fail-open design: if embedder is not ready or classification fails, keyword vector is stored. If embedding produces empty vector but keywords had matches, keyword vector is kept.
- Threshold raised to 0.35 because posts already passed the keyword gate, so the embedding should confirm/refine, not add noise.
- Kept the batch `embedding-classifier.ts` module intact — it may be useful for future batch re-classification scripts.

### Open questions
- `classification_method` stored in `post_scores` is always `'keyword'` at scoring time now. Could add a `classification_method` column to `posts` table to track whether ingestion used keyword or embedding classification.
- Need to deploy with `TOPIC_EMBEDDING_ENABLED=true` on VPS and verify word-sense disambiguation works in practice (e.g., "fork in the road" vs "fork the repository").

## 2026-03-09 #02 — VPS Embedding Deployment + Old Post Purge
**Branch:** `main`
**Commits:** `faa4041` (backfill script), `f5b4ced` (docs), `e7860aa` (merge)
**Files changed:** `scripts/backfill-embeddings.ts` (new), `docs/dev-journal.md`, `docs/SYSTEM_OVERVIEW.md`

### What changed
Three-part VPS deployment to activate embedding classification and clean up stale posts:

1. **Enabled embeddings on VPS**: Set `TOPIC_EMBEDDING_ENABLED=true` and `TOPIC_EMBEDDING_MIN_SIMILARITY=0.35` in production `.env`. Restarted service — embedder initialized with 26 topic embeddings (all-MiniLM-L6-v2, 601ms model load). New posts immediately started getting embedding-classified topic vectors (e.g., `art-creative: 0.36` vs keyword-only `0.2`).

2. **Attempted batch backfill** (abandoned): Created `scripts/backfill-embeddings.ts` to re-classify 188K existing posts. Script ran for ~12 minutes processing 25,200 posts (~19% replacement rate) before being killed — too slow at 33 posts/s (~100 min total).

3. **Soft-deleted old posts instead**: Batch soft-deleted ~948K posts older than 2 hours (`UPDATE posts SET deleted = TRUE` in 10K–50K batches). This left only ~22K recent posts that were properly embedding-classified at ingestion. VACUUM ANALYZE reclaimed space. Feed temporarily smaller but 100% accurately classified.

### Why
After merging `dev/embedding-at-ingestion` to main, the VPS was deployed but embedding was disabled (`TOPIC_EMBEDDING_ENABLED` commented out). Feed was serving the same keyword-classified posts as before. Rather than spending 100 minutes re-embedding 188K old posts, purging them and letting the feed rebuild from properly classified new posts was 10x faster.

### Measurements
- Pre-purge: 981K total posts, 189K with topics, feed dominated by keyword false positives
- Post-purge: 22K active posts, embedding classifier running on all new ingestion
- Backfill script: 25,200/188,385 processed before abort (4,862 replaced at 19% rate)
- Soft-delete: 95 batches, ~948K rows, 4 deadlock retries (scoring pipeline contention)
- Feed top 25: mostly genuine tech/AI content (was: soldiers→education, fashion→space false positives)
- Scoring pipeline: 1,904 posts in 17s (down from 2,500 in 41s pre-purge)

### Decisions & alternatives
- **Soft delete over hard delete**: CLAUDE.md Critical Rule #3 — `deleted=TRUE` preserves data integrity and audit trail.
- **Purge over backfill**: 10x faster (2 min vs 100 min). The 19% backfill replacement rate meant 81% of posts would keep their keyword vectors anyway — not worth the time.
- **2-hour cutoff**: Conservative enough to keep recently ingested (properly classified) posts while removing the bulk of keyword-only classified content.
- **Deadlock retry**: Scoring pipeline running concurrently caused 4 deadlocks — retry-on-deadlock loop handled gracefully.

### Open questions
- Feed will be smaller for ~24 hours as new posts accumulate. Monitor feed size via `ZCARD feed:current`.
- Some keyword false positives persist in recent posts (VTuber schedules → "mobile-development") but they score low and don't reach the top of the feed.
- The `backfill-embeddings.ts` script works and could be reused if a future batch reclassification is needed.

## 2026-03-09 #03 — URL Deduplication for Feed Output
**Branch:** `dev/url-dedup`
**Commits:** `0da2c49`, `4a20862`, `a727c19`, `b25f588`
**Files changed:** `src/db/migrations/019_posts_embed_url.sql`, `src/ingestion/handlers/post-handler.ts`, `src/config.ts`, `src/scoring/pipeline.ts`, `tests/url-dedup.test.ts`, `tests/post-handler-embed-url.test.ts`

### What changed
Added URL-based reshare deduplication to the feed output pipeline. When multiple posts share the same external embed URL, a decay multiplier is applied: 1st post gets full score, 2nd 0.7×, 3rd 0.5×, 4th+ 0.3×. Posts with 200+ chars of original text bypass the penalty (treated as original commentary). The external embed URL is extracted at ingestion time from `app.bsky.embed.external` and `app.bsky.embed.recordWithMedia` nested external — quote-post references (`embed.record.uri`) are excluded.

### Why
When a story goes viral, 15+ posts sharing the same link flood the feed. Each is by a different author (source diversity = 1.0), all match the same topic, and engagement is high. The feed becomes a wall of the same story repeated. This dedup step preserves the top post + posts with original analysis while penalizing low-effort reshares.

### Measurements
16 new tests (10 dedup, 6 embed extraction), 395 total tests passing across 65 files. Build clean.

### Decisions & alternatives
- Decay multipliers [1.0, 0.7, 0.5, 0.3] chosen as moderate — aggressive enough to push 4th+ reshares down, gentle enough to keep 2nd/3rd visible if they have good scores.
- 200-char text threshold for "original commentary" bypass — short enough to catch most quote-tweet analysis, long enough to exclude "wow big news" reactions.
- Dedup applied in `writeToRedisFromDb` (post-scoring) rather than at ingestion or in scoring components — keeps scoring pure and makes the feature easy to disable via `FEED_DEDUP_ENABLED`.
- Re-sort after dedup is necessary because a high-scored duplicate can drop below a lower-scored unique post.

### Open questions
- Decay multipliers and text threshold could be added to the governance parameter registry for community tuning.
- Old posts without `embed_url` (ingested before migration) pass through unpenalized — they age out naturally within 72 hours.

## 2026-03-09 #04 — Fix classification_method tracking (always showed 'keyword')
**Branch:** `dev/classification-method-tracking`
**Commits:** `c54f809`, `32d0b80`, `1f6f722`, `71643c6`, `4b9b507`
**Files changed:** `src/db/migrations/020_posts_classification_method.sql`, `src/ingestion/handlers/post-handler.ts`, `src/scoring/score.types.ts`, `src/scoring/pipeline.ts`, `tests/scoring-pipeline-embeddings.test.ts`, `tests/post-handler-classification-method.test.ts`, `tests/helpers/fixtures.ts`

### What changed
Added `classification_method` column to the `posts` table so ingestion records whether a post was classified by keyword (winkNLP) or embedding (Transformers.js). The scoring pipeline now reads this value from the post row instead of hardcoding `'keyword'`. Added migration, updated post-handler INSERT to pass the method as $12, updated all 3 SELECT queries in pipeline.ts, and ran a backfill on 65,465 existing posts with embedding-style topic vectors.

### Why
The `classification_method` column in `post_scores` always showed `'keyword'` because `pipeline.ts` line 503 hardcoded `const classificationMethod: 'keyword' | 'embedding' = 'keyword'`. The embedder was running and producing cosine-similarity topic vectors (~20% of posts), but this was invisible in the data. The sprint report showed "0% Embedding Classified" despite the model being loaded and active.

### Measurements
402 tests passing across 66 files (+7 new tests). After deploy: 19.1% of newly ingested posts correctly show `classification_method = 'embedding'`. Backfill updated 65,465 historical posts. post_scores now shows both 'keyword' (99.8%) and 'embedding' (0.2%) — the low embedding % in scores is because incremental scoring only processes recent posts; the ratio will converge as more posts are scored.

### Decisions & alternatives
- Backfill heuristic: keyword vectors produce exactly 0.2 and 1.0 values, embedding vectors produce cosine similarity values (0.35-0.99). Used regex on `topic_vector::text` matching `0.[3-9]` to identify embedding-classified posts. Verified with sample queries.
- Added column with `DEFAULT 'keyword'` so existing posts get a safe default without a data rewrite.
- Migration ran via `docker exec psql` instead of `npm run migrate` because `tsx` is a dev dependency not on the VPS PATH.

### Open questions
- The backfill only catches posts with non-standard values (0.35-0.99). Posts where the embedding agreed with keyword results (producing similar 0.2/1.0 values) remain marked as keyword. This is a minor inaccuracy affecting a small number of posts.

## 2026-03-11 #01 — Persistent Report Generation Script
**Branch:** `dev/report-script`
**Commits:** `2b92a83`, `71e26f5`
**Files changed:** `scripts/generate-report.py`, `ops/README.md`

### What changed
Added `scripts/generate-report.py` — a reusable Python script that SSHs to the VPS, pulls scoring data (top 1000 posts, active epoch weights, system stats) in a single call, and generates a 6-page .docx report with matplotlib charts and styled tables. Supports `--dry-run`, `--csv` for offline mode, `--date` for custom labels, and `--output` for custom paths. Added usage docs to `ops/README.md` and a context line to `CLAUDE.md`.

### Why
The feed data analysis report had been generated twice before, each time by writing a throwaway Python script in `/tmp/`. Each session reinvented the format, producing inconsistent charts, tables, and styling. This permanent script ensures every future report uses identical structure and presentation.

### Measurements
Dry-run verified VPS connectivity and data extraction (1000 posts, 910 unique authors, epoch 2). Full report generated successfully at 141 KB. No test changes (Python script, not part of TypeScript test suite).

### Decisions & alternatives
- Python over TypeScript: python-docx + matplotlib + pandas are purpose-built for document generation with charts. All three were already installed (Python 3.12).
- Three queries in one SSH call: Posts via `COPY TO STDOUT WITH CSV HEADER`, epoch and stats via `row_to_json()`, separated by `---REPORT-MARKER---` markers. Minimizes SSH round-trips.
- Used `tick_labels` instead of deprecated `labels` parameter in matplotlib 3.9+ boxplot.

### Open questions
- None. Script is tested and working.

## 2026-03-11 #02 — MCP Report Generation & Feed Snapshot Tools
**Branch:** `dev/mcp-report-tool`
**Commits:** `33af231`
**Files changed:** `src/mcp/tools/report.ts`, `src/mcp/tools/index.ts`, `tests/mcp-server.test.ts`

### What changed
Added two MCP tools: `generate_feed_report` wraps `scripts/generate-report.py` via `execFile` with 120s timeout, exposing report generation to any MCP client. `get_feed_snapshot` combines `/api/admin/status` and `/api/admin/feed-health` into a single JSON response for quick metric checks without generating a full docx.

### Why
The report script was created in the previous entry but could only be triggered from the command line. MCP tools let Claude Code, the CLI, and the admin dashboard trigger report generation with natural language.

### Measurements
402 tests pass across 66 files. MCP tool count: 28 to 30. TypeScript compiles clean. Pre-commit hook passes.

### Decisions & alternatives
- `generate_feed_report` uses `execFile` (first usage in the codebase) because there's no admin route wrapping the Python script. All other MCP tools delegate via `app.inject()`.
- Script path resolved via `fileURLToPath(import.meta.url)` for ESM compatibility.
- `get_feed_snapshot` merges two inject responses into a single JSON object rather than requiring two separate tool calls.

### Open questions
- None.

## 2026-03-13 #01 — Fix: Feed Down — CORS async + did:plc + concurrency tuning
**Branch:** `dev/fix-cors-hang`
**Commits:** (pending)
**Files changed:** `src/feed/server.ts`, `src/config.ts`, VPS `.env`

### What changed
Fixed three-layer production outage: (1) `@fastify/cors` v11 CORS origin function was synchronous — v11 requires async or callback-style functions, sync return values are silently ignored causing all HTTP requests to hang indefinitely. Added `async` keyword. (2) Changed `FEEDGEN_SERVICE_DID` from `did:web:feed.corgi.network` to `did:plc:amzyknmm4auxijvykyfgznw2` per Critical Rule #6 — `did:web` requires server reachability for resolution, `did:plc` resolves via PLC directory independently. (3) Reduced `JETSTREAM_MAX_CONCURRENT` default from 50 to 20 to leave DB pool headroom for HTTP handlers.

### Why
Bluesky app showed "could not resolve identity: did:web:feed.corgi.network" — the server accepted TCP connections but never sent HTTP responses. Root cause: `@fastify/cors@11.2.0` changed the origin function contract from v10. Functions with fewer than 2 arguments are no longer treated as sync-return; the plugin waits for a callback that never arrives. The `did:web` dependency on server availability made the CORS hang fatal to feed resolution.

### Measurements
- Before fix: 0% HTTP response rate (TCP connect, zero bytes returned, 100% timeout)
- After fix: all endpoints respond (<50ms for health, <200ms for feed skeleton)
- Scoring pipeline: 15.2s for 2500 posts (normal)
- Jetstream catch-up: reconnect-on-saturation cycling (expected after downtime, self-healing)

### Decisions & alternatives
- **CORS fix**: `async (origin) => ...` chosen over callback-style `(origin, cb) => cb(null, ...)` for readability. Both work with @fastify/cors v11. Could also pin @fastify/cors to v10, but upgrading the call convention is the correct forward-compatible fix.
- **did:plc over did:web**: One-way door decision per Critical Rule #6. `did:plc` resolves via PLC directory without hitting our server, eliminating a circular dependency (server must be up for Bluesky to verify server identity).
- **JETSTREAM_MAX_CONCURRENT 20 vs 50**: 20 leaves 30 DB pool connections for HTTP handlers. With 50 concurrent ingestion handlers matching a 50-connection pool, HTTP requests could starve during high firehose throughput.
- **Diagnostic approach**: Progressive binary search isolated the hanging plugin from 10+ route groups and 6 plugins. Testing matrix: static values pass, sync functions hang, async functions pass, callback functions pass. Root cause confirmed in <30 minutes of targeted testing.

### Open questions
- Pre-existing `ajv` dependency issue causes 25 test file failures (missing `json-schema-draft-07.json` in ajv@8.18.0). Unrelated to this fix, needs separate investigation.
- Feed record may need re-publishing with `npm run publish-feed` if Bluesky still caches old `did:web` reference.

## 2026-03-13 #02 — Production Reliability: Systemd Watchdog & Self-Healing
**Branch:** `dev/production-reliability`
**Commits:** `1d5721d`
**PR:** #25
**Files changed:** ops/bluesky-feed.service, src/lib/watchdog.ts, src/index.ts, src/lib/shutdown.ts, ops/health-watchdog, ops/health-watchdog.service, ops/health-watchdog.timer, ops/setup-monitoring.sh, ops/install.sh, .github/workflows/deploy.yml, .github/workflows/daily-health.yml, package.json, package-lock.json, tests/watchdog.test.ts

### What changed
Added systemd watchdog integration so the VPS auto-detects and auto-recovers from silent failures (like the recent CORS hang where the process was alive but not serving HTTP). The Node app sends sd_notify heartbeats every 30s, gated on `isReady()` (DB + Redis healthy). If health checks fail for >60s, systemd kills and restarts the process. Also added post-deploy health verification with automatic rollback, daily health alerting (GitHub Issues + healthchecks.io), external health-watchdog timer, and cgroup memory limits.

### Why
The feed was down for days because the Node process was running but not responding to HTTP — systemd reported "active (running)" the whole time. The existing health probes (`/health/ready`) were never checked by anything automated. This closes every gap: in-process watchdog catches unhealthy state, external timer catches unresponsive process, deploy workflow catches bad deploys, and daily workflow alerts on sustained failures.

### Measurements
- Build: clean, no TypeScript errors
- Tests: 64 passed, 3 failed (pre-existing @atproto/xrpc-server express module issue)
- ajv override fixed 22 of 25 previously broken test files
- Watchdog interval: 30s (half of WatchdogSec=60, per systemd docs)
- Health-watchdog timer: 5-min interval with 3 retries before restart

### Decisions & alternatives
- **execFile over node:dgram**: Originally tried `createSocket('unix_dgram')` for sd_notify but TypeScript types don't include `unix_dgram` as a valid SocketType. Switched to `execFile('systemd-notify', ['WATCHDOG=1'])` — simpler, type-safe, no npm deps, hardcoded args prevent shell injection.
- **Belt-and-suspenders**: In-process watchdog + external bash timer. The in-process watchdog catches DB/Redis failures; the external timer catches cases where the process is responsive but `/health/ready` returns 503 (or the watchdog itself is broken).
- **Deploy rollback strategy**: Saves `PREV_COMMIT` SHA before deploy, rolls back via `git checkout $PREV_COMMIT` + rebuild + restart. Simple and reliable vs. blue-green or canary.
- **ajv@8.17.1 pin via overrides**: Chose npm overrides over `resolutions` (yarn) or patching. Fixes the `@fastify/ajv-compiler@4.0.5` incompatibility with `ajv@8.18.0` that removed `json-schema-draft-07.json`.

### Open questions
- 3 remaining test failures (`config-defaults-security`, `feed-skeleton-validation`, `rate-limit-config`) are a different pre-existing issue — `Cannot find module './lib/express'` from `@atproto/xrpc-server`. Needs separate investigation.
- Systemd units need manual installation on VPS via `ops/install.sh` after merge.
- UptimeRobot and Healthchecks.io accounts need manual setup (see `ops/setup-monitoring.sh`).
- `HEALTHCHECK_PING_URL` GitHub secret needs to be configured for deploy/daily-health alerting.

## 2026-07-05 #01 — web-next parity wiring and verification

**Branch:** `dev/PROJ-1557-finish-web-next-parity-wiring`
**Base:** `origin/main` at `f2310a036cb668a9e7419ee8419a2cbe44dc9920`
**Worktree:** clean linked worktree under `.worktrees/corgi-web-next-parity`
**Commits:** (pending)
**Files changed:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `package.json`, `web-next/.eslintrc.json`, `web-next/app/dashboard/page.tsx`, `web-next/app/privacy/error.tsx`, `web-next/app/privacy/page.tsx`, `web-next/app/sign-in/page.tsx`, `web-next/app/tos/error.tsx`, `web-next/app/tos/page.tsx`, `web-next/components/animated-section.tsx`, `web-next/components/app-shell.tsx`, `web-next/components/changelog-section.tsx`, `web-next/components/cta-section.tsx`, `web-next/components/footer-section.tsx`, `web-next/components/get-started-section.tsx`, `web-next/components/hero-section.tsx`, `web-next/components/sign-in-dialog.tsx`, `web-next/components/social-proof.tsx`, `web-next/components/ui/score-radar.tsx`, `web-next/lib/legal-docs.tsx`, `web-next/next.config.mjs`, `web-next/package.json`, `web-next/package-lock.json`

### What changed

Finished the web-next parity pass against the old Vite `web/` route surface without touching the dirty legacy `web/` worktree. Wired sign-in legal links to `/tos` and `/privacy`, replaced the `/sign-in` preview with a production auth route, moved `/tos` and `/privacy` to canonical repo legal Markdown via `web-next/lib/legal-docs.tsx`, replaced stale placeholder/GitHub/footer links, and added CI coverage for `web-next` install, lint, build, axios pin validation, and moderate audit.

Hardened `web-next` build gates by removing `ignoreDuringBuilds` and `ignoreBuildErrors` from `next.config.mjs`, switching lint to ESLint CLI, fixing strict TypeScript issues in `animated-section` and `score-radar`, and adding a PostCSS override so `web-next npm audit --audit-level=moderate` returns 0 vulnerabilities. Fixed a browser-found dashboard hydration bug: `/dashboard` rendered `new Date()` during static hydration and produced React #418; it now renders a stable placeholder and sets the timestamp after mount.

CodeRabbit follow-up fixed valid review issues: legal URL/email href parsing now strips trailing `.`, `,`, and `;` while preserving punctuation in rendered text; legal document parsing is cached per render pass; `/sign-in` keeps the auth dialog closed while session state is loading; footer internal routes use `next/link`; and deploy now runs `web-next` lint, build, and moderate audit before restart so a web-next lint/audit failure cannot ship.

### Why

The old Vite site exposed legal, consent, vote, dashboard, history, post explanation, demo, and admin surfaces. The new `web-next` site had matching route files, but legal/sign-in links and CI coverage were incomplete, and legal copy was duplicated. The target release needs route/function parity, canonical legal source of truth, and build/audit gates before approval.

### Measurements

- Static route matrix: old `web/src/App.tsx` has 11 wired routes; `web-next/app` now verifies 11 matching routes: `/`, `/tos`, `/privacy`, `/sign-in`, `/research-consent`, `/vote`, `/dashboard`, `/history`, `/demo`, `/post`, `/admin`.
- Source scans: `rg 'href="#"|github.com/corgi-feed|ignoreDuringBuilds|ignoreBuildErrors' web-next .github package.json` returned 0 matches.
- `npm run verify`: pass. Backend `tsc` passed; Vitest passed 86 test files / 681 tests; CLI build passed; `build:mcp-local` skipped because `src/mcp-local` is not present; SDK build and fixture passed; legacy `web` lint/build passed with only the existing Vite chunk-size warning; `web-next` lint/build passed.
- `cd web-next && npm run lint`: pass.
- `cd web-next && npm run build`: pass; Next 15.5.18 generated 16 static pages including `/`, `/admin`, `/dashboard`, `/demo`, `/history`, `/post`, `/privacy`, `/research-consent`, `/sign-in`, `/tos`, and `/vote`.
- `cd web-next && npm audit --audit-level=moderate`: pass, 0 vulnerabilities.
- Live backend API smoke (`https://feed.corgi.network`): `/health` 200 bytes=15, `/health/live` 200 bytes=17, `/api/legal/tos` 200 bytes=16048, `/api/legal/privacy` 200 bytes=14387, `/api/transparency/stats` 200 bytes=426, `/api/transparency/audit?limit=3` 200 bytes=596, `/api/governance/epochs/current` 200 bytes=593, `/api/governance/topics` 200 bytes=4443, `/api/governance/content-rules` 200 bytes=258, `/api/governance/auth/session` 401 bytes=63 (expected unauthenticated state).
- Legal digest check: TOS local Markdown digest `7438c52bf6e1` matched live API digest `7438c52bf6e1`; privacy local Markdown digest `d815d6c8ac6d` matched live API digest `d815d6c8ac6d`.
- Browser route QA: Playwright Chromium against `http://127.0.0.1:4175` same-origin static/proxy harness passed 22/22 route checks (11 routes x desktop/mobile) and 4/4 interaction checks. Assertions covered HTTP status, nonblank body text, expected page identity text, 0 `href="#"` links, no framework overlay, no relevant console errors, and no page errors. Expected 401s from unauthenticated session checks were recorded and ignored as auth-gate behavior.
- Interaction QA: `/sign-in` opened the auth dialog and legal links rendered as `/tos/` and `/privacy/`; `/research-consent` unauthenticated Connect Bluesky opened the auth dialog and privacy link rendered as `/privacy/`; `/vote` unauthenticated Submit weight vote opened the auth dialog; `/admin` unauthenticated Connect Bluesky opened the auth dialog.
- CodeRabbit CLI `0.6.4` uncommitted review completed with 9 issues: 1 major, 2 minor, 6 trivial. Fixed the valid major deploy-gate issue, both minor issues, and the low-risk trivial cache/name/link issues. Skipped the requested dashboard unit test because `web-next` has no local test harness and browser E2E covers the hydration behavior; skipped the CI matrix refactor because the duplicated job is intentional minimal-diff coverage for this pass.
- Post-CodeRabbit browser recheck: 22/22 route checks passed, 4/4 interaction checks passed, and 2/2 legal-link hygiene checks passed. Machine-readable result: `/tmp/corgi-web-next-qa/browser-results-after-coderabbit.json`.
- Screenshot artifacts: `/tmp/corgi-web-next-qa/home-desktop.png`, `/tmp/corgi-web-next-qa/tos-desktop.png`, `/tmp/corgi-web-next-qa/privacy-desktop.png`, `/tmp/corgi-web-next-qa/sign-in-desktop.png`, `/tmp/corgi-web-next-qa/research-consent-desktop.png`, `/tmp/corgi-web-next-qa/vote-desktop.png`, `/tmp/corgi-web-next-qa/dashboard-desktop.png`, `/tmp/corgi-web-next-qa/home-mobile.png`, `/tmp/corgi-web-next-qa/sign-in-mobile.png`, `/tmp/corgi-web-next-qa/vote-mobile.png`, `/tmp/corgi-web-next-qa/dashboard-mobile.png`. Machine-readable result: `/tmp/corgi-web-next-qa/browser-results.json`.
- Production Chrome plugin check (`https://feed.corgi.network/`, personal Chrome profile, 2026-07-05): production is older than this branch. The live home page still exposes placeholder/stale anchors, including `Connect`, `Full changelog`, `GitHub`, `Score breakdown`, `Epoch history`, `Voting guide`, `Audit log`, `Propose a rule`, `Documentation`, `Data exports`, and `Privacy policy` with `href="#"`, plus stale `github.com/corgi-feed/corgi` links. The live sign-in dialog legal links still render `Terms of Service` and `Privacy Policy` as `href="#"`; this branch changes them to `/tos` and `/privacy`.
- Production Chrome auth-gate check: clicking live `Sign in` opened the auth dialog with 2 empty inputs (`Bluesky handle`, `App password`) and 3 dialog buttons (`show`, disabled `Sign in`, `Close`). Chrome saved credentials did not autofill into the dialog, so no authenticated mutation flow was executed and no raw credentials were inspected or logged.
- Production Chrome console check: live home emitted 2 matching Radix dialog accessibility warnings: `Missing Description or aria-describedby={undefined} for {DialogContent}`. No claim is made that this branch fixes that warning; it is recorded as a production observation for follow-up.
- Production Chrome authenticated check after manual user sign-in: same browser tab showed authenticated nav on `/dashboard`, `/history`, `/demo`, `/post`, `/tos`, and `/privacy` (`Sign out` present, handle redacted in notes). Read-only interactions passed 2/2: `/demo` `Next` advanced to Step 2 of 5, and `/history` first `Show details` control changed to `Hide details`.
- Production Chrome authenticated parity failures: after auth was visibly active, `/vote`, `/research-consent`, and `/admin` rendered only the app shell/nav (`bodyChars=59`, `Sign out` present, no `h1`, no ballot/consent/admin body). `/sign-in` still rendered the sign-in form while authenticated, with 2 empty inputs, disabled `Sign in`, and legal links still `href="#"`. These are live-production bundle failures; they are not evidence against the pending local branch until the branch is deployed.
- Chrome direct API navigation limitation: opening `https://feed.corgi.network/api/governance/auth/session` in a Chrome-controlled tab returned `net::ERR_BLOCKED_BY_CLIENT`, so authenticated API status was not measured through direct browser URL navigation. The authenticated state above is based on route UI state, not a raw session endpoint body.
- Local authenticated branch simulation (`http://127.0.0.1:4187`, temporary static server with mocked same-origin API responses, headless system Chrome): 4/4 route assertions passed. `/vote` rendered `Community ballot`, `Submit weight vote`, 5 enabled range inputs, 0 placeholder links, and 0 console warnings/errors. `/research-consent` rendered `Research participation`, `I agree to participate`, `No thanks, decline`, a `/privacy/` policy link, 0 placeholder links, and 0 console warnings/errors. `/admin` rendered signed-in non-admin `Access denied`, 0 placeholder links, and 0 console warnings/errors. `/sign-in` redirected authenticated users to `/vote` and rendered the ballot, 0 console warnings/errors.
- Final land-track CodeRabbit CLI review completed with 6 issues: 1 critical, 3 minor, 2 trivial. Fixed all valid items: malformed pipe-prefixed legal Markdown can no longer stall `renderBlocks`; `/sign-in` suppresses the shell-owned sign-in dialog to avoid duplicate dialog roots; legal routes have scoped error fallbacks; the journal worktree path is repo-relative; `AnimatedSection` merges caller transitions without losing its delay; deploy uses the allowlist-aware audit gate for `web-next`.
- CodeRabbit recheck after those fixes completed with 7 issues: 1 major, 1 minor, 5 trivial. Fixed the valid major by switching `web-next` CI/deploy audit to `scripts/audit-allowlist.mjs --audit-level=moderate`; fixed the valid minor by making duplicate legal section IDs fail deterministically. Deferred trivial refactors for axios-pin script dedupe, legal error fallback dedupe, `outputFileTracingRoot`, and `next` redirect support because they are not release blockers for parity.
- Later CodeRabbit rechecks found valid release-blocking deploy rollback gaps and valid lint/footer/journal polish. Fixed them: rollback snapshots existing `web/dist` and `web-next/out` artifacts before deploy, restores those artifacts instead of rebuilding frontends in-place during rollback, keeps `main` checked out by hard-resetting it to the previous commit, makes rollback rebuild steps best-effort so they cannot block the rollback restart attempt, rolls back and retries restart when the service restart command fails, returns to `/opt/bluesky-feed` before touching `.env` or checkout state, makes `web-next` ESLint extend `next/core-web-vitals` and scan JS/JSX/TS/TSX files explicitly, spaces journal headings for markdownlint, and routes footer governance links to distinct surfaces.
- Final post-fix CodeRabbit confirmation was unavailable because the CLI returned recoverable org-attributed rate-limit errors after the rollback/lint fixes. Observed wait times while retrying were 6 minutes, 2 minutes, 14 seconds, 5 minutes, 32 seconds, and 9 minutes. No final clean CodeRabbit verdict is claimed; all known major/minor findings from completed reviews were addressed before commit-track gates.
- Post-final-review local gates: whitespace diff check passed; root docs verification passed; deploy workflow YAML parsed and the embedded SSH script passed shell syntax validation; web-next lint passed with `@next/next/*` rules present in the effective config; web-next build passed without the previous ESLint invalid-options warning and generated 16 static routes; web-next allowlist audit passed with 0 non-allowlisted vulnerabilities at moderate or higher; root verification passed with 86 test files / 681 tests and `web-next` static export still generating 16 routes.
- PR #300 CodeRabbit review completed after an explicit `@coderabbitai review` command. Status changed from pending to success, and the review requested 4 actionable fixes: one deploy rollback dedupe, one footer-label mismatch, and two duplicate legal-parser test-coverage requests. Fixed the valid items by extracting `fail_and_rollback`, renaming `/vote` to `Community ballot`, renaming `/dashboard` to `Transparency dashboard`, adding `web-next/lib/legal-docs.test.tsx`, adding `web-next` Vitest wiring, and enforcing `npm test` in `web-next-verify`.
- Focused parser regression test result: `cd web-next && npm test -- lib/legal-docs.test.tsx` passed 1 test file / 9 tests. Covered title and Last Updated parsing, preface and section IDs, unordered/ordered lists, bold/code/email links, URL trailing punctuation, table followed immediately by paragraph text, list followed immediately by paragraph text, duplicate `##` IDs, different headings that normalize to duplicate IDs, missing H1, missing Last Updated metadata, and headings that normalize to empty IDs.
- Post-CodeRabbit-fix web-next gates: `cd web-next && npm run lint` passed; `cd web-next && npm test` passed 1 file / 9 tests; `cd web-next && node ../scripts/audit-allowlist.mjs --audit-level=moderate` passed with 0 non-allowlisted vulnerabilities at moderate or higher; `cd web-next && npm run build` passed and generated 16 static routes.
- Post-CodeRabbit-fix full gate: `npm run verify` passed. Backend `tsc` passed; root Vitest passed 86 test files / 681 tests; CLI build passed; `build:mcp-local` skipped because `src/mcp-local` is not present; SDK build and fixture passed; legacy `web` lint/build passed with the existing Vite chunk-size warning; `web-next` lint passed; `web-next` Vitest passed 1 test file / 9 tests; `web-next` build generated 16 static routes.
- Local uncommitted CodeRabbit recheck after PR-review fixes completed with 1 trivial finding and no higher-severity findings. Fixed the valid trivial by adding the missing list/paragraph boundary parser test.
- Second local uncommitted CodeRabbit recheck completed with 1 trivial finding and no higher-severity findings. Fixed the valid trivial by making the root `verify` and `web-next-verify` CI commands call `npm test -- --run` explicitly, even though the `web-next` test script already invokes `vitest run`.
- Third local uncommitted CodeRabbit recheck completed with 2 trivial findings and no higher-severity findings. Fixed both valid trivial items by scoping the deploy helper argument as `local` and adding a parser test for headings that normalize to the same duplicate section ID.
- PR #300 snapshot after head `47b438debe92dd929bd08d73e793cebbc14aa7dc`: regular CI checks were green (`docs-verify`, `backend-verify`, `frontend-verify`, `web-next-verify`, `report-scripts-verify`, CodeQL, quality/security/secret/linear gates), CodeRabbit status was success, `coderabbit-freshness` was green, and `reviewDecision` remained `CHANGES_REQUESTED` because `coderabbit-thread-check` still failed on review comments from the latest CodeRabbit pass.
- Follow-up PR-review fixes kept to parity/release hardening scope: early deploy exits now clean rollback artifacts and temporary `.env` backup files; legal error fallbacks share one client component with digest-aware console reporting; Recharts custom dots accept nullable `cx`/`cy`; legal URL/email href parsing strips trailing `!` and `?` while preserving punctuation in rendered text; and the external changelog link now opens with `target="_blank"` plus `rel="noopener noreferrer"`.
- Post-follow-up local gates: root whitespace diff check passed; web-next lint passed; web-next Vitest passed 1 file / 9 tests; deploy workflow YAML extraction plus shell syntax validation passed; root docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next production build passed and generated 16 static routes; sandboxed web-next npm audit failed with registry DNS `ENOTFOUND`, then the same audit passed with live registry access and 0 vulnerabilities; full root verification passed with 86 test files / 681 tests, legacy `web` lint/build, `web-next` lint, `web-next` 1 file / 9 tests, and `web-next` 16 static routes.
- Local uncommitted CodeRabbit recheck completed with 2 issues: 1 minor and 1 trivial. Fixed both valid items by keeping legal error reporting on `console.error` only while including the optional digest for correlation, adding a regression test that `globalThis.reportError` is not invoked, and extending the legal linkification test to cover multiple trailing punctuation marks.
- Post-CodeRabbit-fix local gates: root whitespace diff check passed; root docs verification passed with 14 tracked docs and 26 markdown files scanned; deploy workflow shell syntax validation passed; web-next lint passed; web-next Vitest passed 2 files / 10 tests; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities; full root verification passed with 86 test files / 681 tests, legacy `web` lint/build, `web-next` lint, `web-next` 2 files / 10 tests, and `web-next` 16 static routes.
- Final local uncommitted CodeRabbit recheck completed with 4 issues: 1 major and 3 trivial. The major was not applied because repo search found no existing `web-next` client monitoring provider, and `legal/PRIVACY_POLICY.md` states the service does not use Sentry or similar third-party analytics services; adding a new telemetry path is outside parity scope. Fixed valid trivial items by clearing the deploy `ERR` trap in `exit_before_restart` and adding a bare-question-mark URL linkification regression. Deferred the component-level click/effect test request because `web-next` currently has no DOM test harness dependency, while the helper-level digest/reportError behavior is covered by Vitest.
- Second final local uncommitted CodeRabbit recheck completed with 3 issues: 1 major and 2 trivial. Fixed the valid major by making `exit_before_restart` call the existing rollback checkout path before cleanup/exit, so early manual failures also reset to `PREV_COMMIT`; fixed the valid prop-shape trivial by exporting and reusing the legal error route props; added the digest-less legal error reporter assertion. Deferred the remaining component click/effect test request because `web-next` still has no DOM test harness dependency and adding one is outside this parity land pass.
- Third final local uncommitted CodeRabbit recheck completed with 4 issues: 1 minor and 3 trivial, with 0 major findings. Fixed the valid minor by making `GingerDot` return `null` when Recharts omits either coordinate and adding direct renderer coverage for missing/present coordinates; fixed the valid deploy cleanup trivial by running `cleanup_env_backup` in the `rollback_before_restart` trap path too; removed unnecessary `globalThis.reportError` mocking from the legal error reporter test. Deferred the remaining render/click component test request because `web-next` still has no DOM test harness dependency.
- Fourth final local uncommitted CodeRabbit recheck completed with 6 trivial findings and 0 minor/major/critical findings. Fixed valid behavior/safety items by deduping legal error logging per error instance, focusing the legal error region for keyboard/screen-reader users, and making `exit_before_restart` log and `cd /opt/bluesky-feed` before rollback. Deferred duplicate rollback-helper refactoring as too broad for this pass, deferred render/click component tests because no DOM harness dependency exists, and kept `?`/`!` URL punctuation stripping because it was an explicit PR-review parity request already covered by parser tests.
- Final pre-push local gates after the fourth CodeRabbit pass: root whitespace diff check passed; root docs verification passed with 14 tracked docs and 26 markdown files scanned; deploy workflow shell syntax validation passed; web-next lint passed; web-next Vitest passed 3 files / 13 tests; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities; full root verification passed with 86 test files / 681 tests, legacy `web` lint/build, `web-next` lint, `web-next` 3 files / 13 tests, and `web-next` 16 static routes.
- PR CodeRabbit on pushed head `e422ec4c764abb42002ae5b3ebf71b5a2b6f7a3f` recovered after a manual `@coderabbitai review`: CodeRabbit status succeeded and latest freshness passed, but `coderabbit-thread-check` still found 6 unresolved threads. Fixed the valid new minor by arming `rollback_before_restart` before rollback snapshot `cp -a` operations and adding a defensive `trap - ERR` at the start of `fail_and_rollback`.
- Post-remote-CodeRabbit-fix local gates: root whitespace diff check passed; root docs verification passed with 14 tracked docs and 26 markdown files scanned; deploy workflow shell syntax validation passed; web-next lint passed; web-next Vitest passed 3 files / 13 tests; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities after one approval-timeout retry; full root verification passed with 86 test files / 681 tests, legacy `web` lint/build, `web-next` lint, `web-next` 3 files / 13 tests, and `web-next` 16 static routes.
- PR CodeRabbit on pushed head `a082e00a7f4073a0afb9336fe3bc8713ce148c91` left 6 non-outdated unresolved review threads. Fixed the two remaining behavioral findings before resolving thread state: deploy rollback now refuses to install, build, or restart when `git checkout main` or `git reset --hard "$PREV_COMMIT"` fails, and legal inline parsing now recursively linkifies URLs/emails/code inside bold text instead of rendering them inert.
- Focused post-review-fix gates: root whitespace diff check passed; deploy workflow shell syntax validation passed; targeted parser test `cd web-next && npm test -- --run lib/legal-docs.test.tsx` passed 1 file / 10 tests; full web-next Vitest passed 3 files / 14 tests. New parser coverage asserts bold text containing `legal@example.com`, `https://example.com/docs`, and `` `receipt-id` `` renders nested mailto, URL, and code elements.
- Final local gates after the remote-review behavioral fixes: docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities at moderate or higher; root `npm run verify` passed with 86 test files / 681 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 14 tests, and web-next 16 static routes.
- Final CodeRabbit uncommitted recheck completed with 1 issue: 1 major deploy rollback nuance. Fixed it by making `rollback_checkout` return distinct statuses: `2` only for git checkout/reset failure, which blocks restart on unknown code; `1` for rollback-preparation warnings such as frontend artifact restore failure, which still allows a restart after the git rollback succeeded. Added executable workflow coverage for all three paths. Focused gate results: `./node_modules/.bin/vitest run tests/deploy-rollback-workflow.test.ts` passed 1 file / 3 tests; deploy workflow shell syntax validation passed; root whitespace diff check passed.
- Final full local gates after the distinct rollback-status fix: docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next Vitest passed 3 files / 14 tests; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities at moderate or higher; root `npm run verify` passed with 87 test files / 684 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 14 tests, and web-next 16 static routes.
- Follow-up CodeRabbit uncommitted recheck completed with 4 issues: 1 major and 3 trivial. Fixed the valid major by adding a 10-second timeout and explicit timeout/error handling to the rollback subprocess harness. Fixed valid cleanup/coverage items by deleting each temp rollback harness directory, adding a checkout-failure short-circuit case where checkout exits 99 and reset would also fail, and extending legal parser coverage for nested-bold `?`/`!` trailing punctuation plus malformed bold markers. The malformed-bold test exposed a real parser edge case, so `INLINE_TOKEN_PATTERN` now requires bold delimiters not to be adjacent to another `*`. Focused gates: deploy rollback workflow passed 1 file / 4 tests; legal parser passed 1 file / 11 tests; web-next Vitest passed 3 files / 15 tests.
- Post-follow-up local gates: root whitespace diff check passed; docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities at moderate or higher; root `npm run verify` passed with 87 test files / 685 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 15 tests, and web-next 16 static routes.
- Final CodeRabbit uncommitted recheck completed with 8 issues: 2 minor and 6 trivial, with 0 major/critical findings. Fixed the valid deploy minor by preserving rollback artifacts on fail-closed git rollback and writing `MANUAL_RECOVERY_REQUIRED.txt` into the rollback artifact directory with reason, previous commit, and UTC timestamp. Fixed the valid rollback-test minor by making the `/opt/bluesky-feed` rewrite fail fast if the expected command disappears. Added clean rollback restart coverage, expanded rollback marker assertions, and expanded legal parser boundary coverage for valid intraword bold, adjacent bold markers, and odd triple-asterisk markers. Focused gates: deploy rollback workflow passed 1 file / 6 tests; legal parser passed 1 file / 13 tests; deploy workflow shell syntax validation passed; root whitespace diff check passed; web-next Vitest passed 3 files / 17 tests.
- Post-final-review-fix local gates: docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities at moderate or higher; root `npm run verify` passed with 87 test files / 687 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 17 tests, and web-next 16 static routes.
- Final follow-up CodeRabbit uncommitted recheck completed with 5 issues: 1 major and 4 trivial. Fixed the valid major by making `exit_before_restart` and `rollback_before_restart` preserve rollback artifacts when `rollback_checkout` returns the fail-closed git status `2`, matching the restart/health rollback path. Added harness coverage for both pre-restart rollback entrypoints. Also made deploy-shell extraction step-name-agnostic, deduped missing-file reads in the rollback harness, and added legal parser coverage for bold-like text containing an inline-code asterisk. Focused gates: deploy rollback workflow passed 1 file / 8 tests; legal parser passed 1 file / 14 tests; deploy workflow shell syntax validation passed; root whitespace diff check passed; web-next Vitest passed 3 files / 18 tests.
- Post-pre-restart-rollback-fix local gates: docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next production build passed and generated 16 static routes; web-next npm audit passed with 0 vulnerabilities at moderate or higher; root `npm run verify` passed with 87 test files / 689 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 18 tests, and web-next 16 static routes.
- Final CodeRabbit uncommitted recheck after pre-restart rollback fixes completed with 3 issues: 1 minor and 2 trivial. Fixed the valid minor by quoting the `reason` field in `MANUAL_RECOVERY_REQUIRED.txt`, so recovery reasons with spaces remain parser-safe. Deferred the two trivial parser-matrix expansion requests because the embedded-asterisk fallback is already covered and broader markdown syntax expansion is outside parity land scope. Focused gates: deploy rollback workflow passed 1 file / 8 tests; deploy workflow shell syntax validation passed; root whitespace diff check passed.
- Final local CodeRabbit uncommitted recheck completed with 3 trivial-only findings and 0 minor/major/critical findings. Deferred the remaining duplicate rollback-helper refactor, npm-failure matrix expansion, and multi-line parser-boundary expansion because they are non-blocking coverage/refactor suggestions after the fail-closed rollback paths, recovery-marker behavior, and parser edge cases were covered by existing tests. Last full local gate before this note: `npm run verify` passed with 87 test files / 689 tests, legacy `web` lint/build, web-next lint, web-next 3 files / 18 tests, and web-next 16 static routes.
- PR #300 pushed head `b6753e3249ebc4cea519d3022227758aad4d2ca2` ran all regular GitHub checks green (`CodeQL`, `analyze`, `backend-verify`, `docs-verify`, `frontend-verify`, `web-next-verify`, `report-scripts-verify`, `quality-gate`, `security-gate`, `secret-scan`, `linear-policy`, `linear-state-sync`, `internal-tooling-hygiene`, `dependabot-automerge`, and `aikido-thread-check`), but merge remained blocked by CodeRabbit-specific gates: `CodeRabbit` failed with `Usage spending cap reached`, `coderabbit-freshness` failed because the status was pending at the synchronized head, and `coderabbit-thread-check` found unresolved CodeRabbit review threads.
- Live PR thread audit after that push counted 16 CodeRabbit review threads: 9 resolved, 2 outdated, and 5 unresolved. The unresolved threads were legal-parser coverage, sign-in branch coverage, legal error-boundary dedup coverage, and a duplicated `web-next-verify`/`frontend-verify` workflow refactor suggestion. Added focused `web-next` tests instead of broadening implementation scope: `app/sign-in/page.test.tsx` now covers loading, unauthenticated legal-link/trigger behavior, authenticated `/vote` redirect, and authenticated-plus-loading branch precedence; `components/legal-error-boundary.test.tsx` now covers digest-aware reporting, same-error dedup, different-error reporting, rendered heading/body text, focus, and reset forwarding.
- Focused follow-up test gates passed: `cd web-next && npm test -- --run app/sign-in/page.test.tsx` passed 1 file / 4 tests; `cd web-next && npm test -- --run components/legal-error-boundary.test.tsx` passed 1 file / 4 tests; full `cd web-next && npm test -- --run` passed 4 files / 24 tests. `git --no-pager diff --check` passed.
- Follow-up local CodeRabbit uncommitted review after adding sign-in and legal-boundary tests completed with 2 trivial issues and 0 minor/major/critical findings. Fixed the valid digest assertion request. Deferred the cleanup-path request because `LegalErrorBoundary`'s effect does not return cleanup logic, so adding that test would assert behavior that does not exist.
- Final local CodeRabbit uncommitted retry initially hit an org-attributed recoverable rate limit with wait time `2 minutes`; after waiting, the review completed with 2 trivial issues and 0 minor/major/critical findings. Deferred the hook-mock refactor request because the current no-DOM harness is scoped to this parity branch, and deferred the digest-identity dedupe request because the implementation intentionally deduplicates the same error instance used by React Strict Mode rather than changing runtime semantics to digest-keyed dedupe.
- Final post-test-coverage gates passed before commit update: docs verification passed with 14 tracked docs and 26 markdown files scanned; web-next lint passed; web-next Vitest passed 4 files / 24 tests; web-next production build passed and generated 16 static routes; web-next `npm audit --audit-level=moderate` passed with 0 vulnerabilities; deploy workflow shell syntax validation passed; root `npm run verify` passed with 87 test files / 689 tests, legacy `web` lint/build, web-next lint, web-next 4 files / 24 tests, and web-next 16 static routes.

### Decisions & alternatives

- Kept app-password auth. OAuth remains a separate migration because it requires client metadata, redirect handling, PKCE/DPoP/session plumbing, and ATProto browser/client package changes.
- Did not make legal pages call `/api/legal/*` at runtime. Because `web-next` is a static export and `LegalLayout` accepts React sections, pages now compile canonical repo Markdown from `legal/TERMS_OF_SERVICE.md` and `legal/PRIVACY_POLICY.md`. The live digest check proves those Markdown files match the deployed `/api/legal/*` content.
- Browser validation initially failed 0/22 when a local static server used `NEXT_PUBLIC_API_URL=https://feed.corgi.network`; the backend correctly does not allow CORS from `127.0.0.1`. Rebuilt with the default same-origin API base and used a local static/proxy QA harness on `127.0.0.1:4175`, which matches the intended same-origin production shape.
- Local parity browser validation used Playwright CLI for deterministic desktop/mobile static-export checks. A later Chrome plugin pass was used only for production verification with the user's personal Chrome profile; it found live production staleness and a credential-gated auth blocker, not a local branch regression.
- Authenticated branch checks used mocked same-origin API responses rather than real Bluesky credential mutation. The mock covered session=true, active voting epoch, topic catalog, content rules, no prior vote, null research-consent decision, and non-admin admin status. Submit buttons were verified as rendered/enabled, but no vote, consent, or admin mutation was clicked.

### Open questions

- Real production mutation E2E remains intentionally unexecuted. The user manually signed in through Chrome, but no vote, consent, or admin mutation was clicked because those actions require action-time approval and would change live account/server state.
- CI job is added locally but not yet proven in GitHub Actions until this branch is pushed and CI runs on the remote.
