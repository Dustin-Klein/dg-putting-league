export type CsvCell = string | number | boolean | null | undefined;

/** Leading characters a spreadsheet would run as a formula (tab and CR too, per OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Text that a spreadsheet would treat as a formula is prefixed with `'`;
 * cells with a comma, quote or line break are quoted, quotes doubled. Numbers are
 * written as is, so a negative number stays a number.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to CSV text (CRLF line ends, as RFC 4180). */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
