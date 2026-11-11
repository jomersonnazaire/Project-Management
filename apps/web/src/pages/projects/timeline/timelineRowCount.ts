import { TIMELINE_COLUMNS, TIMELINE_SHEET } from '@xc8/shared';

/** jsdom's File has no arrayBuffer(); FileReader works everywhere. */
const bytesOf = (f: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsArrayBuffer(f);
  });

/**
 * CR-22 NFR-52: the Timeline sheet's task rows (below the header, any of the template columns
 * filled), counted the same way as the API so the 2,000-row limit is caught before upload.
 * Null when the browser can't read the file; the API then checks it (it has a fallback for
 * workbooks exceljs can't open directly).
 */
export async function timelineRowCount(f: File): Promise<number | null> {
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await bytesOf(f));
    const ws = wb.getWorksheet(TIMELINE_SHEET);
    if (!ws) return null;
    let n = 0;
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      if (i === 1) return;
      for (let c = 1; c <= TIMELINE_COLUMNS.length; c++) {
        const v = row.getCell(c).value;
        if (
          v !== null &&
          v !== undefined &&
          String(typeof v === 'object' ? JSON.stringify(v) : v).trim()
        ) {
          n++;
          return;
        }
      }
    });
    return n;
  } catch {
    return null;
  }
}
