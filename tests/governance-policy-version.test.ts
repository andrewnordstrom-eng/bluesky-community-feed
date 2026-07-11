import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  computePolicyHash,
  materializeActivePolicyVersion,
} from '../src/governance/policy-version.js';
import type { GovernancePolicyDocument } from '../src/shared/ranking-contracts.js';

function asClient(query: ReturnType<typeof vi.fn>): PoolClient {
  return { query } as unknown as PoolClient;
}

function policyDocument(overrides: Partial<GovernancePolicyDocument>): GovernancePolicyDocument {
  return {
    communityId: 'community-gov',
    epochId: 7,
    algorithmVersion: 'corgi-ranking-v2',
    weights: {
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    },
    topicWeights: { science: 0.7 },
    contentRules: { include_keywords: [], exclude_keywords: ['spam'] },
    effectiveAt: '2026-07-11T20:00:00.000Z',
    provenanceReferences: [],
    ...overrides,
  };
}

describe('governance policy canonicalization', () => {
  it('produces the same hash regardless of object insertion order', () => {
    const first = policyDocument({
      weights: { recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2 },
      contentRules: { include_keywords: ['corgi'], exclude_keywords: ['spam'] },
    });
    const second = policyDocument({
      weights: { relevance: 0.2, sourceDiversity: 0.2, bridging: 0.2, engagement: 0.2, recency: 0.2 },
      contentRules: { exclude_keywords: ['spam'], include_keywords: ['corgi'] },
    });

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(computePolicyHash(first)).toBe(computePolicyHash(second));
  });

  it('preserves array order because it is policy-significant', () => {
    const first = policyDocument({ contentRules: { include_keywords: ['a', 'b'] } });
    const second = policyDocument({ contentRules: { include_keywords: ['b', 'a'] } });
    expect(computePolicyHash(first)).not.toBe(computePolicyHash(second));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite numeric policy values: %s',
    (value) => {
      expect(() => canonicalJson({ weight: value })).toThrow('non-finite');
    }
  );

  it('rejects cyclic policy objects', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('cyclic');
  });
});

describe('active policy materialization', () => {
  it('materializes serving long-table weights and appends reconciliation evidence', async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM governance_epochs')) {
        return {
          rows: [{
            id: 7,
            recency_weight: 0.2,
            engagement_weight: 0.2,
            bridging_weight: 0.2,
            source_diversity_weight: 0.2,
            relevance_weight: 0.2,
            topic_weights: { science: 0.7 },
            content_rules: { include_keywords: [], exclude_keywords: ['spam'] },
            created_at: '2026-07-01T00:00:00.000Z',
          }],
        };
      }
      if (sql.includes('FROM governance_epoch_weights')) {
        return {
          rows: [
            { component_key: 'bridging', weight: '0.2' },
            { component_key: 'engagement', weight: '0.2' },
            { component_key: 'recency', weight: '0.2' },
            { component_key: 'relevance', weight: '0.2' },
            { component_key: 'sourceDiversity', weight: '0.2' },
          ],
        };
      }
      if (sql.includes('FROM governance_audit_log')) {
        return {
          rows: [{
            id: 99,
            action: 'weights_changed',
            details: {
              new_weights: {
                recency: 0.2,
                engagement: 0.2,
                bridging: 0.2,
                sourceDiversity: 0.2,
                relevance: 0.2,
              },
            },
            created_at: '2026-07-01T00:00:01.000Z',
          }],
        };
      }
      if (sql.includes('INSERT INTO governance_policy_versions')) {
        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000007',
            policy_hash: 'a'.repeat(64),
            reconciliation_status: 'match',
            created_at: '2026-07-11T20:00:00.000Z',
          }],
        };
      }
      if (sql.includes('INSERT INTO governance_policy_reconciliation_events')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [{
        kind: 'migration',
        reference: 'PROJ-1758',
        observedAt: '2026-07-11T20:00:00.000Z',
      }],
    });

    expect(result.created).toBe(true);
    expect(result.bundle.weights).toEqual({
      bridging: 0.2,
      engagement: 0.2,
      recency: 0.2,
      relevance: 0.2,
      sourceDiversity: 0.2,
    });
    expect(result.bundle.reconciliationStatus).toBe('match');
    expect(result.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(queries.some((sql) => sql.includes('governance_policy_reconciliation_events'))).toBe(true);
    expect(queries.some((sql) => /^\s*UPDATE\s+governance_audit_log/i.test(sql))).toBe(false);
  });

  it('fails closed when the active epoch lacks serving long-table weights', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM governance_epochs')) {
        return {
          rows: [{
            id: 7,
            recency_weight: 0.2,
            engagement_weight: 0.2,
            bridging_weight: 0.2,
            source_diversity_weight: 0.2,
            relevance_weight: 0.2,
            topic_weights: {},
            content_rules: {},
            created_at: '2026-07-01T00:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    await expect(materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    })).rejects.toThrow('serving weight rows are missing');
  });
});
