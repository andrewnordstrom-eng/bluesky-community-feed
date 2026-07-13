import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('web-next homepage anchors', () => {
  it('keeps faq-section owned by a single rendered component root', () => {
    const pageContent = readRepoFile('web-next/app/page.tsx');
    const faqContent = readRepoFile('web-next/components/faq-section.tsx');

    expect(pageContent).not.toContain('id="faq-section"');
    expect((faqContent.match(/id="faq-section"/g) ?? [])).toHaveLength(1);
    const faqTag = faqContent.match(/<section\b(?=[^>]*id="faq-section")[^>]*>/s)?.[0];
    const classTokens = faqTag?.match(/\bclassName="([^"]*)"/)?.[1]?.split(/\s+/) ?? [];
    expect(faqTag).toBeDefined();
    expect(classTokens).toEqual(expect.arrayContaining(['scroll-mt-24', 'md:scroll-mt-28']));
  });

  it('keeps the footer history link pointed at the history route', () => {
    const footerContent = readRepoFile('web-next/components/footer-section.tsx');

    expect(footerContent).toContain('{ label: "History", href: "/history" }');
  });

  it('keeps how-it-works navigation routed to the dedicated page', () => {
    const headerContent = readRepoFile('web-next/components/header.tsx');
    const footerContent = readRepoFile('web-next/components/footer-section.tsx');

    expect(headerContent).toMatch(/\{\s*name: "How it works", href: "\/how-it-works"\s*\}/);
    expect(footerContent).toContain('{ label: "How it works", href: "/how-it-works" }');
    expect(headerContent).not.toContain('handleScroll');
  });

  it('keeps landing demo links routed to the public live demo surface', () => {
    const demoContent = readRepoFile('web-next/app/demo/page.tsx');
    const demoDataContent = readRepoFile('web-next/app/demo/live-demo-data.ts');
    const bentoContent = readRepoFile('web-next/components/bento-section.tsx');

    expect(bentoContent).not.toContain('/demo#snapshot-rank-');
    expect(bentoContent).toContain('href: "/demo"');
    expect(demoDataContent).toContain('app.bsky.feed.getFeed');
    expect(demoContent).not.toContain('snapshot-rank');
  });

  it('labels the landing replay as an illustrative Corgi Commons preview', () => {
    const pageContent = readRepoFile('web-next/app/page.tsx');
    const renderedHomepageContent = [
      'web-next/app/page.tsx',
      'web-next/components/hero-section.tsx',
      'web-next/components/replay-teaser.tsx',
      'web-next/components/community-examples-section.tsx',
      'web-next/components/social-proof.tsx',
      'web-next/components/bento-section.tsx',
      'web-next/components/faq-section.tsx',
      'web-next/components/cta-section.tsx',
      'web-next/components/footer-section.tsx',
    ].map(readRepoFile).join('\n');

    expect(pageContent).toContain('Corgi Commons brings together open-network building');
    expect(pageContent).toContain('Change the illustrative policy below');
    expect(pageContent).toContain('Bluesky shows the ordered posts. Corgi shows the policy and receipts.');
    expect(pageContent).not.toContain('same feed reorders in Bluesky');
    expect(renderedHomepageContent).not.toContain('Birders Who Code');
  });

  it('shows lifecycle arrows only when all six steps share one row', () => {
    const bentoContent = readRepoFile('web-next/components/bento-section.tsx');

    expect(bentoContent).toContain('className="hidden text-primary/45 xl:block"');
    expect(bentoContent).not.toContain('className="hidden text-primary/45 md:block"');
  });

  it('keeps public support reachable without repository access', () => {
    const supportContent = readRepoFile('web-next/app/support/page.tsx');

    expect(supportContent).toContain('mailto:hello@corgi.network');
    expect(supportContent).toContain('<Strong>GitHub issues</Strong>');
    expect(supportContent).toContain('existing public threads');
    expect(supportContent).not.toContain('<P>Open a GitHub issue');
  });

  it('keeps shared landing CTAs rendered through Button asChild', () => {
    const ctaContent = readRepoFile('web-next/components/landing-ctas.tsx');

    expect(ctaContent).not.toMatch(/<Link href="\/(?:demo|sign-in)">\s*<Button/s);
    expect(ctaContent).toMatch(/<Button\s+asChild[\s\S]*?<Link href="\/demo">/);
    expect(ctaContent).toMatch(/<Button\s+asChild[\s\S]*?<Link href="\/sign-in">/);
  });

  it('keeps how-it-works centered on the replay walkthrough and modality boundary', () => {
    const howItWorksContent = readRepoFile('web-next/app/how-it-works/page.tsx');
    const replayContent = readRepoFile('web-next/components/how-it-works-replay.tsx');

    expect(howItWorksContent).toContain('<HowItWorksReplay />');
    // The page header IS the replay intro now (the old duplicate hero + its
    // #replay jump-link were collapsed): the hero must carry the replay framing
    // and the replay module must sit directly on the page.
    expect(howItWorksContent).toContain('Watch the same posts become a different feed.');
    expect(howItWorksContent).toContain('eyebrow="Replay a policy change"');
    // The replay anchor now uses the <Section> layout primitive, which renders a
    // <section id="replay"> at runtime — accept either the component or raw tag.
    expect(replayContent).toMatch(/<(?:S|s)ection id="replay"/);
    expect(replayContent).toMatch(/standard Bluesky clients render the ordered posts, not Corgi score panels\./i);
    expect(howItWorksContent).toContain('Rank badges and receipt panels in this page are Corgi annotations.');
  });
});
