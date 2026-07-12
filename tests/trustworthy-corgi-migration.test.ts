import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../src/db/migrations/032_trustworthy_corgi_contracts.sql',
  import.meta.url
);

describe('Trustworthy Corgi migration contract', () => {
  it('is additive and creates every Packet 1 durable surface', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    for (const table of [
      'governance_policy_versions',
      'governance_policy_reconciliation_events',
      'ranking_runs',
      'ranking_run_events',
      'ranking_run_items',
      'ranking_run_inputs',
      'ranking_run_requests',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  it('enforces immutable policies, run transitions, and retention windows in the database', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toContain('governance_policy_versions_immutable');
    expect(sql).toContain('corgi_validate_ranking_run_transition');
    expect(sql).toContain("INTERVAL '7 days'");
    expect(sql).toContain("INTERVAL '30 days'");
    expect(sql).toContain('corgi_protect_retained_ranking_input');
    expect(sql).toContain('corgi_protect_ranking_run_manifest');
  });

  it('binds ranking runs to the exact immutable policy hash', async () => {
    const sql = await readFile(migrationUrl, 'utf8');
    expect(sql).toMatch(
      /FOREIGN KEY \(policy_version_id, policy_hash\)[\s\S]*REFERENCES governance_policy_versions\(id, policy_hash\)/
    );
    expect(sql).toContain("policy_hash ~ '^[0-9a-f]{64}$'");
  });
});
