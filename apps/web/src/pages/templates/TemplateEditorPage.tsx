import {
  JOB_ROLE_LABELS,
  JOB_ROLES,
  NO_ESTIMATE_LABEL,
  PARTIES,
  PARTY_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  TEMPLATE_TYPE_LABELS,
  TEMPLATE_TYPES,
  type TemplateActivityDto,
  type TemplateDto,
  type TemplatePhaseDto,
  type TemplateType,
} from '@xc8/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useDeleteTemplate,
  useSaveTemplate,
  useTemplate,
  useTemplateAction,
  type TemplateAction,
} from '../../api/projectHooks';
import { useCan } from '../../auth/useCan';
import { EmptyState, ErrorAlert, LoadingRows, LockNotice } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { Estimate, TemplateStatusBadge } from '../../components/ProjectBadges';
import { shortDate } from '../../lib/format';
import { NotFoundPage } from '../ErrorPages';

interface Draft {
  name: string;
  type: TemplateType;
  description: string;
  phases: TemplatePhaseDto[];
  activities: TemplateActivityDto[];
}

const toDraft = (t: TemplateDto): Draft => ({
  name: t.name,
  type: t.type,
  description: t.description ?? '',
  phases: t.phases,
  activities: t.activities,
});

const nextId = (prefix: string, taken: { id: string }[]) => {
  let n = taken.length + 1;
  while (taken.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

/**
 * Template editor (FR-TPL-02..05). Drafts are editable; publishing makes the draft the version new
 * projects use, and earlier projects keep the version they were created from (FR-TPL-04).
 */
export function TemplateEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const template = useTemplate(id);
  const canEdit = useCan('templates', 'edit');
  const canCreate = useCan('templates', 'create');
  const canDelete = useCan('templates', 'delete');
  const save = useSaveTemplate();
  const action = useTemplateAction();
  const remove = useDeleteTemplate();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<TemplateActivityDto | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const t = template.data;
  // Start (again) from the server copy whenever it loads or changes, e.g. after a save.
  const [syncedFrom, setSyncedFrom] = useState<TemplateDto | undefined>(undefined);
  if (t && t !== syncedFrom) {
    setSyncedFrom(t);
    setDraft(toDraft(t));
    setDirty(false);
  }

  if (template.error && 'status' in template.error && template.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!t || !draft) {
    return (
      <>
        <PageHeader title="Template" />
        <ErrorAlert error={template.error} />
        <LoadingRows rows={5} />
      </>
    );
  }

  const editable = t.status === 'DRAFT' && canEdit;
  const update = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const body = () => ({
    name: draft.name,
    type: draft.type,
    description: draft.description || null,
    phases: draft.phases,
    activities: draft.activities,
  });

  const run = (a: TemplateAction) => {
    setNotice(null);
    const go = () =>
      action.mutate(
        { id: t.id, action: a },
        {
          onSuccess: (res) => {
            if (a === 'publish')
              setNotice(`Published v${res.version}. New projects now use this version.`);
            if (res.id !== t.id) navigate(`/templates/${res.id}`);
          },
        },
      );
    if (a === 'publish' && dirty) save.mutate({ id: t.id, body: body() }, { onSuccess: go });
    else go();
  };

  const activitiesByPhase = (phaseId: string) =>
    draft.activities.filter((x) => x.phaseId === phaseId);
  const nameOf = (aid: string) => {
    const i = draft.activities.findIndex((x) => x.id === aid);
    return i < 0 ? aid : `#${i + 1} ${draft.activities[i]!.name}`;
  };

  return (
    <>
      <PageHeader
        title={`${t.name} · v${t.version}`}
        badge={
          <>
            <TemplateStatusBadge status={t.status} />
            {t.superseded && <span className="badge bg-label-secondary ms-1">Older version</span>}
          </>
        }
      >
        {editable && (
          <>
            <Button
              variant="outline-secondary"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({ id: t.id, body: body() }, { onSuccess: () => setDirty(false) })
              }
            >
              Save draft
            </Button>
            <Button disabled={action.isPending || save.isPending} onClick={() => run('publish')}>
              Publish v{t.version}
            </Button>
          </>
        )}
      </PageHeader>

      <Link to="/templates" className="d-inline-block mb-4">
        ‹ All templates
      </Link>
      {notice && <Alert variant="success">{notice}</Alert>}
      <ErrorAlert error={save.error || action.error || remove.error} action />
      {!editable && t.status === 'DRAFT' && (
        <LockNotice>You can view this draft. Editing templates needs Edit on Templates.</LockNotice>
      )}
      {t.status !== 'DRAFT' && (
        <p className="text-body-secondary">
          Published versions are read-only. Projects keep the version they were created from;
          {t.superseded
            ? ' a newer version is now used for new projects.'
            : ' new projects use this version.'}
        </p>
      )}

      <div className="row g-6">
        <div className="col-lg-8">
          <div className="card mb-6">
            <div className="card-body">
              <div className="row g-3">
                <Form.Group className="col-md-7" controlId="tpl-edit-name">
                  <Form.Label>Template name</Form.Label>
                  <Form.Control
                    value={draft.name}
                    disabled={!editable}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </Form.Group>
                <Form.Group className="col-md-5" controlId="tpl-edit-type">
                  <Form.Label>Type</Form.Label>
                  <Form.Select
                    value={draft.type}
                    disabled={!editable}
                    onChange={(e) => update({ type: e.target.value as TemplateType })}
                  >
                    {TEMPLATE_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {TEMPLATE_TYPE_LABELS[x]}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
                <Form.Group className="col-12" controlId="tpl-edit-desc">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={2}
                    value={draft.description}
                    disabled={!editable}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </Form.Group>
              </div>
            </div>
          </div>

          {draft.phases.length === 0 && (
            <EmptyState icon="bx-list-ol" title="No phases yet">
              {editable ? 'Add a phase, then its activities.' : 'This template has no activities.'}
            </EmptyState>
          )}
          {draft.phases.map((ph, pi) => (
            <div className="card mb-4" key={ph.id}>
              <div className="card-header d-flex align-items-center gap-2">
                {editable ? (
                  <Form.Control
                    aria-label={`Phase ${pi + 1} name`}
                    value={ph.name}
                    onChange={(e) =>
                      update({
                        phases: draft.phases.map((x) =>
                          x.id === ph.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                ) : (
                  <h2 className="h6 mb-0">{ph.name}</h2>
                )}
                {editable && activitiesByPhase(ph.id).length === 0 && (
                  <Button
                    variant="link"
                    size="sm"
                    className="text-danger"
                    onClick={() => update({ phases: draft.phases.filter((x) => x.id !== ph.id) })}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="table-responsive">
                <table className="table mb-0">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Activity</th>
                      <th scope="col">Party</th>
                      <th scope="col">Est. hours</th>
                      <th scope="col">Day / days</th>
                      <th scope="col">Depends on</th>
                      {editable && (
                        <th scope="col">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {activitiesByPhase(ph.id).map((a) => (
                      <tr key={a.id}>
                        <td>{draft.activities.indexOf(a) + 1}</td>
                        <td className="text-heading">
                          {a.name}
                          <div className="small text-body-secondary">
                            {[
                              a.mandatory ? 'Mandatory' : 'Optional',
                              a.requiresApproval && 'Needs approval',
                              a.isMilestone && 'Milestone',
                              a.deliverable && `Deliverable: ${a.deliverable}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </td>
                        <td>{PARTY_LABELS[a.party]}</td>
                        <td>
                          <Estimate hours={a.estHours} />
                        </td>
                        <td className="text-nowrap">
                          +{a.offsetDays} / {a.durationDays}
                        </td>
                        <td className="small">{a.dependsOn.map(nameOf).join(', ') || '–'}</td>
                        {editable && (
                          <td className="text-end text-nowrap">
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() => setEditing(a)}
                              aria-label={`Edit ${a.name}`}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="link"
                              size="sm"
                              className="text-danger"
                              aria-label={`Remove ${a.name}`}
                              onClick={() =>
                                update({
                                  activities: draft.activities
                                    .filter((x) => x.id !== a.id)
                                    .map((x) => ({
                                      ...x,
                                      dependsOn: x.dependsOn.filter((d) => d !== a.id),
                                    })),
                                })
                              }
                            >
                              Remove
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {editable && (
            <div className="d-flex gap-2">
              <Button
                variant="outline-primary"
                onClick={() =>
                  update({
                    phases: [
                      ...draft.phases,
                      { id: nextId('p', draft.phases), name: `Phase ${draft.phases.length + 1}` },
                    ],
                  })
                }
              >
                + Add phase
              </Button>
              <Button
                variant="outline-primary"
                disabled={!draft.phases.length}
                onClick={() => setEditing('new')}
              >
                + Add activity
              </Button>
            </div>
          )}
        </div>

        <div className="col-lg-4">
          <div className="card mb-6">
            <div className="card-body">
              <h2 className="h6">Summary</h2>
              <p className="mb-1">
                {draft.activities.length} activities in {draft.phases.length} phases
              </p>
              <p className="mb-1">
                {draft.activities.reduce((n, a) => n + a.dependsOn.length, 0)} dependencies ·{' '}
                {draft.activities.filter((a) => a.deliverable).length} deliverables
              </p>
              <p className="mb-0 text-body-secondary small">
                {draft.activities.filter((a) => a.estHours === null).length} without an estimate
              </p>
            </div>
          </div>
          <div className="card mb-6">
            <div className="card-body">
              <h2 className="h6">Versions</h2>
              <ul className="list-unstyled mb-0">
                {t.versions.map((v) => (
                  <li key={v.id} className="d-flex justify-content-between py-1">
                    {v.id === t.id ? (
                      <strong>v{v.version}</strong>
                    ) : (
                      <Link to={`/templates/${v.id}`}>v{v.version}</Link>
                    )}
                    <span className="small text-body-secondary">
                      {v.status === 'DRAFT'
                        ? 'Draft'
                        : v.superseded
                          ? `Older · ${shortDate(v.publishedAt, true)}`
                          : `${v.status === 'ARCHIVED' ? 'Archived' : 'Current'} · ${shortDate(v.publishedAt, true)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="d-grid gap-2">
            {t.status === 'PUBLISHED' &&
              !t.superseded &&
              canEdit &&
              (t.draftId ? (
                <Link className="btn btn-outline-primary" to={`/templates/${t.draftId}`}>
                  Open draft v{t.version + 1}
                </Link>
              ) : (
                <Button variant="outline-primary" onClick={() => run('new-version')}>
                  New version
                </Button>
              ))}
            {canCreate && (
              <Button variant="outline-secondary" onClick={() => run('duplicate')}>
                Duplicate
              </Button>
            )}
            {t.status === 'PUBLISHED' && !t.superseded && canEdit && (
              <Button variant="outline-secondary" onClick={() => run('archive')}>
                Archive
              </Button>
            )}
            {t.status === 'ARCHIVED' && !t.superseded && canEdit && (
              <Button variant="outline-secondary" onClick={() => run('restore')}>
                Restore
              </Button>
            )}
            {t.status === 'DRAFT' && canDelete && (
              <Button
                variant="outline-danger"
                onClick={() => {
                  if (window.confirm('Discard this draft? This cannot be undone.')) {
                    remove.mutate(t.id, { onSuccess: () => navigate('/templates') });
                  }
                }}
              >
                Discard draft
              </Button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <ActivityModal
          activity={editing === 'new' ? null : editing}
          draft={draft}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            const exists = draft.activities.some((x) => x.id === a.id);
            update({
              activities: exists
                ? draft.activities.map((x) => (x.id === a.id ? a : x))
                : [...draft.activities, a],
            });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ActivityModal({
  activity,
  draft,
  onClose,
  onSave,
}: {
  activity: TemplateActivityDto | null;
  draft: Draft;
  onClose: () => void;
  onSave: (a: TemplateActivityDto) => void;
}) {
  const initial = useMemo<TemplateActivityDto>(
    () =>
      activity ?? {
        id: nextId('a', draft.activities),
        phaseId: draft.phases[draft.phases.length - 1]!.id,
        name: '',
        taskType: null,
        priority: 'MEDIUM',
        mandatory: true,
        party: 'INTERNAL',
        defaultJobRole: null,
        defaultTeamId: null,
        estHours: null,
        offsetDays: 0,
        durationDays: 1,
        deliverable: null,
        requiresApproval: false,
        isMilestone: false,
        dependsOn: [],
      },
    [activity, draft],
  );
  const [a, setA] = useState(initial);
  const [est, setEst] = useState(initial.estHours === null ? '' : String(initial.estHours));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<TemplateActivityDto>) => setA({ ...a, ...patch });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!a.name.trim()) return setError('Activity name is required.');
    // Blank means "no estimate" and is stored as null, never 0 (EC-58).
    const estHours = est.trim() === '' ? null : Number(est);
    if (estHours !== null && (!Number.isFinite(estHours) || estHours < 0)) {
      return setError('Estimated hours must be a number of 0 or more, or blank.');
    }
    onSave({ ...a, name: a.name.trim(), estHours });
  };

  return (
    <Modal show onHide={onClose} centered size="lg">
      <Form onSubmit={submit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title as="h2" className="h5">
            {activity ? 'Edit activity' : 'Add activity'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="row g-3">
            <Form.Group className="col-md-8" controlId="act-name">
              <Form.Label>Activity name</Form.Label>
              <Form.Control
                value={a.name}
                onChange={(e) => set({ name: e.target.value })}
                autoFocus
              />
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-phase">
              <Form.Label>Phase</Form.Label>
              <Form.Select value={a.phaseId} onChange={(e) => set({ phaseId: e.target.value })}>
                {draft.phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-party">
              <Form.Label>Party</Form.Label>
              <Form.Select
                value={a.party}
                onChange={(e) => set({ party: e.target.value as TemplateActivityDto['party'] })}
              >
                {PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {PARTY_LABELS[p]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-priority">
              <Form.Label>Priority</Form.Label>
              <Form.Select
                value={a.priority}
                onChange={(e) =>
                  set({ priority: e.target.value as TemplateActivityDto['priority'] })
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-role">
              <Form.Label>Default role</Form.Label>
              <Form.Select
                value={a.defaultJobRole ?? ''}
                onChange={(e) =>
                  set({
                    defaultJobRole: (e.target.value ||
                      null) as TemplateActivityDto['defaultJobRole'],
                  })
                }
              >
                <option value="">None</option>
                {JOB_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {JOB_ROLE_LABELS[r]}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-est">
              <Form.Label>Estimated hours</Form.Label>
              <Form.Control
                inputMode="decimal"
                value={est}
                placeholder="–"
                aria-describedby="act-est-hint"
                onChange={(e) => setEst(e.target.value)}
              />
              <Form.Text id="act-est-hint">
                Leave blank for {NO_ESTIMATE_LABEL.toLowerCase()}.
              </Form.Text>
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-offset">
              <Form.Label>Starts on working day</Form.Label>
              <Form.Control
                type="number"
                min={0}
                value={a.offsetDays}
                onChange={(e) => set({ offsetDays: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Form.Group>
            <Form.Group className="col-md-4" controlId="act-duration">
              <Form.Label>Duration (working days)</Form.Label>
              <Form.Control
                type="number"
                min={0}
                value={a.durationDays}
                onChange={(e) => set({ durationDays: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Form.Group>
            <Form.Group className="col-12" controlId="act-deliverable">
              <Form.Label>Deliverable</Form.Label>
              <Form.Control
                value={a.deliverable ?? ''}
                onChange={(e) => set({ deliverable: e.target.value || null })}
              />
            </Form.Group>
            <Form.Group className="col-12" controlId="act-deps">
              <Form.Label>Depends on</Form.Label>
              <Form.Select
                multiple
                value={a.dependsOn}
                onChange={(e) =>
                  set({ dependsOn: Array.from(e.target.selectedOptions).map((o) => o.value) })
                }
              >
                {draft.activities
                  .filter((x) => x.id !== a.id)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      #{draft.activities.indexOf(x) + 1} {x.name}
                    </option>
                  ))}
              </Form.Select>
            </Form.Group>
            <div className="col-12 d-flex flex-wrap gap-4">
              <Form.Check
                id="act-mandatory"
                label="Mandatory"
                checked={a.mandatory}
                onChange={(e) => set({ mandatory: e.target.checked })}
              />
              <Form.Check
                id="act-approval"
                label="Needs approval"
                checked={a.requiresApproval}
                onChange={(e) => set({ requiresApproval: e.target.checked })}
              />
              <Form.Check
                id="act-milestone"
                label="Milestone"
                checked={a.isMilestone}
                onChange={(e) => set({ isMilestone: e.target.checked })}
              />
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">{activity ? 'Save activity' : 'Add activity'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
