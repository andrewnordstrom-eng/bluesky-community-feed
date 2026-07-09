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
  });

  it('keeps the footer audit log link pointed at the history route', () => {
    const footerContent = readRepoFile('web-next/components/footer-section.tsx');

    expect(footerContent).toMatch(/<Link href="\/history"[^>]*>\s*Audit log\s*<\/Link>/);
  });

  it('keeps shared landing CTAs rendered through Button asChild', () => {
    const ctaContent = readRepoFile('web-next/components/landing-ctas.tsx');

    expect(ctaContent).not.toMatch(/<Link href="\/(?:demo|sign-in)">\s*<Button/s);
    expect(ctaContent).toMatch(/<Button\s+asChild[\s\S]*?<Link href="\/demo">/);
    expect(ctaContent).toMatch(/<Button\s+asChild[\s\S]*?<Link href="\/sign-in">/);
  });
});
