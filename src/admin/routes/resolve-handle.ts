/**
 * Shared AT Protocol handle resolution for admin routes.
 * Used by the participants and waitlist routes when converting a
 * user-supplied Bluesky handle into a DID at approval time.
 */

import { AtpAgent } from '@atproto/api';

/** Bound the external bsky.social resolve so a slow/hung upstream can't pin an
 *  admin request open indefinitely. */
const RESOLVE_TIMEOUT_MS = 10_000;

export async function resolveHandleToDid(handle: string): Promise<{ did: string; handle: string }> {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const response = await agent.resolveHandle({ handle }, { signal: controller.signal });
    return { did: response.data.did, handle };
  } finally {
    clearTimeout(timeout);
  }
}
