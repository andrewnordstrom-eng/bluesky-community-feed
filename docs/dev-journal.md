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

## 2026-07-05 #01 — RecSys validation lab harness and evidence packet
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/harness/campaign.ts`, `src/harness/jetstream-replay.ts`, `src/harness/lab-artifacts.ts`, `scripts/sim-preflight.ts`, `scripts/sim-campaign.ts`, `scripts/jetstream-replay.ts`, `scripts/vote-load.ts`, `scripts/memory-isolated-stress.ts`, `scripts/http-load.ts`, `scripts/load-test.ts`, `tests/harness/campaign.test.ts`, `tests/stress/feed-skeleton.stress.ts`, `tests/stress/feed-skeleton-memory-child.ts`, `tests/stress/feed-skeleton-memory-server.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`, `artifacts/lab/README.md`, `artifacts/lab/manifest.schema.json`, `.gitignore`, `package.json`, `src/harness/index.ts`, `src/harness/scenario.ts`, `src/harness/simulation.ts`, `src/ingestion/jetstream.ts`, `src/governance/routes/vote.ts`, `src/scoring/pipeline.ts`

### What changed
Added an executable simulated epoch campaign ladder around the existing governance/scoring harness, with preflight checks, dry-run manifests, ephemeral Postgres/Redis execution, campaign receipts, and focused tests. Added guarded lab runners for recorded Jetstream replay, real HTTP voting load, process-isolated memory stress, and durable artifact manifests/checksums under `artifacts/lab/PROJ-1551/<run-id>/`. Recorded the detailed lab evidence in `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`; `docs/RECSYS_VALIDATION_EVIDENCE.md` is only the summary index.

### Why
The July 15 RecSys packet needs quantitative, citation-ready evidence about what the ingestion, scoring, feed-serving, and voting paths do and do not prove. The previous evidence was scattered across command output and harness tests; this packages the local proof and marks production-scale gaps explicitly.

### Measurements
- Default suite: 89 files / 710 tests passed with dummy non-production config and local IPC/loopback access after the CodeRabbit hardening tests were added.
- Initial governance harness: 16 files / 168 tests passed against real migrations plus ephemeral Postgres/Redis; the closeout rerun after added coverage passed 17 files / 178 tests in entry #04.
- Campaign ladder executed through S5 locally: 10,000 users / 50,000 posts, 2 seeds, 8,000 votes per run, 10,000 score rows per run, 1,000 Redis feed rows per run.
- Feed-skeleton stress: 20,000 mixed local requests, 100 connections, 0 errors, 0 timeouts, p95 26.22 ms with normal request logging.
- Lab runner dry-runs passed for `lab:jetstream-replay`, `lab:vote-load`, and `lab:memory-isolated`; dry-runs verify CLI/artifact wiring only.
- Small lab smokes passed end-to-end: 19-event Jetstream replay, 40-request / 4-user HTTP voting load with rate-limit phase, and 1-run-per-mode / 100-request process-isolated memory smoke.
- Superseded Jetstream replay receipt passed: 1,200 events, 998.37 events/sec, handler p95 0.83 ms, p99 1.27 ms, 0 queue drops, 0 handler errors, 0 state mismatches, cursor lag 793 microseconds; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-19-32-656Z/manifest.json`. Current receipt is recorded in entry #04.
- Superseded HTTP voting receipt passed: 8,000/8,000 valid POSTs returned `200`, 500 users, 100 connections, p95 40.19 ms, p99 74.12 ms, exact vote/audit/long-table reconciliation, rate-limit phase 20 accepted + 5 `429`; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-20-04-938Z/manifest.json`. Current receipt is recorded in entry #04.
- Full process-isolated memory gate failed: normal mode median after-GC RSS delta 374.68 MB / p95 385.27 MB / max peak RSS 525.77 MB; no-op mode median 370.43 MB / p95 387.58 MB / max peak RSS 529.11 MB. All child exits were 0 and load phases were responsive, but the declared RSS ceilings were exceeded; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-24-30-526Z/manifest.json`.
- TypeScript source build passes after adding the replay/lab-artifact exports and vote OpenAPI schema correction.

### Decisions & alternatives
- Kept the detailed receipt in `docs/lab/` rather than expanding this dev-journal entry into a duplicate lab report.
- Used throwaway Testcontainers for destructive campaign runs; no production or staging endpoint was load-tested.
- Treated the evidence summary as a planning index, not as canonical lab provenance.
- Kept bulky lab outputs ignored by git while tracking `artifacts/lab/README.md` and `artifacts/lab/manifest.schema.json`.
- Left staging saturation behind an explicit approval gate; local lab runners are the next evidence step.
- Fixed smoke-discovered runner issues before documenting them: Jetstream lab config defaults, vote subscriber seed shape, and memory child `--expose-gc` launch mode.
- Switched memory measurement to a server-only child process with parent-generated HTTP load so client allocations are not counted as server RSS.
- Fixed `runScoringPipeline()` to clear its timeout handle in `finally`; the full Jetstream replay initially produced a summary but kept the process open until that timer was cleaned up.

### Open questions
- The process-isolated memory gate is the current blocker. Need heap snapshots, external-memory accounting, socket/HTTP buffer attribution, and repeat runs after a concrete fix before claiming production memory readiness.
- Production/staging DB saturation and external traffic testing remain approval-gated and should not be run until the local memory gate passes.

