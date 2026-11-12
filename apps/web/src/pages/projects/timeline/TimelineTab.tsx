import {
  BROKEN_LINK_TITLE,
  DELAYED_SUB,
  DELAYED_SUB_NO_BASELINE,
  NO_BASELINE_SUB,
  NO_BASELINE_TITLE,
  NO_FORECAST_LINE,
  TASK_STATUS_LABELS,
  VARIANCE_HEADER_TIP,
  doneFinish,
  floatLabel,
  forecastVarianceBadge,
  TIMELINE_EMPTY_HELP,
  TIMELINE_LARGER_SCREEN,
  TIMELINE_PHONE_NOTE,
  TIMELINE_READ_ONLY_NOTE,
  brokenBannerLead,
  buildTimeline,
  noDatesLine,
  shortVarianceLabel,
  type ProjectDto,
  type TimelineDto,
  type TimelineGroup,
  type TimelineLink,
  type TaskForecast,
  type TaskStatusFlags,
  type TimelineModel,
  type TimelineTaskInput,
} from '@xc8/shared';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Alert,
  Button,
  ButtonGroup,
  Dropdown,
  Form,
  Overlay,
  Popover,
  Spinner,
} from 'react-bootstrap';
import { Link } from 'react-router-dom';
import {
  downloadTimelineExport,
  downloadTimelineTemplate,
  useTimeline,
} from '../../../api/timelineHooks';
import { EmptyState, ErrorAlert, LockNotice } from '../../../components/Feedback';
import { shortDate } from '../../../lib/format';
import { useIsCompact } from '../../../lib/useMediaQuery';
import { BaselineHistoryModal, SaveBaselineModal } from './BaselineModals';
import { savedOn } from './format';
import { PhaseManagerModal } from './PhaseManagerModal';
import { TimelineImportModal } from './TimelineImportModal';
import {
  ROW_H,
  ZOOMS,
  dayIndex,
  daysInRange,
  elbowPath,
  monthSpans,
  nonWorkingDays,
  ticks,
  type Zoom,
} from './gantt';

type Filter = 'all' | 'delayed' | 'critical' | 'milestones';
type Row =
  { kind: 'group'; g: TimelineGroup } | { kind: 'task'; t: TimelineTaskInput; g: TimelineGroup };

const LEFT_W = 580;
const LEFT_W_PHONE = 168;
const HEAD_H = 76;

const longDate = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

const dates = (t: TimelineTaskInput) =>
  !t.plannedStart || !t.dueDate
    ? 'No dates'
    : t.isMilestone
      ? shortDate(t.dueDate)
      : // Mockup v0.9.20: a one-day task still reads as a range ("Oct 5 – Oct 5").
        `${shortDate(t.plannedStart)} – ${shortDate(t.dueDate)}`;

const groupCount = (g: TimelineGroup) => {
  if (g.kind === 'UNSCHEDULED') {
    return `${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}, no dates`;
  }
  const n = g.memberCount;
  return `${n} task${n === 1 ? '' : 's'}${g.allCancelled ? ', cancelled' : ''}`;
};

/** UIE §2.4 Var. column: `+2d`, `0`, `−1d`; `—` without a baseline. */
const varText = (v: number | null) =>
  v === null ? '—' : v === 0 ? '0d' : v > 0 ? `+${v}d` : `\u2212${-v}d`;

/** Where a task's bar is drawn (UIE §2.5): completed = actual; in progress = actual start on. */
function barSpan(t: TimelineTaskInput): { start: string; finish: string } {
  if (t.status === 'COMPLETED') {
    const finish = doneFinish(t)!;
    const start = t.actualStart && t.actualStart <= finish ? t.actualStart : t.plannedStart!;
    return { start: start <= finish ? start : finish, finish };
  }
  const start = t.actualStart && t.actualStart <= t.dueDate! ? t.actualStart : t.plannedStart!;
  return { start, finish: t.dueDate! };
}

/** Rows a filter keeps (UIE §2.2). */
function keep(model: TimelineModel, filter: Filter, t: TimelineTaskInput) {
  if (filter === 'milestones') return t.isMilestone;
  if (filter === 'delayed') return Boolean(model.flags[t.id]?.delayed);
  if (filter === 'critical') return Boolean(model.forecast[t.id]?.critical);
  return true;
}

/** Per-task link facts for icons and copy (FR-TL-07, FR-TL-28). */
function linkFacts(model: TimelineModel) {
  const brokenTo = new Map<string, TimelineLink[]>();
  const unscheduledTo = new Set<string>();
  const dependsOnUnscheduled = new Map<string, string[]>();
  for (const l of model.links) {
    if (l.state === 'BROKEN') brokenTo.set(l.to, [...(brokenTo.get(l.to) ?? []), l]);
    if (l.state === 'UNSCHEDULED') {
      unscheduledTo.add(l.to);
      dependsOnUnscheduled.set(l.from, [...(dependsOnUnscheduled.get(l.from) ?? []), l.to]);
    }
  }
  return { brokenTo, unscheduledTo, dependsOnUnscheduled };
}

/**
 * CR-22 Part B slice 1: the project Timeline tab (FR-TL-01 to 07, 14, 23; UIE mockup v0.9.20).
 * Read-only Gantt drawn by us (no chart library, no dragging, Q-143/Q-144); edits go through the
 * task form and the phase manager. The layout comes from the shared buildTimeline() (NFR-50).
 */
