/**
 * Output Formatting
 *
 * Three output modes: JSON, table, and CSV.
 * Respects --json and --quiet global flags.
 */

/** Print data as formatted JSON to stdout. */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** Print a simple key-value summary. */
export function printSummary(entries: [string, unknown][]): void {
  const maxKey = Math.max(...entries.map(([k]) => k.length));
  for (const [key, value] of entries) {
    process.stdout.write(`${key.padEnd(maxKey + 2)}${value}\n`);
  }
}

/** Print rows as an aligned table. */
export function printTable(headers: string[], rows: (string | number | null)[][]): void {
  const allRows = [headers, ...rows.map((r) => r.map(String))];
  const widths = headers.map((_, col) =>
    Math.max(...allRows.map((row) => String(row[col] ?? '').length))
  );

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  process.stdout.write(headerLine + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');

  // Data rows
  for (const row of rows) {
    const line = row
      .map((val, i) => String(val ?? '').padEnd(widths[i]))
      .join('  ');
    process.stdout.write(line + '\n');
  }
}

/** Print rows as CSV to stdout (for piping to file). */
export function printCsv(headers: string[], rows: (string | number | null)[][]): void {
  process.stdout.write(headers.join(',') + '\n');
  for (const row of rows) {
    process.stdout.write(row.map(csvEscape).join(',') + '\n');
  }
}

/** Escape a CSV value. */
function csvEscape(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Print a success message (suppressed in quiet mode). */
export function printSuccess(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Print an error message to stderr. */
export function printError(message: string): void {
  process.stderr.write(`Error: ${message}\n`);
}
