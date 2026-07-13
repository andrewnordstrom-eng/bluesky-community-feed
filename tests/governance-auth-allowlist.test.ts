import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loginMock, saveSessionMock, deleteSessionMock, isAdminMock, isParticipantApprovedMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  saveSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  isAdminMock: vi.fn(),
  isParticipantApprovedMock: vi.fn(),
}));

vi.mock('@atproto/api', () => ({
  AtpAgent: class MockAtpAgent {
    login = loginMock;
  },
}));

vi.mock('../src/governance/session-store.js', () => ({
  saveSession: saveSessionMock,
  getSessionByToken: vi.fn(),
  deleteSession: deleteSessionMock,
}));

// src/auth/admin.ts parses BOT_ADMIN_DIDS at module load, so mock the module
// rather than the environment.
vi.mock('../src/auth/admin.js', () => ({
  isAdmin: isAdminMock,
}));

vi.mock('../src/feed/access-control.js', () => ({
  isParticipantApproved: isParticipantApprovedMock,
  invalidateParticipantCache: vi.fn(),
}));

import { config } from '../src/config.js';
import { registerAuthRoute } from '../src/governance/routes/auth.js';

const originalFlag = config.LOGIN_ALLOWLIST_ENABLED;

function buildApp() {
  const app = Fastify();
  registerAuthRoute(app);
  return app;
}

async function login(app: ReturnType<typeof Fastify>) {
  return app.inject({
    method: 'POST',
    url: '/api/governance/auth/login',
    payload: { handle: 'user.bsky.social', appPassword: 'xxxx-xxxx-xxxx-xxxx' },
  });
}

describe('login allowlist gate', () => {
  beforeEach(() => {
    loginMock.mockReset();
    saveSessionMock.mockReset();
    deleteSessionMock.mockReset();
    isAdminMock.mockReset();
    isParticipantApprovedMock.mockReset();

    loginMock.mockResolvedValue({
      success: true,
      data: { did: 'did:plc:user', handle: 'user.bsky.social' },
    });
    saveSessionMock.mockResolvedValue(undefined);
    deleteSessionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = originalFlag;
  });

  it('flag off: unapproved accounts still log in (regression guard)', async () => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = false;
    isAdminMock.mockReturnValue(false);
    isParticipantApprovedMock.mockResolvedValue(false);

    const response = await login(buildApp());

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeDefined();
    expect(isParticipantApprovedMock).not.toHaveBeenCalled();
  });

  it('flag on: approved participants log in', async () => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = true;
    isAdminMock.mockReturnValue(false);
    isParticipantApprovedMock.mockResolvedValue(true);

    const response = await login(buildApp());

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('governance_session=');
    expect(isParticipantApprovedMock).toHaveBeenCalledWith('did:plc:user');
  });

  it('flag on: admins bypass without a participant lookup', async () => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = true;
    isAdminMock.mockReturnValue(true);

    const response = await login(buildApp());

    expect(response.statusCode).toBe(200);
    expect(isParticipantApprovedMock).not.toHaveBeenCalled();
  });

  it('flag on: unapproved accounts get 403 NotApproved, the minted session is invalidated, and no cookie is set', async () => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = true;
    isAdminMock.mockReturnValue(false);
    isParticipantApprovedMock.mockResolvedValue(false);

    const response = await login(buildApp());

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error).toBe('NotApproved');
    expect(body.waitlist).toBe(true);
    expect(typeof body.message).toBe('string');

    // The session persisted by authenticateWithBluesky must be dead.
    expect(deleteSessionMock).toHaveBeenCalledTimes(1);
    const savedToken = saveSessionMock.mock.calls[0][0];
    expect(deleteSessionMock).toHaveBeenCalledWith(savedToken);

    // No session cookie may leak on the deny path.
    const setCookie = response.headers['set-cookie'];
    if (setCookie !== undefined) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      for (const cookie of cookies) {
        expect(cookie).not.toMatch(/governance_session=[^;]+/);
      }
    }
  });

  it('flag on: allowlist lookup failure fails closed (fail-closed contract)', async () => {
    (config as { LOGIN_ALLOWLIST_ENABLED: boolean }).LOGIN_ALLOWLIST_ENABLED = true;
    isAdminMock.mockReturnValue(false);
    // isParticipantApproved itself catches storage errors and returns false —
    // mirror that contract here.
    isParticipantApprovedMock.mockResolvedValue(false);

    const response = await login(buildApp());

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('NotApproved');
  });

  it('flag defaults to false', () => {
    expect(originalFlag).toBe(false);
  });
});
