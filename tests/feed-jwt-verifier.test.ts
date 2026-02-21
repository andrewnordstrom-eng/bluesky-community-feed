import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';

const { verifyJwtMock, resolveAtprotoKeyMock } = vi.hoisted(() => ({
  verifyJwtMock: vi.fn(),
  resolveAtprotoKeyMock: vi.fn(),
}));

vi.mock('@atproto/xrpc-server', () => ({
  verifyJwt: verifyJwtMock,
}));

vi.mock('@atproto/identity', () => ({
  DidResolver: class {
    resolveAtprotoKey = resolveAtprotoKeyMock;
  },
  MemoryCache: class {},
}));

import { verifyFeedRequesterDid } from '../src/feed/jwt-verifier.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

describe('verifyFeedRequesterDid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAtprotoKeyMock.mockResolvedValue('did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme');
  });

  it('returns null with missing authorization header', async () => {
    const result = await verifyFeedRequesterDid(undefined);
    expect(result).toBeNull();
    expect(verifyJwtMock).not.toHaveBeenCalled();
  });

  it('returns null when JWT verification throws', async () => {
    verifyJwtMock.mockRejectedValueOnce(new Error('BadJwtSignature'));

    const result = await verifyFeedRequesterDid('Bearer invalid.jwt.token');
    expect(result).toBeNull();
  });

  it('returns issuer DID even when subject is present', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      sub: 'did:plc:viewer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBe('did:plc:issuer123');
  });

  it('falls back to issuer DID when subject is absent', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBe('did:plc:issuer123');
  });

  it('returns null for JWT with iat too far in the future', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      sub: 'did:plc:viewer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000) + 7200,
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: 'did:web:feed.example',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBeNull();
  });

  it('enforces audience and lexicon method during verification', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      aud: config.FEEDGEN_SERVICE_DID,
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: Math.floor(Date.now() / 1000) + 60,
      iat: Math.floor(Date.now() / 1000),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: config.FEEDGEN_SERVICE_DID,
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    await verifyFeedRequesterDid(`Bearer ${jwt}`);

    const expectedAudience =
      config.FEED_JWT_AUDIENCE.length > 0 ? config.FEED_JWT_AUDIENCE : config.FEEDGEN_SERVICE_DID;
    expect(verifyJwtMock).toHaveBeenCalledWith(
      jwt,
      expectedAudience,
      'app.bsky.feed.getFeedSkeleton',
      expect.any(Function)
    );
  });
});
