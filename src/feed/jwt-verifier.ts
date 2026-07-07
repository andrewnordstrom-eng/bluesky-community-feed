import { verifyJwt } from '@atproto/xrpc-server';
import { DidResolver, MemoryCache } from '@atproto/identity';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const FEED_REQUESTER_JWT_LXM = 'app.bsky.feed.getFeedSkeleton';
const DID_CACHE_MAX_ENTRIES = 10_000;

class BoundedMemoryCache extends MemoryCache {
  constructor(private readonly maxEntries: number) {
    super();
  }

  override async cacheDid(did: string, doc: Parameters<MemoryCache['cacheDid']>[1]): Promise<void> {
    if (this.cache.has(did)) {
      this.cache.delete(did);
    }

    await super.cacheDid(did, doc);

    while (this.cache.size > this.maxEntries) {
      const oldestDid = this.cache.keys().next().value;
      if (!oldestDid) {
        break;
      }
      this.cache.delete(oldestDid);
    }
  }
}

const didResolver = new DidResolver({
  timeout: 3000,
  didCache: new BoundedMemoryCache(DID_CACHE_MAX_ENTRIES),
});

const allowedIssuerPrefixes = config.FEED_JWT_ALLOWED_ISSUER_PREFIXES
  .split(',')
  .map((prefix) => prefix.trim())
  .filter((prefix) => prefix.length > 0);

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isDid(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('did:');
}

function isAllowedIssuerDid(issuerDid: string): boolean {
  if (allowedIssuerPrefixes.length === 0) {
    return true;
  }

  return allowedIssuerPrefixes.some((prefix) => issuerDid.startsWith(prefix));
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function validateIat(payload: Record<string, unknown>): boolean {
  const iat = payload.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return false;
  }

  const maxAllowedIat = Math.floor(Date.now() / 1000) + config.FEED_JWT_MAX_FUTURE_SKEW_SECONDS;
  return iat <= maxAllowedIat;
}

function expectedAudience(): string {
  return config.FEED_JWT_AUDIENCE.length > 0 ? config.FEED_JWT_AUDIENCE : config.FEEDGEN_SERVICE_DID;
}

function hasExpectedAudience(payload: Record<string, unknown>): boolean {
  return payload.aud === expectedAudience();
}

function hasExpectedLexiconMethod(payload: Record<string, unknown>): boolean {
  return payload.lxm === FEED_REQUESTER_JWT_LXM;
}

function hasUsableExpiry(payload: Record<string, unknown>): boolean {
  const exp = payload.exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

function preflightPayload(payload: Record<string, unknown> | null): payload is Record<string, unknown> & { iss: string } {
  return (
    payload !== null &&
    isDid(payload.iss) &&
    isAllowedIssuerDid(payload.iss) &&
    hasExpectedAudience(payload) &&
    hasExpectedLexiconMethod(payload) &&
    hasUsableExpiry(payload) &&
    validateIat(payload)
  );
}

async function resolveIssuerSigningKey(issuerDid: string, forceRefresh: boolean): Promise<string> {
  if (!isDid(issuerDid) || !isAllowedIssuerDid(issuerDid)) {
    throw new Error('Issuer DID is not allowed');
  }

  return didResolver.resolveAtprotoKey(issuerDid, forceRefresh);
}

export async function verifyFeedRequesterDid(authHeader: string | undefined): Promise<string | null> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);
  if (!preflightPayload(payload)) {
    return null;
  }

  try {
    const verified = await verifyJwt(
      token,
      expectedAudience(),
      FEED_REQUESTER_JWT_LXM,
      resolveIssuerSigningKey
    );

    if (!isDid(verified.iss) || !isAllowedIssuerDid(verified.iss)) {
      return null;
    }

    // Attribute only to the verified issuer DID to prevent claim-confusion spoofing via `sub`.
    return verified.iss;
  } catch (err) {
    logger.debug({ err }, 'Feed requester JWT verification failed');
    return null;
  }
}
