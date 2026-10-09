import {
  ISSUE_CATEGORY_LABELS,
  ISSUE_SEVERITY_LABELS,
  ISSUE_STAGE_LABELS,
  ISSUE_STATUS_LABELS,
  type IssueRowDto,
} from '@xc8/shared';

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** FR-ISS-17: the filtered list as CSV (opens in Excel). */
export function issuesCsv(items: IssueRowDto[]): string {
  const head = [
    'ID',
    'Project',
    'Client',
    'Title',
    'Stage',
    'Category',
    'Severity',
    'Status',
    'Owner',
    'Client contact',
    'Due',
    'Overdue',
  ];
  const rows = items.map((i) => [
    i.key,
    i.project.name,
    i.client?.name ?? '',
    i.title,
    ISSUE_STAGE_LABELS[i.stage],
    ISSUE_CATEGORY_LABELS[i.category],
    ISSUE_SEVERITY_LABELS[i.severity],
    ISSUE_STATUS_LABELS[i.status],
    i.owner?.name ?? '',
    i.contact?.name ?? '',
    i.dueDate ?? '',
    i.overdue ? 'Yes' : 'No',
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(name: string, csv: string) {
  // BOM so Excel reads UTF-8 names (ñ, é) correctly.
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
