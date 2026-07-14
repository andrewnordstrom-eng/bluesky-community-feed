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
});
