import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UI_FIXTURE_FILES = [
  path.join(REPO_ROOT, 'web-next', 'app', 'demo', 'page.tsx'),
  path.join(REPO_ROOT, 'web-next', 'components', 'dashboard-preview.tsx'),
  path.join(REPO_ROOT, 'web-next', 'lib', 'live-metrics-snapshot.ts'),
];

const FORBIDDEN_LIVE_RECEIPT_PATTERNS = [
  { name: 'AT Protocol post URI', pattern: /at:\/\/did:/i },
  { name: 'PLC DID', pattern: /did:plc:/i },
  { name: 'Bluesky handle', pattern: /[a-z0-9._-]+\.bsky\.social/i },
  { name: 'known receipt handle', pattern: /\b(elainesque|waveforest|kdinjenzenvo|sonicstadium)\b/i },
  { name: 'known receipt text', pattern: /Also, this is just funny\./i },
];

describe('web-next demo receipt fixtures', () => {
  it('keeps public UI fixtures anonymized while preserving numeric receipts', () => {
    for (const fixtureFile of UI_FIXTURE_FILES) {
      const content = readFileSync(fixtureFile, 'utf8');

      for (const forbiddenPattern of FORBIDDEN_LIVE_RECEIPT_PATTERNS) {
        expect(
          content,
          `${path.relative(REPO_ROOT, fixtureFile)} contains ${forbiddenPattern.name}`,
        ).not.toMatch(forbiddenPattern.pattern);
      }
    }
  });
});
