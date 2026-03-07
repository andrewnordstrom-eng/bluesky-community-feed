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

## 2026-03-06 — Security Audit & Merge to Main
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

## 2026-03-06 — Admin CLI & Research Export API
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

## 2026-03-06 — MCP Server for Feed Administration
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

## 2026-03-06 — Topic Engine Phase 1: Content Labels & Topic Taxonomy
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

## 2026-03-06 — Topic Engine Phase 2: winkNLP Classifier & Ingestion Integration
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

## 2026-03-06 — Topic Engine Phase 3: Community Topic Voting & Relevance Scoring

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

## 2026-03-06 — Topic Engine Phase 4: Frontend Topic Voting & Dashboard

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

## 2026-03-06 — Topic Engine Phase 5: Admin Tooling, CLI, MCP & Export Integration

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
