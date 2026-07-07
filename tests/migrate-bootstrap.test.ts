import { describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import {
  applyNonTransactionalMigration,
  bootstrapLegacyMigrations,
  MigrationVerificationError,
  shouldRunMigrationInTransaction,
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
