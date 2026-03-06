/**
 * Content Rules Commands
 *
 * Manage keyword include/exclude lists for content filtering.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost } from '../http.js';
import { printJson, printSummary, printTable, printError } from '../output.js';

/** Register rules commands on the program. */
export function registerRulesCommands(program: Command): void {
  const rules = program
    .command('rules')
    .description('Manage content filter rules');

  // ── List ──
  rules
    .command('list')
    .description('Show current content rules')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<Record<string, unknown>>(
          '/api/admin/governance/status',
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          const rules = data.contentRules as Record<string, unknown> | undefined;
          printSummary([
            ['Include Keywords', JSON.stringify(rules?.includeKeywords ?? [])],
            ['Exclude Keywords', JSON.stringify(rules?.excludeKeywords ?? [])],
          ]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Update ──
  rules
    .command('update')
    .description('Update content filter rules')
    .option('--include <keywords...>', 'Keywords to include')
    .option('--exclude <keywords...>', 'Keywords to exclude')
    .action(async (opts: { include?: string[]; exclude?: string[] }) => {
      try {
        const config = resolveConfig(program.opts());

        const body: Record<string, unknown> = {};
        if (opts.include) body.includeKeywords = opts.include;
        if (opts.exclude) body.excludeKeywords = opts.exclude;

        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/governance/content-rules',
          body,
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([['Status', 'Content rules updated']]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Apply ──
  rules
    .command('apply')
    .description('Apply content rules to current epoch')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<Record<string, unknown>>(
          '/api/admin/governance/content-rules/apply',
          {},
          config
        );

        if (config.json) {
          printJson(data);
        } else {
          printSummary([['Status', 'Content rules applied']]);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
