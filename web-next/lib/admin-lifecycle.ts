export function approvedParticipationPercent(
  voteCount: number,
  approvedParticipantCount: number
): number {
  if (approvedParticipantCount <= 0) return 0;
  return Math.round((voteCount / approvedParticipantCount) * 100);
}

export async function completeAdminLifecycleRefresh(
  invalidate: () => Promise<void>,
  closeConfirmation: () => void
): Promise<void> {
  await invalidate();
  closeConfirmation();
}
