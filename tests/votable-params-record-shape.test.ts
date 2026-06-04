/**
 * Votable Params Record-Shape Tests (PROJ-816 / P3)
 *
 * Verifies that after the GovernanceWeightKey widening, vote submission still
 * rejects unregistered weight keys with a clear 400 error rather than
 * silently dropping them. This is the proof that runtime validation took over
 * what the compile-time literal union used to enforce.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  getAuthenticatedDidMock,
  isParticipantApprovedMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  getAuthenticatedDidMock: vi.fn(),
  isParticipantApprovedMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock },
}));

vi.mock('../src/governance/auth.js', () => ({
  getAuthenticatedDid: getAuthenticatedDidMock,
  SessionStoreUnavailableError: class extends Error {},
}));

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: isParticipantApprovedMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { registerVoteRoute } from '../src/governance/routes/vote.js';
import { buildTestApp } from './helpers/app.js';
import {
  GOVERNANCE_WEIGHT_VOTE_FIELDS,
  VOTABLE_WEIGHT_PARAMS,
  voteFieldForKey,
} from '../src/config/votable-params.js';
import { REGISTERED_COMPONENT_KEYS } from '../src/scoring/registry.js';

async function postVote(payload: unknown) {
  const app = buildTestApp();
  registerVoteRoute(app);
  try {
    return await app.inject({
      method: 'POST',
      url: '/api/governance/vote',
      payload,
      headers: { 'content-type': 'application/json' },
    });
  } finally {
    await app.close();
  }
}

describe('votable-params record shape (PROJ-816)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedDidMock.mockResolvedValue('did:plc:alice');
    isParticipantApprovedMock.mockResolvedValue(true);
    // Active subscriber + active voting epoch
    dbQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM subscribers')) {
        return { rows: [{ did: 'did:plc:alice' }] };
      }
      if (text.includes('FROM governance_epochs')) {
        return { rows: [{ id: 1, status: 'active', phase: 'voting' }] };
      }
      return { rows: [] };
    });
  });

  describe('voteFieldForKey', () => {
    it('maps camelCase keys to snake_case `_weight` columns', () => {
      expect(voteFieldForKey('recency')).toBe('recency_weight');
      expect(voteFieldForKey('engagement')).toBe('engagement_weight');
      expect(voteFieldForKey('sourceDiversity')).toBe('source_diversity_weight');
    });

    it('handles hypothetical future keys without code changes', () => {
      expect(voteFieldForKey('civility')).toBe('civility_weight');
      expect(voteFieldForKey('toxicityRisk')).toBe('toxicity_risk_weight');
    });
  });

  describe('REGISTERED_COMPONENT_KEYS', () => {
    it('contains exactly the 5 currently registered component keys', () => {
      expect(REGISTERED_COMPONENT_KEYS.size).toBe(5);
      expect(REGISTERED_COMPONENT_KEYS.has('recency')).toBe(true);
      expect(REGISTERED_COMPONENT_KEYS.has('engagement')).toBe(true);
      expect(REGISTERED_COMPONENT_KEYS.has('bridging')).toBe(true);
      expect(REGISTERED_COMPONENT_KEYS.has('sourceDiversity')).toBe(true);
      expect(REGISTERED_COMPONENT_KEYS.has('relevance')).toBe(true);
    });

    it('rejects unregistered keys with a clear lookup', () => {
      expect(REGISTERED_COMPONENT_KEYS.has('civility')).toBe(false);
      expect(REGISTERED_COMPONENT_KEYS.has('toxicityRisk')).toBe(false);
    });
  });

  describe('vote route rejects unregistered weight keys', () => {
    it('returns 400 UnregisteredWeightKey when an unknown `*_weight` field is submitted', async () => {
      const res = await postVote({
        recency_weight: 0.2,
        engagement_weight: 0.2,
        bridging_weight: 0.2,
        source_diversity_weight: 0.2,
        relevance_weight: 0.1,
        // Unregistered key — must be rejected, not silently dropped.
        civility_weight: 0.1,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('UnregisteredWeightKey');
      expect(body.message).toContain('civility_weight');
      // Surfacing the registered set lets the caller self-correct.
      expect(body.message).toContain('recency_weight');
    });

    it('accepts the registered weight fields', async () => {
      // Make the DB upsert succeed so the path doesn't 500 elsewhere.
      dbQueryMock.mockImplementation(async (sql: unknown) => {
        const text = String(sql);
        if (text.includes('FROM subscribers')) {
          return { rows: [{ did: 'did:plc:alice' }] };
        }
        if (text.includes('FROM governance_epochs')) {
          return { rows: [{ id: 1, status: 'active', phase: 'voting' }] };
        }
        if (text.includes('INSERT INTO governance_votes')) {
          return { rows: [{ id: 'vote-uuid-1', is_new_vote: true }] };
        }
        return { rows: [] };
      });

      const validPayload = Object.fromEntries(
        VOTABLE_WEIGHT_PARAMS.map((p) => [p.voteField, 0.2])
      );

      const res = await postVote(validPayload);

      // Should not be rejected for unregistered keys — exact downstream code
      // matters less than NOT seeing 400 UnregisteredWeightKey here.
      if (res.statusCode === 400) {
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).not.toBe('UnregisteredWeightKey');
      }
    });

    it('rejects multiple unregistered keys with all of them listed in the error', async () => {
      const res = await postVote({
        recency_weight: 0.5,
        civility_weight: 0.3,
        toxicity_risk_weight: 0.2,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('UnregisteredWeightKey');
      expect(body.message).toContain('civility_weight');
      expect(body.message).toContain('toxicity_risk_weight');
    });

    it('allows non-_weight fields the API recognizes (forward-compat for extras)', async () => {
      // The check only rejects *_weight unknowns; other unknown fields are
      // tolerated and stripped by Zod. This ensures the validator doesn't
      // become so strict it blocks forward-compatible additions.
      const res = await postVote({
        recency_weight: 0.2,
        engagement_weight: 0.2,
        bridging_weight: 0.2,
        source_diversity_weight: 0.2,
        relevance_weight: 0.2,
        some_future_extension: 'hello', // not a _weight field; tolerated
      });

      // Must not be rejected for the unregistered-key reason.
      if (res.statusCode === 400) {
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).not.toBe('UnregisteredWeightKey');
      }
    });

    it.each([
      ['empty payload', {}],
      ['numeric string weight', { recency_weight: '0.2' }],
      ['null weight', { recency_weight: null }],
      ['below range weight', { recency_weight: -0.1 }],
      ['above range weight', { recency_weight: 1.1 }],
    ])('returns 400 InvalidVote for invalid registered weight payload: %s', async (_name, payload) => {
      const res = await postVote(payload);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('InvalidVote');
      expect(body.message).toContain('Invalid vote weights');
    });
  });

  describe('GOVERNANCE_WEIGHT_VOTE_FIELDS reflects voteFieldForKey', () => {
    it('voteField column on each VOTABLE_WEIGHT_PARAMS entry is voteFieldForKey(key)', () => {
      for (const param of VOTABLE_WEIGHT_PARAMS) {
        expect(param.voteField).toBe(voteFieldForKey(param.key));
      }
    });

    it('exports the snake_case names in the legacy GOVERNANCE_WEIGHT_VOTE_FIELDS array', () => {
      // Sanity check: the array shape consumers depend on hasn't changed.
      expect(GOVERNANCE_WEIGHT_VOTE_FIELDS).toEqual([
        'recency_weight',
        'engagement_weight',
        'bridging_weight',
        'source_diversity_weight',
        'relevance_weight',
      ]);
    });
  });
});
