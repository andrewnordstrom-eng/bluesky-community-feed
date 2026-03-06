/**
 * DID Anonymization for Research Export
 *
 * Produces a deterministic 16-character hex string from a DID + salt.
 * Same (DID, salt) pair always yields the same output.
 */

import { createHash } from 'node:crypto';

/**
 * Anonymize a DID for research export.
 * @returns A deterministic 16-character hex string.
 */
export function anonymizeDid(did: string, salt: string): string {
  return createHash('sha256')
    .update(`${did}${salt}`)
    .digest('hex')
    .slice(0, 16);
}
