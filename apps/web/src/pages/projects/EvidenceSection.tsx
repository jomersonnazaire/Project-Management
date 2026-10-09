import {
  EVIDENCE_ACCEPT,
  EVIDENCE_TYPES_LABEL,
  MAX_FILES_PER_UPLOAD,
  checkFileRules,
  fileKindOf,
  formatBytes,
  shortName,
  type EvidenceDto,
  type TaskDto,
} from '@xc8/shared';
import { useRef, useState, type DragEvent } from 'react';
import { Button, ProgressBar } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import {
  completeUpload,
  evidenceTickets,
  openDownload,
  putFile,
  useInvalidateTasks,
  type EvidenceComplete,
} from '../../api/m3Hooks';
import { useTaskMutation } from '../../api/projectHooks';
import { shortDate } from '../../lib/format';
import { useConfirm } from '../../components/ConfirmModal';

const CHIP: Record<string, { label: string; className: string }> = {
  PDF: { label: 'PDF', className: 'bg-label-danger' },
  WORD: { label: 'DOC', className: 'bg-label-primary' },
  EXCEL: { label: 'XLS', className: 'bg-label-success' },
  IMAGE: { label: 'IMG', className: 'bg-label-info' },
};

export function FileChip({ name }: { name: string }) {
  const kind = fileKindOf(name);
  const chip = kind ? CHIP[kind]! : { label: 'FILE', className: 'bg-label-secondary' };
  return (
    <span className={`file-chip ${chip.className}`} aria-hidden="true">
      {chip.label}
    </span>
  );
}

interface Progress {
  key: string;
  name: string;
  pct: number;
  abort: AbortController;
}

const errorText = (e: unknown, name: string) =>
  e instanceof ApiError ? e.message : `${name} couldn't be uploaded. Try again.`;

/**
 * Task evidence (FR-EVD-01..07): drop or browse PDF/Word/Excel files (up to 25 MB each). Files go
 * straight to private storage through a short-lived link, then the API checks their real type and
 * scans them for malware before they're attached. Links added before uploads show as legacy.
 */