export function TimelineTab({
  project,
  onOpen,
}: {
  project: ProjectDto;
  /** Opens the task panel (the task form for planners, read-only for others). */
  onOpen: (taskId: string) => void;
}) {
  // CR-24 FR-ARF-03: the Timeline refreshes every 30 s while visible.
  const q = useTimeline(project.id, true, { poll: true });
  const compact = useIsCompact();
  const [zoom, setZoom] = useState<Zoom>('weeks');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'list' | 'gantt'>('list');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [phasesOpen, setPhasesOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showCritical, setShowCritical] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'danger'>('success');
  const [pop, setPop] = useState<{ id: string; el: HTMLElement } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const data = q.data;
  const model = useMemo(
    () =>
      data
        ? buildTimeline({
            tasks: data.tasks,
            phases: data.phases,
            plannedEndDate: data.project.plannedEndDate,
            today: data.today,
            calendar: data.calendar,
          })
        : null,
    [data],
  );

  if (q.isPending) {
    return (
      <div className="card" data-testid="timeline-loading">
        <div className="card-body d-flex align-items-center gap-2 py-5 justify-content-center">
          <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
          <span>Loading timeline…</span>
        </div>
      </div>
    );
  }
  if (q.error || !data || !model || !Array.isArray(data.tasks))
    return <ErrorAlert error={q.error ?? new Error('No data')} />;

  const canPhases = data.can.editPhaseTargets || data.can.editPhaseNames;
  const readOnly = !data.can.plan && !canPhases;
  const facts = linkFacts(model);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const openTask = (id: string) => {
    setPop(null);
    onOpen(id);
  };
  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const say = (message: string | null, tone: 'success' | 'danger' = 'success') => {
    setToastTone(tone);
    setToast(message);
  };
  const openPhases = () => {
    if (compact) say(TIMELINE_LARGER_SCREEN);
    else setPhasesOpen(true);
  };
  const openBaseline = () => {
    if (compact) say(TIMELINE_LARGER_SCREEN);
    else setBaselineOpen(true);
  };
  // UIE §4: on a phone, import shows the larger-screen message; downloads still work.
  const openImport = () => {
    if (compact) say(TIMELINE_LARGER_SCREEN);
    else setImportOpen(true);
  };
  const download = (run: () => Promise<unknown>, failed: string) => {
    run().catch(() => say(failed, 'danger'));
  };
  const downloadExport = () =>
    download(
      () => downloadTimelineExport(project.id, data.project.name),
      "Couldn't download the timeline. Try again.",
    );
  const downloadTemplate = () =>
    download(
      () => downloadTimelineTemplate(project.id),
      "Couldn't download the template. Try again.",
    );
  const showGantt = !compact || view === 'gantt';
  const display = { critical: showCritical, baseline: showBaseline };
  const firstBroken = model.broken[0];

  return (
    <div className="tlx" data-testid="timeline">
      {toast && (
        <Alert
          variant={toastTone}
          role="status"
          dismissible
          onClose={() => {
            setToast(null);
            setToastTone('success');
          }}
          className="py-2"
        >
          {toast}
        </Alert>
      )}
      <SummaryCards data={data} model={model} onHistory={() => setHistoryOpen(true)} />

      {/* UIE retest: on a phone the note comes before the buttons. */}
      {compact && <p className="small text-body-secondary mb-2">{TIMELINE_PHONE_NOTE}</p>}
      {/* UIE review: the empty state has no toolbar (its own Excel buttons stand in). */}
      {model.scheduledCount > 0 && (
        <div
          className="tlx-toolbar d-flex flex-wrap align-items-center gap-2 mb-3"
          data-testid="timeline-toolbar"
        >
          {showGantt && (
            <>
              <ButtonGroup size="sm" aria-label="Zoom">
                {(['days', 'weeks', 'months'] as Zoom[]).map((z) => (
                  <Button
                    key={z}
                    variant={zoom === z ? 'primary' : 'outline-secondary'}
                    aria-pressed={zoom === z}
                    onClick={() => setZoom(z)}
                  >
                    {z[0]!.toUpperCase() + z.slice(1)}
                  </Button>
                ))}
              </ButtonGroup>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => {
                  const el = scrollRef.current;
                  if (el)
                    el.scrollLeft = Math.max(
                      0,
                      dayIndex(model.range.start, data.today) * ZOOMS[zoom] - 40,
                    );
                }}
              >
                <i className="bx bx-target-lock me-1" aria-hidden="true" />
                Today
              </Button>
              <Form.Check
                type="switch"
                id="tlx-critical-switch"
                className="mb-0 tlx-switch"
                label="Critical path"
                checked={showCritical}
                onChange={(e) => setShowCritical(e.target.checked)}
              />
              <Form.Check
                type="switch"
                id="tlx-baseline-switch"
                className="mb-0 tlx-switch"
                label="Baseline"
                checked={showBaseline}
                onChange={(e) => setShowBaseline(e.target.checked)}
              />
            </>
          )}
          {compact ? (
            <Form.Select
              size="sm"
              className="w-auto"
              aria-label="Show"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
            >
              <option value="all">All {model.taskCount}</option>
              <option value="delayed">Delayed {model.delayedCount}</option>
              <option value="critical">Critical path {model.criticalCount}</option>
              <option value="milestones">Milestones {model.milestoneCount}</option>
            </Form.Select>
          ) : (
            <div className="d-flex gap-1" role="group" aria-label="Show">
              <FilterPill
                on={filter === 'all'}
                onClick={() => setFilter('all')}
                label="All"
                count={model.taskCount}
              />
              <FilterPill
                on={filter === 'delayed'}
                onClick={() => setFilter('delayed')}
                label="Delayed"
                count={model.delayedCount}
              />
              <FilterPill
                on={filter === 'critical'}
                onClick={() => setFilter('critical')}
                label="Critical path"
                count={model.criticalCount}
              />
              <FilterPill
                on={filter === 'milestones'}
                onClick={() => setFilter('milestones')}
                label="Milestones"
                count={model.milestoneCount}
              />
            </div>
          )}
          {compact && (
            <ButtonGroup size="sm" aria-label="View" className="ms-auto">
              {(['list', 'gantt'] as const).map((v) => (
                <Button
                  key={v}
                  variant={view === v ? 'primary' : 'outline-secondary'}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === 'list' ? 'List' : 'Gantt'}
                </Button>
              ))}
            </ButtonGroup>
          )}
          {(canPhases || data.can.saveBaseline || data.can.excel) && (
            <div className={`d-flex gap-2${compact ? '' : ' ms-auto'}`}>
              {canPhases && (
                <Button size="sm" variant="outline-secondary" onClick={openPhases}>
                  <i className="bx bx-layer me-1" aria-hidden="true" />
                  Phases
                </Button>
              )}
              {data.can.saveBaseline && (
                <Button size="sm" variant="outline-primary" onClick={openBaseline}>
                  <i className="bx bx-save me-1" aria-hidden="true" />
                  Save baseline
                </Button>
              )}
              {data.can.excel && (
                <Dropdown align="end">
                  <Dropdown.Toggle size="sm" variant="outline-secondary" id="tlx-excel">
                    <i className="bx bx-spreadsheet me-1" aria-hidden="true" />
                    Excel
                  </Dropdown.Toggle>
                  <Dropdown.Menu>
                    {data.can.importExcel && (
                      <Dropdown.Item as="button" onClick={openImport}>
                        <i className="bx bx-upload me-2" aria-hidden="true" />
                        Import from Excel…
                      </Dropdown.Item>
                    )}
                    <Dropdown.Item as="button" onClick={downloadExport}>
                      <i className="bx bx-download me-2" aria-hidden="true" />
                      Download timeline (.xlsx)
                    </Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item as="button" onClick={downloadTemplate}>
                      <i className="bx bx-file-blank me-2" aria-hidden="true" />
                      Download template
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              )}
            </div>
          )}
        </div>
      )}
      {readOnly && <LockNotice>{TIMELINE_READ_ONLY_NOTE}</LockNotice>}

      {firstBroken && (
        <Alert variant="warning" className="py-2" data-testid="broken-banner">
          <i className="bx bx-error me-1" aria-hidden="true" />
          <strong>{brokenBannerLead(model.broken.length)}</strong>{' '}
          {(() => {
            const s = byId.get(firstBroken.to)!;
            const p = byId.get(firstBroken.from)!;
            return (
              <>
                #{s.order} {s.name} is planned to start {shortDate(s.plannedStart)}, but #{p.order}{' '}
                {p.name} finishes {shortDate(p.dueDate)}. Dates weren&apos;t moved.{' '}
                {model.forecast[s.id] && model.forecast[p.id] && (
                  <>
                    The forecast assumes #{s.order} starts after #{p.order} finishes (
                    {shortDate(model.forecast[s.id]!.start)} –{' '}
                    {shortDate(model.forecast[s.id]!.finish)}
                    ).{' '}
                  </>
                )}
                <Button
                  variant="link"
                  size="sm"
                  className="p-0 align-baseline tlx-tap tlx-tap-line"
                  onClick={(e) => setPop({ id: s.id, el: e.currentTarget })}
                >
                  Show task
                </Button>
              </>
            );
          })()}
        </Alert>
      )}

      {model.scheduledCount === 0 ? (
        <div className="card" data-testid="timeline-empty">
          <div className="card-body">
            <EmptyState icon="bx-calendar" title="No scheduled tasks">
              {TIMELINE_EMPTY_HELP}
              {model.unscheduledCount > 0 && (
                <>
                  <br />
                  {noDatesLine(model.unscheduledCount)}
                </>
              )}
            </EmptyState>
            {data.can.plan && (
              <div className="d-flex flex-wrap justify-content-center gap-2 mb-3">
                {data.can.importExcel && (
                  <Button size="sm" onClick={openImport}>
                    <i className="bx bx-upload me-1" aria-hidden="true" />
                    Import from Excel
                  </Button>
                )}
                {data.can.excel && (
                  <Button size="sm" variant="outline-secondary" onClick={downloadTemplate}>
                    <i className="bx bx-download me-1" aria-hidden="true" />
                    Download template
                  </Button>
                )}
                <Link to={`/projects/${project.id}`} className="btn btn-sm btn-outline-primary">
                  Open Checklist
                </Link>
              </div>
            )}
            <Gantt
              data={data}
              model={model}
              rows={[]}
              zoom="months"
              leftW={compact ? LEFT_W_PHONE : LEFT_W}
              compact={compact}
              facts={facts}
              collapsed={collapsed}
              onToggle={toggle}
              onPick={(id, el) => setPop({ id, el })}
              scrollRef={scrollRef}
              display={display}
            />
          </div>
        </div>
      ) : showGantt ? (
        <div className="card">
          <Gantt
            data={data}
            model={model}
            rows={rowsOf(model, collapsed, filter)}
            zoom={zoom}
            leftW={compact ? LEFT_W_PHONE : LEFT_W}
            compact={compact}
            facts={facts}
            collapsed={collapsed}
            onToggle={toggle}
            onPick={(id, el) => setPop({ id, el })}
            scrollRef={scrollRef}
            display={display}
          />
          {!compact && <Legend />}
        </div>
      ) : (
        <TimelineList
          data={data}
          model={model}
          display={display}
          filter={filter}
          collapsed={collapsed}
          onToggle={toggle}
          facts={facts}
          onPick={(id, el) => setPop({ id, el })}
        />
      )}

      {pop && byId.get(pop.id) && (
        <TaskPopover
          task={byId.get(pop.id)!}
          forecast={model.forecast[pop.id]}
          flags={model.flags[pop.id]}
          target={pop.el}
          byId={byId}
          facts={facts}
          phaseName={model.groups.find((g) => g.tasks.some((t) => t.id === pop.id))?.name ?? null}
          onOpen={() => openTask(pop.id)}
          onClose={() => {
            const el = pop.el;
            setPop(null);
            el.focus?.();
          }}
        />
      )}
      {baselineOpen && (
        <SaveBaselineModal
          timeline={data}
          unscheduled={model.unscheduledCount}
          onClose={() => setBaselineOpen(false)}
          onSaved={say}
        />
      )}
      {historyOpen && (
        <BaselineHistoryModal baselines={data.baselines} onClose={() => setHistoryOpen(false)} />
      )}
      {importOpen && (
        <TimelineImportModal projectId={project.id} onClose={() => setImportOpen(false)} />
      )}
      {phasesOpen && (
        <PhaseManagerModal timeline={data} onClose={() => setPhasesOpen(false)} onSaved={say} />
      )}
    </div>
  );
}