## 2026-07-05 #02 — PROJ-1551 memory attribution and feed snapshot-cache fix
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/feed/request-tracker.ts`, `src/feed/snapshot-cache.ts`, `src/feed/routes/feed-skeleton.ts`, `src/feed/jwt-verifier.ts`, `src/db/queries/subscribers.ts`, `src/scoring/pipeline.ts`, `scripts/memory-isolated-stress.ts`, `tests/stress/feed-skeleton-memory-server.ts`, `tests/feed-request-tracker.test.ts`, `tests/feed-jwt-verifier.test.ts`, `tests/feed-skeleton-auth.test.ts`, `tests/feed-skeleton-hot-path.test.ts`, `tests/feed-skeleton-tracking.test.ts`, `tests/feed-skeleton-validation.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`

### What changed
Added bounded async feed-request tracking, cheap JWT claim preflight before DID resolution, shared current snapshot caching, and cursor snapshot-by-ID caching so cursor pagination no longer JSON-parses the full Redis snapshot for every request. The memory lab child now records and uses `node --expose-gc --max-semi-space-size=16 --import tsx`, and the memory server records heap spaces, heap statistics, external memory, array buffers, active resources, Redis request-log/snapshot counts, tracker stats, socket counts, and optional V8 heap snapshots.

### Why
The first full process-isolated memory gate was responsive but failed RSS ceilings. Diagnostics showed tracker drops 0, server connections 0, `snapshot:*` count 1 after the current-snapshot cache, small heap-used deltas, and a large allocation burst from repeated cursor snapshot parsing plus V8 young-generation sizing.

### Measurements
- Initial memory gate failed: normal median/p95 after-GC RSS delta 374.68 MB / 385.27 MB, no-op 370.43 MB / 387.58 MB, max peak RSS 525.77 MB / 529.11 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T13-24-30-526Z/manifest.json`.
- Superseded memory gate passed: normal median/p95 after-GC RSS delta 45.11 MB / 53.07 MB, no-op 28.43 MB / 29.28 MB, max peak RSS 191.55 MB / 167.58 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T14-34-41-316Z/manifest.json`. Current warmup-baseline receipts are recorded in entry #04.
- Superseded heap-snapshot diagnostic passed with before/after V8 snapshots; manifest `artifacts/lab/PROJ-1551/2026-07-05T14-35-09-768Z/manifest.json`. Current compiled heap-snapshot receipt is recorded in entry #04.
- Focused regression suite: 8 files / 39 tests passed.
- Full regression suite: 89 files / 710 tests passed with dummy non-production config and local IPC/loopback access after the CodeRabbit hardening tests were added.
- `npm run build`: passed.

### Decisions & alternatives
- Kept the production systemd unit unchanged because PROJ-1551 marks systemd/host mutation out of scope without a separate approved plan.
- Treated `v8.writeHeapSnapshot()` as a diagnostic artifact, not the primary memory gate, because snapshot creation changes RSS and blocks the event loop.
- Used route-level snapshot caching instead of loosening RSS thresholds.

### Open questions
- Adopt and verify the same memory runtime control in staging or production only through an approved ops plan with abort thresholds and rollback.
- Production/staging DB saturation and external traffic testing remain approval-gated.

## 2026-07-05 #03 — PROJ-1551 compiled prod-parity memory gate
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `.gitignore`, `package.json`, `tsconfig.lab-memory.json`, `scripts/memory-isolated-stress.ts`, `tests/stress/feed-skeleton-memory-server.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`

### What changed
Added a narrow `tsconfig.lab-memory.json` compile target for the memory runner, its HTTP/migration helpers, `src/**/*`, and the memory server. Added `build:lab-memory` and `lab:memory-prod-parity` scripts. Added `--prod-parity` to the memory harness so compiled child processes run from `dist-lab/tests/stress/feed-skeleton-memory-server.js` with `node --expose-gc --max-old-space-size=896 --max-semi-space-size=16`.

### Why
The previous memory pass proved the fixed route under a tsx child runtime. Before touching staging or systemd, the lab needed a local production-shape proxy: compiled JS entrypoints plus the exact old-space and semi-space ceilings proposed for the service.

### Measurements
- `npm run build:lab-memory`: passed.
- Prod-parity dry-run: `npm run lab:memory-prod-parity -- --dry-run --runs 1 --amount 100 --connections 2`; confirmed compiled child runtime and lab receipt shape.
- Compiled prod-parity memory gate passed after the warmup-baseline protocol: normal median/p95 after-GC RSS delta 63.72 MB / 65.39 MB, no-op 63.07 MB / 64.01 MB, max peak RSS 247.02 MB / 240.23 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-40-57-460Z/manifest.json`.
- Compiled heap-snapshot diagnostic passed: normal/no-op after-GC RSS deltas 2.91 MB / 3.45 MB, peak RSS 329.14 MB / 340.02 MB, heap-used deltas -0.83 MB / -0.76 MB, external memory essentially flat, array buffers essentially flat; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json`.

### Decisions & alternatives
- Kept the normal app `npm run build` unchanged because it intentionally compiles only `src/**/*`.
- Used a separate ignored `dist-lab/` output so lab-only compiled scripts do not blur with production `dist/`.
- Kept staging/systemd mutation approval-gated. The local compiled gate supports an ops plan; it is not itself a deployed-runtime receipt.

### Open questions
- Prepare the staging/systemd adoption plan for `NODE_OPTIONS=--max-old-space-size=896 --max-semi-space-size=16`, with abort thresholds, rollback, and no production blast radius.
- After approval, verify the deployed process RSS/heap under the same traffic shape before any DB saturation or external voting traffic.

## 2026-07-05 #04 — PROJ-1551 CodeRabbit hardening and refreshed lab receipts
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/feed/snapshot-cache.ts`, `src/feed/routes/feed-skeleton.ts`, `src/scoring/pipeline.ts`, `src/ingestion/jetstream.ts`, `src/ingestion/outcomes.ts`, `src/ingestion/event-processor.ts`, `src/ingestion/handlers/*`, `src/db/queries/subscribers.ts`, `scripts/jetstream-replay.ts`, `scripts/vote-load.ts`, `scripts/sim-campaign.ts`, `scripts/sim-preflight.ts`, `scripts/memory-isolated-stress.ts`, `tests/stress/feed-skeleton-memory-server.ts`, `tests/stress/feed-skeleton.stress.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`

### What changed
Addressed the major CodeRabbit findings against the uncommitted PROJ-1551 diff: snapshot-cache generation races, by-ID snapshot cache isolation, Redis pipeline invalidation ordering, Jetstream payload shape validation, cursor-save logging correctness, split replay/scoring and vote/rate-limit claims, stronger CLI argument validation, cleanup error preservation, child-process memory timeout handling, seed-response validation, and IPC flush before memory-child exit. Follow-up hardening added observed ingestion outcomes from each handler, raw payload/DID log redaction, safer CLI failure artifact writing, cursor snapshot ID validation, pinned-announcement cursor correctness, deterministic lab checksums, stricter manifest schema, and an atomic snapshot invalidation script. The memory lab now uses a 1,000-request external warmup baseline before the before-GC snapshot, so RSS gates measure steady-state stress growth rather than first-touch runtime allocation.

### Why
The first compiled memory rerun failed under the stricter child lifecycle because it measured runtime warmup residency as stress growth. Heap/external/socket diagnostics showed heap-used deltas near flat, external memory flat, sockets drained, tracker drops 0, and the same RSS shape in normal and no-op modes. The correct fix was to improve the methodology and keep the RSS ceiling, not loosen the claim.

