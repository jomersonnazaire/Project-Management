import {
  CLIENT_IMPORT_MAX_ROWS,
  TIMELINE_COLUMNS,
  TIMELINE_FILE_ERRORS,
  TIMELINE_MAX_BYTES,
  fileTooLargeError,
  TIMELINE_INSTRUCTIONS_SHEET,
  TIMELINE_META_SHEET,
  TIMELINE_SHEET,
  TIMELINE_TEMPLATE_ID,
  TIMELINE_TEMPLATE_VERSION,
  columnsError,
  tooManyTimelineRowsError,
  type TimelineFileErrorCode,
  type TimelineImportField,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { HttpError } from '../../lib/errors.js';
import { cellText, checkUpload } from '../clientImport/workbook.js';

/**
 * CR-22 §B4 / UIE §6: the timeline workbook (template and export) and reading an upload. Same
 * file checks as CR-19 (NFR-52): content sniffing, 5 MB, zip-bomb guard, cells read as text and
 * formulas never evaluated. Everything runs in memory (nothing stored).
 */

export type TimelineValues = Record<TimelineImportField, string>;
export interface TimelineFileRow {
  row: number;
  values: TimelineValues;
}
export interface TimelineMeta {
  template: string | null;
  projectId: string | null;
  projectName: string | null;
  exportedAt: Date | null;
  /** The metadata sheet had an exportedAt cell that isn't a valid time. */
  exportedAtInvalid: boolean;
  exportedBy: string | null;
}
export interface ParsedTimeline {
  rows: TimelineFileRow[];
  /** null when the file has no `_meta` sheet. */
  meta: TimelineMeta | null;
}

export const timelineFileError = (
  status: number,
  code: TimelineFileErrorCode,
  copy: { lead: string; rest: string },
) => new HttpError(status, code, `${copy.lead} ${copy.rest}`);

const COLOR = {
  primary: 'FF5355E0',
  text: 'FF384551',
  line: 'FFE4E6E8',
  milestone: 'FFD7F5FC',
  late: 'FFB8240A',
  noteFill: 'FFFFF2D6',
  noteText: 'FF7A4800',
};
const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});
const WIDTHS = [13, 34, 16, 11, 13, 13, 13, 30, 15, 15, 14];
const DATE_COLS = new Set<TimelineImportField>([
  'start',
  'finish',
  'baselineStart',
  'baselineFinish',
]);
const HEADER_NOTES: Partial<Record<TimelineImportField, string>> = {
  number:
    'Unique in the file. Depends on refers to it. Rows are matched by the hidden Task ID, not by this number.',
  dependsOn: 'Task numbers this task waits for (finish-to-start, no lag), e.g. 5, 6',
  baselineStart:
    'Filled on export, ignored on import. Click Save baseline in OpsTrack after importing.',
};

