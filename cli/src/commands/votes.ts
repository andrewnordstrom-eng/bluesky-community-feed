/**
 * Votes Commands
 *
 * View vote summaries and aggregation previews.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet } from '../http.js';
import { printJson, printSummary, printTable, printError } from '../output.js';

/** Register votes commands on the program. */
export function registerVotesCommands(program: Command): void {
  const votes = program
    .command('votes')
    .description('View vote data');

  // ── Summary ──
  votes
    .command('summary')
    .description('Show vote summary for an epoch')
    .requiredOption('--epoch <id>', 'Epoch ID')
    .action(async (opts: { epoch: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<{ votes: Record<string, unknown>[] }>(
          `/api/admin/governance/votes/${opts.epoch}`,
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([['Total Votes', data.votes?.length ?? 0]]);
          if (data.votes?.length) {
            const rows = data.votes.map((v) => [
              v.voter_did ? String(v.voter_did).slice(0, 20) + '...' : 'N/A',
              v.w_recency,
              v.w_engagement,
              v.w_bridging,
              v.w_source_diversity,
              v.w_relevance,
            ]);
            printTable(
              ['Voter', 'Recency', 'Engagement', 'Bridging', 'SrcDiv', 'Relevance'],
              rows as (string | number | null)[][]
            );
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Aggregation Preview ──
  votes
    .command('preview')
    .description('Preview trimmed mean aggregation')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<Record<string, unknown>>(
          '/api/admin/governance/aggregation/preview',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          const weights = data.weights as Record<string, number> | undefined;
          if (weights) {
            printSummary(
              Object.entries(weights).map(([k, v]) => [k, v.toFixed(3)])
            );
          } else {
            printSummary([['Status', 'No aggregation data available']]);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
