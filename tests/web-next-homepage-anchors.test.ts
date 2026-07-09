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
    expect(faqContent).toContain('scroll-mt-24');
    expect(faqContent).toContain('md:scroll-mt-28');
  });

  it('keeps the footer audit log link pointed at the history route', () => {
    const footerContent = readRepoFile('web-next/components/footer-section.tsx');

    expect(footerContent).toMatch(/<Link href="\/history"[^>]*>\s*Audit log\s*<\/Link>/);
  });

  it('keeps how-it-works navigation routed to the dedicated page', () => {
    const headerContent = readRepoFile('web-next/components/header.tsx');
    const footerContent = readRepoFile('web-next/components/footer-section.tsx');

    expect(headerContent).toMatch(/\{\s*name: "How it works", href: "\/how-it-works"\s*\}/);
    expect(footerContent).toMatch(/<Link href="\/how-it-works"[^>]*>\s*How it works\s*<\/Link>/);
    expect(headerContent).not.toContain('handleScroll');
  });

  it('keeps demo snapshot-rank fragments backed by rendered anchors', () => {
    const demoContent = readRepoFile('web-next/app/demo/page.tsx');
    const bentoContent = readRepoFile('web-next/components/bento-section.tsx');

    expect(bentoContent).toContain('/demo#snapshot-rank-');
    expect(demoContent).toContain('id={`snapshot-rank-${post.rank}`}');
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
    expect(howItWorksContent).toMatch(/href="#replay"/);
    expect(replayContent).toMatch(/<section id="replay"/);
    expect(replayContent).toContain('Standard Bluesky clients render the ordered posts, not Corgi score panels.');
    expect(howItWorksContent).toContain('Rank badges and receipt panels in this page are Corgi annotations.');
  });
});
