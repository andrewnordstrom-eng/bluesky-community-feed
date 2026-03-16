/**
 * Epoch Commands
 *
 * Manage governance epochs: status, list, start-vote, close-vote, transition.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost } from '../http.js';
import { printJson, printSummary, printTable, printError } from '../output.js';
import { getDirectEpochStatus, type EpochStatusData } from '../direct.js';

interface ApiAdminStatusResponse {
  feedPrivateMode?: boolean;
  system?: {
    currentEpoch?: {
      id?: number;
      status?: string;
      phase?: string;
      weights?: Record<string, number>;
    } | null;
    feed?: {
      subscriberCount?: number;
    };
  };
}

async function getApiEpochStatus(config: ReturnType<typeof resolveConfig>): Promise<EpochStatusData> {
  const data = await apiGet<ApiAdminStatusResponse>('/api/admin/status', config);
  const currentEpoch = data.system?.currentEpoch ?? null;

  return {
    epoch: currentEpoch
      ? {
          id: Number(currentEpoch.id ?? 0),
          phase: currentEpoch.phase ?? currentEpoch.status ?? 'N/A',
          weights: currentEpoch.weights ?? {},
        }
      : null,
    feedPrivateMode: data.feedPrivateMode ?? false,
    scoringRunning: null,
    subscriberCount: data.system?.feed?.subscriberCount ?? 0,
  };
}

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
        let data: EpochStatusData;
        if (config.direct) {
          if (!config.databaseUrl) {
            throw new Error('Direct mode requires DATABASE_URL');
          }
          data = await getDirectEpochStatus(config.databaseUrl);
        } else {
          data = await getApiEpochStatus(config);
        }

        if (config.json) {
          printJson(data);
        } else {
          printSummary([
            ['Epoch ID', data.epoch?.id ?? 'N/A'],
            ['Phase', data.epoch?.phase ?? 'N/A'],
            ['Weights', JSON.stringify(data.epoch?.weights ?? {})],
            ['Feed Private Mode', data.feedPrivateMode ?? false],
            ['Scoring Running', data.scoringRunning ?? 'N/A'],
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
