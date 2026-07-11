import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  demoCorpusKeyPrefix,
  demoIdempotencyKeyPrefix,
  demoLockKeyPrefix,
  demoSessionKeyPrefix,
  demoSharedCorpusKeyPrefix,
  demoStagingKeyPrefix,
} from '../src/demo/store.js';
import { demoRateLimitKeyPrefix } from '../src/demo/rate-limit.js';

const DEMO_SRC_DIR = new URL('../src/demo', import.meta.url).pathname;
const COMPOSE_FILE = new URL('../docker-compose.prod.yml', import.meta.url).pathname;
const SERVER_FILE = new URL('../src/feed/server.ts', import.meta.url).pathname;
const DEPLOY_FILE = new URL('../.github/workflows/deploy.yml', import.meta.url).pathname;

describe('shadow demo isolation guards', () => {
  it('keeps Redis state inside the demo namespace', () => {
    expect(demoSessionKeyPrefix()).toBe('demo:session:');
    expect(demoCorpusKeyPrefix()).toBe('demo:corpus:');
    expect(demoSharedCorpusKeyPrefix()).toBe('demo:corpus:current:');
    expect(demoIdempotencyKeyPrefix()).toBe('demo:idempotency:');
    expect(demoLockKeyPrefix()).toBe('demo:lock:');
    expect(demoStagingKeyPrefix()).toBe('demo:staging:');
    expect(demoRateLimitKeyPrefix()).toBe('demo:rate-limit:');
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

  it('uses a dedicated bounded no-eviction Redis without persistence', () => {
    const compose = readFileSync(COMPOSE_FILE, 'utf8');
    const store = readFileSync(new URL('../src/demo/store.ts', import.meta.url), 'utf8');
    const server = readFileSync(SERVER_FILE, 'utf8');
    const deploy = readFileSync(DEPLOY_FILE, 'utf8');

    expect(store).toContain('process.env.DEMO_REDIS_URL');
    expect(compose).toContain('demo-redis:');
    expect(compose).toContain('127.0.0.1:6381:6379');
    expect(compose).toContain('--maxmemory 64mb');
    expect(compose).toContain('--maxmemory-policy noeviction');
    expect(compose).toContain('--save ""');
    expect(compose).toContain('--appendonly no');
    expect(compose).toContain('mem_limit: 96m');
    expect(server).toContain("routeOptions.url.startsWith('/api/demo/')");
    expect(server).toContain('rateLimit: false');
    expect(server).toContain('redisUrl: config.DEMO_REDIS_URL');
    expect(server).toContain('identifierHashSecret: config.DEMO_RATE_LIMIT_HASH_SECRET');
    expect(server).not.toContain('identifierHashSecret: config.EXPORT_ANONYMIZATION_SALT');
    expect(deploy).toContain('http://localhost:3001/api/demo/sessions');
    expect(deploy).toContain('PRODUCTION_KEY_EXISTS');
    expect(deploy).toContain('DEMO_KEY_EXISTS');
    expect(deploy).toContain('DEMO_POLICY');
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
