import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  approvedParticipationPercent,
  completeAdminLifecycleRefresh,
} from '../web-next/lib/admin-lifecycle';

describe('web-next admin lifecycle', () => {
  it('uses approved participants rather than all feed subscribers for participation', () => {
    const subscriberCount = 100;
    const approvedParticipantCount = 10;

    expect(approvedParticipationPercent(5, approvedParticipantCount)).toBe(50);
    expect(approvedParticipationPercent(5, subscriberCount)).toBe(5);
    expect(approvedParticipationPercent(0, 0)).toBe(0);
  });

  it('keeps lifecycle completion pending until every invalidation resolves', async () => {
    let resolveInvalidation!: () => void;
    const invalidation = new Promise<void>((resolve) => {
      resolveInvalidation = resolve;
    });
    const closeConfirmation = vi.fn();
    const completion = completeAdminLifecycleRefresh(
      async () => invalidation,
      closeConfirmation
    );

    await Promise.resolve();
    expect(closeConfirmation).not.toHaveBeenCalled();

    resolveInvalidation();
    await completion;
    expect(closeConfirmation).toHaveBeenCalledTimes(1);
  });

  it('wires every lifecycle mutation to awaited refresh and pending controls', () => {
    const pageSource = readFileSync(
      new URL('../web-next/app/admin/page.tsx', import.meta.url),
      'utf8'
    );

    expect(pageSource).toContain('approvedParticipationPercent(epoch.voteCount, feed.approvedParticipantCount)');
    expect(pageSource).toContain('completeAdminLifecycleRefresh(invalidate, () => setConfirm(null))');
    expect(pageSource).toMatch(/await Promise\.all\(\[/);
    expect(pageSource.match(/onSuccess: refreshThenClose/g)).toHaveLength(4);
    expect(pageSource.match(/loading=\{(?:open|close|approve|reject)Mutation\.isPending\}/g)).toHaveLength(4);
  });
});
