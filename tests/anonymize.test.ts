import { describe, expect, it } from 'vitest';
import { anonymizeDid } from '../src/lib/anonymize.js';

describe('anonymizeDid', () => {
  const salt = 'test-salt-at-least-16';

  it('produces a deterministic 16-char hex string', () => {
    const did = 'did:plc:abc123';
    const result = anonymizeDid(did, salt);
    expect(result).toMatch(/^[0-9a-f]{16}$/);
    expect(result).toBe(anonymizeDid(did, salt));
  });

  it('produces different output for different DIDs', () => {
    const a = anonymizeDid('did:plc:alice', salt);
    const b = anonymizeDid('did:plc:bob', salt);
    expect(a).not.toBe(b);
  });

  it('produces different output for different salts', () => {
    const did = 'did:plc:same-user';
    const a = anonymizeDid(did, 'salt-one-1234567890');
    const b = anonymizeDid(did, 'salt-two-1234567890');
    expect(a).not.toBe(b);
  });

  it('output is exactly 16 characters', () => {
    const result = anonymizeDid('did:plc:test', salt);
    expect(result.length).toBe(16);
  });
});
