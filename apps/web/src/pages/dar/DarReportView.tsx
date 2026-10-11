import {
  DAR_COLUMNS,
  darFooter,
  DAR_TITLE,
  moduleLabel,
  SAVED_EARLIER,
  SAVED_LATEST,
  generatedRangeLabel,
  type DarReportDto,
  type SavedTag,
} from '@xc8/shared';

/**
 * The report as the sample shows it (FR-DAR-07, -08): header, Total Activities, the 11 columns,
 * a total rendered hours row and the footer. Every value is rendered as text (NFR security).
 */
export function DarReportView({ report }: { report: DarReportDto }) {
  const to = report.shownTo ?? report.to;
  return (
    <div className="dar-report" data-testid="dar-report">
      {/* DR-26: the sample's navy band with the white title and the range (FR-DAR-08). */}
      <div className="dar-band">
        <h2>{DAR_TITLE}</h2>
        <div>{generatedRangeLabel(report.from, to)}</div>
      </div>
      <div className="dar-count">
        <strong>Total Activities:</strong> {report.totalActivities}
      </div>
      <div className="dar-table-wrap">
        <table className="table table-sm dar-table mb-0">
          <colgroup>
            {DAR_COL_WIDTHS.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {DAR_COLUMNS.map((c) => (
                <th key={c} scope="col" className="dar-head">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i} className={r.leave ? 'dar-leave' : undefined}>
                <td className="text-nowrap">{r.date}</td>
                <td className="text-nowrap">{r.timeIn}</td>
                <td className="text-nowrap">{r.timeOut}</td>
                <td className="text-nowrap">{r.rendered}</td>
                <td>{r.client}</td>
                <td>{r.project}</td>
                <td>{r.activityType}</td>
                <td>{r.location}</td>
                <td>{r.billable}</td>
                <td>{r.leave ? r.module : moduleLabel(r.module)}</td>
                <td className="dar-remarks">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="dar-total">
              <td colSpan={3}>Total rendered hours</td>
              <td>{report.totalRendered}</td>
              <td colSpan={7} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="dar-footer mb-0">{darFooter(report)}</p>
    </div>
  );
}

/** Column widths (%) that fit all 11 columns from 1200px with Remarks wrapping (DR-26). */
const DAR_COL_WIDTHS = [8.5, 7.5, 7.5, 7.5, 11, 10, 8.5, 7.5, 7, 8, 17];

export function SavedTagBadge({ tag }: { tag: SavedTag }) {
  if (tag === 'LATEST') return <span className="badge bg-label-success">{SAVED_LATEST}</span>;
  if (tag === 'EARLIER') return <span className="badge bg-label-secondary">{SAVED_EARLIER}</span>;
  return <span className="text-body-secondary">–</span>;
}
