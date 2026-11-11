import type { ProjectDto } from '@xc8/shared';
import { Dropdown, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { importLockReason } from './checklistCopy';
import type { ChecklistExcel } from './useChecklistExcel';

/**
 * CR-23 UIE §3.1: the Checklist's Excel menu (the one import, replacing the CR-22 Timeline menu).
 * Planners only (`project.can.checklistExcel`). On Completed, Cancelled or archived projects the
 * downloads still work and Import is disabled with a tooltip (FR-CLX-03). On a phone, Import shows
 * the larger-screen message; downloads still work (FR-CLX-08).
 */

function MenuItem({
  icon,
  title,
  sub,
  onClick,
  disabled,
}: {
  icon: string;
  title: string;
  sub: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      as="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className="d-flex align-items-start gap-2 py-2 ckx-item"
    >
      <i className={`bx ${icon} mt-1`} aria-hidden="true" />
      <span>
        <span className="d-block">{title}</span>
        <span className="d-block small text-body-secondary text-wrap">{sub}</span>
      </span>
    </Dropdown.Item>
  );
}

export function ChecklistExcelMenu({
  project,
  excel,
}: {
  project: ProjectDto;
  excel: ChecklistExcel;
}) {
  const locked = importLockReason(project);
  const importItem = (
    <MenuItem
      icon="bx-upload"
      title="Import from Excel…"
      sub="Add or update tasks, dates, links, owners and deliverables"
      onClick={excel.openImport}
      disabled={Boolean(locked)}
    />
  );
  return (
    <Dropdown align="end">
      <Dropdown.Toggle size="sm" variant="outline-secondary" id="ckx-excel">
        <i className="bx bx-spreadsheet me-1" aria-hidden="true" />
        Excel
      </Dropdown.Toggle>
      <Dropdown.Menu className="ckx-menu">
        {locked ? (
          <OverlayTrigger placement="left" overlay={<Tooltip id="ckx-locked">{locked}</Tooltip>}>
            {/* A disabled button gets no pointer events; the wrapper carries the tooltip. */}
            <span className="d-block" tabIndex={0} aria-label={`Import from Excel… ${locked}`}>
              {importItem}
            </span>
          </OverlayTrigger>
        ) : (
          importItem
        )}
        <MenuItem
          icon="bx-download"
          title="Download checklist (.xlsx)"
          sub="This project's plan in the same file, ready to edit and import"
          onClick={excel.downloadExport}
        />
        <Dropdown.Divider />
        <MenuItem
          icon="bx-file-blank"
          title="Download template"
          sub="Blank file with instructions; every row imports as new"
          onClick={excel.downloadTemplate}
        />
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function ChecklistExcelToast({ excel }: { excel: ChecklistExcel }) {
  if (!excel.toast) return null;
  return (
    <div
      className={`alert alert-${excel.toast.tone} alert-dismissible py-2`}
      role={excel.toast.tone === 'danger' ? 'alert' : 'status'}
    >
      {excel.toast.text}
      <button type="button" className="btn-close" aria-label="Close" onClick={excel.clearToast} />
    </div>
  );
}