### Measurements
- CodeRabbit review ran on the uncommitted diff and surfaced 43 issues; major correctness findings were fixed before these receipts were refreshed. Follow-up closeout reviews surfaced 32, 33, and 24 issues; the valid critical/major runtime/provenance findings were fixed before the final Jetstream and memory reruns.
- Governance and campaign closeout: `npm run sim:core` passed 17 files / 178 tests, `npm --silent run sim:preflight` passed 4/4 checks, and `npm run sim:campaign -- --dry-run --max-stage S1` emitted 4 planned runs.
- Jetstream replay refreshed: 1,200 events, 2,908.17 events/sec, handler p95 0.85 ms, p99 0.99 ms, durable mutations 821, durable mutations/sec 1,989.68, queue drops 0, handler errors 0, state mismatches 0, outcome mismatches 0, cursor lag 793 microseconds, scoring delay 5.72 ms, score rows 1; manifest `artifacts/lab/PROJ-1551/2026-07-05T21-44-07-216Z/manifest.json`.
- HTTP voting load refreshed: 8,000/8,000 valid vote POSTs returned `200`, p95 42.67 ms, p99 84.19 ms, max 272.20 ms, errors/timeouts/non-2xx 0, exact vote/audit/long-table reconciliation, rate-limit phase 20 accepted + 5 `429`, exact post-rate-limit aggregate rows 501 / 8,020 / 2,505, cleanup failures 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T21-44-41-155Z/manifest.json`.
- Memory negative control: tsx child without explicit old-space failed after the warmup baseline with normal median/p95 after-GC RSS deltas 113.61 MB / 127.00 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-38-00-846Z/manifest.json`.
- Fixed tsx memory gate passed with `--max-old-space-size=896 --max-semi-space-size=16`: normal median/p95 46.69 MB / 48.80 MB, no-op 39.88 MB / 49.20 MB, max peak RSS 240.42 MB / 236.92 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T21-45-05-496Z/manifest.json`.
- Current-diff compiled prod-parity memory gate passed: normal median/p95 47.81 MB / 49.70 MB, no-op 40.08 MB / 46.89 MB, max peak RSS 231.03 MB / 226.11 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T21-46-24-461Z/manifest.json`.
- Current-diff compiled heap-snapshot diagnostic passed: normal/no-op RSS deltas 2.91 MB / 3.45 MB, heap-used deltas -0.83 MB / -0.76 MB, external memory and array buffers essentially flat; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json`.
- Focused hardening tests passed: 7 files / 83 tests for request-tracker timeout and FIFO queue behavior, snapshot-cache edge coverage, preflight failure JSON, lab-artifact metadata, HTTP expected-status accounting, engagement attribution, feed-skeleton stress setup, and Jetstream cursor/error handling.
- Full regression suite passed after hardening: 93 files / 780 tests.
- Build and docs gates passed after hardening: `npm run build`, `npm run build:lab-memory`, `git diff --check`, and `npm run docs:verify`.

### Decisions & alternatives
- Kept staging/systemd changes approval-gated. The lab supports an ops plan; it does not mutate deployed runtime.
- Kept failed receipts in the journal because they prove the gates catch bad methodology and split claims correctly.
- Treated heap snapshots as diagnostics only, because writing them changes RSS and blocks the event loop.

### Open questions
- Optional follow-up: address remaining CodeRabbit minor/trivial coverage and cleanup suggestions that are not runtime blockers.
- Get explicit approval for the staging/runtime plan before any shared-environment saturation.

## 2026-07-05 #05 — PROJ-1551 staging/runtime gate plan
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/ingestion/jetstream.ts`, `src/db/queries/subscribers.ts`, `tests/jetstream-message-processing.test.ts`, `tests/stress/feed-skeleton-memory-child.ts`, `tests/backfill-governance-weights-cli.test.ts`, `tests/backfill-score-components-cli.test.ts`, `tests/sim-preflight.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`, `docs/dev-journal.md`

### What changed
Added a `[PLAN DRAFT]` to the canonical lab journal for the next approval-gated move: verify the lab-proven runtime `NODE_OPTIONS=--max-old-space-size=896 --max-semi-space-size=16` on an explicitly approved staging or shadow target before any DB saturation or external voting load. Refreshed the stability/evidence docs to point at the then-current `21:44-21:46Z` lab receipts. Ran CodeRabbit on the uncommitted diff and fixed the valid major runtime issues it surfaced in this pass: generation-scoped Jetstream cursor safety across reconnects and deterministic Redis cleanup/exit in the standalone memory child. Also tightened subscriber DID digest fallback to development/test only and made subprocess CLI/preflight tests use the repo-local `tsx` loader instead of the IPC wrapper.

### Why
PROJ-1551's gate protocol forbids staging or production load without a separate explicit plan. The local compiled memory gate proves the route under compiled child processes; it does not prove deployed systemd/runtime behavior. The tracked service unit already has `--max-old-space-size=896`, so the next risk is verifying/adopting the missing `--max-semi-space-size=16` bound and measuring deployed RSS/latency before pushing into Jetstream, voting, or DB saturation.

### Measurements
- Basis receipt: compiled prod-parity memory gate passed 5 runs per mode at 10,000 requests and 100 connections, normal/no-op median after-GC RSS deltas 47.81 MB / 40.08 MB, p95 deltas 49.70 MB / 46.89 MB, max peak RSS 231.03 MB / 226.11 MB; manifest `artifacts/lab/PROJ-1551/2026-07-05T21-46-24-461Z/manifest.json`.
- Attribution receipt: compiled heap-snapshot diagnostic passed with normal/no-op after-GC RSS deltas 2.91 MB / 3.45 MB, heap-used deltas -0.83 MB / -0.76 MB, and flat external memory; manifest `artifacts/lab/PROJ-1551/2026-07-05T17-42-12-174Z/manifest.json`.
- CodeRabbit review on the uncommitted diff returned 27 issues. Valid major fixes landed in `src/ingestion/jetstream.ts`, `tests/jetstream-message-processing.test.ts`, and `tests/stress/feed-skeleton-memory-child.ts`; one cursor-assertion major was already covered by the existing replay assertions.
- Focused post-review tests passed: Jetstream/subscriber slice 2 files / 13 tests; CLI/preflight slice 3 files / 23 tests.
- Full regression suite passed with dummy non-production config and local IPC/loopback access: 93 files / 780 tests.
- Build and docs gates passed: `npm run build`, `npm run build:lab-memory`, `npm run docs:verify`, and `git diff --check`.
- Planned deployed-feed memory gate: 10,000 requests, 100 connections, p95 < 100 ms, errors 0, timeouts 0, non-2xx 0, 5xx 0, restart count unchanged, cgroup memory below 768 MB, and steady RSS below 512 MB after drain.

### Decisions & alternatives
- Kept this as a plan draft, not a service-unit or deployment change.
- Sequenced the work as runtime/memory first, then Jetstream/scoring observation, then external HTTP voting, then DB saturation.
- Required explicit target identity, rollback command, traffic source/rate, artifact destination, and proof of isolated data target before execution.

### Open questions
- Which host/service is the approved target: true staging, shadow production, or a freshly provisioned disposable target?
- Where should durable shared-environment receipts live if they should not be committed under `artifacts/lab/PROJ-1551/<run-id>/`?

