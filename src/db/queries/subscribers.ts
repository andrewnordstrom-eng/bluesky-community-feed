/**
 * Subscriber database queries.
 *
 * Extracted from feed-skeleton.ts for reuse across modules.
 */

import { createHmac } from 'node:crypto';
import { db } from '../client.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';

let subscriberDigestUnavailableTotal = 0;

function resolveDidDigestSecret(): string {
  if (config.EXPORT_ANONYMIZATION_SALT.length > 0) {
    return config.EXPORT_ANONYMIZATION_SALT;
  }
  if (config.NODE_ENV !== 'development' && config.NODE_ENV !== 'test') {
    throw new Error('EXPORT_ANONYMIZATION_SALT is required outside development/test for subscriber DID digesting');
  }
  return 'dev-salt-not-for-prod';
}

function digestDid(did: string): string {
  return createHmac('sha256', resolveDidDigestSecret()).update(did).digest('hex').slice(0, 16);
}

function safeDigestDid(did: string): string {
  try {
    return digestDid(did);
  } catch (err) {
    subscriberDigestUnavailableTotal += 1;
    logger.error({ subscriberError: safeSubscriberError(err) }, 'Subscriber DID digest unavailable');
    return 'unavailable';
  }
}

export function getSubscriberDigestUnavailableTotal(): number {
  return subscriberDigestUnavailableTotal;
}

function readStringProperty(source: object, key: string): string | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function safeSubscriberError(err: unknown): Record<string, string> {
  if (err === null || typeof err !== 'object') {
    return {};
  }

  const safeError: Record<string, string> = {};
  for (const key of ['name', 'code', 'constraint', 'table', 'schema', 'severity']) {
    const value = readStringProperty(err, key);
    if (value !== undefined) {
      safeError[key] = value;
    }
  }
  return safeError;
}

/**
 * Inserts new subscribers or updates last_seen for existing ones.
 * Errors are logged but never propagated to feed-serving paths.
 */
export async function upsertSubscriberAsync(did: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO subscribers (did, first_seen, last_seen, is_active)
       VALUES ($1, NOW(), NOW(), TRUE)
       ON CONFLICT (did) DO UPDATE SET last_seen = NOW(), is_active = TRUE`,
      [did]
    );
  } catch (err) {
    logger.warn({ subscriberError: safeSubscriberError(err), didDigest: safeDigestDid(did) }, 'Subscriber upsert failed');
  }
}
