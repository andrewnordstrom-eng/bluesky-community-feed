/**
 * Participant Commands
 *
 * Manage approved participants for private feed mode.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost, apiDelete } from '../http.js';
import { printJson, printTable, printSuccess, printError } from '../output.js';

/** Register participant commands on the program. */
export function registerParticipantCommands(program: Command): void {
  const participants = program
    .command('participants')
    .description('Manage approved participants');

  // ── List ──
  participants
    .command('list')
    .description('List approved participants')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<{ participants: Record<string, unknown>[] }>(
          '/api/admin/participants',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          if (!data.participants?.length) {
            printSuccess('No approved participants.');
            return;
          }
          const rows = data.participants.map((p) => [
            p.did,
            p.handle ?? '',
            p.approved_at
              ? new Date(p.approved_at as string).toLocaleDateString()
              : '',
          ]);
          printTable(
            ['DID', 'Handle', 'Approved'],
            rows as (string | number | null)[][]
          );
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Add ──
  participants
    .command('add')
    .description('Add a participant by DID or handle')
    .argument('<identifier>', 'Bluesky DID or handle')
    .action(async (identifier: string) => {
      try {
        const config = resolveConfig(program.opts());

        const body = identifier.startsWith('did:')
          ? { did: identifier }
          : { handle: identifier };

        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/participants',
          body,
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(`Participant added: ${identifier}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Remove ──
  participants
    .command('remove')
    .description('Remove a participant by DID')
    .argument('<did>', 'Bluesky DID')
    .action(async (did: string) => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiDelete<Record<string, unknown>>(
          `/api/admin/participants/${encodeURIComponent(did)}`,
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(`Participant removed: ${did}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
