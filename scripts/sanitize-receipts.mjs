#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultReceiptsRoot = path.join(repoRoot, 'ops', 'receipts');
const receiptsRoot = process.env.RECEIPTS_ROOT
  ? path.resolve(process.env.RECEIPTS_ROOT)
  : defaultReceiptsRoot;

const CANONICAL_UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DEVICE_BY_ID_REGEX = /\/dev\/disk\/by-id\/[^\s",]+/g;
const SHORT_SERIAL_REGEX = /\b[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}\b/g;
const UUID_FIELD_REGEX = /\b(UUID|PARTUUID)=("[^"\s]+"|[A-Fa-f0-9-]+)/gi;
const ACTION_ID_REGEX = /(\baction\s+|\/v2\/actions\/)(\d{8,})\b/gi;
const PROVIDER_JSON_ID_REGEX =
  /((?:"(?:\w*_id|id)"|\b(?:\w*_id|id)\b)\s*:\s*)(?:"(\d{8,})"|\b(\d{8,})\b)/gi;
const DISALLOWED_RECEIPT_REGEX =
  /(UUID=|PARTUUID=|\/dev\/disk\/by-id\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}\b|(\baction\s+|\/v2\/actions\/)\d{8,}\b|(?:"(?:\w*_id|id)"|\b(?:\w*_id|id)\b)\s*:\s*(?:"\d{8,}"|\b\d{8,}\b))/i;
const providerIdTokens = new Map();

class UnsupportedReceiptEntryError extends Error {
  constructor(entryPath) {
    super(`unsupported receipt entry type: ${relative(entryPath)}`);
    this.name = 'UnsupportedReceiptEntryError';
  }
}

function walkFiles(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
        continue;
      }
      throw new UnsupportedReceiptEntryError(fullPath);
    }
  }

  return files;
}

function relative(filePath) {
  const relativeToRepo = path.relative(repoRoot, filePath);
  const isInRepo = relativeToRepo && !relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo);
  const basePath = isInRepo ? repoRoot : receiptsRoot;
  const relativePath = path.relative(basePath, filePath).replace(/\\/g, '/');
  return relativePath || filePath;
}

export function resetReceiptSanitizerState() {
  providerIdTokens.clear();
}

function providerIdToken(rawValue) {
  const existingToken = providerIdTokens.get(rawValue);
  if (existingToken) {
    return existingToken;
  }

  const digest = createHash('sha256').update(rawValue).digest('hex').slice(0, 12).toUpperCase();
  const token = `[PROVIDER_ID_${digest}]`;
  providerIdTokens.set(rawValue, token);
  return token;
}

export function sanitizeReceiptContent(content) {
  return content
    .replace(DEVICE_BY_ID_REGEX, '[REDACTED]')
    .replace(UUID_FIELD_REGEX, (_match, key) => `${key}:[REDACTED]`)
    .replace(CANONICAL_UUID_REGEX, '[REDACTED]')
    .replace(SHORT_SERIAL_REGEX, '[REDACTED]')
    .replace(ACTION_ID_REGEX, (_match, prefix, rawValue) => `${prefix}${providerIdToken(rawValue)}`)
    .replace(PROVIDER_JSON_ID_REGEX, (_match, prefix, quotedValue, bareValue) => {
      const rawValue = quotedValue || bareValue;
      return `${prefix}"${providerIdToken(rawValue)}"`;
    });
}

function main() {
  const checkOnly = process.argv.includes('--check');

  if (!existsSync(receiptsRoot)) {
    console.error(`receipt sanitizer: missing receipts directory ${relative(receiptsRoot)}`);
    process.exit(1);
  }
  let receiptsRootStat;
  try {
    receiptsRootStat = statSync(receiptsRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`receipt sanitizer: failed to read receipts directory ${relative(receiptsRoot)}: ${message}`);
    process.exit(1);
  }
  if (!receiptsRootStat.isDirectory()) {
    console.error(`receipt sanitizer: missing receipts directory ${relative(receiptsRoot)}`);
    process.exit(1);
  }

  const dirtyFiles = [];
  let receiptFiles = [];
  try {
    receiptFiles = walkFiles(receiptsRoot).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`receipt sanitizer: failed to read receipts directory ${relative(receiptsRoot)}: ${message}`);
    process.exit(1);
  }
  for (const file of receiptFiles) {
    const displayPath = relative(file);
    try {
      const originalBuffer = readFileSync(file);
      if (originalBuffer.includes(0)) {
        continue;
      }

      const original = originalBuffer.toString('utf8');
      const sanitized = sanitizeReceiptContent(original);
      if (sanitized === original && !DISALLOWED_RECEIPT_REGEX.test(original)) {
        continue;
      }

      if (checkOnly) {
        dirtyFiles.push(displayPath);
      } else {
        writeFileSync(file, sanitized);
        dirtyFiles.push(displayPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`receipt sanitizer: failed to process ${displayPath}: ${message}`);
      process.exit(1);
    }
  }

  if (dirtyFiles.length > 0 && checkOnly) {
    console.error('Receipt sanitizer found unredacted stable identifiers:');
    for (const file of dirtyFiles) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  const action = checkOnly ? 'checked' : 'sanitized';
  console.log(`Receipt sanitizer ${action} ${receiptFiles.length} receipt files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
