import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/db/migrations');
const MIGRATIONS_TABLE = 'schema_migrations';
const NON_TRANSACTIONAL_MIGRATION_MARKER = '-- migrate: no-transaction';
const NON_TRANSACTIONAL_MIGRATION_MARKER_PATTERN = new RegExp(
  `^\\s*${escapeRegExp(NON_TRANSACTIONAL_MIGRATION_MARKER)}\\s*$`,
  'm'
);
// Migrations that build CREATE INDEX CONCURRENTLY indexes must be verified
// post-hoc: a canceled/failed concurrent build leaves an INVALID index
// behind (pg_index.indisvalid = false) rather than rolling back, since
// CONCURRENTLY doesn't run inside a transaction. Maps migration filename ->
// the index name(s) (schema `public`) that migration must leave valid.
const MIGRATION_REQUIRED_INDEXES: Record<string, readonly string[]> = {
  '024_post_scores_run_scope_index.sql': ['idx_scores_epoch_run_total'],
  // PROJ-917 thread 8: same statement_timeout-cancellation risk applies to
  // this migration's three CONCURRENTLY builds (see that migration's own
  // SET statement_timeout = 0 fix).
  '025_raw_event_created_at_indexes.sql': [
    'idx_follows_created',
    'idx_reposts_created',
    'idx_likes_created',
  ],
};
const LEGACY_MIGRATION_SENTINEL_TABLES = ['posts', 'governance_epochs', 'post_scores'] as const;

const LEGACY_MIGRATION_PROBES: Record<string, string> = {
  '001_initial_schema.sql': `
    SELECT (
      to_regclass('public.posts') IS NOT NULL
      AND to_regclass('public.subscribers') IS NOT NULL
      AND to_regclass('public.jetstream_cursor') IS NOT NULL
    ) AS applied
  `,
  '002_scoring_tables.sql': `
    SELECT (to_regclass('public.post_scores') IS NOT NULL) AS applied
  `,
  '003_governance_tables.sql': `
    SELECT (
      to_regclass('public.governance_epochs') IS NOT NULL
      AND to_regclass('public.governance_votes') IS NOT NULL
      AND to_regclass('public.governance_audit_log') IS NOT NULL
    ) AS applied
  `,
  '004_transparency_tables.sql': `
    SELECT (to_regclass('public.epoch_metrics') IS NOT NULL) AS applied
  `,
  '005_bot_tables.sql': `
    SELECT (to_regclass('public.bot_announcements') IS NOT NULL) AS applied
  `,
  '006_content_governance.sql': `
    SELECT (
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'governance_epochs'
          AND column_name = 'content_rules'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'governance_votes'
          AND column_name = 'include_keywords'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'governance_votes'
          AND column_name = 'exclude_keywords'
      )
    ) AS applied
  `,
  '007_epoch_scheduling.sql': `
    SELECT (
      to_regclass('public.system_status') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'governance_epochs'
          AND column_name = 'voting_ends_at'
      )
    ) AS applied
  `,
  '008_audit_log_append_only.sql': `
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'governance_audit_log_append_only'
        AND tgrelid = 'governance_audit_log'::regclass
    ) AS applied
  `,
  '009_governance_phases.sql': `
    SELECT (
      to_regclass('public.scheduled_votes') IS NOT NULL
      AND to_regclass('public.announcement_settings') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'governance_epochs'
          AND column_name = 'phase'
      )
    ) AS applied
  `,
  '010_posts_text_trgm_index.sql': `
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_posts_text_trgm'
    ) AS applied
  `,
};

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((filename) => filename.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function queryBoolean(client: pg.Client, sql: string): Promise<boolean> {
  const result = await client.query<{ applied: boolean }>(sql);
  return result.rows[0]?.applied === true;
}

export class MigrationVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationVerificationError';
  }
}

export function shouldRunMigrationInTransaction(sql: string): boolean {
  return !NON_TRANSACTIONAL_MIGRATION_MARKER_PATTERN.test(sql);
}

export async function verifyRequiredMigrationSideEffects(
  client: pg.Client,
  filename: string
): Promise<void> {
  const requiredIndexes = MIGRATION_REQUIRED_INDEXES[filename];
  if (!requiredIndexes) {
    return;
  }

  const failures: string[] = [];

  for (const indexName of requiredIndexes) {
    const regclass = `public.${indexName}`;
    const result = await client.query<{ index_exists: boolean; index_is_valid: boolean }>(
      `
        SELECT
          to_regclass($1) IS NOT NULL AS index_exists,
          COALESCE((
            SELECT pg_index.indisvalid
            FROM pg_class index_class
            JOIN pg_index ON pg_index.indexrelid = index_class.oid
            JOIN pg_namespace namespace ON namespace.oid = index_class.relnamespace
            WHERE namespace.nspname = $2
              AND index_class.relname = $3
          ), false) AS index_is_valid
      `,
      [regclass, 'public', indexName]
    );
    const verification = result.rows[0];

    if (verification?.index_exists === true && verification.index_is_valid === true) {
      continue;
    }

    failures.push(
      `${regclass}: index_exists=${String(verification?.index_exists ?? false)} ` +
        `index_is_valid=${String(verification?.index_is_valid ?? false)}`
    );
  }

  if (failures.length === 0) {
    return;
  }

  throw new MigrationVerificationError(
    `Migration ${filename} did not leave valid required indexes: ${failures.join('; ')}`
  );
}

