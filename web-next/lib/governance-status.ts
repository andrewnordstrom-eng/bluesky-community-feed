/** Shared display semantics for governance rounds.
 *
 * The backend reports two overlapping fields per epoch:
 *   - `status`  — lifecycle of the *policy* ("active" = currently applied, "closed" = superseded)
 *   - `phase`   — position in the *voting* cycle ("voting" | "review" | "running" | "results"),
 *                 which is only reliable for the current epoch (historical epochs keep whatever
 *                 phase they last had).
 *
 * The vote, history, and proposals pages previously each interpreted these
 * differently, producing contradictory labels ("Closed" vs "active" vs "still
 * open") for the same round. Everything user-facing derives from here instead.
 */

export interface EpochStatusFields {
  status: string
  phase?: string
  closed_at?: string | null
  voting_ends_at?: string | null
  voting_closed_at?: string | null
}

/** Ballot state: voting is only open during an unexpired "voting" phase. */
export type VotingState = "open" | "review" | "closed"

export function votingState(epoch: EpochStatusFields): VotingState {
  if (epoch.phase === "voting") {
    const ends = epoch.voting_ends_at ? new Date(epoch.voting_ends_at).getTime() : null
    if (ends === null || ends > Date.now()) return "open"
    return "closed"
  }
  if (epoch.phase === "review") return "review"
  // "running", "results", unknown/missing phases: no ballot is open.
  return "closed"
}

/** When voting for this round ended, preferring the recorded close over the scheduled end. */
export function votingClosedDate(epoch: EpochStatusFields): Date | null {
  const iso = epoch.voting_closed_at ?? epoch.voting_ends_at ?? epoch.closed_at
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whether this epoch's weights are the policy currently applied to the feed. */
export function policyIsActive(epoch: { status: string; closed_at?: string | null }): boolean {
  return epoch.status === "active" || epoch.closed_at == null
}

/** Below this member count, "N of M voted · X%" reads as a ghost town rather
 *  than transparency — show plain ballot counts instead of participation math. */
export const MIN_MEANINGFUL_MEMBERS = 10

export function showParticipationRatio(subscriberCount: number | null | undefined): boolean {
  return (subscriberCount ?? 0) >= MIN_MEANINGFUL_MEMBERS
}

export function ballotCountText(voteCount: number): string {
  return voteCount === 1 ? "1 ballot cast" : `${voteCount.toLocaleString()} ballots cast`
}