/** UIE §6 Instructions sheet ("How import works" and the column table). */
const HOW_IT_WORKS = [
  '• Fill in the Timeline sheet. Keep the header row and the column order. Row 1 is the header; data starts on row 2.',
  '• Import adds or updates tasks. Rows exported from OpsTrack carry a hidden Task ID and update that task. Rows without a Task ID (rows you add) become new tasks.',
  '• Import never deletes tasks. A task that is missing from the file stays in the project as it is.',
  '• Task number must be unique in the file. Depends on refers to these numbers, so new rows can depend on each other. It is never used to match rows. When you import, OpsTrack assigns the final numbers and adds new tasks at the end.',
  '• A blank optional cell clears that field on an existing task (Phase, Milestone, Start, Finish, Depends on, Owner). The preview lists every field that will be cleared before you confirm.',
  '• Dates: use a date cell or text in YYYY-MM-DD (for example 2026-11-04). Other formats such as 04/11/2026 are refused.',
  '• Baseline start and Baseline finish are filled on export and ignored on import. Only Save baseline in OpsTrack sets a baseline, so click Save baseline after importing.',
  '• You see a preview with every row checked before anything is saved. Any row with an error stops the whole import: fix the errors in the file and upload it again.',
  '• If a task was changed in OpsTrack after this file was exported, the preview flags the row and saves nothing for it until you confirm it.',
  '• Cancelled tasks are exported too, so the file round-trips. The blank template has no Task IDs, so every row imports as a new task.',
  '• Import works while the project is Planning, Active or On hold.',
  "• Don't edit or delete the hidden Task ID column or the hidden _meta sheet. A file from another project is refused.",
];
const COLUMN_TABLE: [string, string, string, string, string][] = [
  [
    'Task number',
    'Whole number ≥ 1',
    'Yes',
    'Unique in the file',
    'Row reference for Depends on. Never used to match rows. OpsTrack assigns the final numbers on import; new tasks go to the end.',
  ],
  ['Task name', 'Text, up to 200', 'Yes', 'Not blank', 'Sets the name (renames on update).'],
  [
    'Phase',
    'Text, up to 120',
    'No',
    'A phase of this project (case and spaces ignored)',
    'Sets the phase; blank clears it (No phase). A new name is added at the end of the phase list where phases can be edited (Admin any time, PM in Planning); otherwise the row is an error.',
  ],
  [
    'Milestone',
    'Y/N',
    'No',
    'Y, N, Yes or No (any case); blank = N',
    'Sets Milestone. A milestone shows as a diamond on its Finish date.',
  ],
  [
    'Start',
    'Date',
    'No (needed for a bar)',
    'Date cell or YYYY-MM-DD',
    'Sets the planned start; blank clears it.',
  ],
  [
    'Finish',
    'Date',
    'No (needed for a bar)',
    'Date cell or YYYY-MM-DD; on or after Start',
    'Sets the planned finish (due date); blank clears it. A milestone may have Finish = Start.',
  ],
  [
    'Depends on',
    'Task numbers',
    'No',
    'Whole numbers separated by , or ; e.g. 3, 5. Finish-to-start only, no lag',
    "Each number must be a Task number in this file. Replaces the task's dependencies; blank clears them. Self or circular links are errors.",
  ],
  [
    'Owner',
    'Email',
    'No',
    'Email of an active internal user (case ignored)',
    "Sets the owner; blank clears it. An unknown email, or a user who isn't a member of the project, is a row error.",
  ],
  [
    'Baseline start',
    'Date',
    'No',
    'Date cell or YYYY-MM-DD',
    'Filled on export, ignored on import. Use Save baseline in OpsTrack.',
  ],
  [
    'Baseline finish',
    'Date',
    'No',
    'On or after Baseline start',
    'Filled on export, ignored on import. Use Save baseline in OpsTrack.',
  ],
  [
    'Task ID (hidden)',
    'Text',
    'Filled by export',
    "Don't edit",
    'Match key. Found in this project = update that task. Blank = new task. Not a task of this project = row error.',
  ],
];

/** One exported task (§B4 Export column). Dates are YYYY-MM-DD. */
export interface TimelineExportRow {
  number: number;
  name: string;
  phase: string | null;
  milestone: boolean;
  start: string | null;
  finish: string | null;
  dependsOn: number[];
  owner: string | null;
  baselineStart: string | null;
  baselineFinish: string | null;
  taskId: string;
}

export interface TimelineWorkbookInput {
  /** null for the blank template (A-54). */
  project: { id: string; name: string } | null;
  phases: string[];
  rows: TimelineExportRow[];
  exportedAt: Date;
  exportedBy: string;
  /** Instructions row 2, e.g. "Exported from Acme on Nov 9, 2026, 9:42 AM (PH time) by …". */
  note: string;
}

const asDate = (d: string) => new Date(`${d}T00:00:00.000Z`);

