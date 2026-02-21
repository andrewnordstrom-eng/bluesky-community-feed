import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';

const { loginMock, saveSessionMock, getSessionByTokenMock, deleteSessionMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  saveSessionMock: vi.fn(),
  getSessionByTokenMock: vi.fn(),
  deleteSessionMock: vi.fn(),
}));

vi.mock('@atproto/api', () => ({
  AtpAgent: class MockAtpAgent {
    login = loginMock;
  },
}));

vi.mock('../src/governance/session-store.js', () => ({
  saveSession: saveSessionMock,
  getSessionByToken: getSessionByTokenMock,
  deleteSession: deleteSessionMock,
}));

import { config } from '../src/config.js';
import { extractSessionToken } from '../src/governance/auth.js';
import { registerAuthRoute } from '../src/governance/routes/auth.js';

describe('governance auth cookie flow', () => {
  beforeEach(() => {
    loginMock.mockReset();
    saveSessionMock.mockReset();
    getSessionByTokenMock.mockReset();
    deleteSessionMock.mockReset();
  });

  it('sets HttpOnly session cookie on login', async () => {
    loginMock.mockResolvedValue({
      success: true,
      data: {
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
      },
    });
    saveSessionMock.mockResolvedValue(undefined);

    const app = Fastify();
    registerAuthRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/auth/login',
      payload: {
        handle: 'alice.bsky.social',
        appPassword: 'xxxx-xxxx-xxxx-xxxx',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).not.toHaveProperty('accessJwt');
    expect(body).not.toHaveProperty('token');
    const setCookie = response.headers['set-cookie'];
    expect(typeof setCookie).toBe('string');
    expect(String(setCookie)).toContain(`${config.GOVERNANCE_SESSION_COOKIE_NAME}=`);
    expect(String(setCookie)).toContain('HttpOnly');
    expect(String(setCookie)).toContain('Path=/');

    await app.close();
  });

  it('resolves session from cookie token and falls back to bearer token', async () => {
    getSessionByTokenMock
      .mockResolvedValueOnce({
        did: 'did:plc:cookie',
        handle: 'cookie-user.bsky.social',
        accessJwt: 'cookie-token',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        did: 'did:plc:bearer',
        handle: 'bearer-user.bsky.social',
        accessJwt: 'bearer-token',
        expiresAt: new Date(Date.now() + 60_000),
      });

    const app = Fastify();
    registerAuthRoute(app);

    const cookieResponse = await app.inject({
      method: 'GET',
      url: '/api/governance/auth/session',
      headers: {
        cookie: `${config.GOVERNANCE_SESSION_COOKIE_NAME}=cookie-token`,
      },
    });
    expect(cookieResponse.statusCode).toBe(200);
    expect(getSessionByTokenMock).toHaveBeenNthCalledWith(1, 'cookie-token');

    const bearerResponse = await app.inject({
      method: 'GET',
      url: '/api/governance/auth/session',
      headers: {
        authorization: 'Bearer bearer-token',
      },
    });
    expect(bearerResponse.statusCode).toBe(200);
    expect(getSessionByTokenMock).toHaveBeenNthCalledWith(2, 'bearer-token');

    await app.close();
  });

  it('clears session cookie on logout and invalidates token', async () => {
    deleteSessionMock.mockResolvedValue(undefined);

    const app = Fastify();
    registerAuthRoute(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/governance/auth/logout',
      headers: {
        cookie: `${config.GOVERNANCE_SESSION_COOKIE_NAME}=logout-token`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(deleteSessionMock).toHaveBeenCalledWith('logout-token');
    const setCookie = response.headers['set-cookie'];
    expect(typeof setCookie).toBe('string');
    expect(String(setCookie)).toContain(`${config.GOVERNANCE_SESSION_COOKIE_NAME}=`);
    expect(String(setCookie)).toContain('Max-Age=0');

    await app.close();
  });

  it('prefers cookie token over bearer token when both exist', () => {
    const request = {
      headers: {
        cookie: `${config.GOVERNANCE_SESSION_COOKIE_NAME}=cookie-priority-token`,
        authorization: 'Bearer bearer-token',
      },
    } as FastifyRequest;

    expect(extractSessionToken(request)).toBe('cookie-priority-token');
  });
});
