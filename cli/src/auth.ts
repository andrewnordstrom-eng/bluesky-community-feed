/**
 * CLI Authentication
 *
 * Handles login, session persistence, and logout.
 * Session stored at ~/.feed-cli/session.json with mode 0600.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CliConfig } from './config.js';

/** Stored session data. */
interface SessionData {
  cookie: string;
  serverUrl: string;
  expiresAt: string;
}

/**
 * Login to the feed server and persist session.
 * @returns The session cookie string.
 */
export async function login(
  handle: string,
  appPassword: string,
  config: CliConfig
): Promise<string> {
  const res = await fetch(`${config.serverUrl}/api/governance/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, appPassword }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  // Extract Set-Cookie header
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Login succeeded but no session cookie returned');
  }

  // Parse cookie name=value from the Set-Cookie header
  const cookiePart = setCookie.split(';')[0];

  // Save session
  const session: SessionData = {
    cookie: cookiePart,
    serverUrl: config.serverUrl,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  const dir = dirname(config.sessionPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(config.sessionPath, JSON.stringify(session, null, 2), {
    mode: 0o600,
  });

  return cookiePart;
}

/**
 * Get the stored session cookie, or null if expired/missing.
 */
export function getSessionCookie(config: CliConfig): string | null {
  if (!existsSync(config.sessionPath)) return null;

  try {
    const raw = readFileSync(config.sessionPath, 'utf-8');
    const session: SessionData = JSON.parse(raw);

    if (new Date(session.expiresAt) < new Date()) {
      // Session expired — clean up
      unlinkSync(config.sessionPath);
      return null;
    }

    return session.cookie;
  } catch {
    return null;
  }
}

/**
 * Remove the stored session file.
 */
export function logout(config: CliConfig): void {
  if (existsSync(config.sessionPath)) {
    unlinkSync(config.sessionPath);
  }
}
