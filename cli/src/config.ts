/**
 * CLI Configuration
 *
 * Resolves server URL, session path, and mode (API vs Direct).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** CLI configuration. */
export interface CliConfig {
  serverUrl: string;
  sessionPath: string;
  direct: boolean;
  databaseUrl?: string;
  json: boolean;
  quiet: boolean;
  yes: boolean;
}

/** Resolve CLI config from options and environment. */
export function resolveConfig(opts: {
  server?: string;
  direct?: boolean;
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
}): CliConfig {
  const direct = opts.direct || !!process.env.DATABASE_URL;
  return {
    serverUrl:
      opts.server ||
      process.env.FEED_CLI_SERVER ||
      'https://feed.corgi.network',
    sessionPath: join(homedir(), '.feed-cli', 'session.json'),
    direct,
    databaseUrl: process.env.DATABASE_URL,
    json: opts.json ?? false,
    quiet: opts.quiet ?? false,
    yes: opts.yes ?? false,
  };
}
