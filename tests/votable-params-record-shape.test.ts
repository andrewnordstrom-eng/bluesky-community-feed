/**
 * Votable Params Record-Shape Tests (PROJ-816 / P3)
 *
 * Verifies that after the GovernanceWeightKey widening, vote submission still
 * rejects unregistered weight keys with a clear 400 error rather than
 * silently dropping them. This is the proof that runtime validation took over
 * what the compile-time literal union used to enforce.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  dbConnectMock,
  clientReleaseMock,
  getAuthenticatedDidMock,
  isParticipantApprovedMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  getAuthenticatedDidMock: vi.fn(),
  isParticipantApprovedMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: { query: dbQueryMock, connect: dbConnectMock },
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

import {
  WideVoteFieldCountError,
  assertWideVoteFieldCount,
  registerVoteRoute,
} from '../src/governance/routes/vote.js';
import { buildTestApp } from './helpers/app.js';
import {
  GOVERNANCE_WEIGHT_VOTE_FIELDS,
  VOTABLE_WEIGHT_PARAMS,
  voteFieldForKey,
} from '../src/config/votable-params.js';
import {
  REGISTERED_COMPONENT_KEYS,
  WIDE_COLUMN_COMPONENT_KEYS,
  assertWideColumnsRegistered,
} from '../src/scoring/registry.js';
import { config } from '../src/config.js';

const ORIGINAL_LOGIN_ALLOWLIST_ENABLED = config.LOGIN_ALLOWLIST_ENABLED;

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
  function registeredWeights(value: number): Record<string, number> {
    return Object.fromEntries(
      VOTABLE_WEIGHT_PARAMS.map((p) => [p.voteField, value])
    );
  }

  function expectInvalidVoteBody(bodyText: string): void {
    const body = JSON.parse(bodyText) as { error: string; message: string };
    expect(body.error).toBe('InvalidVote');
    expect(body.message).toContain('Invalid vote weights');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthenticatedDidMock.mockResolvedValue('did:plc:alice');
    isParticipantApprovedMock.mockResolvedValue(true);
    dbConnectMock.mockResolvedValue({ query: dbQueryMock, release: clientReleaseMock });
    // Active subscriber + active voting epoch.
    dbQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM subscribers')) {
        return { rows: [{ did: 'did:plc:alice' }] };
      }
      if (text.includes('FROM governance_epochs')) {
        return { rows: [{ id: 1, status: 'active', phase: 'voting' }] };
      }
      if (text.includes('FROM approved_participants') && text.includes('FOR SHARE')) {
        return { rows: [{ did: 'did:plc:alice' }] };
      }
      if (text.includes('INSERT INTO governance_votes')) {
        return { rows: [{ id: 'vote-uuid-1', is_new_vote: true }] };
      }
      return { rows: [] };
    });
  });

  afterEach(() => {
    config.LOGIN_ALLOWLIST_ENABLED = ORIGINAL_LOGIN_ALLOWLIST_ENABLED;
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
    it('enforces pilot approval whenever the login allowlist is enabled', async () => {
      config.LOGIN_ALLOWLIST_ENABLED = true;
      isParticipantApprovedMock.mockResolvedValue(false);

      const res = await postVote(registeredWeights(0.2));

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ message: 'Governance voting pilot: approved participants only.' });
      expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:alice');
    });

    it('does not apply the pilot allowlist when the feature flag is disabled', async () => {
      config.LOGIN_ALLOWLIST_ENABLED = false;
      isParticipantApprovedMock.mockResolvedValue(false);

      const res = await postVote(registeredWeights(0.2));

      expect(res.statusCode).toBe(200);
      expect(isParticipantApprovedMock).not.toHaveBeenCalled();
    });

    it('accepts an approved pilot participant when the login allowlist is enabled', async () => {
      config.LOGIN_ALLOWLIST_ENABLED = true;
      isParticipantApprovedMock.mockResolvedValue(true);

      const res = await postVote(registeredWeights(0.2));

      expect(res.statusCode).toBe(200);
      expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:alice');
    });

    it('returns 400 UnregisteredWeightKey when an unknown `*_weight` field is submitted', async () => {
      const res = await postVote({
        recency_weight: 0.2,
        engagement_weight: 0.2,
        bridging_weight: 0.2,
        source_diversity_weight: 0.2,
        relevance_weight: 0.1,
        civility_weight: 0.1,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; message: string };
      expect(body.error).toBe('UnregisteredWeightKey');
      expect(body.message).toContain('civility_weight');
      expect(body.message).toContain('recency_weight');
    });

    it('accepts the registered weight fields', async () => {
      const validPayload = Object.fromEntries(
        VOTABLE_WEIGHT_PARAMS.map((p) => [p.voteField, 0.2])
      );

      const res = await postVote(validPayload);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        success: boolean;
        epoch_id: number;
        weights: Record<string, number>;
      };
      expect(body.success).toBe(true);
      expect(body.epoch_id).toBe(1);
      expect(body.weights).toEqual({
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.2,
        relevance: 0.2,
      });
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

    it('allows non-_weight fields the API recognizes', async () => {
      const res = await postVote({
        recency_weight: 0.2,
        engagement_weight: 0.2,
        bridging_weight: 0.2,
        source_diversity_weight: 0.2,
        relevance_weight: 0.2,
        some_future_extension: 'hello',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        success: boolean;
        epoch_id: number;
        weights: Record<string, number>;
      };
      expect(body.success).toBe(true);
      expect(body.epoch_id).toBe(1);
      expect(body.weights).toEqual({
        recency: 0.2,
        engagement: 0.2,
        bridging: 0.2,
        sourceDiversity: 0.2,
        relevance: 0.2,
      });
    });

    it('rejects registered weights that do not sum to 1.0', async () => {
      const res = await postVote(registeredWeights(0.1));

      expect(res.statusCode).toBe(400);
      expectInvalidVoteBody(res.body);
    });

    it('rejects partial registered weight submissions', async () => {
      const res = await postVote({ recency_weight: 1.0 });

      expect(res.statusCode).toBe(400);
      expectInvalidVoteBody(res.body);
    });

    it('rejects a registered weight below its per-field minimum when the sum is otherwise valid', async () => {
      const payload = {
        ...registeredWeights(0.275),
        recency_weight: -0.1,
      };

      const res = await postVote(payload);

      expect(res.statusCode).toBe(400);
      expectInvalidVoteBody(res.body);
    });

    it.each([
      ['empty payload', {}],
      ['numeric string weight', { recency_weight: '0.2' }],
      ['null weight', { recency_weight: null }],
      ['above range weight', { recency_weight: 1.1 }],
      ['non-snake registered key variant', { sourceDiversity: 0.2 }],
    ])('returns 400 InvalidVote for invalid registered weight payload: %s', async (_name, payload) => {
      const res = await postVote(payload);

      expect(res.statusCode).toBe(400);
      expectInvalidVoteBody(res.body);
    });
  });

  describe('GOVERNANCE_WEIGHT_VOTE_FIELDS reflects voteFieldForKey', () => {
    it('voteField column on each VOTABLE_WEIGHT_PARAMS entry is voteFieldForKey(key)', () => {
      for (const param of VOTABLE_WEIGHT_PARAMS) {
        expect(param.voteField).toBe(voteFieldForKey(param.key));
      }
    });

    it('exports the snake_case names in the legacy GOVERNANCE_WEIGHT_VOTE_FIELDS array', () => {
      expect(GOVERNANCE_WEIGHT_VOTE_FIELDS).toEqual([
        'recency_weight',
        'engagement_weight',
        'bridging_weight',
        'source_diversity_weight',
        'relevance_weight',
      ]);
    });

    it('keeps route vote-field allowlist aligned with scoring registry keys', () => {
      const scoringVoteFields = [...REGISTERED_COMPONENT_KEYS]
        .map((key) => voteFieldForKey(key))
        .sort();
      expect([...GOVERNANCE_WEIGHT_VOTE_FIELDS].sort()).toEqual(scoringVoteFields);
    });

    it('accepts the current 5-field wide vote shape', () => {
      expect(() => {
        assertWideVoteFieldCount(GOVERNANCE_WEIGHT_VOTE_FIELDS);
      }).not.toThrow();
    });

    it('fails fast if the wide vote insert is asked to handle a sixth weight', () => {
      expect(() => {
        assertWideVoteFieldCount([
          ...GOVERNANCE_WEIGHT_VOTE_FIELDS,
          'civility_weight',
        ]);
      }).toThrow(WideVoteFieldCountError);
    });

    it('accepts the live registry for wide-column coverage', () => {
      expect(() => assertWideColumnsRegistered()).not.toThrow();
      for (const key of WIDE_COLUMN_COMPONENT_KEYS) {
        expect(REGISTERED_COMPONENT_KEYS.has(key)).toBe(true);
      }
    });

    it('throws if a wide-column key drifts out of the registry', () => {
      const driftedRegistry = new Set(
        [...REGISTERED_COMPONENT_KEYS].filter((k) => k !== 'recency')
      );
      expect(() => assertWideColumnsRegistered(driftedRegistry)).toThrow(/recency/);
    });
  });
});