function FilterPill({
  on,
  onClick,
  label,
  count,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <Button
      size="sm"
      variant={on ? 'primary' : 'outline-secondary'}
      className="rounded-pill tlx-pill"
      aria-pressed={on}
      onClick={onClick}
    >
      {label} <span className="badge bg-label-secondary ms-1">{count}</span>
    </Button>
  );
}

function rowsOf(model: TimelineModel, collapsed: Set<string>, filter: Filter): Row[] {
  const rows: Row[] = [];
  for (const g of model.groups) {
    const list = g.tasks.filter((t) => keep(model, filter, t));
    if (filter !== 'all' && !list.length) continue;
    rows.push({ kind: 'group', g });
    if (!collapsed.has(g.key)) for (const t of list) rows.push({ kind: 'task', t, g });
  }
  return rows;
}

function SummaryCards({
  data,
  model,
  onHistory,
}: {
  data: TimelineDto;
  model: TimelineModel;
  onHistory: () => void;
}) {
  const badge =
    model.forecastVariance !== null ? forecastVarianceBadge(model.forecastVariance) : null;
  const current = data.baselines[0];
  const card = (title: string, body: ReactNode) => (
    <div className="col-6 col-md-3">
      <div className="card h-100">
        <div className="card-body py-3">
          <div className="small text-body-secondary">{title}</div>
          {body}
        </div>
      </div>
    </div>
  );
  return (
    <div className="row g-3 mb-3" data-testid="timeline-cards">
      {card(
        'Target delivery',
        <>
          <div className="h5 mb-1" data-testid="card-target">
            {longDate(data.project.plannedEndDate)}
          </div>
          <div className="small text-body-secondary">Project planned end date</div>
        </>,
      )}
      {card(
        'Forecast end',
        <>
          <div className="h5 mb-1" data-testid="card-forecast">
            {model.forecastEnd ? longDate(model.forecastEnd) : '—'}
          </div>
          <div className="small">
            {!model.forecastEnd ? (
              <span className="text-body-secondary">{NO_FORECAST_LINE}</span>
            ) : badge ? (
              <span className={`badge bg-label-${badge.tone}`} data-testid="forecast-variance">
                {badge.text}
              </span>
            ) : (
              <span className="text-body-secondary">No target delivery date</span>
            )}
          </div>
        </>,
      )}
      {card(
        'Delayed tasks',
        <>
          <div
            className={`h5 mb-1${model.delayedCount ? ' text-danger' : ''}`}
            data-testid="card-delayed"
          >
            {model.delayedCount}
          </div>
          <div className="small text-body-secondary">
            {model.hasBaseline ? DELAYED_SUB : DELAYED_SUB_NO_BASELINE}
          </div>
        </>,
      )}
      {card(
        'Baseline',
        current ? (
          <>
            <div className="h5 mb-1" data-testid="card-baseline">
              Saved {savedOn(current.savedAt)}
            </div>
            <div className="small text-body-secondary">
              by {current.savedBy?.name ?? 'Unknown user'} ·{' '}
              <Button
                variant="link"
                size="sm"
                className="p-0 align-baseline tlx-tap"
                onClick={onHistory}
              >
                Baseline history ({data.baselines.length})
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="h5 mb-1" data-testid="card-baseline">
              {NO_BASELINE_TITLE}
            </div>
            <div className="small text-body-secondary">{NO_BASELINE_SUB}</div>
          </>
        ),
      )}
    </div>
  );
}

