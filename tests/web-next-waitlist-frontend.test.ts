import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  participantAddResponseSchema,
  participantListResponseSchema,
  participantRemoveResponseSchema,
} from '../web-next/lib/api/participant-contract';
import {
  waitlistApproveResponseSchema,
  waitlistJoinResponseSchema,
  waitlistListResponseSchema,
  waitlistRequestSchema,
  waitlistRejectResponseSchema,
} from '../web-next/lib/api/waitlist-contract';
import { AuthRequestCoordinator } from '../web-next/lib/auth-request';
import {
  classifySignInFailure,
  isCurrentDialogRequest,
} from '../web-next/lib/sign-in-request';

function axiosFailure(status?: number, data?: unknown): unknown {
  return {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data },
  };
}

const validRequest = {
  id: 7,
  handle: 'researcher.bsky.social',
  did: null,
  note: 'Interested in community governance.',
  status: 'pending' as const,
  created_at: '2026-07-12T18:00:00.000Z',
  decided_at: null,
  decided_by: null,
};

describe('web-next waitlist response validation', () => {
  it('accepts complete list and mutation responses', () => {
    expect(waitlistListResponseSchema.parse({ requests: [validRequest], total: 1 })).toEqual({
      requests: [validRequest],
      total: 1,
    });
    expect(waitlistApproveResponseSchema.parse({
      success: true,
      did: 'did:plc:approved',
      handle: 'researcher.bsky.social',
    }).success).toBe(true);
    expect(waitlistRejectResponseSchema.parse({ success: true }).success).toBe(true);
    expect(waitlistListResponseSchema.parse({ requests: [], total: 0 })).toEqual({ requests: [], total: 0 });
    expect(waitlistApproveResponseSchema.parse({
      success: false,
      did: 'did:plc:approved',
      handle: 'researcher.bsky.social',
    }).success).toBe(false);
    expect(waitlistRejectResponseSchema.parse({ success: false }).success).toBe(false);
    expect(waitlistJoinResponseSchema.parse({ success: true, message: 'Request received.' })).toEqual({
      success: true,
      message: 'Request received.',
    });
    expect(() => waitlistListResponseSchema.parse({
      requests: [{ ...validRequest, created_at: '2026-07-12T20:00:00.000+02:00' }],
      total: 1,
    })).not.toThrow();
  });

  it('rejects missing fields, invalid statuses, malformed timestamps, and non-boolean success values', () => {
    expect(() => waitlistListResponseSchema.parse({ requests: [{ ...validRequest, status: 'queued' }], total: 1 })).toThrow();
    expect(() => waitlistListResponseSchema.parse({ requests: [{ ...validRequest, created_at: 'yesterday' }], total: 1 })).toThrow();
    expect(() => waitlistListResponseSchema.parse({ requests: [{ ...validRequest, note: undefined }], total: 1 })).toThrow();
    expect(() => waitlistApproveResponseSchema.parse({ success: 'yes', did: 'did:plc:x', handle: 'x.test' })).toThrow();
    expect(() => waitlistRejectResponseSchema.parse({ success: 1 })).toThrow();
    expect(() => waitlistJoinResponseSchema.parse({ success: true })).toThrow();
    expect(() => waitlistJoinResponseSchema.parse({ success: 'yes', message: 'Request received.' })).toThrow();
    expect(() => waitlistRequestSchema.parse({ ...validRequest, id: 0 })).toThrow();
    expect(() => waitlistRequestSchema.parse({ ...validRequest, id: -1 })).toThrow();
    expect(() => waitlistListResponseSchema.parse({ requests: [], total: -1 })).toThrow();
    expect(() => waitlistRejectResponseSchema.parse({ success: true, unexpected: true })).toThrow();
  });
});

