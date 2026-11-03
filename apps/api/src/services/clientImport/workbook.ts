import {
  CLIENT_IMPORT_COLUMNS,
  CLIENT_IMPORT_FIRST_DATA_ROW,
  CLIENT_IMPORT_HEADER_ROW,
  CLIENT_IMPORT_HELP_ROW,
  CLIENT_IMPORT_MAX_BYTES,
  CLIENT_IMPORT_MAX_ROWS,
  CLIENT_IMPORT_MAX_UNZIPPED_BYTES,
  CLIENT_IMPORT_MESSAGES as MSG,
  CLIENT_IMPORT_SHEETS,
  CLIENT_IMPORT_STATUS_VALUES,
  extraColumnsMessage,
  tooManyRowsMessage,
  type ClientImportField,
  type ClientImportSheet,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import { HttpError } from '../../lib/errors.js';

/**
 * CR-19 workbook handling: the template (FR-CLI-25..28) and the file checks and parsing of an
 * upload (§9, NFR-36/37). Everything runs in memory; nothing is written to Storage or disk.
 */

export type RowValues = Record<ClientImportField, string>;
export interface SheetRow {
  /** Excel row number. */
  row: number;
  values: RowValues;
}
export interface ParsedWorkbook {
  Clients: SheetRow[];
  Contacts: SheetRow[];
  notes: string[];
}

const fileError = (status: number, code: keyof typeof MSG | 'TOO_MANY_ROWS', message?: string) =>
  new HttpError(status, code, message ?? MSG[code as keyof typeof MSG]);

// ---------------------------------------------------------------------------------------------
// Template

const HELP_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF2F4F7' },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF00467F' },
};
const WIDTHS: Record<ClientImportField, number> = {
  company: 32,
  industry: 22,
  address: 40,
  notes: 40,
  status: 14,
  name: 26,
  position: 22,
  email: 30,
  phone: 18,
  department: 20,
};

type DvSheet = {
  dataValidations: { add: (range: string, dv: ExcelJS.DataValidation) => void };
};

/** Data rows to write under the headers, one value per column field of that sheet. */
export type WorkbookRows = Record<ClientImportSheet, Partial<RowValues>[]>;

/**
 * FR-CLI-37 / EC-153 (as the skipped-rows file, DEF-054): every value is a plain string in a Text
 * ("@") cell, never a formula, so `=1+2` or `+63 900` reads back exactly as stored. The CSV
 * apostrophe (`csvSafe`) is not used here: in .xlsx it would become part of the value.
 */
function writeTextRow(ws: ExcelJS.Worksheet, rowNumber: number, values: string[]) {
  const row = ws.getRow(rowNumber);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    if (v) cell.value = String(v); // blank stays an empty cell, as in the template
    cell.numFmt = '@';
    cell.protection = { locked: false };
  });
}

/**
 * FR-CLI-25..28: two sheets, row 1 explains each column, row 2 holds the headers (both locked
 * by sheet protection without a password, a guide only), data cells unlocked and formatted as
 * Text from row 3, and a Status dropdown with Active / Inactive. With no rows this is the blank
 * template; the clients export passes the rows it read (same layout, so it imports as is).
 */
