import { describe, expect, it } from 'vitest';
import { parseSessionResponse } from '../web-next/lib/api/session-contract';

describe('web-next auth session response contract', () => {
  it('accepts the anonymous session response', () => {
    expect(parseSessionResponse({ authenticated: false })).toEqual({
      authenticated: false,
    });
  });

  it('accepts a complete authenticated session response', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    expect(parseSessionResponse({
      authenticated: true,
      did: 'did:plc:alice',
      handle: 'alice.bsky.social',
      expiresAt,
    })).toEqual({
      authenticated: true,
      did: 'did:plc:alice',
      handle: 'alice.bsky.social',
      expiresAt,
    });
  });

  it('rejects an authenticated response without its required identity fields', () => {
    expect(() => parseSessionResponse({ authenticated: true })).toThrow();
  });

  it('rejects an anonymous response with unexpected properties', () => {
    expect(() => parseSessionResponse({
      authenticated: false,
      did: 'did:plc:alice',
    })).toThrow();
  });

  it.each([
    {
      caseName: 'empty authenticated identity fields',
      value: {
        authenticated: true,
        did: '',
        handle: '',
        expiresAt: '2026-07-14T05:00:00.000Z',
      },
    },
    {
      caseName: 'a malformed expiration timestamp',
      value: {
        authenticated: true,
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
        expiresAt: 'not-a-date',
      },
    },
    {
      caseName: 'an expiration timestamp without an offset',
      value: {
        authenticated: true,
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
        expiresAt: '2026-07-14T05:00:00.000',
      },
    },
    {
      caseName: 'a non-boolean authenticated discriminator',
      value: { authenticated: 'true' },
    },
  ])('rejects $caseName', ({ value }) => {
    expect(() => parseSessionResponse(value)).toThrow();
  });
});
