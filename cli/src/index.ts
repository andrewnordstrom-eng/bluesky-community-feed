#!/usr/bin/env node
/**
 * Feed CLI — Admin CLI for Corgi Network Bluesky Feed
 *
 * Usage:
 *   feed-cli login <handle> <app-password>
 *   feed-cli epoch status
 *   feed-cli export votes --epoch=1 --format=csv
 *   feed-cli --help
 */

import { Command } from 'commander';
import { resolveConfig } from './config.js';
import { login, logout } from './auth.js';
import { printSuccess, printError, printJson } from './output.js';
import { registerEpochCommands } from './commands/epoch.js';
import { registerRulesCommands } from './commands/rules.js';
import { registerVotesCommands } from './commands/votes.js';
import { registerParticipantCommands } from './commands/participants.js';
import { registerFeedCommands } from './commands/feed.js';
import { registerAnnounceCommands } from './commands/announce.js';
import { registerExportCommands } from './commands/export.js';

const program = new Command()
  .name('feed-cli')
  .description('Admin CLI for Corgi Network Bluesky Feed')
  .version('1.0.0')
  .option('--server <url>', 'Server URL')
  .option('--direct', 'Use direct DB access instead of API')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output')
  .option('--yes', 'Skip confirmation prompts');

// ── Login ──
program
  .command('login')
  .description('Authenticate with the feed server')
  .argument('<handle>', 'Bluesky handle')
  .argument('<app-password>', 'Bluesky app password')
  .action(async (handle: string, appPassword: string) => {
    try {
      const config = resolveConfig(program.opts());
      await login(handle, appPassword, config);
      if (!config.quiet) {
        printSuccess(`Logged in as ${handle}`);
      }
    } catch (err) {
      printError((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── Logout ──
program
  .command('logout')
  .description('Remove stored session')
  .action(() => {
    try {
      const config = resolveConfig(program.opts());
      logout(config);
      if (!config.quiet) {
        printSuccess('Logged out');
      }
    } catch (err) {
      printError((err as Error).message);
      process.exitCode = 1;
    }
  });

// ── Command Groups ──
registerEpochCommands(program);
registerRulesCommands(program);
registerVotesCommands(program);
registerParticipantCommands(program);
registerFeedCommands(program);
registerAnnounceCommands(program);
registerExportCommands(program);

// ── Parse ──
program.parseAsync().catch((err: Error) => {
  printError(err.message);
  process.exitCode = 1;
});
