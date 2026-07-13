import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { readGovernanceVoteCounts } from '../src/governance/vote-counts.js';

describe('readGovernanceVoteCounts', () => {
  it('counts all ballots while separating content-rule and topic ballots', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ total: '25', content: '8', topic: '19' }],
    });
    const client = { query } as unknown as PoolClient;

    await expect(readGovernanceVoteCounts(client, 7)).resolves.toEqual({
      total: 25,
      content: 8,
      topic: 19,
    });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('COUNT(*)::int AS total');
    expect(String(sql)).toContain('array_length(include_keywords, 1) > 0');
    expect(String(sql)).toContain('array_length(exclude_keywords, 1) > 0');
    expect(String(sql)).toContain("topic_weight_votes != '{}'::jsonb");
    expect(params).toEqual([7]);
  });

  it('returns zeroes for an empty voting window', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [{ total: '0', content: '0', topic: '0' }],
      }),
    } as unknown as PoolClient;

    await expect(readGovernanceVoteCounts(client, 9)).resolves.toEqual({
      total: 0,
      content: 0,
      topic: 0,
    });
  });
});