/**
 * Split a SQL script into individually-executable statements.
 *
 * PROJ-917 discovered this the hard way: PostgreSQL's simple query protocol
 * implicitly wraps multiple `;`-separated statements sent in a *single*
 * message into one transaction block — and `CREATE INDEX CONCURRENTLY`
 * refuses to run inside ANY transaction block, explicit or implicit
 * ("CREATE INDEX CONCURRENTLY cannot run inside a transaction block").
 * Migration 025 sends a `SET ...;` followed by three
 * `CREATE INDEX CONCURRENTLY ...;` statements as one file — passing that
 * whole string to a single `client.query(sql)` call (as this function used
 * to) hits exactly that error. Migration 024 never hit it only because it
 * happens to be a single statement. Executing one `client.query()` call per
 * statement avoids the implicit wrapping entirely; a session-scoped `SET`
 * still applies to the later statements because they all run on the same
 * `client` (same underlying connection), regardless of being separate
 * query() calls.
 *
 * Quote/dollar-quote/comment aware, so a `;` inside a string literal,
 * quoted identifier, `$tag$...$tag$` block, `--` line comment, or a
 * slash-star block comment is never mistaken for a statement separator —
 * migration 025 has exactly this case (a `;` inside a `--` comment
 * sentence).
 * Deliberately simple — sufficient for the no-transaction migrations this
 * repo has today (plain DDL, no nested statements); extend it if a future
 * one needs more.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') {
        inLineComment = false;
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '*' && sql[i + 1] === '/') {
        current += '/';
        i += 2;
        inBlockComment = false;
      } else {
        i++;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += ch;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        inSingleQuote = false;
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') {
        inDoubleQuote = false;
      }
      i++;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      inLineComment = true;
      current += '--';
      i += 2;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      inBlockComment = true;
      current += '/*';
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === '$') {
      // Dollar-quote tag rules (PostgreSQL docs, "Dollar-Quoted String
      // Constants"): a tag follows the rules for an unquoted identifier —
      // must start with a letter or underscore, subsequent characters can
      // be letters, digits, or underscores — except it additionally cannot
      // contain a dollar sign. `[a-zA-Z_]*` (no digits at all) rejected
      // legitimate tags like `$tag1$`, causing any `;` inside that block to
      // be mis-split as a statement boundary.
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const trimmedTail = current.trim();
  if (trimmedTail.length > 0) {
    statements.push(trimmedTail);
  }

  return statements;
}

export async function applyNonTransactionalMigration(
  client: pg.Client,
  filename: string,
  sql: string
): Promise<void> {
  for (const statement of splitSqlStatements(sql)) {
    await client.query(statement);
  }
  await verifyRequiredMigrationSideEffects(client, filename);
  await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [filename]);
}

export async function detectLegacySchema(client: pg.Client): Promise<boolean> {
  for (const tableName of LEGACY_MIGRATION_SENTINEL_TABLES) {
    const result = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [`public.${tableName}`]
    );
    if (result.rows[0]?.exists === true) {
      return true;
    }
  }

  return false;
}

export async function bootstrapLegacyMigrations(
  client: pg.Client,
  files: string[],
  applied: Set<string>
): Promise<Set<string>> {
  if (applied.size > 0) {
    return applied;
  }

  const hasLegacySchema = await detectLegacySchema(client);
  if (!hasLegacySchema) {
    return applied;
  }

  console.log('[bootstrap] detected existing schema with empty migration tracking');

  const bootstrapped = new Set(applied);
  for (const filename of files) {
    const probe = LEGACY_MIGRATION_PROBES[filename];
    if (!probe) {
      continue;
    }

    const isApplied = await queryBoolean(client, probe);
    if (!isApplied) {
      continue;
    }

    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
      [filename]
    );
    bootstrapped.add(filename);
    console.log(`[bootstrap] ${filename}`);
  }

  return bootstrapped;
}

export async function runMigrations(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const files = await getMigrationFiles();
    const appliedResult = await client.query<{ filename: string }>(
      `SELECT filename FROM ${MIGRATIONS_TABLE}`
    );
    let applied = new Set(appliedResult.rows.map((row) => row.filename));
    applied = await bootstrapLegacyMigrations(client, files, applied);

    if (files.length === 0) {
      console.log(`No migration files found in ${MIGRATIONS_DIR}`);
      return;
    }

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`[skip] ${filename}`);
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, filename);
      const sql = await readFile(migrationPath, 'utf8');

      console.log(`[apply] ${filename}`);
      if (!shouldRunMigrationInTransaction(sql)) {
        try {
          await applyNonTransactionalMigration(client, filename, sql);
          console.log(`[done] ${filename}`);
        } catch (err) {
          console.error(`[failed] ${filename}`);
          throw err;
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [filename]);
        await client.query('COMMIT');
        console.log(`[done] ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[failed] ${filename}`);
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

function isMainModule(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runMigrations().catch((err) => {
    console.error('Migration run failed');
    console.error(err);
    process.exit(1);
  });
}
