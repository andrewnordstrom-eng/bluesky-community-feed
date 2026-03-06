/**
 * Export Commands
 *
 * Download anonymized research data: votes, scores, engagement, epochs, audit, full-dataset.
 */

import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiStream } from '../http.js';
import { printJson, printSuccess, printError } from '../output.js';

/** Register export commands on the program. */
export function registerExportCommands(program: Command): void {
  const exp = program
    .command('export')
    .description('Export anonymized research data');

  // ── Votes ──
  exp
    .command('votes')
    .description('Export votes for an epoch')
    .requiredOption('--epoch <id>', 'Epoch ID')
    .option('--format <fmt>', 'Output format: json or csv', 'json')
    .action(async (opts: { epoch: string; format: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const fmt = opts.format;

        if (fmt === 'csv') {
          const stream = await apiStream(
            `/api/admin/export/votes?epoch_id=${opts.epoch}&format=csv`,
            config
          );
          await pipeToStdout(stream);
        } else {
          const data = await apiGet<unknown>(
            `/api/admin/export/votes?epoch_id=${opts.epoch}&format=json`,
            config
          );
          printJson(data);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Scores ──
  exp
    .command('scores')
    .description('Export score decomposition for an epoch')
    .requiredOption('--epoch <id>', 'Epoch ID')
    .option('--format <fmt>', 'Output format: json or csv', 'json')
    .option('--limit <n>', 'Limit results', '5000')
    .option('--offset <n>', 'Offset for pagination', '0')
    .action(async (opts: { epoch: string; format: string; limit: string; offset: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const params = `epoch_id=${opts.epoch}&format=${opts.format}&limit=${opts.limit}&offset=${opts.offset}`;

        if (opts.format === 'csv') {
          const stream = await apiStream(
            `/api/admin/export/scores?${params}`,
            config
          );
          await pipeToStdout(stream);
        } else {
          const data = await apiGet<unknown>(
            `/api/admin/export/scores?${params}`,
            config
          );
          printJson(data);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Engagement ──
  exp
    .command('engagement')
    .description('Export engagement attribution for an epoch')
    .requiredOption('--epoch <id>', 'Epoch ID')
    .option('--format <fmt>', 'Output format: json or csv', 'json')
    .action(async (opts: { epoch: string; format: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const fmt = opts.format;

        if (fmt === 'csv') {
          const stream = await apiStream(
            `/api/admin/export/engagement?epoch_id=${opts.epoch}&format=csv`,
            config
          );
          await pipeToStdout(stream);
        } else {
          const data = await apiGet<unknown>(
            `/api/admin/export/engagement?epoch_id=${opts.epoch}&format=json`,
            config
          );
          printJson(data);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Epochs ──
  exp
    .command('epochs')
    .description('Export epoch metadata')
    .option('--format <fmt>', 'Output format: json or csv', 'json')
    .action(async (opts: { format: string }) => {
      try {
        const config = resolveConfig(program.opts());

        if (opts.format === 'csv') {
          const stream = await apiStream(
            `/api/admin/export/epochs?format=csv`,
            config
          );
          await pipeToStdout(stream);
        } else {
          const data = await apiGet<unknown>(
            `/api/admin/export/epochs?format=json`,
            config
          );
          printJson(data);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Audit ──
  exp
    .command('audit')
    .description('Export audit log entries')
    .option('--start <date>', 'Start date (YYYY-MM-DD)')
    .option('--end <date>', 'End date (YYYY-MM-DD)')
    .option('--format <fmt>', 'Output format: json or csv', 'json')
    .action(async (opts: { start?: string; end?: string; format: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const params = new URLSearchParams({ format: opts.format });
        if (opts.start) params.set('start_date', opts.start);
        if (opts.end) params.set('end_date', opts.end);

        if (opts.format === 'csv') {
          const stream = await apiStream(
            `/api/admin/export/audit?${params}`,
            config
          );
          await pipeToStdout(stream);
        } else {
          const data = await apiGet<unknown>(
            `/api/admin/export/audit?${params}`,
            config
          );
          printJson(data);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Full Dataset ──
  exp
    .command('full')
    .description('Export full dataset as ZIP')
    .requiredOption('--epoch <id>', 'Epoch ID')
    .option('--output <path>', 'Output file path', './export.zip')
    .action(async (opts: { epoch: string; output: string }) => {
      try {
        const config = resolveConfig(program.opts());
        const stream = await apiStream(
          `/api/admin/export/full-dataset?epoch_id=${opts.epoch}`,
          config
        );

        const nodeStream = Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
        const file = createWriteStream(opts.output);
        await pipeline(nodeStream, file);

        if (!config.quiet) {
          printSuccess(`Full dataset saved to ${opts.output}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

/** Pipe a web ReadableStream to process.stdout. */
async function pipeToStdout(stream: ReadableStream<Uint8Array>): Promise<void> {
  const nodeStream = Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, process.stdout);
}