export async function buildWorkbook(
  rows: WorkbookRows = { Clients: [], Contacts: [] },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OpsTrack';
  for (const sheet of CLIENT_IMPORT_SHEETS) {
    const columns = CLIENT_IMPORT_COLUMNS[sheet];
    const ws = wb.addWorksheet(sheet, {
      views: [{ state: 'frozen', ySplit: CLIENT_IMPORT_HEADER_ROW }],
    });
    columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = WIDTHS[c.field];
      // Text format so a phone keeps its leading + or 0; data cells stay editable.
      col.style = { numFmt: '@', protection: { locked: false } };
    });
    const help = ws.getRow(CLIENT_IMPORT_HELP_ROW);
    const head = ws.getRow(CLIENT_IMPORT_HEADER_ROW);
    columns.forEach((c, i) => {
      const h = help.getCell(i + 1);
      h.value = c.help;
      h.style = {
        numFmt: '@',
        font: { italic: true, size: 9, color: { argb: 'FF566A7F' } },
        alignment: { wrapText: true, vertical: 'top' },
        fill: HELP_FILL,
        protection: { locked: true },
      };
      const t = head.getCell(i + 1);
      t.value = c.header;
      t.style = {
        numFmt: '@',
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: HEADER_FILL,
        protection: { locked: true },
      };
    });
    help.height = 54;
    if (sheet === 'Clients') {
      const letter = String.fromCharCode(64 + columns.findIndex((c) => c.field === 'status') + 1);
      const last =
        CLIENT_IMPORT_FIRST_DATA_ROW + Math.max(CLIENT_IMPORT_MAX_ROWS, rows.Clients.length) - 1;
      // exceljs supports a range key here (written as one sqref) but doesn't type it.
      (ws as unknown as DvSheet).dataValidations.add(
        `${letter}${CLIENT_IMPORT_FIRST_DATA_ROW}:${letter}${last}`,
        {
          type: 'list',
          allowBlank: true,
          formulae: [`"${CLIENT_IMPORT_STATUS_VALUES.join(',')}"`],
          showErrorMessage: true,
          errorStyle: 'stop',
          errorTitle: 'Status',
          error: 'Choose Active or Inactive, or leave it blank.',
        },
      );
    }
    rows[sheet].forEach((values, i) =>
      writeTextRow(
        ws,
        CLIENT_IMPORT_FIRST_DATA_ROW + i,
        columns.map((c) => values[c.field] ?? ''),
      ),
    );
    await ws.protect('', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatColumns: true,
      formatRows: true,
      insertRows: true,
      deleteRows: true,
      sort: true,
      autoFilter: true,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The blank template: the workbook with no data rows (no customer data). */
export const buildTemplate = (): Promise<Buffer> => buildWorkbook();

// ---------------------------------------------------------------------------------------------
// Upload checks (§9)

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Encrypted (password-protected) OOXML files are OLE containers with this stream. */
const ENCRYPTION_INFO = Buffer.from('EncryptionInfo', 'utf16le');

interface ZipListing {
  names: Set<string>;
  unzipped: number;
}

/** Reads the ZIP central directory (names and declared sizes) without inflating anything. */
function zipListing(buf: Buffer): ZipListing | null {
  const minEnd = Math.max(0, buf.length - 22 - 0xffff);
  let end = -1;
  for (let i = buf.length - 22; i >= minEnd; i--) {
    if (buf.readUInt32LE(i) === ZIP_END) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const names = new Set<string>();
  let unzipped = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CENTRAL) return null;
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) return null; // ZIP64: far beyond any real template
    unzipped += size;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.add(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { names, unzipped };
}

/**
 * §9: refuse by content, not by name. .xlsx is a ZIP with `xl/workbook.xml`; .xls (OLE), .csv
 * and other ZIPs (.docx) are 415; .xlsm (has a VBA project) is 415; a password-protected
 * workbook (encrypted OLE) or a broken or oversized ZIP is 422 UNREADABLE_FILE.
 */
export function checkUpload(buf: Buffer): void {
  if (buf.length > CLIENT_IMPORT_MAX_BYTES) throw fileError(413, 'FILE_TOO_LARGE');
  if (buf.length >= OLE.length && buf.subarray(0, OLE.length).equals(OLE)) {
    if (buf.includes(ENCRYPTION_INFO)) throw fileError(422, 'UNREADABLE_FILE');
    throw fileError(415, 'UNSUPPORTED_FILE');
  }
  if (buf.length < 4 || buf.readUInt32LE(0) !== ZIP_LOCAL) {
    throw fileError(415, 'UNSUPPORTED_FILE');
  }
  const listing = zipListing(buf);
  if (!listing) throw fileError(422, 'UNREADABLE_FILE');
  if (!listing.names.has('xl/workbook.xml') || listing.names.has('xl/vbaProject.bin')) {
    throw fileError(415, 'UNSUPPORTED_FILE');
  }
  // NFR-37: zip-bomb guard on the declared sizes.
  if (listing.unzipped > CLIENT_IMPORT_MAX_UNZIPPED_BYTES) throw fileError(422, 'UNREADABLE_FILE');
}

/** FR-CLI-37 and §6: every cell is read as text; a formula is its formula text, never evaluated. */
export function cellText(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Formula) return `=${cell.formula ?? ''}`;
  return valueText(cell.value);
}

function valueText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('formula' in v || 'sharedFormula' in v) {
      const f = (v as { formula?: string; sharedFormula?: string }).formula;
      return `=${f ?? ''}`;
    }
    if ('text' in v) return valueText((v as { text: ExcelJS.CellValue }).text);
    if ('error' in v) return String((v as { error: string }).error);
  }
  return String(v);
}

const norm = (s: string) => s.trim().toLowerCase();

function sheetByName(wb: ExcelJS.Workbook, name: ClientImportSheet) {
  return wb.worksheets.find((ws) => norm(ws.name) === norm(name));
}

/** §9 checks, then the data rows of both sheets (blank rows dropped, cells trimmed). */
export async function readWorkbook(buf: Buffer): Promise<ParsedWorkbook> {
  checkUpload(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer, { ignoreNodes: ['dataValidations'] });
  } catch {
    throw fileError(422, 'UNREADABLE_FILE');
  }
  const out: ParsedWorkbook = { Clients: [], Contacts: [], notes: [] };
  const extra: string[] = [];
  for (const sheet of CLIENT_IMPORT_SHEETS) {
    const ws = sheetByName(wb, sheet);
    if (!ws) throw fileError(422, 'NOT_TEMPLATE');
    const columns = CLIENT_IMPORT_COLUMNS[sheet];
    const head = ws.getRow(CLIENT_IMPORT_HEADER_ROW);
    columns.forEach((c, i) => {
      if (norm(cellText(head.getCell(i + 1))) !== norm(c.header)) {
        throw fileError(422, 'NOT_TEMPLATE');
      }
    });
    head.eachCell((cell, col) => {
      const text = cellText(cell).trim();
      if (col > columns.length && text) extra.push(`${text} (${sheet})`);
    });
    const rows: SheetRow[] = [];
    ws.eachRow((r, n) => {
      if (n < CLIENT_IMPORT_FIRST_DATA_ROW) return;
      const values = {} as RowValues;
      let blank = true;
      columns.forEach((c, i) => {
        const text = cellText(r.getCell(i + 1)).trim();
        values[c.field] = text;
        if (text) blank = false;
      });
      if (!blank) rows.push({ row: n, values });
    });
    if (rows.length > CLIENT_IMPORT_MAX_ROWS) {
      throw fileError(422, 'TOO_MANY_ROWS', tooManyRowsMessage(sheet, rows.length));
    }
    out[sheet] = rows;
  }
  if (!out.Clients.length && !out.Contacts.length) throw fileError(422, 'EMPTY_FILE');
  if (extra.length) out.notes.push(extraColumnsMessage(extra));
  return out;
}