## 2026-07-05 #06 — PROJ-1551 feed tracking abort hardening
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/feed/routes/feed-skeleton.ts`, `tests/feed-skeleton-tracking.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/dev-journal.md`

### What changed
Wrapped feed request tracking's DID verification, epoch read, and Redis write pipeline in abort-aware waits that share the request tracker timeout signal. Added regression coverage for a stalled `redis.get('feed:epoch')` call so a hung tracking read times out, releases the tracker slot, and does not continue to enqueue tracking writes after the request has already been counted as timed out.

### Why
The feed response path already decouples tracking from serving, but tracking work still needs bounded background lifetime. Without abort-aware Redis waits, a stuck Redis command could keep the tracking task alive after the slot was released, making tracker metrics overstate recovery and hiding background work during memory or saturation tests.

### Measurements
- Focused tracking slice passed: 2 files / 24 tests for `tests/feed-skeleton-tracking.test.ts` and `tests/feed-request-tracker.test.ts`.
- Full regression suite passed with dummy non-production config and local IPC/loopback access: 93 files / 781 tests.
- Build gates passed: `npm run build` and `npm run build:lab-memory`.

### Decisions & alternatives
- Kept the hardening local to feed request tracking instead of changing Redis client behavior globally.
- Preserved the existing best-effort logging behavior for non-timeout tracking failures.

### Open questions
- Rerun docs and diff hygiene, then CodeRabbit, before considering this continuation closed.

## 2026-07-05 #07 — PROJ-1551 current-head closeout receipts
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `scripts/sim-campaign.ts`, `scripts/memory-isolated-stress.ts`, `src/ingestion/jetstream.ts`, `tests/jetstream-message-processing.test.ts`, `tests/stress/feed-skeleton.stress.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`, `docs/dev-journal.md`

### What changed
Closed the final current-head evidence gap after the late CodeRabbit fixes. The campaign runner now defaults to the current clock when `--clock-ms` is omitted, so default ephemeral campaign runs score recent seeded posts instead of accidentally aging them out at Unix epoch time. The Jetstream cursor escape hatch, stress fixture cleanup, memory child listener cleanup, and campaign cleanup/default-clock fixes are now covered by fresh build/test/lab receipts.

### Why
The prior `21:44-21:46Z` receipts were no longer enough after changing Jetstream cursor handling and the memory/campaign scripts. PROJ-1551 requires quantitative proof tied to the code under review, so the lab gates were rerun and the docs were repointed to the new manifests.

### Measurements
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- `npm run docs:verify`: pass after doc patch, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass after doc patch.
- Full regression suite passed with dummy non-production config and local IPC/loopback access: 93 files / 782 tests.
- `npm run sim:core`: pass, 17 files / 178 tests, migrations 001-022 applied against Testcontainers Postgres/Redis.
- `npm run sim:campaign -- --dry-run --max-stage S1`: pass, 4 planned runs.
- `npm --silent run sim:preflight`: first current-head attempt failed because Testcontainers port binding exceeded the 10s preflight window; immediate retry passed 4/4 checks, Docker 29.4.3, migrations 001-022, migration check duration 1.667s.
- `npm run sim:campaign -- --ephemeral --stage S0 --artifacts-dir /private/tmp/corgi-sim-campaign-s0-current-head`: pass, 30 users, 50 posts, 24 votes, 13 score rows, 12 Redis feed rows, scratch summary `/private/tmp/corgi-sim-campaign-s0-current-head/campaign-summary.json`.
- Jetstream replay refreshed: 1,200 events, 2,958.43 events/sec, handler p95 0.83 ms, p99 0.99 ms, max 2.84 ms, durable mutations 821, durable mutations/sec 2,024.06, queue drops 0, handler errors 0, state mismatches 0, outcome mismatches 0, cursor lag 793 microseconds, scoring delay 5.27 ms, score rows 1; manifest `artifacts/lab/PROJ-1551/2026-07-05T22-17-41-693Z/manifest.json`.
- HTTP voting load refreshed: 8,000/8,000 valid vote POSTs returned `200`, p95 41.91 ms, p99 77.90 ms, max 257.54 ms, errors/timeouts/non-2xx 0, exact vote/audit/long-table reconciliation, rate-limit phase 20 accepted + 5 `429`, exact post-rate-limit aggregate rows 501 / 8,020 / 2,505, cleanup failures 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T22-17-58-509Z/manifest.json`.
- Fixed tsx memory gate refreshed: normal median/p95 44.00 MB / 46.56 MB, no-op 42.72 MB / 53.36 MB, max peak RSS 239.89 MB / 240.98 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T22-18-16-183Z/manifest.json`.
- Compiled prod-parity memory gate refreshed: normal median/p95 47.13 MB / 50.93 MB, no-op 44.24 MB / 47.83 MB, max peak RSS 230.52 MB / 226.05 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-05T22-19-36-438Z/manifest.json`.
- CodeRabbit fresh full-diff review timed out without findings, review ID `11cad39b-c8de-4f4d-bbb3-2a52e95b380d`.
- CodeRabbit fresh light full-diff review was stopped after repeated no-output heartbeats and no findings emitted.
- CodeRabbit fresh light scoped ingestion review timed out without findings, review ID `e2947cc1-d489-4c4d-bdcf-88e7b2a9f0a7`.
- `coderabbit review findings` still contained the prior 24 stored findings. The two cached major findings were stale against current code: `scripts/load-test.ts` already exits explicitly with `process.exit(process.exitCode ?? 0)`, and `tests/stress/feed-skeleton.stress.ts` already closes the Fastify app in a setup-failure `catch`. The cached memory timer finding was also stale; `waitForChildCloseWithin()` clears its timeout in `finally`.

### Decisions & alternatives
- Kept the first preflight timeout in the record instead of flattening it into the passing retry.
- Kept staging/systemd and production saturation approval-gated; these receipts are local/non-production evidence only.
- Retained older failing/negative-control memory receipts because they prove the gates catch bad methodology and separate claim surfaces.

### Open questions
- CodeRabbit service did not complete a fresh review after three attempts; keep the timeout review IDs in the closeout instead of claiming a clean vendor review.
- Remaining cached minor/trivial findings are follow-up coverage/performance/nit items, not current PROJ-1551 blockers.
- Superseded by the corrected Linear receipt and July 6 lab refresh in entry #02; staging execution remains behind the existing approval gate.

## 2026-07-05 #08 — PROJ-1551 continuation hardening after review
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `scripts/load-test.ts`, `scripts/http-load.ts`, `src/feed/routes/feed-skeleton.ts`, `src/ingestion/handlers/like-handler.ts`, `src/ingestion/handlers/repost-handler.ts`, `tests/feed-skeleton-tracking.test.ts`, `tests/http-load.test.ts`, `tests/sim-preflight.test.ts`, `tests/vote-load-cli.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/dev-journal.md`

### What changed
Extended the feed request tracking timeout hardening with abort-aware waits around DID verification, the `feed:epoch` Redis read, and the tracking write pipeline. Addressed the still-valid CodeRabbit load-test process-lifetime finding by restoring an explicit CLI exit path after PASS/FAIL output and adding a subprocess smoke test that proves the script terminates promptly. Tightened HTTP expected-status accounting coverage, made vote-load CLI tests use the repo-local `tsx` loader, gave subprocess CLI tests explicit 30s budgets, and corrected like/repost debug logs so duplicate or untracked events are not logged as indexed inserts.

### Why
These are local rigor fixes for the lab evidence path. Feed tracking needs bounded background lifetime for memory and saturation tests; the standalone load-test CLI needs deterministic process shutdown; subprocess tests should not race Vitest's default 5s timeout while the child process budget is 30s; and ingestion logs should distinguish inserted events from duplicate/untracked no-ops.

### Measurements
- CodeRabbit review on the uncommitted diff returned 24 issues. The still-valid major load-test process-lifetime issue was fixed. The stress-fixture cleanup and memory-child timeout findings were already satisfied in current code. The distributed scoring-lock suggestion remains a larger architecture follow-up, not a safe local validation edit.
- Focused feed tracking slice passed: 2 files / 24 tests.
- Focused CLI/load-accounting slice passed: 5 files / 65 tests.
- Full regression suite passed with dummy non-production config and local IPC/loopback access: 93 files / 785 tests.
- Build gates passed: `npm run build` and `npm run build:lab-memory`.
- `npm run docs:verify`: pass after doc patch, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass after doc patch.
- Post-fix CodeRabbit rerun failed with vendor timeout before findings were returned, review ID `129c1f80-f214-4201-b078-a45ec710ff3a`, `recoverable:false`.

### Decisions & alternatives
- Kept staging/systemd, production traffic, and shared DB saturation untouched.
- Did not implement a distributed scoring lock inside this continuation because it changes cross-process production behavior and needs a separate design/rollout plan.
- Kept the explicit load-test `process.exit` local to the standalone CLI rather than changing the reusable `runHttpLoad` helper.

### Open questions
- CodeRabbit did not return a fresh post-fix review result; retain the timeout review ID instead of claiming a clean vendor pass.
- Superseded by the corrected July 6 Linear receipt in entry #02; keep staging execution behind the existing approval gate.

