import {
  CLIENT_IMPORT_COLUMNS,
  CLIENT_IMPORT_SKIPPED_NAME,
  XLSX_MIME,
  type ClientImportPreviewDto,
  type ClientImportSheet,
} from '@xc8/shared';
import { saveBlob } from '../../api/client';

/**
 * FR-CLI-36: the skipped (Error) rows as an .xlsx with the template's columns plus Row and Reason,
 * so they can be fixed and imported again. Built in the browser from the commit result; exceljs
 * loads only when this runs. Every value is written as a text cell (format "@"), never a formula,
 * so a cell such as "=1+2" stays plain text (FR-CLI-37, EC-153).
 */
export async function buildSkippedRows(
  result: Pick<ClientImportPreviewDto, 'clients' | 'contacts'>,
): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheets: [ClientImportSheet, ClientImportPreviewDto['clients']][] = [
    ['Clients', result.clients],
    ['Contacts', result.contacts],
  ];
  for (const [sheet, rows] of sheets) {
    const ws = wb.addWorksheet(sheet);
    const headers = CLIENT_IMPORT_COLUMNS[sheet].map((c) => c.header);
    ws.columns = [...headers, 'Row', 'Reason'].map((h) => ({
      header: h,
      width: h === 'Reason' ? 60 : 22,
      style: { numFmt: '@' },
    }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows.filter((x) => x.result === 'ERROR')) {
      const row = ws.addRow([
        ...headers.map((h) => r.values[h] ?? ''),
        String(r.row),
        r.reasons.join('; '),
      ]);
      row.eachCell((cell) => {
        cell.numFmt = '@';
        cell.value = String(cell.value ?? '');
      });
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

export async function downloadSkippedRows(
  result: Pick<ClientImportPreviewDto, 'clients' | 'contacts'>,
): Promise<void> {
  saveBlob(await buildSkippedRows(result), CLIENT_IMPORT_SKIPPED_NAME);
}
