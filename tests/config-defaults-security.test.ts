import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

import { parseTrustProxyConfig } from '../src/feed/server.js';

describe('security-oriented config defaults', () => {
  it('uses did:plc-only default issuer prefixes in config schema', () => {
    const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    expect(source).toContain("FEED_JWT_ALLOWED_ISSUER_PREFIXES: z.string().default('did:plc:')");
  });

  it('enforces a non-default export anonymization salt in production', () => {
    const source = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
    expect(source).toContain('EXPORT_ANONYMIZATION_SALT must be explicitly set in production.');
    expect(source).toContain('EXPORT_ANONYMIZATION_SALT should be at least 32 characters in production.');
  });

  it('parses trustProxy configuration safely', () => {
    expect(parseTrustProxyConfig('false')).toBe(false);
    expect(parseTrustProxyConfig('true')).toBe(true);
    expect(parseTrustProxyConfig('2')).toBe(2);
    expect(parseTrustProxyConfig('loopback')).toBe('loopback');
    expect(parseTrustProxyConfig('127.0.0.1,10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });
});
