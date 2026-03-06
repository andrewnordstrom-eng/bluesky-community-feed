/**
 * Announce Commands
 *
 * Send and list bot announcements.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost } from '../http.js';
import { printJson, printTable, printSuccess, printError } from '../output.js';

/** Register announce commands on the program. */
export function registerAnnounceCommands(program: Command): void {
  const announce = program
    .command('announce')
    .description('Bot announcements');

  // ── List ──
  announce
    .command('list')
    .description('List recent announcements')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<{ announcements: Record<string, unknown>[] }>(
          '/api/admin/announcements',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          if (!data.announcements?.length) {
            printSuccess('No announcements.');
            return;
          }
          const rows = data.announcements.map((a) => [
            a.created_at
              ? new Date(a.created_at as string).toLocaleDateString()
              : '',
            String(a.text ?? '').slice(0, 60),
            a.post_uri ? 'Yes' : 'No',
          ]);
          printTable(['Date', 'Text', 'Posted'], rows as (string | number | null)[][]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Send ──
  announce
    .command('send')
    .description('Post a custom announcement')
    .argument('<text>', 'Announcement text (max 280 chars)')
    .action(async (text: string) => {
      try {
        const config = resolveConfig(program.opts());

        if (text.length > 280) {
          printError('Announcement text must be 280 characters or fewer.');
          process.exitCode = 1;
          return;
        }

        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/announcements',
          { text },
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess('Announcement posted');
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