## 2026-07-06 #01 — PROJ-1551 queue saturation and redaction hardening
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/feed/request-tracker.ts`, `src/feed/routes/feed-skeleton.ts`, `tests/feed-request-tracker.test.ts`, `tests/feed-skeleton-auth.test.ts`, `tests/subscribers-log-redaction.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/dev-journal.md`

### What changed
Added a rate-limited operator warning when the feed request tracking queue is saturated and drops tracking work. Strengthened request-tracker tests for drop accounting, unchanged enqueue counts on rejected work, overlapping drain waiters, and a short drain timeout not canceling a concurrent long drain. Reused the already verified private-mode viewer DID for background request tracking so approved private feed requests do not verify the same JWT twice. Added subscriber log-redaction coverage for string, null, and object rejection values with non-string properties.

### Why
The local lab already measures tracker drops and queue depth, but saturation needs an operator-visible warning if the queue limit is reached. Private-mode tracking should not spend extra verifier work on the hot request path's already approved identity. Subscriber failures must stay redacted even when a dependency rejects with unusual values.

### Measurements
- Focused queue/redaction slice passed: 4 files / 35 tests.
- Full regression suite passed with dummy non-production config and local IPC/loopback access: 93 files / 791 tests.
- Build gates passed: `npm run build` and `npm run build:lab-memory`.

### Decisions & alternatives
- Kept saturation logging rate-limited to avoid turning a dropped-task storm into a log storm.
- Kept the private-mode DID reuse scoped to feed request tracking only; access-control semantics are unchanged.
- Kept staging/systemd, production traffic, and shared DB saturation untouched.

### Open questions
- Superseded by the corrected July 6 Linear receipt in entry #02; rerun docs/diff hygiene before PR closeout.
- Remaining larger follow-up remains the distributed scoring lock design, which should not be slipped into the validation branch without a separate plan.

## 2026-07-06 #02 — PROJ-1551 post-review lab receipt refresh
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `scripts/vote-load.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`, `docs/dev-journal.md`

### What changed
Refreshed the full local lab gates after the post-review hardening and the queue/redaction continuation. Repointed the evidence summary, lab journal, and stability checklist to the July 6 manifests. Added `DB_POOL_MAX` and `DB_STATEMENT_TIMEOUT` to the vote-load manifest allowlist so future receipts can show whether a vote-load pass depends on explicit database pool tuning.

### Why
The previous canonical lab manifests predated later request-tracking, logging, and test-hardening changes. PROJ-1551 is evidence-driven; current claims need current-head receipts, and a failed 100-connection vote-load attempt needed to stay visible rather than be hidden by a later passing retry.

### Measurements
- `npm run lab:jetstream-replay -- --ephemeral --events 1200`: pass, 1,200 events, 1,071.48 events/sec, handler p95 2.36 ms, p99 3.20 ms, max 10.68 ms, durable mutations 821, durable mutations/sec 733.07, queue drops 0, handler errors 0, state mismatches 0, outcome mismatches 0, cursor lag 793 microseconds, scoring delay 16.12 ms, score rows 1; manifest `artifacts/lab/PROJ-1551/2026-07-06T17-43-53-532Z/manifest.json`.
- First current-head `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100`: fail, 7,903/8,000 valid `200` responses, 97 timeouts, p95 121.55 ms, 7,960/8,000 expected audit rows, and PostgreSQL pool connection timeouts; manifest `artifacts/lab/PROJ-1551/2026-07-06T17-44-14-781Z/manifest.json`.
- Discriminator `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 50`: pass, 8,000/8,000 valid `200` responses, p95 27.68 ms, p99 37.30 ms, max 98.40 ms, exact reconciliation; manifest `artifacts/lab/PROJ-1551/2026-07-06T18-25-11-074Z/manifest.json`.
- Canonical repeat `npm run lab:vote-load -- --ephemeral --valid-requests 8000 --users 500 --connections 100`: pass, 8,000/8,000 valid `200` responses, p95 43.99 ms, p99 87.15 ms, max 288.42 ms, exact vote/audit/long-table reconciliation, 20 accepted + 5 rate-limited responses, cleanup failures 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T18-26-05-568Z/manifest.json`.
- `npm run lab:memory-isolated -- --ephemeral --runs 5 --amount 10000 --connections 100`: pass, normal median/p95 after-GC RSS deltas 42.45 MB / 46.80 MB, no-op 37.93 MB / 42.64 MB, max peak RSS 239.13 MB / 230.22 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T18-26-30-271Z/manifest.json`.
- `npm run lab:memory-prod-parity -- --ephemeral --runs 5 --amount 10000 --connections 100`: pass, normal median/p95 after-GC RSS deltas 45.92 MB / 48.44 MB, no-op 47.97 MB / 50.39 MB, max peak RSS 228.30 MB / 226.86 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T18-27-54-834Z/manifest.json`.
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- First full `npm test -- --run` without dummy env failed at config import, 43 failed suites / 50 passed files, because required non-production config values were absent.
- Full `npm test -- --run` with explicit dummy non-production env passed: 93 files / 791 tests.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.
- Fresh `coderabbit review --agent -t uncommitted` reached setup/analyzing, emitted no findings or review ID after repeated polls, and was stopped with SIGINT; exit code 130. Treat this as no fresh vendor result, not as a clean review.

### Decisions & alternatives
- Kept the failed 100-connection vote-load attempt in the journal and summary docs as a repeatability warning.
- Kept staging/systemd, production traffic, and shared DB saturation untouched.
- Treated the passing local vote-load retry as local evidence only; the approved staging gate must record repeated voting runs and DB pool utilization.
- Retained the prior post-fix CodeRabbit timeout `129c1f80-f214-4201-b078-a45ec710ff3a` as the latest review ID because this fresh attempt did not return one.

### Open questions
- Shared-environment/staging claims remain blocked on explicit target/operator/window/rollback/artifact approval and repeated DB-pool-instrumented voting runs.

## 2026-07-06 #03 — PROJ-1551 current-main PR closeout
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** validation code, lab harness scripts, lab artifact schema, regression tests, and evidence docs.

### What changed
Fast-forwarded the validation worktree from `e9a8a4c` to current `origin/main` at `f2310a036cb668a9e7419ee8419a2cbe44dc9920`, preserving the PROJ-1551 local validation diff and bringing in the PROJ-1465 legal-doc runtime-image checks before PR creation. Ran CodeRabbit on the uncommitted diff; it exceeded the 10-minute completion window, but emitted actionable findings before being stopped. Fixed the valid major/minor findings around manifest claim evidence rules, feed request tracking DB-pool headroom, vote-load DB-pool sizing, `FEED_MAX_POSTS` bounds, subscriber digest config, by-ID snapshot cache eviction, soft-deleted like/repost subjects, and stress snapshot cleanup.

### Why
The validation packet should land against the same mainline that now includes the runtime legal-doc fix and its regression test. The earlier PROJ-1551 receipts were still valid local evidence, but the PR closeout needed a current-main build/test/docs hygiene pass.

### Measurements
- Full `npm run verify` with the same dummy non-production env and local loopback/IPC permission: pass; included root TypeScript build, 97 files / 840 Vitest tests, CLI build, MCP-local skip check, SDK build, SDK fixture, Vite lint/build, and Next static build.
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- Focused post-review slice (`tests/config.test.ts`, `tests/feed-request-tracker.test.ts`, `tests/feed-snapshot-cache.test.ts`, `tests/harness/lab-artifacts.test.ts`, `tests/engagement-ingestion-filter.test.ts`, `tests/vote-load-cli.test.ts`, `tests/subscribers-log-redaction.test.ts`): pass, 7 files / 88 tests.
- Full `npm test -- --run` with explicit dummy non-production env and local loopback/IPC permission: pass, 97 files / 840 tests.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.
- Post-fix CodeRabbit reruns with `.coderabbit.yaml`: blocked by recoverable vendor rate limits after waits of 2 minutes and 20 seconds; final retry reported an 8-minute wait. Do not claim a clean post-fix CodeRabbit pass.

