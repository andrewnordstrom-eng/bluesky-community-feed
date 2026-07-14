import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-scan guards for the post-login redirect wiring (PROJ-1844). Matches the
// established web-next convention of asserting component source rather than
// rendering, since the redirect is a client-only interaction.

function read(rel: string): string {
  return readFileSync(new URL(`../web-next/${rel}`, import.meta.url), 'utf8');
}

describe('web-next post-login redirect wiring', () => {
  it('SignInDialog performs exactly one guarded router redirect, on sign-in success', () => {
    const src = read('components/sign-in-dialog.tsx');
    expect(src).toContain('import { useRouter } from "next/navigation"');
    expect(src).toContain('redirectOnSuccess?: string');
    // Fires only when the prop is set — so in-task dialogs (no prop) stay put.
    expect(src).toContain('if (redirectOnSuccess) router.push(redirectOnSuccess)');
    // Exactly one push total guarantees the waitlist submit path never navigates.
    expect(src.match(/router\.push\(/g)?.length ?? 0).toBe(1);
  });

  it('global sign-in entry points land the user on /dashboard', () => {
    for (const rel of ['components/header.tsx', 'components/app-shell.tsx', 'app/sign-in/page.tsx']) {
      expect(read(rel)).toMatch(/<SignInDialog[^>]*redirectOnSuccess="\/dashboard"/);
    }
  });

  it('in-task dialogs omit the redirect so the user can finish what they came to do', () => {
    for (const rel of [
      'app/vote/page.tsx',
      'app/settings/page.tsx',
      'app/admin/page.tsx',
      'app/research-consent/page.tsx',
    ]) {
      const src = read(rel);
      const openTag = src.slice(src.indexOf('<SignInDialog'));
      expect(openTag.slice(0, openTag.indexOf('/>'))).not.toContain('redirectOnSuccess');
    }
  });
});

describe('web-next signed-out /vote preview', () => {
  it('frames the ballot as a pilot preview with a waitlist CTA for signed-out visitors', () => {
    const src = read('app/vote/page.tsx');
    // Shown only when signed out, and its CTA reuses the page's waitlist dialog.
    expect(src).toContain('{!isAuthenticated && (');
    expect(src).toContain('previewing the community ballot');
    expect(src).toContain('onClick={onRequireAuth}');
  });
});
