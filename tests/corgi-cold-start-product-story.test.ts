import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

const PUBLIC_STORY_FILES = [
  'web-next/app/page.tsx',
  'web-next/app/how-it-works/page.tsx',
  'web-next/app/start/page.tsx',
  'web-next/app/about/page.tsx',
  'web-next/app/docs/page.tsx',
  'web-next/app/demo/page.tsx',
  'web-next/app/demo/layout.tsx',
  'web-next/app/demo/shadow-demo-copy.ts',
  'web-next/app/history/page.tsx',
  'web-next/app/post/page.tsx',
  'web-next/app/proposals/page.tsx',
  'web-next/app/vote/page.tsx',
  'web-next/app/dashboard/page.tsx',
  'web-next/app/admin/page.tsx',
  'web-next/components/bento-section.tsx',
  'web-next/components/community-examples-section.tsx',
  'web-next/components/footer-section.tsx',
  'web-next/components/header.tsx',
  'web-next/components/hero-section.tsx',
  'web-next/components/landing-ctas.tsx',
  'web-next/components/replay-teaser.tsx',
  'web-next/components/how-it-works-replay.tsx',
  'web-next/components/demo/community-picker.tsx',
  'web-next/components/demo/live-proof-panel.tsx',
  'web-next/components/demo/vote-panel.tsx',
  'web-next/components/faq-section.tsx',
  'web-next/components/feed/corgi-rank-badge.tsx',
  'web-next/components/social-proof.tsx',
  'web-next/lib/replay-model.ts',
] as const;

const CURRENT_DOC_FILES = [
  'README.md',
  'docs/PRD.md',
  'docs/SYSTEM_OVERVIEW.md',
  'docs/agent/REPO_CONTRACT.md',
  'docs/docs-site/openapi.json',
  'scripts/publish-feed.ts',
  'src/bot/announcements.ts',
  'src/feed/server.ts',
  'src/governance/routes/epochs.ts',
] as const;

describe('Corgi cold-start product story', () => {
  it('uses Corgi Commons and removes the obsolete Birders public demo world', () => {
    const publicStory = PUBLIC_STORY_FILES.map(read).join('\n');

    expect(publicStory).toContain('Corgi Commons');
    expect(publicStory).not.toMatch(/Birders Who Code/i);
    expect(publicStory).not.toMatch(/Community Governed Feed/i);
  });

  it('keeps the Bluesky and Corgi modality boundary explicit', () => {
    const homepage = read('web-next/app/page.tsx');
    const howItWorks = read('web-next/app/how-it-works/page.tsx');
    const demoCopy = read('web-next/app/demo/shadow-demo-copy.ts');

    expect(homepage).toContain('Bluesky shows the ordered posts. Corgi shows the policy and receipts.');
    expect(howItWorks).toContain('Rank badges and receipt panels in this page are Corgi annotations.');
    expect(demoCopy).toContain('not native Bluesky UI');
  });

  it('does not claim ballots auto-apply or have equal aggregation influence', () => {
    const currentStory = [...PUBLIC_STORY_FILES, ...CURRENT_DOC_FILES].map(read).join('\n');

    expect(currentStory).not.toMatch(/subscribers democratically/i);
    expect(currentStory).not.toMatch(/each vote counts equally/i);
    expect(currentStory).not.toMatch(/aggregated weights become the next/i);
    expect(currentStory).not.toMatch(/when the round closes[^.]{0,100}(?:go live|reranks?|becomes? the feed)/i);
    expect(currentStory).not.toMatch(/creates? the next active epoch/i);
    expect(currentStory).not.toMatch(/transition to the next round/i);
    expect(currentStory).not.toMatch(/voting closes when[^.]*subscribers/i);
    expect(currentStory).not.toMatch(/subscribers can vote/i);
    expect(currentStory).toMatch(/results review/i);
    expect(currentStory).toMatch(/operator approval/i);
    expect(currentStory).toMatch(/approved pilot participants/i);
  });

  it('does not overclaim universal receipt coverage or read-only interactivity', () => {
    const publicStory = PUBLIC_STORY_FILES.map(read).join('\n');

    expect(publicStory).not.toMatch(/every ranked post shows its receipt/i);
    expect(publicStory).not.toMatch(/every post (?:carries|keeps|has) a receipt/i);
    expect(publicStory).not.toMatch(/read-only demo/i);
    expect(publicStory).not.toMatch(/Explore the live demo/i);
  });

  it('states the three production ballot channels and the pilot boundary', () => {
    const start = read('web-next/app/start/page.tsx');
    const docs = read('web-next/app/docs/page.tsx');
    const about = read('web-next/app/about/page.tsx');

    expect(start).toMatch(/approved waitlist pilot/i);
    expect(docs).toMatch(/five global signal weights/i);
    expect(docs).toMatch(/Topic preferences are separate/i);
    expect(docs).toMatch(/Content rules determine eligibility/i);
    expect(about).toMatch(/signals, topic priorities, and content rules/i);
  });

  it('keeps the operator UI on the reviewed lifecycle instead of the rejected transition bypass', () => {
    const adminPage = read('web-next/app/admin/page.tsx');

    expect(adminPage).toContain('adminApi.startVoting(72, true)');
    expect(adminPage).toContain('adminApi.endVoting(false)');
    expect(adminPage).toContain('adminApi.approveResults(true)');
    expect(adminPage).toContain('adminApi.rejectResults()');
    expect(adminPage).not.toContain('adminApi.transitionEpoch');
    expect(adminPage).toContain('signal weights, topic priorities, and adopted content rules');
  });

  it('updates the Bluesky feed record by compare-and-swap without rebuilding it', () => {
    const updater = read('scripts/update-corgi-commons-record.ts');

    expect(updater).toContain("displayName: DISPLAY_NAME");
    expect(updater).toContain("description: DESCRIPTION");
    expect(updater).toContain('...currentRecord');
    expect(updater).toContain('const currentServiceDid = currentRecord.did');
    expect(updater).toContain('verification.value.did !== currentServiceDid');
    expect(updater).toContain('swapRecord: currentResponse.data.cid');
    expect(updater).toContain("if (!apply)");
    expect(updater).toContain("process.argv.includes('--apply')");
    expect(updater).toContain('Target description: ${DESCRIPTION}');
    expect(updater).not.toContain("requireEnvironmentValue('FEEDGEN_SERVICE_DID')");
    expect(updater).not.toContain('createdAt: new Date');
  });
});