### Decisions & alternatives
- Kept staging/systemd, production traffic, and shared DB saturation untouched.
- Kept the approval-gated staging/runtime plan as a plan only; no shared-environment load was executed.
- Left CodeRabbit trivial coverage suggestions for a later cleanup lane where they did not affect runtime correctness or the PROJ-1551 evidence claim.

## 2026-07-06 #04 — PROJ-1551 receipt-integrity hardening and lab refresh
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** PR closeout at `154e55b`; this follow-up records post-closeout verification.
**Files changed:** `src/feed/request-tracker.ts`, `src/ingestion/jetstream.ts`, `src/harness/jetstream-replay.ts`, `src/harness/lab-artifacts.ts`, `scripts/jetstream-replay.ts`, `scripts/memory-isolated-stress.ts`, `scripts/vote-load.ts`, `tests/feed-request-tracker.test.ts`, `tests/jetstream-message-processing.test.ts`, `tests/jetstream-replay-harness.test.ts`, `tests/harness/lab-artifacts.test.ts`, `tests/memory-isolated-cli.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/STABILITY_TEST.md`, `docs/dev-journal.md`

### What changed
Fixed the valid major findings emitted during the latest CodeRabbit stream: abort-aware feed-tracking tasks now count as timed out instead of completed, Jetstream cursor persistence is monotonic under overlapping saves, replay state expectations use fixture expected outcomes instead of observed outcomes, lab manifests are schema-validated before write, lab guard checks happen before `CORGI_SIM_ALLOW` defaults are set, container cleanup failures propagate, and memory CLI arguments are bounded/rejected explicitly. The lab scripts also now import Testcontainers dynamically only inside the ephemeral-container path, so dry-run and non-ephemeral CLI paths do not require Testcontainers module loading.

### Why
The previous lab receipts proved the main local gates, but several receipt-integrity edges could make a passing artifact less defensible than it looked. PROJ-1551 needs claims supported by quantitative receipts, so the gate code itself must fail loudly when validation assumptions are wrong.

