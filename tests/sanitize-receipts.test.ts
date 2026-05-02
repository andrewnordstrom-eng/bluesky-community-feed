import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
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

    expect(sanitizeReceiptContent(content)).toBe(
      'DigitalOcean action [PROVIDER_ID_1] via /v2/actions/[PROVIDER_ID_1] {"id": "[PROVIDER_ID_1]", "droplet_id": "[PROVIDER_ID_1]", "volume_id": "[PROVIDER_ID_2]"}',
    );
  });

  it('redacts uppercase JSON id keys', () => {
    const content = '{"ID": 3138450041, "VOLUME_ID": 3138450042}';

    expect(sanitizeReceiptContent(content)).toBe(
      '{"ID": "[PROVIDER_ID_1]", "VOLUME_ID": "[PROVIDER_ID_2]"}',
    );
  });

  it('redacts quoted numeric JSON id values', () => {
    const content = '{"id":"3138450041","droplet_id":"3138450041"}';

    expect(sanitizeReceiptContent(content)).toBe(
      '{"id":"[PROVIDER_ID_1]","droplet_id":"[PROVIDER_ID_1]"}',
    );
  });

  it('redacts unquoted receipt id keys', () => {
    const content = 'ID:3138450041 volume_id:"3138450042"';

    expect(sanitizeReceiptContent(content)).toBe(
      'ID:"[PROVIDER_ID_1]" volume_id:"[PROVIDER_ID_2]"',
    );
  });

  it('redacts provider JSON id values only at the 8-digit boundary', () => {
    expect(sanitizeReceiptContent('{"id":1234567}')).toBe('{"id":1234567}');
    expect(sanitizeReceiptContent('{"id":"1234567"}')).toBe('{"id":"1234567"}');
    expect(sanitizeReceiptContent('{"id":12345678}')).toBe('{"id":"[PROVIDER_ID_1]"}');
    expect(sanitizeReceiptContent('{"id":"12345678"}')).toBe('{"id":"[PROVIDER_ID_1]"}');
  });

  it('leaves empty and already-safe content unchanged', () => {
    expect(sanitizeReceiptContent('')).toBe('');
    expect(sanitizeReceiptContent('no stable identifiers here')).toBe(
      'no stable identifiers here',
    );
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

  it('sanitizes receipt files in sorted order for stable provider tokens', () => {
    const receiptsRoot = mkdtempSync(path.join(tmpdir(), 'receipt-sanitize-sorted-'));
    writeFileSync(path.join(receiptsRoot, 'b.txt'), '{"id":22222222}\n');
    writeFileSync(path.join(receiptsRoot, 'a.txt'), '{"id":11111111}\n');

    const result = spawnSync(process.execPath, [sanitizeScriptPath], {
      encoding: 'utf8',
      env: { ...process.env, RECEIPTS_ROOT: receiptsRoot },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(path.join(receiptsRoot, 'a.txt'), 'utf8')).toBe(
      '{"id":"[PROVIDER_ID_1]"}\n',
    );
    expect(readFileSync(path.join(receiptsRoot, 'b.txt'), 'utf8')).toBe(
      '{"id":"[PROVIDER_ID_2]"}\n',
    );
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
      expect(result.stderr).toContain(receiptsRoot);
      expect(result.stderr).toMatch(/failed to read|EACCES|permission/i);
    } finally {
      chmodSync(receiptsRoot, 0o700);
      rmSync(receiptsRoot, { recursive: true, force: true });
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
