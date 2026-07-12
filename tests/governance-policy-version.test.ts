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

const COMPLETE_WEIGHT_ROWS = [
  { component_key: 'bridging', weight: '0.2' },
  { component_key: 'engagement', weight: '0.2' },
  { component_key: 'recency', weight: '0.2' },
  { component_key: 'relevance', weight: '0.2' },
  { component_key: 'sourceDiversity', weight: '0.2' },
];

function activeEpoch(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 7,
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    topic_weights: { science: 0.7 },
    content_rules: { include_keywords: [], exclude_keywords: ['spam'] },
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function policyAudit(details: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 99,
    action: 'weights_changed',
    details,
    created_at: '2026-07-01T00:00:01.000Z',
  };
}

function materializationMock(options: {
  epochRows?: readonly Record<string, unknown>[];
  weightRows?: readonly Record<string, unknown>[];
  auditRows?: readonly Record<string, unknown>[];
  policyInsertRows?: readonly Record<string, unknown>[];
  existingRows?: readonly Record<string, unknown>[];
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes('FROM governance_epochs')) {
      return { rows: options.epochRows ?? [activeEpoch({})] };
    }
    if (sql.includes('FROM governance_epoch_weights')) {
      return { rows: options.weightRows ?? COMPLETE_WEIGHT_ROWS };
    }
    if (sql.includes('FROM governance_audit_log')) {
      return { rows: options.auditRows ?? [policyAudit({
        new_weights: {
          recency: 0.2,
          engagement: 0.2,
          bridging: 0.2,
          sourceDiversity: 0.2,
          relevance: 0.2,
        },
      })] };
    }
    if (sql.includes('INSERT INTO governance_policy_versions')) {
      return {
        rows: options.policyInsertRows ?? [{
          id: '00000000-0000-4000-8000-000000000007',
          policy_hash: params?.[8],
          reconciliation_status: params?.[9],
          created_at: '2026-07-11T20:00:00.000Z',
        }],
      };
    }
    if (sql.includes('FROM governance_policy_versions')) {
      return { rows: options.existingRows ?? [] };
    }
    if (sql.includes('INSERT INTO governance_policy_reconciliation_events')) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
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
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
      queries.push(sql);
      calls.push({ sql, params });
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
            policy_hash: params[8],
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

    const policyInsert = calls.find((call) => call.sql.includes('INSERT INTO governance_policy_versions'));
    expect(policyInsert?.params).toHaveLength(10);
    expect(policyInsert?.params.slice(0, 3)).toEqual(['community-gov', 7, 'corgi-ranking-v2']);
    expect(JSON.parse(String(policyInsert?.params[3]))).toEqual(result.bundle.weights);
    expect(JSON.parse(String(policyInsert?.params[4]))).toEqual({ science: 0.7 });
    expect(JSON.parse(String(policyInsert?.params[5]))).toEqual({
      exclude_keywords: ['spam'],
      include_keywords: [],
    });
    expect(policyInsert?.params[6]).toBe('2026-07-11T20:00:00.000Z');
    expect(JSON.parse(String(policyInsert?.params[7]))).toHaveLength(3);
    expect(policyInsert?.params[8]).toMatch(/^[0-9a-f]{64}$/);
    expect(policyInsert?.params[9]).toBe('match');

    const reconciliationInsert = calls.find(
      (call) => call.sql.includes('INSERT INTO governance_policy_reconciliation_events')
    );
    expect(reconciliationInsert?.params).toHaveLength(10);
    expect(reconciliationInsert?.params.slice(0, 4)).toEqual([
      '00000000-0000-4000-8000-000000000007',
      'community-gov',
      7,
      'match',
    ]);
    expect(JSON.parse(String(reconciliationInsert?.params[4]))).toEqual(result.bundle.weights);
    expect(JSON.parse(String(reconciliationInsert?.params[5]))).toEqual(result.bundle.weights);
    expect(JSON.parse(String(reconciliationInsert?.params[6]))).toEqual(result.bundle.weights);
    expect(reconciliationInsert?.params[7]).toEqual([99]);
    expect(reconciliationInsert?.params[8]).toBe(result.evidenceHash);
    expect(JSON.parse(String(reconciliationInsert?.params[9]))).toEqual({
      policyHash: result.bundle.policyHash,
    });
  });

  it.each([
    ['no policy audit rows', []],
    ['a null audit weight payload', [policyAudit({ new_weights: null })]],
  ] as const)('preserves incomplete evidence for %s', async (_label, auditRows) => {
    const query = materializationMock({ auditRows });
    const result = await materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    });
    expect(result.bundle.reconciliationStatus).toBe('incomplete_evidence');
    const policyInsert = query.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO governance_policy_versions')
    );
    expect(policyInsert?.[1]?.[9]).toBe('incomplete_evidence');
  });

  it.each([
    [
      'wide epoch weights differ',
      activeEpoch({ recency_weight: 0.3, engagement_weight: 0.1 }),
      [policyAudit({ new_weights: {
        recency: 0.2, engagement: 0.2, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2,
      } })],
    ],
    [
      'audit weights differ',
      activeEpoch({}),
      [policyAudit({ new_weights: {
        recency: 0.3, engagement: 0.1, bridging: 0.2, sourceDiversity: 0.2, relevance: 0.2,
      } })],
    ],
  ] as const)('preserves a conflict when %s', async (_label, epoch, auditRows) => {
    const query = materializationMock({ epochRows: [epoch], auditRows });
    const result = await materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    });
    expect(result.bundle.reconciliationStatus).toBe('conflict_preserved');
  });

  it('loads the existing immutable policy on an idempotent rerun and still records evidence', async () => {
    const query = materializationMock({
      policyInsertRows: [],
      existingRows: [{
        id: '00000000-0000-4000-8000-000000000007',
        policy_hash: 'a'.repeat(64),
        reconciliation_status: 'match',
        created_at: '2026-07-11T20:00:00.000Z',
      }],
    });
    const result = await materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    });
    expect(result.created).toBe(false);
    expect(query.mock.calls.some(([sql]: [string]) => sql.includes('FROM governance_policy_versions')))
      .toBe(true);
    const evidenceInsert = query.mock.calls.find(
      ([sql]: [string]) => sql.includes('INSERT INTO governance_policy_reconciliation_events')
    );
    expect(evidenceInsert?.[0]).toContain('ON CONFLICT (policy_version_id, evidence_hash) DO NOTHING');
  });

  it('rejects materialization when no active epoch exists', async () => {
    const query = materializationMock({ epochRows: [] });
    await expect(materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    })).rejects.toThrow('no active governance epoch');
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

  it('fails closed when serving long-table weights are partial', async () => {
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
      if (sql.includes('FROM governance_epoch_weights')) {
        return {
          rows: [
            { component_key: 'recency', weight: '0.5' },
            { component_key: 'engagement', weight: '0.5' },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    })).rejects.toThrow('serving weight keys do not match registry');
  });

  it('fails closed when serving weights do not sum to one', async () => {
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
      if (sql.includes('FROM governance_epoch_weights')) {
        return {
          rows: [
            { component_key: 'bridging', weight: '0.1' },
            { component_key: 'engagement', weight: '0.1' },
            { component_key: 'recency', weight: '0.1' },
            { component_key: 'relevance', weight: '0.1' },
            { component_key: 'sourceDiversity', weight: '0.1' },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(materializeActivePolicyVersion(asClient(query), {
      communityId: 'community-gov',
      algorithmVersion: 'corgi-ranking-v2',
      effectiveAt: '2026-07-11T20:00:00.000Z',
      provenanceReferences: [],
    })).rejects.toThrow('serving weights total 0.5, expected 1');
  });
});
