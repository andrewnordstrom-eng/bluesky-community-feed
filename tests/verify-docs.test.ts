import { describe, expect, it } from 'vitest';

import {
  collectTopLevelHeadings,
  findHeadingLineIndex,
  findNextTopLevelHeadingIndex,
  isMarkdownSeparatorRow,
} from '../scripts/verify-docs.mjs';

describe('verify-docs helpers', () => {
  it('returns an empty list when no top-level headings exist', () => {
    expect(collectTopLevelHeadings('')).toEqual([]);
  });

  it('ignores top-level headings inside fenced code blocks', () => {
    const content = [
      '## 1. What This Repo Is',
      '',
      '```bash',
      '## fake heading',
      '```',
      '',
      '## 2. Why It Exists',
    ].join('\n');

    expect(collectTopLevelHeadings(content)).toEqual([
      '## 1. What This Repo Is',
      '## 2. Why It Exists',
    ]);
  });

  it('finds the next real top-level heading after a tracker subsection', () => {
    const lines = [
      '### Doc Compliance Tracker (production_service)',
      '| Required Doc | Canonical Path | Status | Notes |',
      '|--------------|----------------|--------|-------|',
      '| readme | `README.md` | Exists | Canonical entry point |',
      '```md',
      '## fake heading',
      '```',
      '## 8. Known Gotchas',
    ];

    expect(findNextTopLevelHeadingIndex(lines, 1)).toBe(7);
  });

  it('returns -1 when no real top-level heading exists after the start index', () => {
    const lines = ['plain text', '```md', '## fake heading', '```'];
    expect(findNextTopLevelHeadingIndex(lines, 0)).toBe(-1);
    expect(findNextTopLevelHeadingIndex(lines, 2)).toBe(-1);
  });

  it('finds only actual tracker heading lines, not prose or fenced code', () => {
    const lines = [
      'This paragraph mentions ### Doc Compliance Tracker in prose.',
      '```md',
      '### Doc Compliance Tracker (production_service)',
      '```',
      '### Doc Compliance Tracker (production_service)',
    ];

    expect(findHeadingLineIndex(lines, /^###\s+Doc Compliance Tracker\b/)).toBe(4);
  });

  it('accepts only valid markdown separator rows', () => {
    expect(
      isMarkdownSeparatorRow(['--------------', '----------------', '--------', '-------'], 4),
    ).toBe(true);
    expect(
      isMarkdownSeparatorRow(['Required Doc', 'Canonical Path', 'Status', 'Notes'], 4),
    ).toBe(false);
    expect(isMarkdownSeparatorRow(['--------------', '----------------', '--------'], 4)).toBe(
      false,
    );
    expect(
      isMarkdownSeparatorRow(['--------------', '---x---', '--------', '-------'], 4),
    ).toBe(false);
  });
});
