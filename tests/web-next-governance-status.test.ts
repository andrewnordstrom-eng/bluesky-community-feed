import { describe, expect, it } from 'vitest';
import { policyApplied } from '../web-next/lib/governance-status';

describe('web-next governance status', () => {
  it.each([
    [{ status: 'active', phase: 'running' }, true],
    [{ status: 'active' }, true],
    [{ status: 'active', phase: 'voting' }, false],
    [{ status: 'active', phase: 'review' }, false],
    [{ status: 'active', phase: 'results' }, false],
    [{ status: 'closed', phase: 'running' }, false],
    [{ status: 'closed' }, false],
  ] as const)('identifies applied policy for %o as %s', (epoch, expected) => {
    expect(policyApplied(epoch)).toBe(expected);
  });
});
