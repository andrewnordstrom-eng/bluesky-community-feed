import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  demoCorpusKeyPrefix,
  demoIdempotencyKeyPrefix,
  demoLockKeyPrefix,
  demoSessionKeyPrefix,
  demoSessionNonceKeyPrefix,
  demoSharedCorpusKeyPrefix,
  demoStagingKeyPrefix,
} from '../src/demo/store.js';
import { demoRateLimitKeyPrefix } from '../src/demo/rate-limit.js';
import { SHADOW_DEMO_SHARED_CORPUS_TTL_SECONDS } from '../src/demo/types.js';

const DEMO_SRC_DIR = new URL('../src/demo', import.meta.url).pathname;
const COMPOSE_FILE = new URL('../docker-compose.prod.yml', import.meta.url).pathname;
const SERVER_FILE = new URL('../src/feed/server.ts', import.meta.url).pathname;
const DEPLOY_FILE = new URL('../.github/workflows/deploy.yml', import.meta.url).pathname;
const PROBE_UUID_A = '00000000-0000-4000-8000-000000000001';
const PROBE_UUID_B = '00000000-0000-4000-8000-000000000002';

describe('shadow demo isolation guards', () => {
  it('keeps Redis state inside the demo namespace', () => {
    expect(demoSessionKeyPrefix()).toBe('demo:session:');
    expect(demoSessionNonceKeyPrefix()).toBe('demo:session-nonce:');
    expect(demoCorpusKeyPrefix()).toBe('demo:corpus:');
    expect(demoSharedCorpusKeyPrefix()).toBe('demo:corpus:current:v4:');
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
    expect(deploy).toContain(`DEMO_KEY="${demoSessionKeyPrefix()}\${DEMO_SESSION_ID}"`);

    expect(deploy).toContain('DEMO_RESPONSE=$(curl -fsS --max-time 90');
    expect(deploy).toContain('PROBE_TIMESTAMP=$(date +%s)');
    expect(deploy).toContain(
      "PROBE_UUID=$(node -e \"process.stdout.write(require('node:crypto').randomUUID())\")"
    );
    expect(deploy).toContain('DEMO_CLIENT_NONCE="deploy-probe-${PROBE_UUID}"');
    expect(deploy).toContain('\\"clientNonce\\":\\"${DEMO_CLIENT_NONCE}\\"');
    expect(SHADOW_DEMO_SHARED_CORPUS_TTL_SECONDS).toBe(60 * 60);
    expect(usesOnlySudoDockerComposeCommands(deploy)).toBe(true);

    const demoCompose = compose.split('demo-redis:')[1];
    const maxmemoryMatch = demoCompose?.match(/--maxmemory\s+(\d+)mb/);
    expect(maxmemoryMatch).toBeDefined();
    const maxmemoryBytes = Number(maxmemoryMatch?.[1]) * 1024 * 1024;
    expect(deploy).toContain(`[ "$DEMO_MAXMEMORY" != "${maxmemoryBytes}" ]`);
  });

  it.each([
    { timestamp: 1_750_000_000, expectedOctet: 1 },
    { timestamp: 1_749_999_999, expectedOctet: 250 },
  ])(
    'serializes a valid demo probe nonce at the octet boundary: %j',
    ({ timestamp, expectedOctet }) => {
      const deploy = readFileSync(DEPLOY_FILE, 'utf8');
      const output = renderDemoProbe(deploy, timestamp, PROBE_UUID_A);

      expect(output.body).toEqual({
        communityId: 'open_science_builders',
        clientNonce: `deploy-probe-${PROBE_UUID_A}`,
      });
      expect(output.body.clientNonce).toMatch(/^[A-Za-z0-9:_-]{1,64}$/);
      expect(output.octet).toBe(expectedOctet);
    }
  );

  it('does not replay a nonce when concurrent probes share a timestamp', () => {
    const deploy = readFileSync(DEPLOY_FILE, 'utf8');
    const timestamp = 1_750_000_000;

    const first = renderDemoProbe(deploy, timestamp, PROBE_UUID_A);
    const second = renderDemoProbe(deploy, timestamp, PROBE_UUID_B);

    expect(first.body.clientNonce).not.toBe(second.body.clientNonce);
  });
});

describe('sudo Docker Compose command matcher', () => {
  it.each([
    'sudo docker compose up -d',
    'if sudo docker compose exec -T demo-redis redis-cli ping; then true; fi',
    'VALUE=$(sudo docker compose exec -T demo-redis redis-cli ping)',
    'sudo docker \\\n      compose up -d',
  ])('accepts privileged invocation: %j', (script) => {
    expect(usesOnlySudoDockerComposeCommands(script)).toBe(true);
  });

  it.each([
    '',
    'docker compose up -d',
    'sudo docker compose up -d\ndocker compose ps',
    '# sudo docker compose up -d',
    'echo "sudo docker compose up -d"',
    'echo sudo docker compose up -d',
    'docker \\\n      compose up -d',
  ])('rejects missing or non-privileged invocation: %j', (script) => {
    expect(usesOnlySudoDockerComposeCommands(script)).toBe(false);
  });
});