### Measurements
- Focused receipt-integrity slice passed: 6 files / 71 tests.
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- Focused CLI/lab-script slice passed after dynamic Testcontainers import hardening: 5 files / 52 tests.
- Full regression suite with dummy non-production env and local loopback/IPC permission passed: 97 files / 840 tests.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.
- Jetstream replay refreshed: 1,200 events, 3,105.67 events/sec, handler p95 0.76 ms, p99 1.02 ms, max 5.13 ms, durable mutations 569, durable mutations/sec 1,472.61, queue drops 0, handler errors 0, state mismatches 0, outcome mismatches 0, cursor lag 793 microseconds, scoring delay 5.9 ms, score rows 1; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-37-49-725Z/manifest.json`.
- HTTP voting load refreshed: 8,000/8,000 valid vote POSTs returned `200`, p95 48.18 ms, p99 101.06 ms, max 319.53 ms, errors/timeouts/non-2xx 0, exact vote/audit/long-table reconciliation, rate-limit phase 20 accepted + 5 `429`, exact post-rate-limit aggregate rows 501 / 8,020 / 2,505, cleanup failures 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-38-04-859Z/manifest.json`.
- Fixed tsx memory gate refreshed: normal median/p95 44.75 MB / 50.27 MB, no-op 42.94 MB / 51.09 MB, max peak RSS 251.34 MB / 234.20 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-38-23-532Z/manifest.json`.
- Compiled prod-parity memory gate refreshed: normal median/p95 36.43 MB / 39.49 MB, no-op 30.14 MB / 40.10 MB, max peak RSS 215.92 MB / 215.70 MB, tracker drops 0, remaining connections 0; manifest `artifacts/lab/PROJ-1551/2026-07-06T19-42-01-707Z/manifest.json`.
- Post-fix CodeRabbit attempt first returned recoverable rate limit with a 3-minute wait; retry exited 0 with `review_skipped`, message `No changes detected`, and findings 0. Treat this as a completed CLI interaction, not as a fresh substantive vendor review.

### Decisions & alternatives
- Kept staging/systemd, production traffic, and shared DB saturation untouched.
- Treated the CodeRabbit stream as actionable evidence for fixes. The post-fix retry exited 0 with `review_skipped` and 0 findings, but did not run a fresh substantive review.
- Left the larger subscriber digest-secret split and distributed scoring-lock work as separate design/ops follow-ups rather than slipping broader production behavior changes into this validation branch.

### Open questions
- Shared-environment/staging claims remain blocked on explicit target/operator/window/rollback/artifact approval and repeated DB-pool-instrumented voting runs.

## 2026-07-06 #05 — PROJ-1551 backend CI import-order retry
**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** code fix `d7a233c`
**Files changed:** `scripts/jetstream-replay.ts`, `scripts/memory-isolated-stress.ts`, `scripts/sim-campaign.ts`, `scripts/sim-preflight.ts`, `scripts/vote-load.ts`, `docs/dev-journal.md`

### What changed
Moved Testcontainers value imports in the lab CLI scripts into the ephemeral-container execution paths, while keeping the container handle imports type-only. The runtime container behavior stays in the guarded path; dry-run, invalid-argument, and preflight-skip paths no longer load optional Testcontainers dependencies before CLI validation.

### Why
GitHub PR #302 `backend-verify` failed under Node 20.19.0 before CLI validation in `tests/vote-load-cli.test.ts`, because static Testcontainers imports loaded `undici` and crashed with `webidl.util.markAsUncloneable is not a function`. That made invalid-argument tests report the dependency crash instead of the expected `--valid-requests`, `--users`, `--connections`, or unknown-flag validation errors.

### Measurements
- GitHub PR #302 failing CI receipt before the fix: run `28818957727`, job `85465508809`, `backend-verify`, Node 20.19.0, failing suite `tests/vote-load-cli.test.ts`.
- Focused CLI regression passed after the import-order fix: 3 files / 26 tests via `npx vitest run tests/vote-load-cli.test.ts tests/memory-isolated-cli.test.ts tests/sim-preflight.test.ts` with dummy non-production env.
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- Compiled lab dry-run passed: `node dist-lab/scripts/memory-isolated-stress.js --dry-run --runs 1 --amount 1 --connections 1`.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.
- `npm run verify` with dummy non-production env and local loopback/IPC permission: pass, including root build, 97 files / 840 tests, CLI build, MCP-local skip, SDK build, SDK fixture, web lint/build, and web-next build.

### Decisions & alternatives
- Kept staging/systemd, production traffic, Docker tasking, and shared databases untouched.
- Did not downgrade or pin Testcontainers/undici in this validation branch; the root issue was import order on paths that do not need containers.

## 2026-07-06 #06 — PROJ-1551 CodeRabbit hardening loop

**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** request tracking, feed request logging, Jetstream cursor/dead-letter handling, subscriber logging, validation scripts, regression tests, and migration `023_jetstream_failed_cursor_dead_letters.sql`.

### What changed

Ran CodeRabbit CLI on the uncommitted PR diff after the spending cap cleared for CLI review execution. Fixed the valid runtime findings instead of treating the stale PR status as current truth:

- Feed request tracking now keeps timeout accounting distinct from late task completion/rejection, re-arms warning gates after idle drains, and adds abort-path regressions for verifier, subscriber, Redis read, and Redis pipeline stalls.
- Feed request logging now dispatches the Redis request-log pipeline eagerly and independently from subscriber upsert, so subscriber stalls do not suppress request-log writes.
- Jetstream handler-error outcomes no longer advance the cursor. Failed cursor pins are keyed by event identity, generation-scoped, retry-bounded, age-bounded, max-count-bounded, and dead-lettered durably before the pin is removed.
- Added migration `023_jetstream_failed_cursor_dead_letters.sql` for durable failed-cursor dead-letter audit rows.
- Subscriber upsert redaction now keeps the catch path non-throwing if DID digest secret resolution fails, emits a sanitized error log, increments a digest-unavailable counter, and still avoids raw DID leakage.
- Vote-load and memory-isolated stress harnesses now carry the prior CodeRabbit hardening around ephemeral Postgres connection budget, cleanup error preservation, and shared threshold constants.

### Why

The PR was blocked by a stale CodeRabbit app status, but the CLI cap had passed enough to run substantive reviews. The review loop found real correctness issues in cursor safety and async tracking behavior. PROJ-1551 claims depend on ingestion and validation receipts being defensible under handler failures, stalled tracking dependencies, and dead-letter audit requirements.

### Measurements

- CodeRabbit CLI `coderabbit review --agent -t uncommitted -c .coderabbit.yaml`: multiple completed review passes emitted actionable findings; latest post-fix retry was blocked by recoverable `rate_limit` with wait time `11 minutes`. Do not claim a clean final CodeRabbit pass yet.
- `npm run verify` with dummy non-production env and local loopback/IPC permission: pass, including root build, 97 files / 868 Vitest tests, CLI build, MCP-local skip, SDK build, SDK fixture, web lint/build, and web-next build.
- `npm --silent run sim:preflight`: pass, 4/4 checks; Docker server 29.4.3; Testcontainers started `postgres:16` and `redis:7-alpine`; migrations `001` through `023` applied.
- `npm run build:lab-memory`: pass.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.

### Decisions & alternatives

- Kept staging/systemd, production traffic, Docker tasking beyond Testcontainers, and shared databases untouched.
- Treated CodeRabbit "trivial" labels skeptically: implemented test-only gaps when cheap, but also promoted the durable dead-letter requirement to runtime work because log-only drops were not recoverable.
- Retry-limit skips remain blocked when durable dead-letter persistence fails. Pin-limit and age-limit cleanup still remove pins to enforce memory and age bounds, while logging the failed durable write.
- CodeRabbit final clean state remains pending on the vendor rate-limit retry.

## 2026-07-06 #07 — PROJ-1551 final local hardening receipts and CodeRabbit cap state

**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** request tracking, feed request logging, Jetstream failed-cursor locking/dead-letter handling, subscriber logging, memory/vote validation scripts, regression tests, docs, and migration `023_jetstream_failed_cursor_dead_letters.sql`.

### What changed

Continued the CodeRabbit hardening loop from entry #06 and fixed the remaining still-valid emitted issues:

- Serialized Jetstream `failedCursorPins` mutations across awaited dead-letter inserts, guarded post-await deletes against reconnect/reset key reuse, and added a concurrent same-event retry-limit regression that proves one durable dead-letter plus one fresh pin.
- Downgraded route-local feed tracking failure logging to debug so repeated Redis/subscriber tracking failures rely on the request tracker's rate-limited warnings instead of one warn per request.
- Kept the feed request tracker timeout above the configured Postgres statement timeout by default, preserving DB statement-timeout headroom while tests still override the task timeout deterministically.
- Extended subscriber digest-unavailable coverage to prove the production-mode counter increments per failed call without leaking raw DIDs.
- Made the memory-isolated harness importable without auto-running, then covered startup-error cleanup when both stops fail, one stop fails, and cleanup succeeds.
- Added the small CLI timeout single-source-of-truth regression requested by the final CodeRabbit stream.

### Why

The remaining findings were mostly low-severity test coverage, but they protected real evidence claims: failed Jetstream events must not race cursor safety, feed tracking must not create log storms under dependency failures, and startup cleanup tests must prove the original startup error is preserved regardless of cleanup outcome.

### Measurements

- Focused review slice after final fixes: `npx vitest run tests/jetstream-message-processing.test.ts tests/feed-skeleton-tracking.test.ts tests/subscribers-log-redaction.test.ts tests/memory-isolated-cli.test.ts` passed, 4 files / 60 tests.
- `npm run build`: pass.
- `npm run build:lab-memory`: pass.
- `npm run docs:verify`: pass, 14 tracked docs / 28 markdown files scanned.
- `git diff --check`: pass.
- `npm --silent run sim:preflight`: pass, generated `2026-07-07T00:54:49.393Z`, 4/4 checks, Docker server 29.4.3, Testcontainers `postgres:16`/`redis:7-alpine`, migrations `001` through `023` applied.
- Final `npm run verify` with dummy non-production env and local loopback/IPC permission: pass, including root build, 97 files / 876 Vitest tests, CLI build, MCP-local skip, SDK build, SDK fixture, web lint/build, and web-next build.
- CodeRabbit rerun after the first final-fix batch exceeded the 10-minute window, emitted 4 issues, and was stopped; all 4 were fixed.
- CodeRabbit rerun after that exceeded the 10-minute window, emitted 2 trivial issues, and was stopped; both were fixed.
- Final CodeRabbit attempt after the green local gates returned recoverable `rate_limit` with wait time `6 minutes`; after waiting 6 minutes plus an 8-second buffer, retries still returned recoverable `rate_limit` with wait times `4 seconds` and then `4 minutes`. Do not claim a clean final CodeRabbit pass.

### Decisions & alternatives

- Stopped the CodeRabbit retry loop after the moving vendor wait window returned another 4-minute cap; local verification is green, but vendor freshness is not clean.
- Kept staging/systemd, production traffic, credentials, DNS, deploys, and shared database saturation untouched.
- Kept retry-limit dead-letter DB failure fail-closed for cursor advancement, while pin-limit and age-limit cleanup remain bounded even if durable audit insertion fails.

### Open questions

- CodeRabbit vendor freshness remains blocked by recoverable rate limit; rerun once the cap actually clears.
- Shared-environment/staging claims remain blocked on explicit target/operator/window/rollback/artifact approval and repeated DB-pool-instrumented voting runs.

## 2026-07-06 #08 — PROJ-1551 adversarial tracker accounting closeout

**Branch:** `dev/PROJ-1551-corgi-validation`
**Commits:** pending
**Files changed:** `src/feed/request-tracker.ts`, `src/feed/routes/feed-skeleton.ts`, `scripts/memory-isolated-stress.ts`, `tests/feed-request-tracker.test.ts`, `tests/feed-skeleton-tracking.test.ts`, `docs/lab/2026-07-05-corgi-ingestion-voting-validation.md`, `docs/RECSYS_VALIDATION_EVIDENCE.md`, `docs/dev-journal.md`.

### What changed

Closed the adversarial review gap where an abort-aware wrapper could reject on timeout while the underlying Redis, subscriber DB, or verifier promise continued outside tracker accounting:

- Added `abandonedBackendOps`, total, max-observed, and backend-saturation drop counters to feed request tracker stats.
- Made tracker drain/reset wait for abandoned backend operations to settle, not only queued/in-flight app tasks.
- Added a circuit breaker that drops new tracking work when abandoned backend operations reach the request-tracker concurrency ceiling.
- Wrapped feed-skeleton tracking operations so abort-before-settle records an abandoned backend operation and clears it only when the original promise resolves or rejects.
- Updated the memory harness pass/fail gate to require `abandonedBackendOps=0` and `backendSaturationDropped=0` on future runs.

### Why

The previous timeout tests proved the response path stayed non-blocking, but they did not prove dependency-stall backpressure. A Redis/DB/verifier stall could still leave detached backend promises alive after app-level tracking reported idle. That would make memory and saturation receipts overstate recovery under dependency-stall conditions.

### Measurements

- Focused adversarial tracker slice with dummy non-production env: `npx vitest tests/feed-request-tracker.test.ts tests/feed-skeleton-tracking.test.ts --run` passed, 2 files / 42 tests.
- Broader focused hardening slice with dummy non-production env: `npx vitest tests/config.test.ts tests/feed-request-tracker.test.ts tests/feed-skeleton-tracking.test.ts tests/memory-isolated-cli.test.ts tests/subscribers-log-redaction.test.ts tests/jetstream-message-processing.test.ts --run` passed, 6 files / 98 tests.
- `npm run build` with dummy non-production env: pass.
- `npm run build:lab-memory` with dummy non-production env: pass.
- Full `npm run verify` with dummy non-production env and local loopback/IPC permission: pass, including root build, 97 files / 878 Vitest tests, CLI build, MCP-local skip, SDK build, SDK fixture, web lint/build, and web-next build.

### Decisions & alternatives

- Kept the feed response non-blocking, but made abandoned backend work visible and gated instead of treating abort as cancellation.
- Did not rerun the full 5-run memory gate in this entry; prior memory receipts remain valid for their recorded protocol, while future memory gates now include abandoned-backend-operation assertions.
- Kept staging/systemd, production traffic, credentials, DNS, deploys, and shared databases untouched.

## 2026-07-07 #01 — PROJ-1433 live metrics packet and paper/site refresh

**Branch:** `dev/PROJ-1433-recsys-live-metrics-packet`
**Commits:** see branch history for this PROJ-1433 refresh commit
**Files changed:** `docs/lab/2026-07-07-recsys-live-metrics-packet.md`, `README.md`, `web-next/lib/live-metrics-snapshot.ts`, `web-next/components/hero-section.tsx`, `web-next/components/dashboard-preview.tsx`, `web-next/app/demo/page.tsx`, `web-next/components/animated-section.tsx`, `web-next/components/ui/score-radar.tsx`, `tests/web-next-demo-fixtures.test.ts`, `docs/dev-journal.md`, external workspace paper draft `corgi-recsys2026-paper-draft.md`.

### What changed

- Added a dated PROJ-1433 metrics packet with public production endpoint commands, exact timestamps, raw metric values, counterfactual summaries, and caveats.
- Updated README and Corgi `web-next` homepage/demo copy from fake or stale figures to the 2026-07-07 live-production snapshot.
- Replaced the demo walkthrough's fake epoch 47 / 312-vote fixture with epoch 2, 3,348 scored posts, 3,007 unique authors, 0 current-epoch votes, and a public rank-1 post explanation receipt.
- Fixed two pre-existing `web-next` TypeScript validation blockers in animation and radar tooltip components so the branch can pass direct `npx tsc --noEmit`, not only the configured Next build that skips type validation.
- Addressed CodeRabbit's valid major privacy finding by anonymizing public UI receipt fixtures, moving shared snapshot values into `web-next/lib/live-metrics-snapshot.ts`, and adding a regression guard that rejects live Bluesky handles, DIDs, AT-URIs, and known receipt text in the public demo fixtures.
- Refreshed the external demo-paper draft with the same live numbers and downgraded the old Sybil-resistance paragraph to bounded simulation/mechanism evidence.

### Why

PROJ-1433 requires every metric used in the paper or site to have a receipt and to be classified as live production, demo-seeded, or simulation-derived. The prior paper draft still carried a 2026-06-27 snapshot and an obsolete Sybil-resistance claim pointing at a test file that no longer exists.

### Measurements

- `curl -sS https://feed.corgi.network/health`: pass, `{"status":"ok"}`.
- `curl -sS https://feed.corgi.network/api/transparency/stats`: pass; epoch 2 active, 3,348 scored posts, 3,007 unique authors, 0 current-epoch votes, median total score 0.5312066730135393.
- `curl -sS https://feed.corgi.network/api/governance/weights`: pass; recency 0.25, engagement 0.20, bridging 0.10, source diversity 0.10, relevance 0.35; epoch description says forced transition from epoch 1 with 2 votes.
- `curl -sS ...getFeedSkeleton...limit=100`: pass; returned 100 post URIs plus a cursor, proving a served page rather than total feed size.
- `curl -sS ...counterfactual?recency=0.2&engagement=0.5&bridging=0.1&source_diversity=0.1&relevance=0.1&limit=10`: pass; 4 posts moved up, 6 moved down, max rank change 13, average absolute rank change 4.1.
- `curl -sS .../api/transparency/post/<rank-1-uri>`: pass; total score 0.8486208006784361, community rank 1, pure-engagement rank 4, component rows recorded in the metrics packet.
- `git diff --check`: pass.
- `npx tsc --noEmit` from `web-next`: pass after the narrow type-only fixes.
- `npx vitest tests/web-next-demo-fixtures.test.ts --run`: pass, 1 file / 12 tests.
- `npm run docs:verify`: pass, 14 tracked docs / 29 markdown files scanned.
- Full `npm run verify` with dummy non-production env and local loopback/IPC permission: pass, including root build, 98 files / 890 Vitest tests, CLI build, MCP-local skip, SDK build, SDK fixture, web lint/build, and web-next build.
- CodeRabbit CLI `coderabbit review --agent -t committed -c .coderabbit.yaml`: returned 2 issues before this fix pass, 1 valid major privacy issue and 1 trivial drift issue; both were addressed in the public UI fixture update.
- Fresh strategyproofness simulation rerun did not produce a result in this worktree: Vitest/Testcontainers failed before tests with `Could not find a working container runtime strategy`, even though `docker info` showed Docker Desktop server 29.4.3 running.

### Decisions & alternatives

- Used only public endpoints for production receipts; no admin export, database query, cookie, bearer token, or host mutation was used.
- Treated the feed skeleton `limit=100` result as a served-page receipt, not total corpus volume.
- Removed hard Sybil-resistance wording from refreshed paper/site claims. Current safe wording is simulation/mechanism evidence only, and the metrics packet preserves the PROJ-1551 warning that synthetic voter populations do not prove real electorate behavior, Sybil resistance, personhood, or abuse resistance.
- Kept the `web-next` type fixes scoped to validation blockers discovered during PROJ-1433; no visual behavior was intentionally changed in those two helper components.
- Redacted the example production post's raw handle, post text, DID, and source URI from the public metrics packet and UI fixtures; public site and paper copy now use anonymized receipt labels while preserving the numeric proof.
