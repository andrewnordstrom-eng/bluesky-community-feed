/**
 * HTTP Client
 *
 * Thin wrapper around fetch with session cookie attachment
 * and structured error handling.
 */

import { getSessionCookie } from './auth.js';
import type { CliConfig } from './config.js';

/**
 * Make a GET request to the feed server API.
 */
export async function apiGet<T>(path: string, config: CliConfig): Promise<T> {
  const cookie = getSessionCookie(config);
  const res = await fetch(`${config.serverUrl}${path}`, {
    headers: buildHeaders(cookie),
  });
  return handleResponse<T>(res);
}

/**
 * Make a POST request to the feed server API.
 */
export async function apiPost<T>(
  path: string,
  body: unknown,
  config: CliConfig
): Promise<T> {
  const cookie = getSessionCookie(config);
  const res = await fetch(`${config.serverUrl}${path}`, {
    method: 'POST',
    headers: {
      ...buildHeaders(cookie),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

/**
 * Make a DELETE request to the feed server API.
 */
export async function apiDelete<T>(
  path: string,
  config: CliConfig
): Promise<T> {
  const cookie = getSessionCookie(config);
  const res = await fetch(`${config.serverUrl}${path}`, {
    method: 'DELETE',
    headers: buildHeaders(cookie),
  });
  return handleResponse<T>(res);
}

/**
 * Stream a GET response body (for CSV/ZIP piping to stdout/file).
 */
export async function apiStream(
  path: string,
  config: CliConfig
): Promise<ReadableStream<Uint8Array>> {
  const cookie = getSessionCookie(config);
  const res = await fetch(`${config.serverUrl}${path}`, {
    headers: buildHeaders(cookie),
  });

  if (res.status === 401) {
    process.exitCode = 2;
    throw new Error('Not authenticated. Run: feed-cli login');
  }
  if (res.status === 403) {
    process.exitCode = 2;
    throw new Error('Not authorized. Admin access required.');
  }
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  if (!res.body) {
    throw new Error('No response body');
  }
  return res.body;
}

/** Build request headers with optional session cookie. */
function buildHeaders(cookie: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  return headers;
}

/** Handle response: check status, parse JSON. */
async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    process.exitCode = 2;
    throw new Error('Not authenticated. Run: feed-cli login');
  }
  if (res.status === 403) {
    process.exitCode = 2;
    throw new Error('Not authorized. Admin access required.');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}
