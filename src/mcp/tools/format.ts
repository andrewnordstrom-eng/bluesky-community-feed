/**
 * MCP Tool Response Formatter
 *
 * Converts Fastify app.inject() responses to MCP tool results.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Convert an app.inject() response to an MCP CallToolResult. */
export function formatInjectResponse(response: { statusCode: number; body: string }): CallToolResult {
  const isError = response.statusCode >= 400;
  let text: string;
  try {
    const parsed = JSON.parse(response.body);
    text = JSON.stringify(parsed, null, 2);
  } catch {
    text = response.body;
  }
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}
