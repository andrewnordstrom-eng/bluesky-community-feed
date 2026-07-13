/**
 * Shared AT Protocol handle resolution for admin routes.
 * Used by the participants and waitlist routes when converting a
 * user-supplied Bluesky handle into a DID at approval time.
 */

import { AtpAgent } from '@atproto/api';

export async function resolveHandleToDid(handle: string): Promise<{ did: string; handle: string }> {
  const agent = new AtpAgent({ service: 'https://bsky.social' });
  const response = await agent.resolveHandle({ handle });
  return { did: response.data.did, handle };
}
