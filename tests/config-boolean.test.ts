/**
 * Tests for Zod boolean env var coercion.
 *
 * Verifies that zodEnvBool correctly handles string values from .env files,
 * especially the critical case where "false" was silently treated as true
 * by z.coerce.boolean().
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Mirror of zodEnvBool from src/config.ts.
 * Duplicated here so we can test the logic in isolation without loading
 * the full config (which requires all env vars).
 */
function zodEnvBool(defaultValue: boolean) {
  return z.preprocess(
    (val) => {
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
      return defaultValue;
    },
    z.boolean().default(defaultValue),
  );
}

describe('zodEnvBool', () => {
  const schemaDefaultTrue = z.object({ flag: zodEnvBool(true) });
  const schemaDefaultFalse = z.object({ flag: zodEnvBool(false) });

  it('parses "true" as true', () => {
    expect(schemaDefaultFalse.parse({ flag: 'true' }).flag).toBe(true);
  });

  it('parses "false" as false', () => {
    expect(schemaDefaultTrue.parse({ flag: 'false' }).flag).toBe(false);
  });

  it('parses "TRUE" as true (case-insensitive)', () => {
    expect(schemaDefaultFalse.parse({ flag: 'TRUE' }).flag).toBe(true);
  });

  it('parses "FALSE" as false (case-insensitive)', () => {
    expect(schemaDefaultTrue.parse({ flag: 'FALSE' }).flag).toBe(false);
  });

  it('parses "True" as true (mixed case)', () => {
    expect(schemaDefaultFalse.parse({ flag: 'True' }).flag).toBe(true);
  });

  it('parses "1" as true', () => {
    expect(schemaDefaultFalse.parse({ flag: '1' }).flag).toBe(true);
  });

  it('parses "0" as false', () => {
    expect(schemaDefaultTrue.parse({ flag: '0' }).flag).toBe(false);
  });

  it('uses default value when undefined', () => {
    expect(schemaDefaultTrue.parse({}).flag).toBe(true);
    expect(schemaDefaultFalse.parse({}).flag).toBe(false);
  });

  it('parses empty string as false', () => {
    expect(schemaDefaultTrue.parse({ flag: '' }).flag).toBe(false);
  });

  it('passes through boolean true', () => {
    expect(schemaDefaultFalse.parse({ flag: true }).flag).toBe(true);
  });

  it('passes through boolean false', () => {
    expect(schemaDefaultTrue.parse({ flag: false }).flag).toBe(false);
  });

  it('uses default for null', () => {
    expect(schemaDefaultTrue.parse({ flag: null }).flag).toBe(true);
    expect(schemaDefaultFalse.parse({ flag: null }).flag).toBe(false);
  });

  it('treats random strings as false (not true like z.coerce.boolean)', () => {
    // This was THE bug: z.coerce.boolean() treats "false", "no", "anything" as true
    expect(schemaDefaultTrue.parse({ flag: 'no' }).flag).toBe(false);
    expect(schemaDefaultTrue.parse({ flag: 'yes' }).flag).toBe(false);
    expect(schemaDefaultTrue.parse({ flag: 'anything' }).flag).toBe(false);
  });
});
