import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
      'DigitalOcean action 3138450041 via /v2/actions/3138450041 {"id": 3138450041}';

    expect(sanitizeReceiptContent(content)).toBe(
      'DigitalOcean action [PROVIDER_ID_1] via /v2/actions/[PROVIDER_ID_1] {"id": "[PROVIDER_ID_1]"}',
    );
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
});
