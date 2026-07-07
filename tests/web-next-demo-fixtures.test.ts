import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LIVE_FEED_POSTS,
  LIVE_METRICS_SNAPSHOT,
  LIVE_RANK_ONE_COMPONENTS,
  LIVE_RANK_ONE_EXPLANATION,
} from '../web-next/lib/live-metrics-snapshot';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_NEXT_ROOT = path.join(REPO_ROOT, 'web-next');
const LIVE_METRICS_SNAPSHOT_FILE = path.join(WEB_NEXT_ROOT, 'lib', 'live-metrics-snapshot.ts');

const UI_FIXTURE_FILES = [
  path.join(REPO_ROOT, 'web-next', 'app', 'demo', 'page.tsx'),
  path.join(REPO_ROOT, 'web-next', 'components', 'dashboard-preview.tsx'),
  path.join(REPO_ROOT, 'web-next', 'components', 'hero-section.tsx'),
  LIVE_METRICS_SNAPSHOT_FILE,
];

const DOMAIN_HANDLE_PATTERN =
  /\b(?![a-z0-9.-]+\.(?:cjs|css|gif|ico|jpe?g|json|jsx|mjs|md|png|svg|tsx?|webp)\b)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z][a-z0-9-]{1,62})+\b/i;
const CODE_FILE_EXTENSIONS = new Set(['.ts', '.tsx']);
const IGNORED_DIRECTORY_NAMES = new Set(['.next', 'dist', 'node_modules', 'out']);

const FORBIDDEN_LIVE_RECEIPT_PATTERNS = [
  { name: 'AT Protocol post URI', pattern: /at:\/\/did:/i },
  { name: 'PLC DID', pattern: /did:plc:/i },
  { name: 'Bluesky handle', pattern: /[a-z0-9._-]+\.bsky\.social/i },
  { name: 'domain-style handle', pattern: DOMAIN_HANDLE_PATTERN },
  { name: 'known receipt handle', pattern: /\b(elainesque|waveforest|kdinjenzenvo|sonicstadium)\b/i },
  { name: 'known receipt text', pattern: /Also, this is just funny\./i },
];

function readFixtureFile(fixtureFile: string): string {
  try {
    return readFileSync(fixtureFile, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read fixture ${path.relative(REPO_ROOT, fixtureFile)}: ${message}`);
  }
}

function extractStringLiterals(content: string): string[] {
  const literals: string[] = [];
  const literalPattern = /(["'`])((?:\\[\s\S]|(?!\1)[\s\S])*)\1/g;
  let match = literalPattern.exec(content);

  while (match !== null) {
    literals.push((match[2] ?? '').replace(/\$\{[^}]*\}/g, ''));
    match = literalPattern.exec(content);
  }

  return literals;
}

function sanitizeStringLiterals(literals: string[]): string[] {
  return literals
    .map((literal) => literal.replace(/https?:\/\/\S+/gi, ''))
    .filter((literal) => literal.length > 0);
}

function listCodeFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        files.push(...listCodeFiles(entryPath));
      }
      continue;
    }

    if (entry.isFile() && CODE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function findLiveMetricsSnapshotFixtureFiles(): string[] {
  const importers = listCodeFiles(WEB_NEXT_ROOT).filter((codeFile) => {
    if (codeFile === LIVE_METRICS_SNAPSHOT_FILE) {
      return false;
    }

    return readFixtureFile(codeFile).includes('live-metrics-snapshot');
  });

  return [...importers, LIVE_METRICS_SNAPSHOT_FILE].sort();
}

function relativeFixturePaths(fixtureFiles: string[]): string[] {
  return fixtureFiles.map((fixtureFile) => path.relative(REPO_ROOT, fixtureFile)).sort();
}

describe('web-next demo receipt fixtures', () => {
  it('keeps the scanned fixture set exhaustive for live snapshot importers', () => {
    expect(relativeFixturePaths(UI_FIXTURE_FILES)).toEqual(
      relativeFixturePaths(findLiveMetricsSnapshotFixtureFiles()),
    );
  });

  it('keeps public UI fixtures anonymized while preserving numeric receipts', () => {
    for (const fixtureFile of UI_FIXTURE_FILES) {
      const content = readFixtureFile(fixtureFile);
      const stringLiterals = sanitizeStringLiterals(extractStringLiterals(content));

      for (const forbiddenPattern of FORBIDDEN_LIVE_RECEIPT_PATTERNS) {
        expect(
          stringLiterals.join('\n'),
          `${path.relative(REPO_ROOT, fixtureFile)} contains ${forbiddenPattern.name}`,
        ).not.toMatch(forbiddenPattern.pattern);
      }
    }
  });

  it('extracts multiline template literals for live identifier checks', () => {
    const content = [
      'const fixture = `',
      'Public copy line',
      'did:plc:multilineexample123',
      'author.bsky.social',
      '`;',
    ].join('\n');
    const stringLiterals = sanitizeStringLiterals(extractStringLiterals(content)).join('\n');

    expect(stringLiterals).toMatch(/did:plc:/i);
    expect(stringLiterals).toMatch(/[a-z0-9._-]+\.bsky\.social/i);
  });

  it('proves forbidden receipt patterns catch synthetic live identifiers', () => {
    const samples = [
      { name: 'AT Protocol post URI', value: 'at://did:plc:example/app.bsky.feed.post/abc' },
      { name: 'PLC DID', value: 'did:plc:example1234567890' },
      { name: 'Bluesky handle', value: 'author.bsky.social' },
      { name: 'domain-style handle', value: 'author.example.social' },
      { name: 'known receipt handle', value: 'elainesque' },
      { name: 'known receipt text', value: 'Also, this is just funny.' },
    ];

    for (const sample of samples) {
      const forbiddenPattern = FORBIDDEN_LIVE_RECEIPT_PATTERNS.find(
        (pattern) => pattern.name === sample.name,
      );

      expect(forbiddenPattern, `Missing forbidden pattern fixture for ${sample.name}`).toBeDefined();
      expect(sample.value).toMatch(forbiddenPattern?.pattern ?? /$^/);
    }
  });

  it('distinguishes domain-style handles from benign dotted file literals', () => {
    expect('author.example.social').toMatch(DOMAIN_HANDLE_PATTERN);
    expect('styles.css').not.toMatch(DOMAIN_HANDLE_PATTERN);
    expect('page.tsx').not.toMatch(DOMAIN_HANDLE_PATTERN);
  });

  it('keeps rank-one score receipts internally consistent', () => {
    const componentTotal = LIVE_RANK_ONE_COMPONENTS.reduce(
      (total, component) => total + component.weighted,
      0,
    );

    expect(componentTotal).toBeCloseTo(LIVE_RANK_ONE_EXPLANATION.totalScore, 12);
    expect(LIVE_FEED_POSTS[0]?.score).toBe(LIVE_RANK_ONE_EXPLANATION.totalScore);
    expect(LIVE_METRICS_SNAPSHOT.scoredPosts).toBe(3348);
    expect(LIVE_METRICS_SNAPSHOT.uniqueAuthors).toBe(3007);
  });

  it('keeps snapshot authors as anonymized receipt labels', () => {
    const authorLabels = [
      LIVE_RANK_ONE_EXPLANATION.authorLabel,
      ...LIVE_FEED_POSTS.map((post) => post.author),
    ];

    for (const authorLabel of authorLabels) {
      expect(authorLabel).toMatch(/^Production receipt \d{3}$/);
      expect(authorLabel).not.toMatch(DOMAIN_HANDLE_PATTERN);
    }
  });
});
