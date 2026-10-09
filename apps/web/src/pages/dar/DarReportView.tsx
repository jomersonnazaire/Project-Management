import {
  DAR_COLUMNS,
  DAR_FOOTER,
  DAR_TITLE,
  SAVED_EARLIER,
  SAVED_LATEST,
  generatedRangeLabel,
  type DarReportDto,
  type SavedTag,
} from '@xc8/shared';
import { Table } from 'react-bootstrap';

/**
 * The report as the sample shows it (FR-DAR-07, -08): header, Total Activities, the 11 columns,
 * a total rendered hours row and the footer. Every value is rendered as text (NFR security).
 */
export function DarReportView({ report }: { report: DarReportDto }) {
  const to = report.shownTo ?? report.to;
  return (
    <div className="dar-report" data-testid="dar-report">
      <h2 className="h5 mb-1">{DAR_TITLE}</h2>
      <div className="small">{generatedRangeLabel(report.from, to)}</div>
      <div className="small mb-3">
        Total Activities: <strong>{report.totalActivities}</strong>
      </div>
      <div className="table-responsive">
        <Table size="sm" bordered className="mb-2 align-top">
          <thead>
            <tr>
              {DAR_COLUMNS.map((c) => (
                <th key={c} scope="col" className="text-nowrap dar-head">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              <tr key={i} className={r.leave ? 'table-info' : undefined}>
                <td className="text-nowrap">{r.date}</td>
                <td className="text-nowrap">{r.timeIn}</td>
                <td className="text-nowrap">{r.timeOut}</td>
                <td className="text-nowrap">{r.rendered}</td>
                <td>{r.client}</td>
                <td>{r.project}</td>
                <td>{r.activityType}</td>
                <td>{r.location}</td>
                <td>{r.billable}</td>
                <td>{r.module}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{r.remarks}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="fw-semibold">
              <td colSpan={3}>Total rendered hours</td>
              <td>{report.totalRendered}</td>
              <td colSpan={7} />
            </tr>
          </tfoot>
        </Table>
      </div>
      <p className="small text-body-secondary fst-italic mb-0">{DAR_FOOTER}</p>
    </div>
  );
}

export function SavedTagBadge({ tag }: { tag: SavedTag }) {
  if (tag === 'LATEST') return <span className="badge bg-label-success">{SAVED_LATEST}</span>;
  if (tag === 'EARLIER') return <span className="badge bg-label-secondary">{SAVED_EARLIER}</span>;
  return <span className="text-body-secondary">–</span>;
}
