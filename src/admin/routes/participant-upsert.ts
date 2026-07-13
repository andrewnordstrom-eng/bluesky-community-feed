/**
 * Shared write path for the approved_participants allowlist.
 *
 * Both the participants route (plain pool) and the waitlist approve route
 * (in-transaction client) insert/re-activate an approved participant with the
 * exact same conflict resolution. Keeping it here means a schema or
 * conflict-handling change to this security-sensitive table happens once.
 */

/** Anything with a pg-style `query` — satisfied by both the pool and a PoolClient. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

export async function upsertApprovedParticipant(
  client: Queryable,
  params: { did: string; handle: string | null; addedBy: string; notes: string | null },
): Promise<void> {
  // Re-activates a previously soft-removed row (removed_at = NULL).
  await client.query(
    `INSERT INTO approved_participants (did, handle, added_by, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (did) DO UPDATE SET
       removed_at = NULL,
       handle = COALESCE($2, approved_participants.handle),
       added_by = $3,
       notes = $4,
       added_at = NOW()`,
    [params.did, params.handle, params.addedBy, params.notes],
  );
}
