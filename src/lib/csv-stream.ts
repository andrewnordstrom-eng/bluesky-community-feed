/**
 * CSV Streaming Helper
 *
 * Streams CSV rows to a Fastify reply using chunked transfer encoding.
 * Avoids buffering the full dataset in memory.
 */

import { FastifyReply } from 'fastify';

/** Writer interface for streaming CSV rows. */
export interface CsvWriter {
  writeRow(values: (string | number | null | boolean)[]): void;
  end(): void;
}

/**
 * Start a CSV stream on a Fastify reply.
 * Sets Content-Type and Content-Disposition headers, writes BOM + header row.
 */
export function startCsvStream(
  reply: FastifyReply,
  filename: string,
  columns: string[]
): CsvWriter {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Transfer-Encoding': 'chunked',
  });

  // BOM for Excel compatibility + header row
  reply.raw.write('\ufeff');
  reply.raw.write(columns.join(',') + '\n');

  return {
    writeRow(values: (string | number | null | boolean)[]) {
      reply.raw.write(values.map(csvEscape).join(',') + '\n');
    },
    end() {
      reply.raw.end();
    },
  };
}

/** Escape a value for CSV output. */
function csvEscape(value: string | number | null | boolean): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
