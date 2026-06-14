/**
 * Governance Decisions (pure, no I/O)
 *
 * Single source of truth for governance *policy* decisions, split from the
 * DB-coupled call sites (hexagonal style) so they can be exhaustively tested.
 * Currently: the quorum rule. Keep all quorum checks routed through here so the
 * policy can never drift between apply paths (the root cause behind PROJ-1045,
 * where the admin path enforced quorum inconsistently).
 */

/**
 * Whether an electorate meets the quorum required to adopt a governance change.
 *
 * @param voteCount - number of quorum-eligible (weight) votes cast
 * @param minVotes  - the configured minimum (GOVERNANCE_MIN_VOTES)
 */
export function quorumMet(voteCount: number, minVotes: number): boolean {
  return voteCount >= minVotes;
}

/** Structured quorum status, useful for transparency surfaces and admin UIs. */
export interface QuorumStatus {
  met: boolean;
  voteCount: number;
  minVotes: number;
  /** Votes still required to reach quorum (0 once met). */
  shortfall: number;
}

export function quorumStatus(voteCount: number, minVotes: number): QuorumStatus {
  return {
    met: quorumMet(voteCount, minVotes),
    voteCount,
    minVotes,
    shortfall: Math.max(0, minVotes - voteCount),
  };
}