type Display = { critical: boolean; baseline: boolean };

interface GanttProps {
  data: TimelineDto;
  model: TimelineModel;
  rows: Row[];
  zoom: Zoom;
  leftW: number;
  compact: boolean;
  facts: ReturnType<typeof linkFacts>;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  onPick: (id: string, el: HTMLElement) => void;
  scrollRef: RefObject<HTMLDivElement>;
  display: Display;
}

function Gantt({
  data,
  model,
  rows,
  zoom,
  leftW,
  compact,
  facts,
  collapsed,
  onToggle,
  onPick,
  scrollRef,
  display,
}: GanttProps) {
  const ppd = ZOOMS[zoom];
  const days = useMemo(() => daysInRange(model.range), [model.range]);
  const width = days.length * ppd;
  const x = (d: string) => dayIndex(model.range.start, d) * ppd;
  const off = useMemo(() => nonWorkingDays(days, data.calendar), [days, data.calendar]);
  const bodyH = Math.max(rows.length * ROW_H, 40);
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => r.kind === 'task' && rowOf.set(r.t.id, i));
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const target = data.project.plannedEndDate;
  const forecastEnd = model.forecastEnd;
  const forecastLate = Boolean(forecastEnd && target && forecastEnd > target);
  const criticalLink = new Set(
    display.critical ? model.criticalLinks.map((l) => `${l.from}-${l.to}`) : [],
  );

  // Opens with today near the left edge (UIE §1), and again when the zoom changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, x(data.today) - 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, model.range.start]);

  const drawn = model.links.filter(
    (l) => (l.state === 'OK' || l.state === 'BROKEN') && rowOf.has(l.from) && rowOf.has(l.to),
  );

  return (
    <div className="tlx-scroll" ref={scrollRef} data-testid="gantt">
      <div className="tlx-grid" style={{ width: leftW + width }}>
        <div className="tlx-head" style={{ height: HEAD_H }}>
          <div className="tlx-left tlx-left-head" style={{ width: leftW }}>
            <span className="tlx-c-num">#</span>
            <span className="tlx-c-name">Task</span>
            {!compact && <span className="tlx-c-owner">Owner</span>}
            {!compact && <span className="tlx-c-dates">Dates</span>}
            {!compact && (
              <span className="tlx-c-var" title={VARIANCE_HEADER_TIP}>
                Var.
              </span>
            )}
          </div>
          <div className="tlx-chart-head" style={{ width }} aria-hidden="true">
            <div className="tlx-months">
              {monthSpans(days).map((m) => (
                <span key={m.key} style={{ left: m.from * ppd, width: (m.to - m.from + 1) * ppd }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="tlx-ticks">
              {ticks(days, zoom).map((t) => (
                <span
                  key={t.i}
                  style={{ left: t.i * ppd, width: zoom === 'days' ? ppd : undefined }}
                >
                  {t.label}
                </span>
              ))}
            </div>
            <div className="tlx-flags">
              <span className="tlx-flag tlx-flag-today" style={{ left: x(data.today) + ppd / 2 }}>
                Today {shortDate(data.today)}
              </span>
              {target && (
                <span className="tlx-flag tlx-flag-target" style={{ left: x(target) + ppd / 2 }}>
                  Target {shortDate(target)}
                </span>
              )}
              {forecastLate && (
                <span
                  className="tlx-flag tlx-flag-forecast"
                  style={{ left: x(forecastEnd!) + ppd / 2 }}
                >
                  Forecast {shortDate(forecastEnd)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="tlx-body" style={{ minHeight: bodyH }}>
          <div className="tlx-bg" style={{ left: leftW, width }} aria-hidden="true">
            {off.map((d) => (
              <span
                key={d.i}
                className={d.holiday ? 'tlx-holiday' : 'tlx-weekend'}
                style={{ left: d.i * ppd, width: ppd }}
                title={d.holiday ?? undefined}
              />
            ))}
            <span className="tlx-line tlx-line-today" style={{ left: x(data.today) + ppd / 2 }} />
            {target && (
              <span
                className="tlx-line tlx-line-target"
                data-testid="target-line"
                data-date={target}
                style={{ left: x(target) + ppd / 2 }}
              />
            )}
            {forecastLate && (
              <span
                className="tlx-line tlx-line-forecast"
                data-testid="forecast-line"
                data-date={forecastEnd!}
                style={{ left: x(forecastEnd!) + ppd / 2 }}
              />
            )}
          </div>
          <svg
            className="tlx-links"
            style={{ left: leftW, width, height: bodyH }}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="tlx-arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 z" fill="#5d6878" />
              </marker>
              <marker
                id="tlx-arrow-red"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 z" fill="#b8240a" />
              </marker>
              <marker
                id="tlx-arrow-dark"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L6,3 L0,6 z" fill="#22303e" />
              </marker>
            </defs>
            {drawn.map((l) => {
              const p = byId.get(l.from)!;
              const s = byId.get(l.to)!;
              const y1 = rowOf.get(l.from)! * ROW_H + ROW_H / 2;
              const y2 = rowOf.get(l.to)! * ROW_H + ROW_H / 2;
              const broken = l.state === 'BROKEN';
              const crit = criticalLink.has(`${l.from}-${l.to}`);
              return (
                <path
                  key={`${l.from}-${l.to}`}
                  data-testid={`link-${l.from}-${l.to}`}
                  data-state={l.state}
                  data-critical={crit || undefined}
                  d={elbowPath(x(barSpan(p).finish) + ppd, y1, x(barSpan(s).start), y2)}
                  className={`tlx-link${broken ? ' tlx-link-broken' : ''}${crit ? ' tlx-link-critical' : ''}`}
                  markerEnd={
                    broken
                      ? 'url(#tlx-arrow-red)'
                      : crit
                        ? 'url(#tlx-arrow-dark)'
                        : 'url(#tlx-arrow)'
                  }
                />
              );
            })}
          </svg>
          {rows.map((r) =>
            r.kind === 'group' ? (
              <GroupRow
                key={`g-${r.g.key}`}
                g={r.g}
                leftW={leftW}
                width={width}
                ppd={ppd}
                x={x}
                compact={compact}
                open={!collapsed.has(r.g.key)}
                onToggle={() => onToggle(r.g.key)}
              />
            ) : (
              <TaskRow
                key={r.t.id}
                t={r.t}
                leftW={leftW}
                width={width}
                ppd={ppd}
                x={x}
                compact={compact}
                facts={facts}
                byId={byId}
                onPick={onPick}
                forecast={model.forecast[r.t.id]}
                flags={model.flags[r.t.id]}
                display={display}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function GroupRow({
  g,
  leftW,
  width,
  ppd,
  x,
  compact,
  open,
  onToggle,
}: {
  g: TimelineGroup;
  leftW: number;
  width: number;
  ppd: number;
  x: (d: string) => number;
  compact: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const late = (g.variance ?? 0) > 0;
  const second = g.allCancelled
    ? 'Completion —'
    : g.complete
      ? `Completed ${shortDate(g.completedOn)}`
      : g.forecastFinish
        ? `Forecast ${shortDate(g.forecastFinish)}`
        : null;
  return (
    <div className="tlx-row tlx-row-group" data-testid={`group-${g.name}`}>
      <div className="tlx-left" style={{ width: leftW }}>
        <button
          type="button"
          className="btn btn-sm btn-text-secondary tlx-chevron"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${g.name}`}
          onClick={onToggle}
        >
          <i className={`bx ${open ? 'bx-chevron-down' : 'bx-chevron-right'}`} aria-hidden="true" />
        </button>
        <span className="tlx-group-name text-truncate">
          <strong>{g.name}</strong>
          {!compact && <span className="text-body-secondary small"> · {groupCount(g)}</span>}
        </span>
        {!compact && g.kind === 'PHASE' && (
          <span className="tlx-group-target small">
            <span>{g.targetDate ? `Target ${shortDate(g.targetDate)}` : 'No target'}</span>
            {second && <span className="d-block text-body-secondary">{second}</span>}
          </span>
        )}
        {!compact && g.kind === 'PHASE' && g.variance !== null && !g.allCancelled && (
          <span
            className={`tlx-group-var small fw-semibold ${late ? 'text-danger' : 'text-success'}`}
            title="Compared with the phase target, in working days"
          >
            {shortVarianceLabel(g.variance)}
          </span>
        )}
      </div>
      <div className="tlx-cell" style={{ width }}>
        {g.kind === 'UNSCHEDULED' ? null : (
          <>
            {g.start && g.finish && (
              <span
                className="tlx-summary"
                style={{ left: x(g.start), width: x(g.finish) - x(g.start) + ppd }}
                aria-hidden="true"
              />
            )}
            {g.targetDate && (
              <span
                className={`tlx-phase-flag${late ? ' tlx-phase-flag-late' : ''}`}
                style={{ left: x(g.targetDate) + ppd / 2 }}
                title={`${g.name} target ${shortDate(g.targetDate)}`}
                aria-hidden="true"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  t,
  leftW,
  width,
  ppd,
  x,
  compact,
  facts,
  byId,
  onPick,
  forecast,
  flags,
  display,
}: {
  t: TimelineTaskInput;
  forecast: TaskForecast | undefined;
  flags: TaskStatusFlags | undefined;
  display: Display;
  leftW: number;
  width: number;
  ppd: number;
  x: (d: string) => number;
  compact: boolean;
  facts: ReturnType<typeof linkFacts>;
  byId: Map<string, TimelineTaskInput>;
  onPick: (id: string, el: HTMLElement) => void;
}) {
  const cancelled = t.status === 'CANCELLED';
  const done = t.status === 'COMPLETED';
  const scheduled = Boolean(t.plannedStart && t.dueDate);
  const broken = facts.brokenTo.has(t.id);
  const noDatesLink = facts.unscheduledTo.has(t.id);
  const dependents = (facts.dependsOnUnscheduled.get(t.id) ?? []).map((id) => byId.get(id)!);
  const delayed = Boolean(flags?.delayed);
  const finishedLate = Boolean(flags?.finishedLate);
  const critical = display.critical && Boolean(forecast?.critical);
  const span = scheduled ? barSpan(t) : null;
  // UIE review: a cancelled task gets no baseline bar.
  const showBase =
    display.baseline && t.baselineStart && t.baselineFinish && !t.isMilestone && !cancelled;
  const forecastTail =
    span && forecast && !done && !cancelled && forecast.finish > span.finish
      ? forecast.finish
      : null;
  const variance = flags?.variance ?? null;
  const label = `${t.isMilestone ? 'Milestone ' : ''}#${t.order} ${t.name}, ${
    scheduled
      ? t.plannedStart === t.dueDate
        ? shortDate(t.dueDate)
        : `${shortDate(t.plannedStart)} to ${shortDate(t.dueDate)}`
      : 'no dates'
  }${cancelled ? ', cancelled' : done ? ', completed' : ''}${delayed ? ', delayed' : ''}${
    finishedLate ? ', finished late' : ''
  }${critical ? ', critical' : ''}${broken ? ', broken dependency' : ''}`;
  return (
    <div
      className={`tlx-row${critical ? ' tlx-row-critical' : ''}${scheduled ? '' : ' tlx-row-nodates'}`}
      data-testid={`row-${t.id}`}
      data-critical={critical || undefined}
    >
      <div className="tlx-left" style={{ width: leftW }}>
        <span className="tlx-c-num text-body-secondary">{t.order}</span>
        <span className="tlx-c-name text-truncate">
          {t.isMilestone && <span className="tlx-diamond-icon" aria-hidden="true" />}
          {broken && (
            <i
              className="bx bx-error text-danger me-1"
              role="img"
              aria-label={BROKEN_LINK_TITLE}
              title={BROKEN_LINK_TITLE}
            />
          )}
          {noDatesLink && (
            <i
              className="bx bx-error tlx-warn me-1"
              role="img"
              aria-label="Linked task has no dates"
              title="Linked task has no dates"
            />
          )}
          <button
            type="button"
            className={`btn btn-link p-0 tlx-name-link${cancelled ? ' text-decoration-line-through' : ''}`}
            onClick={(e) => onPick(t.id, e.currentTarget)}
            title={t.name}
          >
            {/* A button centres overflowing text; the inner span clips at the end with "…". */}
            <span className="tlx-name-text">{t.name}</span>
          </button>
          {cancelled && <span className="badge bg-label-secondary ms-1 tlx-badge">Cancelled</span>}
          {/* UIE §4: at 390 the left column shows the number and name only. */}
          {delayed && !compact && (
            <span className="badge bg-label-danger ms-1 tlx-badge">Delayed</span>
          )}
          {finishedLate && !compact && (
            <span className="badge bg-label-secondary ms-1 tlx-badge">Finished late</span>
          )}
        </span>
        {!compact && (
          <span className="tlx-c-owner text-truncate">
            {t.owner ? t.owner.name : <em className="text-body-secondary">No owner</em>}
          </span>
        )}
        {!compact && <span className="tlx-c-dates">{dates(t)}</span>}
        {!compact && (
          <span
            className={`tlx-c-var small${
              cancelled || variance === null || variance <= 0
                ? ' text-body-secondary'
                : done
                  ? ''
                  : ' text-danger fw-semibold'
            }`}
            data-testid={`var-${t.id}`}
          >
            {cancelled ? '—' : varText(variance)}
          </span>
        )}
        {!scheduled && (
          // UIE retest: the note sits in the left column under the task name and wraps, so it is
          // fully readable at any scroll position and width. Unscheduled rows are always last,
          // so a taller row doesn't move any bar or link above it.
          <span className="tlx-nodates small text-body-secondary" data-testid={`nodates-${t.id}`}>
            {dependents.length > 0 && (
              <>
                <i className="bx bx-error tlx-warn me-1" aria-hidden="true" />
                {dependents.map((d) => `#${d.order}`).join(', ')} depend
                {dependents.length === 1 ? 's' : ''} on it; that link is ignored.{' '}
              </>
            )}
            No dates, so it is left out of the critical path and forecast.
          </span>
        )}
      </div>
      <div className="tlx-cell" style={{ width }}>
        {showBase && (
          <span
            className="tlx-baseline"
            data-testid={`baseline-${t.id}`}
            style={{
              left: x(t.baselineStart!),
              width: Math.max(x(t.baselineFinish!) - x(t.baselineStart!) + ppd, 4),
            }}
            aria-hidden="true"
          />
        )}
        {forecastTail && span && (
          <span
            className="tlx-forecast-tail"
            data-testid={`forecast-${t.id}`}
            style={{ left: x(span.finish) + ppd, width: x(forecastTail) - x(span.finish) }}
            aria-hidden="true"
          />
        )}
        {!scheduled ? null : t.isMilestone ? (
          <button
            type="button"
            className="tlx-milestone"
            style={{ left: x(t.dueDate!) + ppd / 2 - 9 }}
            aria-label={label}
            onClick={(e) => onPick(t.id, e.currentTarget)}
          >
            <span className="tlx-diamond" aria-hidden="true" />
            <span className="tlx-ms-label" aria-hidden="true">
              {shortDate(t.dueDate)}
            </span>
          </button>
        ) : (
          <button
            type="button"
            className={`tlx-bar${done ? ' tlx-bar-done' : ''}${cancelled ? ' tlx-bar-cancelled' : ''}${
              delayed ? ' tlx-bar-delayed' : ''
            }${critical ? ' tlx-bar-critical' : ''}`}
            style={{
              left: x(span!.start),
              width: Math.max(x(span!.finish) - x(span!.start) + ppd, 6),
            }}
            aria-label={label}
            onClick={(e) => onPick(t.id, e.currentTarget)}
          />
        )}
      </div>
    </div>
  );
}

function Legend() {
  // Spec §2.5 order (UIE retest).
  const sw = (cls: string): ReactNode => <span className={`tlx-lg ${cls}`} aria-hidden="true" />;
  const items: [string, ReactNode, string][] = [
    ['planned', sw('tlx-lg-planned'), 'Planned / in progress'],
    ['done', sw('tlx-lg-done'), 'Completed'],
    ['delayed', sw('tlx-lg-delayed'), 'Delayed'],
    [
      'late',
      <span className="badge bg-label-secondary">Finished late</span>,
      'Completed after baseline finish',
    ],
    ['cancelled', sw('tlx-lg-cancelled'), 'Cancelled (left out of phase)'],
    ['baseline', sw('tlx-lg-baseline'), 'Baseline'],
    ['forecast', sw('tlx-lg-forecast'), 'Forecast, when later than planned'],
    ['critical', sw('tlx-lg-critical'), 'Critical path'],
    ['milestone', sw('tlx-lg-milestone'), 'Milestone'],
    ['phase', sw('tlx-lg-phase'), 'Phase'],
    ['flag', sw('tlx-lg-flag'), 'Phase target'],
    ['today', sw('tlx-lg-line tlx-line-today'), 'Today'],
    ['target', sw('tlx-lg-line tlx-line-target'), 'Target delivery'],
    ['fend', sw('tlx-lg-line tlx-line-forecast'), 'Forecast end'],
    ['broken', sw('tlx-lg-broken'), 'Broken dependency'],
    [
      'nodates',
      <i className="bx bx-error tlx-warn" aria-hidden="true" />,
      'Linked task has no dates',
    ],
    ['weekend', sw('tlx-lg-weekend'), 'Weekend'],
    ['holiday', sw('tlx-lg-holiday'), 'Holiday'],
  ];
  return (
    <div className="tlx-legend small text-body-secondary px-3 py-2" data-testid="timeline-legend">
      {items.map(([key, swatch, text]) => (
        <span key={key} className="me-3 text-nowrap" data-legend={key}>
          {swatch} {text}
        </span>
      ))}
    </div>
  );
}

function TaskPopover({
  task,
  forecast,
  flags,
  target,
  byId,
  facts,
  phaseName,
  onOpen,
  onClose,
}: {
  task: TimelineTaskInput;
  forecast: TaskForecast | undefined;
  flags: TaskStatusFlags | undefined;
  target: HTMLElement;
  byId: Map<string, TimelineTaskInput>;
  facts: ReturnType<typeof linkFacts>;
  phaseName: string | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const openRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    openRef.current?.focus();
  }, [task.id]);
  const broken = facts.brokenTo.get(task.id) ?? [];
  const preds = task.dependsOn.map((id) => byId.get(id)).filter(Boolean) as TimelineTaskInput[];
  return (
    <Overlay target={target} show placement="auto" rootClose onHide={onClose}>
      <Popover id="tlx-popover" className="tlx-popover" aria-labelledby="tlx-pop-title">
        <Popover.Header as="h3" id="tlx-pop-title">
          #{task.order} {task.name}
        </Popover.Header>
        <Popover.Body>
          <div className="small text-body-secondary mb-2">
            {[
              task.phase ?? phaseName ?? 'No phase',
              task.owner?.name ?? 'No owner',
              TASK_STATUS_LABELS[task.status],
            ].join(' · ')}
          </div>
          <dl className="row small mb-2">
            <dt className="col-5">Planned</dt>
            <dd className="col-7 mb-1">{dates(task)}</dd>
            <dt className="col-5">Actual</dt>
            <dd className="col-7 mb-1" data-testid="pop-actual">
              {!task.actualStart
                ? task.status === 'COMPLETED'
                  ? `Done ${shortDate(doneFinish(task))}`
                  : 'Not started'
                : task.actualFinish
                  ? `${shortDate(task.actualStart)} – ${shortDate(task.actualFinish)}`
                  : `${shortDate(task.actualStart)} – not finished`}
            </dd>
            <dt className="col-5">Baseline</dt>
            <dd className="col-7 mb-1">
              {task.baselineStart && task.baselineFinish
                ? task.baselineStart === task.baselineFinish
                  ? shortDate(task.baselineFinish)
                  : `${shortDate(task.baselineStart)} – ${shortDate(task.baselineFinish)}`
                : '—'}
            </dd>
            <dt className="col-5">Variance</dt>
            <dd className="col-7 mb-1" data-testid="pop-variance">
              {flags?.variance == null ? '—' : `${varText(flags.variance)} (working days)`}
            </dd>
            {forecast && !forecast.done && (
              <>
                <dt className="col-5">Forecast</dt>
                <dd className="col-7 mb-1">
                  {forecast.start === forecast.finish
                    ? shortDate(forecast.finish)
                    : `${shortDate(forecast.start)} – ${shortDate(forecast.finish)}`}
                </dd>
                <dt className="col-5">Float</dt>
                <dd className="col-7 mb-1" data-testid="pop-float">
                  {forecast.float === null ? '—' : floatLabel(forecast.float)}
                </dd>
              </>
            )}
            <dt className="col-5">Depends on</dt>
            <dd className="col-7 mb-1">
              {preds.length === 0
                ? '—'
                : preds.map((p) => (
                    <div key={p.id}>
                      {p.plannedStart && p.dueDate ? (
                        `#${p.order} ${p.name} (${shortDate(p.dueDate)})`
                      ) : (
                        <>
                          <i className="bx bx-error tlx-warn me-1" aria-hidden="true" />#{p.order}{' '}
                          {p.name} (no dates, link ignored for the forecast and critical path)
                        </>
                      )}
                    </div>
                  ))}
            </dd>
          </dl>
          {broken.map((l) => {
            const p = byId.get(l.from)!;
            return (
              <Alert key={l.from} variant="danger" className="py-2 small mb-2">
                <i className="bx bx-error me-1" aria-hidden="true" />
                <strong>{BROKEN_LINK_TITLE}</strong> #{p.order} {p.name} finishes{' '}
                {shortDate(p.dueDate)}. You can still save. Dates aren't moved.
              </Alert>
            );
          })}
          {flags?.delayed && (
            <p className="small text-danger mb-2" data-testid="pop-delayed">
              <strong>Delayed:</strong>{' '}
              {flags.delayReason === 'PAST_DUE'
                ? `not completed, and its planned finish (${shortDate(task.dueDate)}) has passed.`
                : `not completed, and its forecast finish (${shortDate(forecast?.finish ?? null)}) is after its baseline finish (${shortDate(task.baselineFinish ?? null)}).`}
            </p>
          )}
          {flags?.finishedLate && (
            <p className="small mb-2" data-testid="pop-finished-late">
              <strong>Finished late:</strong> done {shortDate(doneFinish(task))}, after its baseline
              finish ({shortDate(task.baselineFinish ?? null)}).
            </p>
          )}
          <div className="d-flex gap-2 justify-content-end">
            <Button ref={openRef} size="sm" variant="primary" className="tlx-tap" onClick={onOpen}>
              Open task
            </Button>
            <Button size="sm" variant="outline-secondary" className="tlx-tap" onClick={onClose}>
              Close
            </Button>
          </div>
        </Popover.Body>
      </Popover>
    </Overlay>
  );
}

/** UIE §4: the phone List view, collapsible phase cards with a mini-bar per task. */
function TimelineList({
  data,
  model,
  display,
  filter,
  collapsed,
  onToggle,
  facts,
  onPick,
}: {
  data: TimelineDto;
  model: TimelineModel;
  display: Display;
  filter: Filter;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  facts: ReturnType<typeof linkFacts>;
  onPick: (id: string, el: HTMLElement) => void;
}) {
  const total = Math.max(dayIndex(model.range.start, model.range.end), 1);
  const pct = (d: string) => (dayIndex(model.range.start, d) / total) * 100;
  const target = data.project.plannedEndDate;
  return (
    <div data-testid="timeline-list">
      {model.groups.map((g) => {
        const list = g.tasks.filter((t) => keep(model, filter, t));
        if (filter !== 'all' && !list.length) return null;
        const open = !collapsed.has(g.key);
        return (
          <div className="card mb-2" key={g.key} data-testid={`list-group-${g.name}`}>
            <button
              type="button"
              className="card-header btn text-start d-flex align-items-center gap-2 py-2"
              aria-expanded={open}
              onClick={() => onToggle(g.key)}
            >
              <i
                className={`bx ${open ? 'bx-chevron-down' : 'bx-chevron-right'}`}
                aria-hidden="true"
              />
              <span className="flex-grow-1">
                <strong>{g.name}</strong>
                <span className="d-block small text-body-secondary">
                  {g.kind === 'PHASE' && g.targetDate ? `Target ${shortDate(g.targetDate)} · ` : ''}
                  {g.complete
                    ? `Completed ${shortDate(g.completedOn)}`
                    : g.forecastFinish
                      ? `Forecast ${shortDate(g.forecastFinish)}`
                      : groupCount(g)}
                </span>
              </span>
              {g.kind === 'PHASE' && g.variance !== null && !g.allCancelled && (
                <span
                  className={`badge ${g.variance > 0 ? 'bg-label-danger' : 'bg-label-success'}`}
                >
                  {shortVarianceLabel(g.variance)}
                </span>
              )}
            </button>
            {open && (
              <ul className="list-group list-group-flush">
                {list.map((t) => {
                  const scheduled = Boolean(t.plannedStart && t.dueDate);
                  return (
                    <li key={t.id} className="list-group-item py-2">
                      <button
                        type="button"
                        className={`btn btn-link p-0 text-start tlx-tap${t.status === 'CANCELLED' ? ' text-decoration-line-through' : ''}`}
                        onClick={(e) => onPick(t.id, e.currentTarget)}
                      >
                        #{t.order} {t.name}
                      </button>
                      {t.isMilestone && <span className="badge bg-label-info ms-1">Milestone</span>}
                      {facts.brokenTo.has(t.id) && (
                        <span className="badge bg-label-danger ms-1">Broken link</span>
                      )}
                      {model.flags[t.id]?.delayed && (
                        <span className="badge bg-label-danger ms-1">Delayed</span>
                      )}
                      {model.flags[t.id]?.finishedLate && (
                        <span className="badge bg-label-secondary ms-1">Finished late</span>
                      )}
                      {t.status === 'CANCELLED' && (
                        <span className="badge bg-label-secondary ms-1">Cancelled</span>
                      )}
                      <div className="small text-body-secondary">
                        {[
                          dates(t),
                          t.owner?.name ?? 'No owner',
                          TASK_STATUS_LABELS[t.status],
                          ...(display.critical && model.forecast[t.id]?.critical
                            ? ['Critical']
                            : []),
                          `Var. ${t.status === 'CANCELLED' ? '—' : varText(model.flags[t.id]?.variance ?? null)}`,
                        ].join(' · ')}
                      </div>
                      {scheduled && (
                        <div className="tlx-mini" aria-hidden="true">
                          <span
                            className={`tlx-mini-bar${t.status === 'COMPLETED' ? ' tlx-bar-done' : ''}${
                              model.flags[t.id]?.delayed ? ' tlx-mini-delayed' : ''
                            }`}
                            style={{
                              left: `${pct(barSpan(t).start)}%`,
                              width: `${Math.max(pct(barSpan(t).finish) - pct(barSpan(t).start), 1)}%`,
                            }}
                          />
                          <span
                            className="tlx-mini-today"
                            style={{ left: `${pct(data.today)}%` }}
                          />
                          {target && (
                            <span className="tlx-mini-target" style={{ left: `${pct(target)}%` }} />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
