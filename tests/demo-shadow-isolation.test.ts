import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  demoCorpusKeyPrefix,
  demoIdempotencyKeyPrefix,
  demoLockKeyPrefix,
  demoSessionKeyPrefix,
  demoSharedCorpusKeyPrefix,
} from '../src/demo/store.js';

const DEMO_SRC_DIR = new URL('../src/demo', import.meta.url).pathname;

describe('shadow demo isolation guards', () => {
  it('keeps Redis state inside the demo namespace', () => {
    expect(demoSessionKeyPrefix()).toBe('demo:session:');
    expect(demoCorpusKeyPrefix()).toBe('demo:corpus:');
    expect(demoSharedCorpusKeyPrefix()).toBe('demo:corpus:current:');
    expect(demoIdempotencyKeyPrefix()).toBe('demo:idempotency:');
    expect(demoLockKeyPrefix()).toBe('demo:lock:');
  });

  it('does not import production mutation or scoring pipeline entry points', () => {
    const source = demoSourceText();

    expect(source).not.toMatch(/forceEpochTransition/);
    expect(source).not.toMatch(/closeCurrentEpochAndCreateNext/);
    expect(source).not.toMatch(/runScoringPipeline/);
    expect(source).not.toMatch(/from ['"].*\.\.\/governance\/routes\/vote/);
    expect(source).not.toMatch(/from ['"].*\.\.\/scoring\/pipeline/);
  });

  it('does not write production governance, audit, feed, or export storage', () => {
    const source = demoSourceText();

    expect(source).not.toMatch(/\bINSERT\s+INTO\s+governance_/i);
    expect(source).not.toMatch(/\bUPDATE\s+governance_/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\s+governance_/i);
    expect(source).not.toContain('feed:current');
    expect(source).not.toContain('feed:current_snapshot_id');
    expect(source).not.toMatch(/\bresearch_exports?\b/i);
  });
});

function demoSourceText(): string {
  return sourceFiles(DEMO_SRC_DIR)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir).map((entry) => join(dir, entry));
  return entries.flatMap((entry) => {
    const stat = statSync(entry);
    if (stat.isDirectory()) {
      return sourceFiles(entry);
    }
    return entry.endsWith('.ts') ? [entry] : [];
  });
}
