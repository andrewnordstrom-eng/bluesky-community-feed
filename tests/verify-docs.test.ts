import { describe, expect, it } from 'vitest';

import {
  collectTopLevelHeadings,
  findNextTopLevelHeadingIndex,
  isMarkdownSeparatorRow,
} from '../scripts/verify-docs.mjs';

describe('verify-docs helpers', () => {
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
  });
});