function instructions(wb: ExcelJS.Workbook, note: string) {
  const ws = wb.addWorksheet(TIMELINE_INSTRUCTIONS_SHEET);
  [18, 16, 16, 36, 64].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const title = ws.getCell('A1');
  title.value = 'OpsTrack project timeline template';
  title.font = { bold: true, size: 14, color: { argb: COLOR.text } };
  ws.mergeCells('A2:E2');
  const n = ws.getCell('A2');
  n.value = note;
  n.font = { italic: true, color: { argb: COLOR.noteText } };
  n.fill = solid(COLOR.noteFill);
  n.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = 32;
  const h = ws.getCell('A4');
  h.value = 'How import works';
  h.font = { bold: true, size: 12, color: { argb: COLOR.text } };
  HOW_IT_WORKS.forEach((line, i) => {
    const r = 5 + i;
    ws.mergeCells(`A${r}:E${r}`);
    const c = ws.getCell(`A${r}`);
    c.value = line;
    c.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 32;
  });
  const cols = 6 + HOW_IT_WORKS.length; // one blank row, then the column table
  const ch = ws.getCell(`A${cols}`);
  ch.value = 'Columns';
  ch.font = { bold: true, size: 12, color: { argb: COLOR.text } };
  const head = ws.getRow(cols + 1);
  ['Column', 'Type', 'Required', 'Format / allowed values', 'What import does'].forEach((t, i) => {
    const c = head.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = solid(COLOR.primary);
  });
  COLUMN_TABLE.forEach((cells, i) => {
    const row = ws.getRow(cols + 2 + i);
    cells.forEach((t, j) => {
      const c = row.getCell(j + 1);
      c.value = t;
      c.alignment = { wrapText: true, vertical: 'top' };
    });
    row.height = 48;
  });
}

/**
 * FR-TL-15/16 (UIE §6): Instructions, Timeline (active) and the hidden `_meta`. Header styled
 * `#5355E0`, panes frozen at C2, autofilter, date cells `yyyy-mm-dd`, Milestone Y/N and Phase
 * lists, header comments, milestone rows tinted, a finish later than the baseline red bold.
 * Every text value is written as a plain string, never a formula (EC-196).
 */
export async function buildTimelineWorkbook(input: TimelineWorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OpsTrack';
  instructions(wb, input.note);
  const ws = wb.addWorksheet(TIMELINE_SHEET, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2', activeCell: 'C2' }],
  });
  WIDTHS.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(TIMELINE_COLUMNS.length).hidden = true;
  const head = ws.getRow(1);
  TIMELINE_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = solid(COLOR.primary);
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    const note = HEADER_NOTES[c.field];
    if (note) cell.note = { texts: [{ text: note }], editAs: 'absolute' } as ExcelJS.Comment;
  });

  input.rows.forEach((r, i) => {
    const row = ws.getRow(2 + i);
    const late = Boolean(r.finish && r.baselineFinish && r.finish > r.baselineFinish);
    const values: Record<TimelineImportField, ExcelJS.CellValue> = {
      number: r.number,
      name: r.name,
      phase: r.phase ?? null,
      milestone: r.milestone ? 'Y' : 'N',
      start: r.start ? asDate(r.start) : null,
      finish: r.finish ? asDate(r.finish) : null,
      dependsOn: r.dependsOn.length ? r.dependsOn.join(', ') : null,
      owner: r.owner ?? null,
      baselineStart: r.baselineStart ? asDate(r.baselineStart) : null,
      baselineFinish: r.baselineFinish ? asDate(r.baselineFinish) : null,
      taskId: r.taskId,
    };
    TIMELINE_COLUMNS.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.value = values[c.field];
      cell.font = {
        name: 'Calibri',
        size: 11,
        color: { argb: c.field === 'finish' && late ? COLOR.late : COLOR.text },
        ...(c.field === 'finish' && late ? { bold: true } : {}),
      };
      cell.border = { bottom: { style: 'thin', color: { argb: COLOR.line } } };
      if (DATE_COLS.has(c.field)) {
        cell.numFmt = 'yyyy-mm-dd';
        cell.alignment = { horizontal: 'left' };
      } else if (c.field === 'number' || c.field === 'milestone') {
        cell.alignment = { horizontal: 'center' };
      } else {
        cell.numFmt = '@';
      }
      if (r.milestone) cell.fill = solid(COLOR.milestone);
    });
  });

  const last = Math.max(1 + input.rows.length, 1 + CLIENT_IMPORT_MAX_ROWS);
  ws.autoFilter = `A1:J${Math.max(2, 1 + input.rows.length)}`;
  type DvSheet = { dataValidations: { add: (range: string, dv: ExcelJS.DataValidation) => void } };
  const dv = (ws as unknown as DvSheet).dataValidations;
  dv.add(`D2:D${last}`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"Y,N"'],
    showErrorMessage: true,
    errorStyle: 'stop',
    errorTitle: 'Milestone',
    error: 'Use Y or N.',
  });
  for (const col of ['E', 'F', 'I', 'J']) {
    dv.add(`${col}2:${col}${last}`, {
      type: 'date',
      operator: 'between',
      allowBlank: true,
      formulae: [new Date('1900-01-01T00:00:00Z'), new Date('9999-12-31T00:00:00Z')],
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Date',
      error: 'Use a date cell or YYYY-MM-DD.',
    });
  }

  const meta = wb.addWorksheet(TIMELINE_META_SHEET, { state: 'hidden' });
  meta.getColumn(1).width = 16;
  meta.getColumn(2).width = 40;
  const metaRows: [string, string][] = [
    ['key', 'value'],
    ['template', TIMELINE_TEMPLATE_ID],
    ['templateVersion', String(TIMELINE_TEMPLATE_VERSION)],
    ['projectId', input.project?.id ?? ''],
    ['projectName', input.project?.name ?? ''],
    // Full ISO with milliseconds: a task saved in the same second just before the export
    // mustn't read as changed after it (FR-TL-25).
    ['exportedAt', input.exportedAt.toISOString()],
    ['exportedBy', input.exportedBy],
    ['rows', String(input.rows.length)],
  ];
  metaRows.forEach(([k, v], i) => {
    meta.getCell(i + 1, 1).value = k;
    meta.getCell(i + 1, 2).value = v;
  });
  // Phase list for the Phase dropdown (no error: a new name is allowed, Q-141).
  if (input.phases.length) {
    meta.getCell(1, 4).value = 'phases';
    input.phases.forEach((p, i) => (meta.getCell(i + 2, 4).value = p));
    dv.add(`C2:C${last}`, {
      type: 'list',
      allowBlank: true,
      formulae: [`'${TIMELINE_META_SHEET}'!$D$2:$D$${input.phases.length + 1}`],
      showErrorMessage: false,
    });
  }
  wb.views = [
    { x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' },
  ];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------
// Reading an upload

/**
 * exceljs only finds comments at `xl/commentsN.xml` and relative part names; files written by
 * other tools (openpyxl, as UIE's sample) use `xl/comments/comment1.xml` or absolute targets and
 * make exceljs throw. Cells are all we read, so comment and VML links are dropped and retried.
 */
async function withoutComments(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files).filter((n) => n.endsWith('.rels'))) {
    const xml = await zip.file(name)!.async('string');
    const next = xml.replace(
      /<Relationship\b[^>]*Type="[^"]*\/(?:comments|vmlDrawing)"[^>]*\/>/g,
      '',
    );
    if (next !== xml) zip.file(name, next);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const opts = { ignoreNodes: ['dataValidations'] };
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer, opts);
    return wb;
  } catch {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await withoutComments(buf)) as unknown as ArrayBuffer, opts);
      return wb;
    } catch {
      throw timelineFileError(422, 'UNREADABLE_FILE', TIMELINE_FILE_ERRORS.UNREADABLE_FILE);
    }
  }
}

