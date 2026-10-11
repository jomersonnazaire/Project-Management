import { downloadCsv } from './issuesCsv';

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** FR-RPT-05 / AC-22.2: the filtered rows with the visible columns, header first. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(String(c.value(r) ?? ''))).join(','));
  return [head, ...body].join('\r\n');
}

export function exportCsv<T>(name: string, columns: CsvColumn<T>[], rows: T[]) {
  downloadCsv(name, toCsv(columns, rows));
}