function usesOnlySudoDockerComposeCommands(script: string): boolean {
  const tokens = tokenizeShellCommands(script);
  const invocationIndexes = tokens.flatMap((token, index) =>
    token === 'docker' && tokens[index + 1] === 'compose' ? [index] : []
  );

  return (
    invocationIndexes.length > 0 &&
    invocationIndexes.every((index) => isDirectSudoCommand(tokens, index))
  );
}

function isDirectSudoCommand(tokens: string[], dockerIndex: number): boolean {
  if (tokens[dockerIndex - 1] !== 'sudo') {
    return false;
  }

  const boundaries = new Set(['\n', ';', '&', '|', '(', ')']);
  let commandStart = dockerIndex - 1;
  while (commandStart > 0 && !boundaries.has(tokens[commandStart - 1])) {
    commandStart -= 1;
  }

  const controlWords = new Set(['if', 'then', 'elif', 'while', 'until', '!']);
  const commandPrefix = tokens
    .slice(commandStart, dockerIndex)
    .filter((token) => !controlWords.has(token));
  return commandPrefix.length === 1 && commandPrefix[0] === 'sudo';
}

function tokenizeShellCommands(script: string): string[] {
  const tokens: string[] = [];
  let word = '';
  let quote: "'" | '"' | null = null;
  let index = 0;

  const pushWord = (): void => {
    if (word.length > 0) {
      tokens.push(word);
      word = '';
    }
  };

  while (index < script.length) {
    const char = script[index];
    const next = script[index + 1];

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && next !== undefined) {
        word += next;
        index += 1;
      } else {
        word += char;
      }
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }

    if (char === '\\' && next === '\n') {
      index += 2;
      continue;
    }

    if (char === '#' && word.length === 0) {
      while (index < script.length && script[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '\n') {
      pushWord();
      tokens.push('\n');
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      pushWord();
      index += 1;
      continue;
    }

    if (';&|()'.includes(char)) {
      pushWord();
      tokens.push(char);
      index += 1;
      continue;
    }

    word += char;
    index += 1;
  }

  pushWord();
  return tokens;
}

function renderDemoProbe(
  deploy: string,
  timestamp: number,
  probeUuid: string
): {
  body: { communityId: string; clientNonce: string };
  octet: number;
} {
  const octetAssignment = deploy.match(/^\s*(PROBE_OCTET=.*)$/m)?.[1];
  const nonceAssignment = deploy.match(/^\s*(DEMO_CLIENT_NONCE=.*)$/m)?.[1];
  const dataArgument = deploy.match(/^\s*-d\s+(.+)\s+\\$/m)?.[1];
  if (
    octetAssignment === undefined ||
    nonceAssignment === undefined ||
    dataArgument === undefined
  ) {
    throw new Error('Deploy workflow is missing the executable demo probe fragment');
  }

  const serialized = execFileSync(
    '/bin/sh',
    [
      '-eu',
      '-c',
      [
        `PROBE_TIMESTAMP=${timestamp}`,
        octetAssignment,
        `PROBE_UUID=${probeUuid}`,
        nonceAssignment,
        'printf \'%s\\n\' "$PROBE_OCTET"',
        `printf '%s' ${dataArgument}`,
      ].join('\n'),
    ],
    { encoding: 'utf8' }
  );
  const separator = serialized.indexOf('\n');
  if (separator < 1) {
    throw new Error(`Deploy workflow emitted a demo probe payload without an octet: ${serialized}`);
  }
  const octet = Number(serialized.slice(0, separator));
  if (!Number.isInteger(octet)) {
    throw new Error(`Deploy workflow emitted an invalid demo probe octet: ${serialized}`);
  }
  const serializedBody = serialized.slice(separator + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedBody);
  } catch (error) {
    throw new Error(`Deploy workflow emitted invalid demo probe JSON: ${serializedBody}`, {
      cause: error,
    });
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('communityId' in parsed) ||
    typeof parsed.communityId !== 'string' ||
    !('clientNonce' in parsed) ||
    typeof parsed.clientNonce !== 'string'
  ) {
    throw new Error(`Deploy workflow emitted an invalid demo probe payload: ${serialized}`);
  }

  return {
    body: { communityId: parsed.communityId, clientNonce: parsed.clientNonce },
    octet,
  };
}

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