/** CR-19's checks, with UIE's timeline copy (UIE §5.1 file errors). */
function checkTimelineUpload(buf: Buffer) {
  if (buf.length > TIMELINE_MAX_BYTES)
    throw timelineFileError(413, 'FILE_TOO_LARGE', fileTooLargeError(buf.length));
  try {
    checkUpload(buf);
  } catch (err) {
    const code = err instanceof HttpError ? err.code : null;
    if (code === 'FILE_TOO_LARGE')
      throw timelineFileError(413, 'FILE_TOO_LARGE', fileTooLargeError(buf.length));
    if (code === 'UNREADABLE_FILE')
      throw timelineFileError(422, 'UNREADABLE_FILE', TIMELINE_FILE_ERRORS.UNREADABLE_FILE);
    throw timelineFileError(415, 'NOT_XLSX', TIMELINE_FILE_ERRORS.NOT_XLSX);
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function readMeta(wb: ExcelJS.Workbook): TimelineMeta | null {
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(TIMELINE_META_SHEET));
  if (!ws) return null;
  const kv = new Map<string, string>();
  ws.eachRow((r) => {
    const k = cellText(r.getCell(1)).trim();
    if (k) kv.set(k.toLowerCase(), cellText(r.getCell(2)).trim());
  });
  const at = kv.get('exportedat') || '';
  const parsed = at ? new Date(at) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  return {
    template: kv.get('template') || null,
    projectId: kv.get('projectid') || null,
    projectName: kv.get('projectname') || null,
    exportedAt: valid,
    exportedAtInvalid: Boolean(at) && !valid,
    exportedBy: kv.get('exportedby') || null,
  };
}

/**
 * Template headers that are missing, or present but out of order (not in the longest run of
 * headers already in template order), in template order; then unknown extra headers.
 */
function headerProblems(head: ExcelJS.Row): string[] {
  const want = TIMELINE_COLUMNS.map((c) => norm(c.header));
  const found: { idx: number }[] = [];
  const extra: string[] = [];
  const seen = new Set<number>();
  head.eachCell((cell) => {
    const t = cellText(cell).trim();
    if (!t) return;
    const idx = want.indexOf(norm(t));
    if (idx < 0 || seen.has(idx)) extra.push(t);
    else {
      seen.add(idx);
      found.push({ idx });
    }
  });
  // Longest increasing subsequence of template indexes = the columns already in order.
  const seq = found.map((f) => f.idx);
  const len: number[] = [];
  const prev: number[] = [];
  seq.forEach((v, i) => {
    len[i] = 1;
    prev[i] = -1;
    for (let j = 0; j < i; j++)
      if (seq[j]! < v && len[j]! + 1 > len[i]!) {
        len[i] = len[j]! + 1;
        prev[i] = j;
      }
  });
  const inOrder = new Set<number>();
  let k = len.length ? len.indexOf(Math.max(...len)) : -1;
  while (k >= 0) {
    inOrder.add(seq[k]!);
    k = prev[k]!;
  }
  // In order but not at its template position (e.g. a column inserted before it) also counts.
  const positions = new Map<number, number>();
  head.eachCell((cell, col) => {
    const idx = want.indexOf(norm(cellText(cell)));
    if (idx >= 0 && !positions.has(idx)) positions.set(idx, col - 1);
  });
  const bad = TIMELINE_COLUMNS.map((c, i) => ({ c, i })).filter(
    ({ i }) => !seen.has(i) || !inOrder.has(i),
  );
  const shifted =
    // (a blank-header column pushed them right; an extra named column is reported itself)
    bad.length === 0 && extra.length === 0 && [...positions].some(([idx, pos]) => idx !== pos)
      ? TIMELINE_COLUMNS.filter((_, i) => positions.get(i) !== i)
      : [];
  return [...bad.map(({ c }) => c.header), ...shifted.map((c) => c.header), ...extra];
}

/** §B4/§B5 file checks, then the Timeline rows (blank rows dropped, cells trimmed). */
export async function readTimelineWorkbook(buf: Buffer): Promise<ParsedTimeline> {
  checkTimelineUpload(buf);
  const wb = await load(buf);
  const ws = wb.worksheets.find((w) => norm(w.name) === norm(TIMELINE_SHEET));
  if (!ws)
    throw timelineFileError(422, 'NO_TIMELINE_SHEET', TIMELINE_FILE_ERRORS.NO_TIMELINE_SHEET);
  // §B4: headers match ignoring case and surrounding spaces. UIE review: compared BY NAME, so
  // the error lists only the missing or misplaced columns (a deleted column doesn't make every
  // later one "wrong"), then any unknown extra headers.
  const wrong = headerProblems(ws.getRow(1));
  if (wrong.length) throw timelineFileError(422, 'COLUMNS', columnsError(wrong));
  const rows: TimelineFileRow[] = [];
  ws.eachRow((r, n) => {
    if (n < 2) return;
    const values = {} as TimelineValues;
    let blank = true;
    TIMELINE_COLUMNS.forEach((c, i) => {
      const text = cellText(r.getCell(i + 1)).trim();
      values[c.field] = text;
      if (text) blank = false;
    });
    if (!blank) rows.push({ row: n, values });
  });
  if (rows.length > CLIENT_IMPORT_MAX_ROWS) {
    throw timelineFileError(
      422,
      'TOO_MANY_ROWS',
      tooManyTimelineRowsError(rows.length, CLIENT_IMPORT_MAX_ROWS),
    );
  }
  if (!rows.length) throw timelineFileError(422, 'EMPTY_FILE', TIMELINE_FILE_ERRORS.EMPTY_FILE);
  return { rows, meta: readMeta(wb) };
}
