/**
 * Feed Commands
 *
 * Trigger rescoring, check health, and manage feed operations.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost } from '../http.js';
import { printJson, printSummary, printError, printSuccess } from '../output.js';

/** Register feed commands on the program. */
export function registerFeedCommands(program: Command): void {
  const feed = program
    .command('feed')
    .description('Feed operations');

  // ── Health ──
  feed
    .command('health')
    .description('Show feed health status')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<Record<string, unknown>>(
          '/api/admin/feed-health',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          const db = data.database as Record<string, unknown> | undefined;
          const scoring = data.scoring as Record<string, unknown> | undefined;
          const jetstream = data.jetstream as Record<string, unknown> | undefined;
          printSummary([
            ['Total Posts', db?.totalPosts ?? 'N/A'],
            ['Scored Posts', scoring?.scoredPosts ?? 'N/A'],
            ['Last Scored', scoring?.lastScoredAt ?? 'N/A'],
            ['Jetstream Connected', jetstream?.connected ?? 'N/A'],
            ['Subscriber Count', data.subscriberCount ?? 'N/A'],
          ]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Rescore ──
  feed
    .command('rescore')
    .description('Trigger manual scoring pipeline run')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/feed/rescore',
          {},
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess('Scoring pipeline triggered');
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Reconnect Jetstream ──
  feed
    .command('reconnect')
    .description('Trigger Jetstream reconnection')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/jetstream/reconnect',
          {},
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess('Jetstream reconnection triggered');
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
