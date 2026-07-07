import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/db/migrations');
const MIGRATIONS_TABLE = 'schema_migrations';
const NON_TRANSACTIONAL_MIGRATION_MARKER = '-- migrate: no-transaction';
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

export function shouldRunMigrationInTransaction(sql: string): boolean {
  return !sql.includes(NON_TRANSACTIONAL_MIGRATION_MARKER);
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
          await client.query(sql);
          await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [filename]);
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
