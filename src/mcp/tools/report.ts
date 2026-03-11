/**
 * MCP Report & Snapshot Tools
 *
 * Tools for generating feed quality reports and retrieving quick metric snapshots.
 */

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the report generation Python script. */
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/generate-report.py');

/** Project root directory (for cwd when spawning the script). */
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/** Register report and snapshot tools on the MCP server. */
export function registerReportTools(
  server: McpServer,
  app: FastifyInstance,
  token: string,
  cookieName: string
): void {
  const cookie = `${cookieName}=${token}`;

  server.registerTool(
    'generate_feed_report',
    {
      description:
        'Generate a feed quality analysis report (docx) from current production data. ' +
        'Returns the file path and generation summary.',
      inputSchema: {
        date_label: z
          .string()
          .optional()
          .describe('Date label for the report title (default: today)'),
        dry_run: z
          .boolean()
          .optional()
          .describe('If true, print data summary without generating docx'),
      },
    },
    async ({ date_label, dry_run }: { date_label?: string; dry_run?: boolean }): Promise<CallToolResult> => {
      const args: string[] = [];
      if (date_label) args.push('--date', date_label);
      if (dry_run) args.push('--dry-run');

      try {
        const { stdout, stderr } = await execFileAsync('python3', [SCRIPT_PATH, ...args], {
          timeout: 120_000,
          cwd: PROJECT_ROOT,
        });

        const output = stdout || 'Report generated successfully.';
        return {
          content: [{ type: 'text', text: stderr ? `${output}\n${stderr}` : output }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stderr =
          err && typeof err === 'object' && 'stderr' in err ? String(err.stderr) : '';
        return {
          content: [{ type: 'text', text: `Report generation failed: ${message}\n${stderr}`.trim() }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'get_feed_snapshot',
    {
      description:
        'Get a JSON summary of current feed metrics without generating a full report',
    },
    async (): Promise<CallToolResult> => {
      const [statusRes, feedHealthRes] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/admin/status', headers: { cookie } }),
        app.inject({ method: 'GET', url: '/api/admin/feed-health', headers: { cookie } }),
      ]);

      const isError = statusRes.statusCode >= 400 || feedHealthRes.statusCode >= 400;

      let text: string;
      try {
        const snapshot = {
          status: JSON.parse(statusRes.body),
          feedHealth: JSON.parse(feedHealthRes.body),
        };
        text = JSON.stringify(snapshot, null, 2);
      } catch {
        text = `status: ${statusRes.body}\nfeedHealth: ${feedHealthRes.body}`;
      }

      return {
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
      };
    }
  );
}