export function EvidenceSection({ task, archived }: { task: TaskDto; archived: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Progress[]>([]);
  const remove = useTaskMutation();
  const refresh = useInvalidateTasks();
  const canUpload = task.can.status && !archived;
  const locked = task.status === 'FOR_REVIEW' || task.status === 'COMPLETED';

  async function upload(list: File[]) {
    const problems: string[] = [];
    if (list.length > MAX_FILES_PER_UPLOAD) {
      problems.push(`Up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
      list = list.slice(0, MAX_FILES_PER_UPLOAD);
    }
    const ok: File[] = [];
    for (const f of list) {
      const issue = checkFileRules({ name: f.name, size: f.size }, 'EVIDENCE');
      if (issue) problems.push(issue.message);
      else ok.push(f);
    }
    setErrors(problems);
    if (!ok.length) return;
    let tickets;
    try {
      tickets = (await evidenceTickets(task.id, ok)).uploads;
    } catch (e) {
      setErrors((x) => [...x, errorText(e, ok.map((f) => f.name).join(', '))]);
      return;
    }
    await Promise.all(
      tickets.map(async (t, i) => {
        const file = ok[i]!;
        const abort = new AbortController();
        const row: Progress = { key: t.id, name: file.name, pct: 0, abort };
        setUploads((u) => [...u, row]);
        const setPct = (pct: number) =>
          setUploads((u) => u.map((x) => (x.key === t.id ? { ...x, pct } : x)));
        try {
          await putFile(t, file, setPct, abort.signal);
          await completeUpload<EvidenceComplete>(t.id);
        } catch (e) {
          if ((e as Error).name !== 'AbortError') setErrors((x) => [...x, errorText(e, file.name)]);
        } finally {
          setUploads((u) => u.filter((x) => x.key !== t.id));
        }
      }),
    );
    refresh();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (canUpload) void upload(Array.from(e.dataTransfer.files));
  };

  const removable = (ev: EvidenceDto) =>
    task.can.edit && !archived && !(ev.type === 'FILE' && locked);

  return (
    <>
      <h3 className="h6">Evidence</h3>
      {canUpload && (
        <div
          className={`drop-zone mb-3 ${over ? 'is-over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Add evidence files"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              input.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <i className="bx bx-upload me-1" aria-hidden="true" />
          Drop a file here or <span className="text-primary">browse</span>
          <div className="small text-body-secondary">{EVIDENCE_TYPES_LABEL}</div>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={EVIDENCE_ACCEPT}
            data-testid="evidence-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void upload(files);
            }}
          />
        </div>
      )}
      {task.evidence.length === 0 && uploads.length === 0 && (
        <p className="small text-body-secondary">
          No evidence yet.
          {task.requiresApproval &&
            ' Upload a PDF, Word or Excel file before submitting for review.'}
        </p>
      )}
      <ul className="list-unstyled small mb-2">
        {task.evidence.map((ev) =>
          ev.type === 'LINK' ? (
            <li key={ev.id} className="d-flex align-items-center gap-2 mb-2">
              <span className="file-chip bg-label-secondary" aria-hidden="true">
                <i className="bx bx-link" />
              </span>
              <div className="flex-grow-1 min-w-0">
                <a
                  href={ev.url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-break"
                >
                  {ev.name}
                </a>
                <div className="text-body-secondary">Link (legacy) · added before file uploads</div>
              </div>
              {removable(ev) && <RemoveButton ev={ev} task={task} mutate={remove.mutate} />}
            </li>
          ) : (
            <li key={ev.id} className="d-flex align-items-center gap-2 mb-2">
              <FileChip name={ev.name} />
              <div className="flex-grow-1 min-w-0">
                <strong className="text-heading text-break">{ev.name}</strong>
                <div className="text-body-secondary">
                  {ev.size != null && `${formatBytes(ev.size)} · `}
                  {ev.addedBy ? shortName(ev.addedBy.name) : 'Unknown'} · {shortDate(ev.at)}
                </div>
              </div>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() =>
                  openDownload(`/tasks/${task.id}/evidence/${ev.id}/download`).catch((e) =>
                    setErrors([errorText(e, ev.name)]),
                  )
                }
              >
                Download
              </Button>
              {removable(ev) && <RemoveButton ev={ev} task={task} mutate={remove.mutate} />}
            </li>
          ),
        )}
        {uploads.map((u) => (
          <li key={u.key} className="d-flex align-items-center gap-2 mb-2">
            <FileChip name={u.name} />
            <div className="flex-grow-1">
              <strong className="text-heading">{u.name}</strong>
              <ProgressBar
                now={u.pct}
                className="my-1"
                style={{ height: 6 }}
                aria-label={`Uploading ${u.name}`}
              />
              <span className="text-body-secondary">
                {u.pct < 100 ? `Uploading… ${u.pct}%` : 'Checking the file…'}
              </span>
            </div>
            <Button variant="link" size="sm" className="p-0" onClick={() => u.abort.abort()}>
              Cancel
            </Button>
          </li>
        ))}
      </ul>
      {errors.map((m) => (
        <div key={m} className="small text-danger mb-1" role="alert">
          ⚠ {m}
        </div>
      ))}
      {remove.error instanceof ApiError && (
        <div className="small text-danger mb-1" role="alert">
          ⚠ {remove.error.message}
        </div>
      )}
      <div className="mb-4" />
    </>
  );
}

function RemoveButton({
  ev,
  task,
  mutate,
}: {
  ev: EvidenceDto;
  task: TaskDto;
  mutate: ReturnType<typeof useTaskMutation>['mutate'];
}) {
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      {confirmDialog}
      <Button
        variant="link"
        size="sm"
        className="p-0 text-danger"
        aria-label={`Remove ${ev.name}`}
        onClick={async () => {
          if (
            await confirm({
              title: `Remove ${ev.name} from this task?`,
              confirmLabel: 'Remove',
              danger: true,
            })
          ) {
            mutate({ path: `/tasks/${task.id}/evidence/${ev.id}`, method: 'DELETE' });
          }
        }}
      >
        Remove
      </Button>
    </>
  );
}
