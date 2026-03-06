/**
 * Epoch Commands
 *
 * Manage governance epochs: status, list, start-vote, close-vote, transition.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost } from '../http.js';
import { printJson, printSummary, printTable, printError } from '../output.js';

/** Register epoch commands on the program. */
export function registerEpochCommands(program: Command): void {
  const epoch = program
    .command('epoch')
    .description('Manage governance epochs');

  // ── Status ──
  epoch
    .command('status')
    .description('Show current epoch status')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<Record<string, unknown>>(
          '/api/admin/status',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          const epoch = data.epoch as Record<string, unknown> | undefined;
          printSummary([
            ['Epoch ID', epoch?.id ?? 'N/A'],
            ['Phase', epoch?.phase ?? 'N/A'],
            ['Weights', JSON.stringify(epoch?.weights ?? {})],
            ['Feed Private Mode', data.feedPrivateMode ?? false],
            ['Scoring Running', data.scoringRunning ?? false],
            ['Subscriber Count', data.subscriberCount ?? 0],
          ]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── List ──
  epoch
    .command('list')
    .description('List all epochs')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<{ epochs: Record<string, unknown>[] }>(
          '/api/admin/epochs',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          const rows = data.epochs.map((e) => [
            e.id,
            e.phase,
            e.vote_count ?? 0,
            e.created_at ? new Date(e.created_at as string).toLocaleDateString() : '',
          ]);
          printTable(
            ['ID', 'Phase', 'Votes', 'Created'],
            rows as (string | number | null)[][]
          );
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Start Vote ──
  epoch
    .command('start-vote')
    .description('Open voting for current epoch')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/governance/weights/apply',
          { action: 'open_voting' },
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([['Status', 'Voting opened']]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Close Vote ──
  epoch
    .command('close-vote')
    .description('Close voting and apply results')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/epochs/transition',
          {},
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([
            ['Status', 'Epoch transitioned'],
            ['New Epoch', data.newEpochId ?? 'N/A'],
          ]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Force Transition ──
  epoch
    .command('transition')
    .description('Force an epoch transition')
    .option('--force', 'Force transition even if conditions not met')
    .action(async (opts: { force?: boolean }) => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/epochs/transition',
          { force: opts.force ?? false },
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([
            ['Status', 'Transition complete'],
            ['New Epoch', data.newEpochId ?? 'N/A'],
          ]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