describe('web-next participant response validation', () => {
  const participant = {
    did: 'did:plc:participant',
    handle: 'participant.bsky.social',
    added_by: 'did:plc:admin',
    notes: null,
    added_at: '2026-07-12T18:00:00.000Z',
  };

  it('accepts complete list and mutation responses', () => {
    expect(participantListResponseSchema.parse({ participants: [participant], total: 1 })).toEqual({
      participants: [participant],
      total: 1,
    });
    expect(participantAddResponseSchema.parse({
      success: true,
      participant: {
        did: participant.did,
        handle: participant.handle,
      },
    })).toEqual({
      success: true,
      participant: {
        did: participant.did,
        handle: participant.handle,
        notes: null,
      },
    });
    expect(participantRemoveResponseSchema.parse({ success: false })).toEqual({ success: false });
  });

  it('rejects malformed participant responses', () => {
    expect(() => participantListResponseSchema.parse({ participants: [{ ...participant, did: undefined }], total: 1 })).toThrow();
    expect(() => participantListResponseSchema.parse({ participants: [{ ...participant, did: 'not-a-did' }], total: 1 })).toThrow();
    expect(() => participantListResponseSchema.parse({ participants: [participant], total: -1 })).toThrow();
    expect(() => participantListResponseSchema.parse({ participants: [participant], total: 1.5 })).toThrow();
    expect(() => participantListResponseSchema.parse({ participants: [participant], total: 1, unexpected: true })).toThrow();
    expect(() => participantAddResponseSchema.parse({ success: true, participant: { handle: null, notes: null } })).toThrow();
    expect(() => participantRemoveResponseSchema.parse({ success: 'yes' })).toThrow();
  });
});

describe('web-next auth request coordination', () => {
  it('aborts a superseded login and keeps only the latest request current', () => {
    const requests = new AuthRequestCoordinator();
    const first = requests.begin();
    const second = requests.begin();

    expect(first.aborted).toBe(true);
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
  });

  it('aborts the active login when a dialog session closes or switches mode', () => {
    const requests = new AuthRequestCoordinator();
    const active = requests.begin();

    requests.cancel();

    expect(active.aborted).toBe(true);
    expect(requests.isCurrent(active)).toBe(false);
  });
});

describe('web-next sign-in failure handling', () => {
  it('only treats a typed NotApproved 403 as a waitlist response', () => {
    expect(classifySignInFailure(axiosFailure(403, { error: 'NotApproved', waitlist: true }))).toBe('not-approved');
    expect(classifySignInFailure(axiosFailure(403, { waitlist: true }))).toBe('service');
    expect(classifySignInFailure(axiosFailure(403, '<html>forbidden</html>'))).toBe('service');
  });

  it('separates credential failures from network, timeout, and server failures', () => {
    expect(classifySignInFailure(axiosFailure(401, { error: 'InvalidCredentials' }))).toBe('bad-credentials');
    expect(classifySignInFailure(axiosFailure(500, { error: 'InternalServerError' }))).toBe('service');
    expect(classifySignInFailure(axiosFailure())).toBe('service');
    expect(classifySignInFailure(new Error('timeout'))).toBe('service');
  });

  it('rejects stale and unmounted dialog request tokens', () => {
    expect(isCurrentDialogRequest(4, 4, true)).toBe(true);
    expect(isCurrentDialogRequest(5, 4, true)).toBe(false);
    expect(isCurrentDialogRequest(4, 4, false)).toBe(false);
  });
});

describe('web-next waitlist copy and feature-flag states', () => {
  it('states post-decision retention and deletion rights for waitlist submissions', () => {
    const privacySource = readFileSync(new URL('../web-next/app/privacy/page.tsx', import.meta.url), 'utf8');

    expect(privacySource).toContain('retained after it is approved or rejected');
    expect(privacySource).toContain('participation data and waitlist submission');
  });

  it('renders an explicit unknown state when the login allowlist field is absent', () => {
    const adminSource = readFileSync(new URL('../web-next/app/admin/page.tsx', import.meta.url), 'utf8');

    expect(adminSource).toContain('"enforced" | "off" | "unknown"');
    expect(adminSource).toContain(': "unknown"');
    expect(adminSource).toContain('unknown: "Unknown"');
  });
});
