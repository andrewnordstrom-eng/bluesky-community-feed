import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import {
  applyNonTransactionalMigration,
  bootstrapLegacyMigrations,
  MigrationVerificationError,
  shouldRunMigrationInTransaction,
  splitSqlStatements,
  verifyRequiredMigrationSideEffects,
} from '../scripts/migrate.ts';

function asClient(queryImpl: Client['query']): Client {
  return { query: queryImpl } as unknown as Client;
}

describe('migration bootstrap for legacy schemas', () => {
  it('detects migrations that must run outside transaction wrappers', () => {
    expect(shouldRunMigrationInTransaction('')).toBe(true);
    expect(shouldRunMigrationInTransaction('CREATE TABLE example (id int);')).toBe(true);
    expect(shouldRunMigrationInTransaction('-- migrate: no-transaction')).toBe(false);
    expect(shouldRunMigrationInTransaction('SELECT 1;\n-- migrate: no-transaction')).toBe(false);
    expect(shouldRunMigrationInTransaction('-- migrate: no-transaction\nCREATE INDEX CONCURRENTLY idx ON example(id);')).toBe(false);
    expect(shouldRunMigrationInTransaction('-- migrate: no-transactional')).toBe(true);
    expect(shouldRunMigrationInTransaction("SELECT '-- migrate: no-transaction';")).toBe(true);
  });

  it('verifies the run-scoped post score index for migration 024', async () => {
    const queryMock = vi.fn(async () => ({
      rows: [{ index_exists: true, index_is_valid: true }],
    }));

    await expect(
      verifyRequiredMigrationSideEffects(
        asClient(queryMock as Client['query']),
        '024_post_scores_run_scope_index.sql'
      )
    ).resolves.toBeUndefined();

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('pg_index.indisvalid'), [
      'public.idx_scores_epoch_run_total',
      'public',
      'idx_scores_epoch_run_total',
    ]);
  });

  // PROJ-917 thread 8: migration 025 builds three CREATE INDEX CONCURRENTLY
  // indexes; verify all three get checked for indisvalid=true, not just one.
  it('verifies all three created_at indexes for migration 025', async () => {
    const checkedIndexNames: unknown[] = [];
    const queryMock = vi.fn(async (_sql: unknown, params?: unknown[]) => {
      checkedIndexNames.push(params?.[2]);
      return { rows: [{ index_exists: true, index_is_valid: true }] };
    });

    await expect(
      verifyRequiredMigrationSideEffects(
        asClient(queryMock as Client['query']),
        '025_raw_event_created_at_indexes.sql'
      )
    ).resolves.toBeUndefined();

    expect(checkedIndexNames).toEqual([
      'idx_follows_created',
      'idx_reposts_created',
      'idx_likes_created',
    ]);
  });

  it('refuses to mark migration 025 applied when any one of the three indexes is invalid', async () => {
    const queryMock = vi.fn(async (_sql: unknown, params?: unknown[]) => {
      const indexName = params?.[2];
      if (indexName === 'idx_likes_created') {
        return { rows: [{ index_exists: true, index_is_valid: false }] };
      }
      return { rows: [{ index_exists: true, index_is_valid: true }] };
    });

    await expect(
      verifyRequiredMigrationSideEffects(
        asClient(queryMock as Client['query']),
        '025_raw_event_created_at_indexes.sql'
      )
    ).rejects.toThrow(MigrationVerificationError);
  });

  it('refuses to mark migration 025 applied when an index is missing (to_regclass null)', async () => {
    // The other failure branch: CREATE INDEX CONCURRENTLY never ran or was
    // rolled back, so the index does not exist at all (distinct from existing-
    // but-invalid).
    const queryMock = vi.fn(async (_sql: unknown, params?: unknown[]) => {
      const indexName = params?.[2];
      if (indexName === 'idx_reposts_created') {
        return { rows: [{ index_exists: false, index_is_valid: false }] };
      }
      return { rows: [{ index_exists: true, index_is_valid: true }] };
    });

    await expect(
      verifyRequiredMigrationSideEffects(
        asClient(queryMock as Client['query']),
        '025_raw_event_created_at_indexes.sql'
      )
    ).rejects.toThrow(MigrationVerificationError);
  });

  it('refuses to mark migration 024 applied when the concurrent index is invalid', async () => {
    const inserted: string[] = [];
    const queryMock = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const queryText = String(sql);

      if (queryText.includes('CREATE INDEX CONCURRENTLY')) {
        return { rows: [] };
      }

      if (queryText.includes('pg_index.indisvalid')) {
        return { rows: [{ index_exists: true, index_is_valid: false }] };
      }

      if (queryText.includes('INSERT INTO schema_migrations')) {
        inserted.push(String(params?.[0] ?? ''));
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    await expect(
      applyNonTransactionalMigration(
        asClient(queryMock as Client['query']),
        '024_post_scores_run_scope_index.sql',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scores_epoch_run_total ON post_scores (epoch_id)'
      )
    ).rejects.toThrow(MigrationVerificationError);

    expect(inserted).toEqual([]);
  });

  it('marks detected legacy migrations as applied when tracking table is empty', async () => {
    const inserted: string[] = [];
    const queryMock = vi.fn(async (sql: unknown, params?: unknown[]) => {
      const queryText = String(sql);

      if (queryText.includes('to_regclass($1) IS NOT NULL AS exists')) {
        // Legacy schema detected on first sentinel table.
        return { rows: [{ exists: true }] };
      }

      if (queryText.includes('public.posts') && queryText.includes('subscribers')) {
        return { rows: [{ applied: true }] };
      }

      if (queryText.includes('public.post_scores')) {
        return { rows: [{ applied: false }] };
      }

      if (queryText.includes('INSERT INTO schema_migrations')) {
        inserted.push(String(params?.[0] ?? ''));
        return { rows: [] };
      }

      return { rows: [{ applied: false }] };
    });

    const files = ['001_initial_schema.sql', '002_scoring_tables.sql'];
    const applied = await bootstrapLegacyMigrations(asClient(queryMock as Client['query']), files, new Set());

    expect(applied.has('001_initial_schema.sql')).toBe(true);
    expect(applied.has('002_scoring_tables.sql')).toBe(false);
    expect(inserted).toEqual(['001_initial_schema.sql']);
  });

  // PROJ-917 / thread 6: the dollar-quote tag regex previously only allowed
  // `[a-zA-Z_]*` (no digits), so a tag like `$tag1$` was not recognized as a
  // dollar-quote delimiter at all, and a `;` inside that block would be
  // mis-split as a statement boundary.
  it('does not split on a semicolon inside a $tag1$ ... $tag1$ dollar-quoted block', () => {
    const sql = `DO $tag1$ BEGIN RAISE NOTICE 'a;b'; END $tag1$;`;
    expect(splitSqlStatements(sql)).toEqual([sql.replace(/;$/, '')]);
  });

  it('does not split on a semicolon inside a $$ ... $$ dollar-quoted block', () => {
    const sql = `DO $$ BEGIN RAISE NOTICE 'a;b'; END $$;`;
    expect(splitSqlStatements(sql)).toEqual([sql.replace(/;$/, '')]);
  });

  it('does not bootstrap on fresh schema without sentinel tables', async () => {
    const queryMock = vi.fn(async (sql: unknown) => {
      const queryText = String(sql);
      if (queryText.includes('to_regclass($1) IS NOT NULL AS exists')) {
        return { rows: [{ exists: false }] };
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    const files = ['001_initial_schema.sql', '002_scoring_tables.sql'];
    const applied = await bootstrapLegacyMigrations(asClient(queryMock as Client['query']), files, new Set());

    expect(applied.size).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
