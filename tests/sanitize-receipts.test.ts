import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetReceiptSanitizerState,
  sanitizeReceiptContent,
} from '../scripts/sanitize-receipts.mjs';

const sanitizeScriptPath = path.resolve('scripts', 'sanitize-receipts.mjs');
const PROVIDER_TOKEN_REGEX = /\[PROVIDER_ID_[0-9A-F]{16}\]/g;

function providerTokens(content: string): string[] {
  return content.match(PROVIDER_TOKEN_REGEX) ?? [];
}

describe('sanitizeReceiptContent', () => {
  beforeEach(() => {
    resetReceiptSanitizerState();
  });

  it('redacts disk-by-id paths inside JSON without consuming punctuation', () => {
    const content =
      '{"path":"/dev/disk/by-id/scsi-0DO_Volume_corgi-vps-backups","next":"kept"}';

    expect(sanitizeReceiptContent(content)).toBe(
      '{"path":"[REDACTED]","next":"kept"}',
    );
  });

  it('redacts short filesystem serials from mount proof output', () => {
    const content = '└─vda15 vfat FAT32 UEFI DAD0-3607 98.2M 6% /boot/efi';

    expect(sanitizeReceiptContent(content)).toBe(
      '└─vda15 vfat FAT32 UEFI [REDACTED] 98.2M 6% /boot/efi',
    );
  });

  it('redacts UUID and PARTUUID fields while preserving separators', () => {
    const content =
      'UUID="12345678-1234-1234-1234-1234567890ab"; PARTUUID=abcdef12-3456-7890-abcd-ef1234567890.';

    expect(sanitizeReceiptContent(content)).toBe(
      'UUID:[REDACTED]; PARTUUID:[REDACTED].',
    );
  });

  it('redacts lowercase uuid and partuuid fields consistently', () => {
    const content = 'uuid=12345678-1234-1234-1234-1234567890ab partuuid=abcdef12.';

    expect(sanitizeReceiptContent(content)).toBe(
      'uuid:[REDACTED] partuuid:[REDACTED].',
    );
  });

  it('redacts free-text canonical UUID tokens', () => {
    const content = 'volume id: 12345678-1234-1234-1234-1234567890ab';

    expect(sanitizeReceiptContent(content)).toBe('volume id: [REDACTED]');
  });

  it('redacts provider action ids in prose, API paths, and JSON ids', () => {
    const content =
      'DigitalOcean action 3138450041 via /v2/actions/3138450041 {"id": 3138450041, "droplet_id": 3138450041, "volume_id": 3138450042}';
    const sanitized = sanitizeReceiptContent(content);
    const tokens = providerTokens(sanitized);

    expect(tokens).toHaveLength(5);
    expect(tokens[0]).toBe(tokens[1]);
    expect(tokens[0]).toBe(tokens[2]);
    expect(tokens[0]).toBe(tokens[3]);
    expect(tokens[4]).not.toBe(tokens[0]);
    expect(sanitized).not.toContain('3138450041');
    expect(sanitized).not.toContain('3138450042');
  });

  it('redacts uppercase JSON id keys', () => {
    const content = '{"ID": 3138450041, "VOLUME_ID": 3138450042}';
    const sanitized = sanitizeReceiptContent(content);
    const tokens = providerTokens(sanitized);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(sanitized).toBe(`{"ID": "${tokens[0]}", "VOLUME_ID": "${tokens[1]}"}`);
  });

  it('redacts quoted numeric JSON id values', () => {
    const content = '{"id":"3138450041","droplet_id":"3138450041"}';
    const sanitized = sanitizeReceiptContent(content);
    const tokens = providerTokens(sanitized);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toBe(tokens[1]);
    expect(sanitized).toBe(`{"id":"${tokens[0]}","droplet_id":"${tokens[0]}"}`);
  });

  it('redacts unquoted receipt id keys', () => {
    const content = 'ID:3138450041 volume_id:"3138450042"';
    const sanitized = sanitizeReceiptContent(content);
    const tokens = providerTokens(sanitized);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(sanitized).toBe(`ID:"${tokens[0]}" volume_id:"${tokens[1]}"`);
  });

  it('redacts provider JSON id values only at the 8-digit boundary', () => {
    expect(sanitizeReceiptContent('{"id":1234567}')).toBe('{"id":1234567}');
    expect(sanitizeReceiptContent('{"id":"1234567"}')).toBe('{"id":"1234567"}');
    const bareSanitized = sanitizeReceiptContent('{"id":12345678}');
    const quotedSanitized = sanitizeReceiptContent('{"id":"12345678"}');
    const [token] = providerTokens(bareSanitized);

    expect(bareSanitized).toBe(`{"id":"${token}"}`);
    expect(quotedSanitized).toBe(`{"id":"${token}"}`);
  });

  it('does not partially redact alphanumeric provider id values', () => {
    expect(sanitizeReceiptContent('{"id":"3138450041abc"}')).toBe(
      '{"id":"3138450041abc"}',
    );
    expect(sanitizeReceiptContent('ID:3138450041xyz')).toBe('ID:3138450041xyz');
  });

  it('leaves empty and already-safe content unchanged', () => {
    expect(sanitizeReceiptContent('')).toBe('');
    expect(sanitizeReceiptContent('no stable identifiers here')).toBe(
      'no stable identifiers here',
    );
  });

  it('redacts dotenv-style secret assignments while preserving key names', () => {
    const content = [
      'DATABASE_URL=postgresql://feed:db-password@example.internal:5432/feed',
      'export BOT_APP_PASSWORD="bot-password"',
      "BSKY_APP_PASSWORD='bsky-password'",
      'EXPORT_ANONYMIZATION_SALT=random-export-salt',
      'PUBLIC_BASE_URL=https://feed.corgi.network',
    ].join('\n');

    const sanitized = sanitizeReceiptContent(content);

    expect(sanitized).toContain('DATABASE_URL=[REDACTED]');
    expect(sanitized).toContain('export BOT_APP_PASSWORD=[REDACTED]');
    expect(sanitized).toContain('BSKY_APP_PASSWORD=[REDACTED]');
    expect(sanitized).toContain('EXPORT_ANONYMIZATION_SALT=[REDACTED]');
    expect(sanitized).toContain('PUBLIC_BASE_URL=https://feed.corgi.network');
    expect(sanitized).not.toContain('db-password');
    expect(sanitized).not.toContain('bot-password');
    expect(sanitized).not.toContain('bsky-password');
    expect(sanitized).not.toContain('random-export-salt');
  });

  it('redacts credential-bearing URLs outside dotenv assignments', () => {
    const content =
      'psql postgresql://feed:db-password@example.internal:5432/feed && redis://default:redis-password@localhost:6379';

    const sanitized = sanitizeReceiptContent(content);

    expect(sanitized).toContain('postgresql://[REDACTED]@example.internal:5432/feed');
    expect(sanitized).toContain('redis://[REDACTED]@localhost:6379');
    expect(sanitized).not.toContain('feed:db-password');
    expect(sanitized).not.toContain('default:redis-password');
  });

  it('cli --check fails on dirty receipt files and reports the path', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-dirty-'));
    const receiptPath = path.join(receiptsRoot, 'dirty.txt');
    writeFileSync(receiptPath, 'DigitalOcean action 3138450041\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Receipt sanitizer found unredacted stable identifiers');
    expect(result.stderr).toContain('dirty.txt');
  });

  it('cli --check fails on quoted numeric JSON id receipt files', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-json-dirty-'));
    const receiptPath = path.join(receiptsRoot, 'dirty-json.txt');
    writeFileSync(receiptPath, '{"id":"3138450041"}\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Receipt sanitizer found unredacted stable identifiers');
    expect(result.stderr).toContain('dirty-json.txt');
  });

  it('cli --check fails on dotenv-style secret assignments', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-env-dirty-'));
    const receiptPath = path.join(receiptsRoot, 'dirty-env.txt');
    writeFileSync(receiptPath, 'DATABASE_URL=postgresql://feed:db-password@example.internal/feed\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Receipt sanitizer found unredacted stable identifiers');
    expect(result.stderr).toContain('dirty-env.txt');
  });

  it('cli --check fails on dotenv-style secret assignment edge cases', () => {
    const cases = [
      ['empty-value.txt', 'DATABASE_URL=\n'],
      ['inline-comment.txt', 'DATABASE_URL=secret # db\n'],
      ['lowercase-key.txt', 'database_url=postgresql://feed:db-password@example.internal/feed\n'],
      ['quoted-equals.txt', 'PASSWORD="pass=word"\n'],
    ];

    for (const [fileName, content] of cases) {
      const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-env-edge-'));
      writeFileSync(path.join(receiptsRoot, fileName), content);

      const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Receipt sanitizer found unredacted stable identifiers');
      expect(result.stderr).toContain(fileName);
    }
  });

  it('cli --check respects the provider JSON id digit boundary', () => {
    const cleanReceiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-boundary-clean-'));
    writeFileSync(path.join(cleanReceiptsRoot, 'safe-json.txt'), '{"id":"1234567"}\n');

    const cleanResult = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: cleanReceiptsRoot },
    });

    expect(cleanResult.status).toBe(0);
    expect(cleanResult.stderr).toBe('');

    const dirtyReceiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-boundary-dirty-'));
    writeFileSync(path.join(dirtyReceiptsRoot, 'dirty-json.txt'), '{"id":"12345678"}\n');

    const dirtyResult = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: dirtyReceiptsRoot },
    });

    expect(dirtyResult.status).toBe(1);
    expect(dirtyResult.stderr).toContain('dirty-json.txt');
  });

  it('cli --check passes on alphanumeric provider id-like values', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-alphanumeric-'));
    writeFileSync(path.join(receiptsRoot, 'safe-json.txt'), '{"id":"3138450041abc"}\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('sanitizes receipt files with collision-free provider tokens', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-sorted-'));
    writeFileSync(path.join(receiptsRoot, 'b.txt'), '{"id":22222222}\n');
    writeFileSync(path.join(receiptsRoot, 'a.txt'), '{"id":11111111}\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(0);
    const aContent = readFileSync(path.join(receiptsRoot, 'a.txt'), 'utf8');
    const bContent = readFileSync(path.join(receiptsRoot, 'b.txt'), 'utf8');
    const [aToken] = providerTokens(aContent);
    const [bToken] = providerTokens(bContent);

    expect(aContent).toBe(`{"id":"${aToken}"}\n`);
    expect(bContent).toBe(`{"id":"${bToken}"}\n`);
    expect(aToken).not.toBe(bToken);
  });

  it('keeps provider tokens collision-free across incremental sanitize runs', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-incremental-'));
    writeFileSync(path.join(receiptsRoot, 'a.txt'), '{"id":11111111}\n');

    const firstResult = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(firstResult.status).toBe(0);
    const aContent = readFileSync(path.join(receiptsRoot, 'a.txt'), 'utf8');
    const [aToken] = providerTokens(aContent);
    expect(aContent).toBe(`{"id":"${aToken}"}\n`);

    writeFileSync(path.join(receiptsRoot, 'legacy.txt'), '{"id":"[PROVIDER_ID_1]"}\n');
    writeFileSync(path.join(receiptsRoot, 'b.txt'), '{"id":22222222}\n');

    const secondResult = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(secondResult.status).toBe(0);
    expect(readFileSync(path.join(receiptsRoot, 'legacy.txt'), 'utf8')).toBe(
      '{"id":"[PROVIDER_ID_1]"}\n',
    );
    const bContent = readFileSync(path.join(receiptsRoot, 'b.txt'), 'utf8');
    const [bToken] = providerTokens(bContent);
    expect(bContent).toBe(`{"id":"${bToken}"}\n`);
    expect(bToken).not.toBe(aToken);
    expect(bContent).not.toContain('[PROVIDER_ID_1]');
  });

  it('sanitize mode leaves binary receipts byte-identical', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-binary-'));
    const binaryPath = path.join(receiptsRoot, 'artifact.bin');
    const originalBinary = Buffer.from([0x00, 0x31, 0x32, 0x33, 0x34, 0xff]);
    writeFileSync(binaryPath, originalBinary);

    const result = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(binaryPath)).toEqual(originalBinary);
  });

  it('cli --check fails on invalid UTF-8 receipts', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-invalid-utf8-'));
    writeFileSync(path.join(receiptsRoot, 'invalid.txt'), Buffer.from([0xff, 0xfe, 0xfd]));

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('receipt sanitizer: failed to process invalid.txt');
  });

  it('sanitize mode fails when disallowed identifiers remain after replacement', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-still-dirty-'));
    const receiptPath = path.join(receiptsRoot, 'still-dirty.txt');
    writeFileSync(receiptPath, 'UUID=not-a-uuid\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('receipt sanitizer: failed to process still-dirty.txt');
    expect(result.stderr).toContain('sanitized content still contains disallowed stable identifiers');
    expect(readFileSync(receiptPath, 'utf8')).toBe('UUID=not-a-uuid\n');
  });

  it('cli --check reports dirty text receipts while ignoring binary receipts', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-mixed-'));
    writeFileSync(path.join(receiptsRoot, 'dirty.txt'), '{"id":"3138450041"}\n');
    writeFileSync(path.join(receiptsRoot, 'artifact.bin'), Buffer.from([0x00, 0x31, 0x32]));

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dirty.txt');
    expect(result.stderr).not.toContain('artifact.bin');
  });

  it('cli --check succeeds on clean receipt files without reporting paths', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-clean-'));
    mkdirSync(path.join(receiptsRoot, 'nested'));
    writeFileSync(path.join(receiptsRoot, 'nested', 'clean.txt'), 'already clean\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Receipt sanitizer checked 1 receipt files.');
    expect(result.stderr).toBe('');
  });

  it('cli --check fails when RECEIPTS_ROOT is missing', () => {
    const receiptsRoot = path.join(
      tmpdir(),
      `receipt-sanitize-missing-${process.pid}-${Date.now()}`,
    );

    const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('receipt sanitizer: missing receipts directory');
    expect(result.stderr).toContain(receiptsRoot);
  });

  it('cli --check fails when RECEIPTS_ROOT cannot be read', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(process.getuid()).toBe(0);
      return;
    }

    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-unreadable-'));
    try {
      chmodSync(receiptsRoot, 0o000);

      const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('receipt sanitizer: failed to read receipts directory');
      expect(result.stderr).toContain(receiptsRoot);
      expect(result.stderr).toMatch(/failed to read|EACCES|permission/i);
    } finally {
      chmodSync(receiptsRoot, 0o700);
      rmSync(receiptsRoot, { recursive: true, force: true });
    }
  });

  it('cli --check fails closed when RECEIPTS_ROOT is a symlink', () => {
    const targetRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-root-target-'));
    const linkRoot = path.join(tmpdir(), `receipt-sanitize-root-link-${process.pid}-${Date.now()}`);
    writeFileSync(path.join(targetRoot, 'clean.txt'), 'already clean\n');
    symlinkSync(targetRoot, linkRoot, 'dir');

    try {
      const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: linkRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('receipt sanitizer: unsupported receipts directory');
      expect(result.stderr).toContain(linkRoot);
    } finally {
      unlinkSync(linkRoot);
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it('cli --check fails closed when receipts contain a symlink', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-symlink-'));
    writeFileSync(path.join(receiptsRoot, 'target.txt'), 'already clean\n');
    symlinkSync('target.txt', path.join(receiptsRoot, 'linked.txt'));

    try {
      const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('unsupported receipt entry type: linked.txt');
    } finally {
      rmSync(receiptsRoot, { recursive: true, force: true });
    }
  });

  it('cli --check fails with a deterministic error for unreadable receipt files', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(process.getuid()).toBe(0);
      return;
    }

    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-unreadable-file-'));
    const receiptPath = path.join(receiptsRoot, 'dirty.txt');
    writeFileSync(receiptPath, '{"id":"3138450041"}\n');

    try {
      chmodSync(receiptPath, 0o000);

      const result = spawnSync(process.execPath, [sanitizeScriptPath, '--check'], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('receipt sanitizer: failed to process dirty.txt');
    } finally {
      chmodSync(receiptPath, 0o600);
      rmSync(receiptsRoot, { recursive: true, force: true });
    }
  });

  it('sanitize mode fails with a deterministic error for unwritable receipt files', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(process.getuid()).toBe(0);
      return;
    }

    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-unwritable-file-'));
    const receiptPath = path.join(receiptsRoot, 'dirty.txt');
    writeFileSync(receiptPath, '{"id":"3138450041"}\n');

    try {
      chmodSync(receiptPath, 0o400);

      const result = spawnSync(process.execPath, [sanitizeScriptPath], {
        encoding: 'utf8',
        env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('receipt sanitizer: failed to process dirty.txt');
    } finally {
      chmodSync(receiptPath, 0o600);
      rmSync(receiptsRoot, { recursive: true, force: true });
    }
  });
});
