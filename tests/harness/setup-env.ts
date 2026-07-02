/**
 * Per-test-file environment setup for the A1 simulation-harness suite.
 *
 * `src/config.ts` runs `ConfigSchema.parse(process.env)` synchronously at
 * *import time* (see docs/agent build-bible §6), so every required env var
 * must exist in `process.env` BEFORE any test file statically imports
 * anything under `src/**` (directly, or transitively via
 * `src/harness/index.ts`). Vitest's `setupFiles` run to completion before
 * the test file's own module graph is evaluated, so this file — not a
 * `beforeAll` inside a test — is the only place this can be done safely for
 * a plain top-level `import`.
 *
 * `inject()` reads the Testcontainers connection URLs the globalSetup
 * (`global-setup.ts`) handed off via `project.provide`.
 */

import { inject } from 'vitest';

// @testcontainers/postgresql's `getConnectionUri()` returns the short
// `postgres://` scheme; `src/config.ts` requires the literal `postgresql://`
// prefix (`z.string().startsWith('postgresql://')`). Both are the same
// connection string as far as `pg` is concerned — normalize the scheme so
// `ConfigSchema.parse` accepts it.
const databaseUrl = inject('corgiSimPgUrl').replace(/^postgres:\/\//, 'postgresql://');
const redisUrl = inject('corgiSimRedisUrl');

process.env.DATABASE_URL = databaseUrl;
process.env.REDIS_URL = redisUrl;

// The harness never talks to Jetstream/Bluesky/a real bot account — these
// are placeholder values that only need to satisfy `ConfigSchema`'s shape
// (`did:` prefix, valid URL, non-empty string) so `src/config.ts` parses.
process.env.FEEDGEN_SERVICE_DID ??= 'did:plc:corgisimharness00000000000';
process.env.FEEDGEN_PUBLISHER_DID ??= 'did:plc:corgisimharnesspublisher0';
process.env.FEEDGEN_HOSTNAME ??= 'sim-harness.local.test';
process.env.JETSTREAM_URL ??= 'wss://sim-harness.local.test/subscribe';
process.env.JETSTREAM_FALLBACK_URL ??= 'wss://sim-harness.local.test/subscribe-fallback';
process.env.JETSTREAM_COLLECTIONS ??= 'app.bsky.feed.post';
process.env.BSKY_IDENTIFIER ??= 'sim-harness.test';
process.env.BSKY_APP_PASSWORD ??= 'sim-harness-not-a-real-password';

// Explicit, defense-in-depth: never let a simulation run post to Bluesky or
// enable the semantic embedding classifier (irrelevant to A1, and slower).
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'warn';
process.env.BOT_ENABLED ??= 'false';
process.env.TOPIC_EMBEDDING_ENABLED ??= 'false';
