import {
  DAR_COLUMNS,
  darExportName,
  darFooter,
  DAR_TITLE,
  generatedRangeLabel,
  moduleLabel,
  type DarReportDto,
  type DarRowDto,
} from '@xc8/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const NAVY = '00467F';

/** The values of one row in DAR_COLUMNS order. */
function cells(r: DarRowDto): string[] {
  return [
    r.date,
    r.timeIn,
    r.timeOut,
    r.rendered,
    r.client,
    r.project,
    r.activityType,
    r.location,
    r.billable,
    r.leave ? r.module : moduleLabel(r.module),
    r.remarks,
  ];
}

const rangeOf = (r: DarReportDto) => ({ from: r.from, to: r.shownTo ?? r.to });

export const darFileName = (r: DarReportDto, ext: 'pdf' | 'xlsx') => {
  const { from, to } = rangeOf(r);
  return `DAR_${from}${from === to ? '' : `_to_${to}`}.${ext}`;
};

/**
 * Excel export (FR-DAR-03): same rows and totals as the preview. Rendered hours are numbers
 * (days, shown as [h]:mm) so they add up; every text cell is a plain string, never a formula.
 */
export async function darToXlsx(report: DarReportDto): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = darExportName(report);
  wb.created = new Date(report.generatedAt);
  const ws = wb.addWorksheet('Report', { pageSetup: { orientation: 'landscape' } });
  const { from, to } = rangeOf(report);
  ws.addRow([DAR_TITLE]).font = { bold: true, size: 14 };
  ws.addRow([generatedRangeLabel(from, to)]);
  ws.addRow([`Total Activities: ${report.totalActivities}`]);
  ws.addRow([]);
  const header = ws.addRow([...DAR_COLUMNS]);
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${NAVY}` } };
  });
  for (const r of report.rows) {
    const values: (string | number)[] = cells(r);
    if (!r.leave) values[3] = r.minutes / 1440;
    const row = ws.addRow(values);
    if (!r.leave) row.getCell(4).numFmt = '[h]:mm';
  }
  const total = ws.addRow(['Total rendered hours', '', '', report.totalMinutes / 1440]);
  total.font = { bold: true };
  total.getCell(4).numFmt = '[h]:mm';
  ws.addRow([]);
  ws.addRow([darFooter(report)]).font = { italic: true };
  const widths = [12, 10, 10, 12, 22, 26, 20, 12, 9, 18, 48];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(11).alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF export (FR-DAR-03): the sample's layout, landscape A4, standard fonts. */
export function darToPdf(report: DarReportDto, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 32,
    compress: opts.compress ?? true,
    info: { Title: DAR_TITLE, Creator: darExportName(report) },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const { from, to } = rangeOf(report);
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const ratios = [62, 50, 50, 46, 80, 96, 76, 50, 40, 70, 158];
  const sum = ratios.reduce((a, b) => a + b, 0);
  const widths = ratios.map((r) => (r / sum) * usable);
  const pad = 3;
  const fontSize = 7.5;

  // DR-26: the sample's navy band with the white title and the range, centred.
  const bandTop = doc.page.margins.top;
  const bandHeight = 54;
  doc.rect(left, bandTop, usable, bandHeight).fill(`#${NAVY}`);
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#ffffff')
    .text(DAR_TITLE, left, bandTop + 12, { width: usable, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#ffffff')
    .text(generatedRangeLabel(from, to), left, bandTop + 33, { width: usable, align: 'center' });
  doc.x = left;
  doc.y = bandTop + bandHeight + 8;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#222222')
    .text('Total Activities: ', left, doc.y, { continued: true })
    .font('Helvetica')
    .text(String(report.totalActivities));
  doc.moveDown(0.6);

  const rowHeight = (vals: string[], w: number[], font: string) => {
    doc.font(font).fontSize(fontSize);
    return (
      Math.max(...vals.map((v, i) => doc.heightOfString(v || ' ', { width: w[i]! - pad * 2 }))) +
      pad * 2
    );
  };
  // `span` merges the first n columns (the total row's label).
  const drawRow = (
    cellsIn: string[],
    opts: { header?: boolean; bold?: boolean; span?: number } = {},
  ) => {
    const span = opts.span ?? 1;
    const vals = [cellsIn.slice(0, span).join(' '), ...cellsIn.slice(span)];
    const w = [widths.slice(0, span).reduce((a, b) => a + b, 0), ...widths.slice(span)];
    const font = opts.header || opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    const h = rowHeight(vals, w, font);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 24) {
      doc.addPage();
      if (!opts.header) drawRow([...DAR_COLUMNS], { header: true });
    }
    const y = doc.y;
    let x = left;
    if (opts.header) doc.rect(left, y, usable, h).fill(`#${NAVY}`);
    vals.forEach((v, i) => {
      doc.rect(x, y, w[i]!, h).lineWidth(0.4).strokeColor('#b0b8c4').stroke();
      doc
        .font(font)
        .fontSize(fontSize)
        .fillColor(opts.header ? '#ffffff' : '#1f2937')
        .text(v, x + pad, y + pad, { width: w[i]! - pad * 2, lineBreak: true });
      x += w[i]!;
    });
    doc.x = left;
    doc.y = y + h;
  };
  drawRow([...DAR_COLUMNS], { header: true });
  for (const r of report.rows) drawRow(cells(r));
  drawRow(['Total rendered hours', '', '', report.totalRendered, '', '', '', '', '', '', ''], {
    bold: true,
    span: 3,
  });
  doc.moveDown(1);
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor('#4b5563')
    .text(darFooter(report), left, doc.y, { width: usable, align: 'center' });
  doc.end();
  return done;
}
