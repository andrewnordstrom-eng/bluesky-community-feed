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

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expectedAudience(): string {
  return config.FEED_JWT_AUDIENCE.length > 0 ? config.FEED_JWT_AUDIENCE : config.FEEDGEN_SERVICE_DID;
}

function validPayload(): Record<string, unknown> {
  return {
    iss: 'did:plc:issuer123',
    aud: expectedAudience(),
    lxm: 'app.bsky.feed.getFeedSkeleton',
    exp: nowSeconds() + 60,
    iat: nowSeconds(),
  };
}

describe('verifyFeedRequesterDid', () => {
  beforeEach(() => {
    verifyJwtMock.mockReset();
    resolveAtprotoKeyMock.mockReset();
    resolveAtprotoKeyMock.mockResolvedValue('did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme');
  });

  it('returns null with missing authorization header', async () => {
    const result = await verifyFeedRequesterDid(undefined);
    expect(result).toBeNull();
    expect(verifyJwtMock).not.toHaveBeenCalled();
  });

  it('returns null when JWT verification throws', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
      iat: nowSeconds(),
    });
    verifyJwtMock.mockRejectedValueOnce(new Error('BadJwtSignature'));

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBeNull();
  });

  it('returns issuer DID even when subject is present', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      sub: 'did:plc:viewer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
      iat: nowSeconds(),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      exp: nowSeconds() + 60,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBe('did:plc:issuer123');
  });

  it('falls back to issuer DID when subject is absent', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
      iat: nowSeconds(),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      exp: nowSeconds() + 60,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBe('did:plc:issuer123');
  });

  it('returns null for JWT with iat too far in the future', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      sub: 'did:plc:viewer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
      iat: nowSeconds() + 7200,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBeNull();
    expect(verifyJwtMock).not.toHaveBeenCalled();
    expect(resolveAtprotoKeyMock).not.toHaveBeenCalled();
  });

  it('accepts iat exactly at the configured future-skew boundary', async () => {
    const now = 1_800_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now * 1000));
    try {
      const jwt = makeJwt({
        ...validPayload(),
        exp: now + 3600,
        iat: now + config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS,
      });
      verifyJwtMock.mockResolvedValueOnce({
        iss: 'did:plc:issuer123',
        aud: expectedAudience(),
        lxm: 'app.bsky.feed.getFeedSkeleton',
        exp: now + 3600,
      });

      const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);

      expect(result).toBe('did:plc:issuer123');
      expect(verifyJwtMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects iat one second beyond the configured future-skew boundary', async () => {
    const now = 1_800_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now * 1000));
    try {
      const jwt = makeJwt({
        ...validPayload(),
        exp: now + 3600,
        iat: now + config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS + 1,
      });

      const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);

      expect(result).toBeNull();
      expect(verifyJwtMock).not.toHaveBeenCalled();
      expect(resolveAtprotoKeyMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces audience and lexicon method during verification', async () => {
    const jwt = makeJwt({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
      iat: nowSeconds(),
    });

    verifyJwtMock.mockResolvedValueOnce({
      iss: 'did:plc:issuer123',
      aud: expectedAudience(),
      lxm: 'app.bsky.feed.getFeedSkeleton',
      exp: nowSeconds() + 60,
    });

    await verifyFeedRequesterDid(`Bearer ${jwt}`);

    expect(verifyJwtMock).toHaveBeenCalledWith(
      jwt,
      expectedAudience(),
      'app.bsky.feed.getFeedSkeleton',
      expect.any(Function)
    );
  });

  it.each([
    ['missing iss', { iss: undefined }],
    ['null iss', { iss: null }],
    ['empty iss', { iss: '' }],
    ['invalid iss', { iss: 'plc:issuer123' }],
    ['missing aud', { aud: undefined }],
    ['null aud', { aud: null }],
    ['empty aud', { aud: '' }],
    ['invalid aud', { aud: 'did:web:wrong.example' }],
    ['missing lxm', { lxm: undefined }],
    ['null lxm', { lxm: null }],
    ['empty lxm', { lxm: '' }],
    ['invalid lxm', { lxm: 'app.bsky.feed.wrongMethod' }],
    ['missing exp', { exp: undefined }],
    ['null exp', { exp: null }],
    ['empty exp', { exp: '' }],
    ['expired exp', { exp: nowSeconds() - 1 }],
    ['missing iat', { iat: undefined }],
    ['null iat', { iat: null }],
    ['empty iat', { iat: '' }],
    ['string iat', { iat: String(nowSeconds()) }],
    ['nan iat serializes to null', { iat: Number.NaN }],
    ['future iat', { iat: nowSeconds() + 7200 }],
  ])('short-circuits tokens with %s before DID resolution', async (_label, override) => {
    const jwt = makeJwt({
      ...validPayload(),
      ...override,
    });

    const result = await verifyFeedRequesterDid(`Bearer ${jwt}`);
    expect(result).toBeNull();
    expect(verifyJwtMock).not.toHaveBeenCalled();
    expect(resolveAtprotoKeyMock).not.toHaveBeenCalled();
  });
});
