import { END_AFTER_START, TEMPLATE_TYPE_LABELS, plural, todayUtc, toDateOnly } from '@xc8/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, saveErrorMessage } from '../../api/client';
import { useClients } from '../../api/hooks';
import { useCreateProject, usePeople, useTemplates } from '../../api/projectHooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorAlert, LoadingRows } from '../../components/Feedback';
import { HandoverModal } from '../../components/HandoverModal';
import { PageHeader } from '../../components/PageHeader';

const MANAGER_ROLES = new Set(['ADMIN', 'PROJECT_MANAGER']);

/** New project from a published template (FR-PRJ-01..04, AC-09.*). */
export function NewProjectPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const clients = useClients();
  const templates = useTemplates({ status: 'PUBLISHED' });
  const people = usePeople();
  const create = useCreateProject();

  const [name, setName] = useState('');
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [templateId, setTemplateId] = useState(params.get('templateId') ?? '');
  const [managerId, setManagerId] = useState(
    user && MANAGER_ROLES.has(user.systemRole) ? user.id : '',
  );
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(toDateOnly(todayUtc()));
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmHandover, setConfirmHandover] = useState(false);

  const activeClients = (clients.data?.items ?? []).filter((c) => c.active);
  const template = templates.data?.items.find((t) => t.id === templateId);
  const managers = (people.data ?? []).filter((p) => MANAGER_ROLES.has(p.systemRole));
  const serverErrors = create.error instanceof ApiError ? create.error.fieldErrors() : {};
  const fieldError = (k: string) => errors[k] ?? serverErrors[k];

  const preview = useMemo(
    () =>
      template
        ? `Generates ${plural(template.activityCount, 'activity', 'activities')}, ${plural(template.dependencyCount, 'dependency', 'dependencies')} and ${plural(template.deliverableCount, 'deliverable')}.`
        : null,
    [template],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Project name is required.';
    if (!clientId) next.clientId = 'Choose a client.';
    if (!templateId) next.templateId = 'Choose a template.';
    if (!managerId) next.managerId = 'Choose a project manager.';
    if (!startDate) next.startDate = 'Baseline start is required.';
    if (!plannedEndDate) next.plannedEndDate = 'Baseline end is required.';
    else if (startDate && plannedEndDate <= startDate) next.plannedEndDate = END_AFTER_START;
    setErrors(next);
    if (Object.keys(next).length) return;
    // A PM creating a project for another manager hands it over: confirm first (doc 11 §12).
    if (user?.systemRole === 'PROJECT_MANAGER' && managerId !== user.id) {
      setConfirmHandover(true);
      return;
    }
    send();
  };

  const send = () => {
    setConfirmHandover(false);
    create.mutate(
      {
        name: name.trim(),
        clientId,
        templateId,
        templateVersion: template?.version,
        managerId,
        memberIds: memberIds.filter((m) => m !== managerId),
        startDate,
        plannedEndDate,
        description: description.trim() || null,
      },
      {
        onSuccess: (res) =>
          navigate(`/projects/${res.project.id}`, { state: { warnings: res.warnings } }),
        onError: (err) => {
          // A newer version was published while the form was open (EC-11): show the latest.
          if (err instanceof ApiError && err.code === 'TEMPLATE_CHANGED') void templates.refetch();
        },
      },
    );
  };

  if (clients.isPending || templates.isPending || people.isPending) {
    return (
      <>
        <PageHeader title="New project" />
        <LoadingRows rows={5} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="New project" />
      {confirmHandover && (
        <HandoverModal
          name={managers.find((m) => m.id === managerId)?.name ?? 'the new manager'}
          pending={create.isPending}
          onCancel={() => setConfirmHandover(false)}
          onConfirm={send}
        />
      )}
      <Link to="/projects" className="d-inline-block mb-4">
        ‹ All projects
      </Link>
      <div className="card" style={{ maxWidth: 820 }}>
        <div className="card-body">
          <ErrorAlert error={clients.error || templates.error || people.error} />
          {create.error && !Object.keys(serverErrors).length && (
            <Alert variant="danger">
              {saveErrorMessage(create.error, 'Could not create the project.')}
            </Alert>
          )}
          <Form onSubmit={submit} noValidate>
            <div className="row g-4">
              <Form.Group className="col-12" controlId="prj-name">
                <Form.Label>Project name</Form.Label>
                <Form.Control
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  isInvalid={Boolean(fieldError('name'))}
                />
                <Form.Control.Feedback type="invalid">{fieldError('name')}</Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="col-md-6" controlId="prj-client">
                <Form.Label>Client</Form.Label>
                <Form.Select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  isInvalid={Boolean(fieldError('clientId'))}
                >
                  <option value="">Choose…</option>
                  {activeClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {fieldError('clientId')}
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="col-md-6" controlId="prj-template">
                <Form.Label>Template</Form.Label>
                <Form.Select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  isInvalid={Boolean(fieldError('templateId'))}
                  aria-describedby="prj-template-preview"
                >
                  <option value="">Choose…</option>
                  {(templates.data?.items ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · v{t.version} ({TEMPLATE_TYPE_LABELS[t.type]})
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {fieldError('templateId')}
                </Form.Control.Feedback>
                {preview && (
                  <Form.Text
                    id="prj-template-preview"
                    className="d-block"
                    data-testid="template-preview"
                  >
                    {preview}
                  </Form.Text>
                )}
              </Form.Group>
              <Form.Group className="col-md-6" controlId="prj-start">
                <Form.Label>Baseline start</Form.Label>
                <Form.Control
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  isInvalid={Boolean(fieldError('startDate'))}
                />
                <Form.Control.Feedback type="invalid">
                  {fieldError('startDate')}
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="col-md-6" controlId="prj-end">
                <Form.Label>Baseline end</Form.Label>
                <Form.Control
                  type="date"
                  value={plannedEndDate}
                  onChange={(e) => setPlannedEndDate(e.target.value)}
                  isInvalid={Boolean(fieldError('plannedEndDate'))}
                />
                <Form.Control.Feedback type="invalid">
                  {fieldError('plannedEndDate')}
                </Form.Control.Feedback>
              </Form.Group>
              <Form.Group className="col-md-6" controlId="prj-manager">
                <Form.Label>Project manager</Form.Label>
                <Form.Select
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                  isInvalid={Boolean(fieldError('managerId'))}
                >
                  <option value="">Choose…</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {fieldError('managerId')}
                </Form.Control.Feedback>
              </Form.Group>
              <fieldset className="col-md-6">
                <legend className="form-label fs-6">Team members</legend>
                <div className="border rounded p-2" style={{ maxHeight: 180, overflowY: 'auto' }}>
                  {(people.data ?? [])
                    .filter((p) => p.id !== managerId)
                    .map((p) => (
                      <Form.Check
                        key={p.id}
                        id={`prj-member-${p.id}`}
                        label={p.name}
                        checked={memberIds.includes(p.id)}
                        onChange={(e) =>
                          setMemberIds(
                            e.target.checked
                              ? [...memberIds, p.id]
                              : memberIds.filter((x) => x !== p.id),
                          )
                        }
                      />
                    ))}
                </div>
                <Form.Text>The project manager is always on the team.</Form.Text>
              </fieldset>
              <Form.Group className="col-12" controlId="prj-desc">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Form.Group>
            </div>
            <div className="d-flex gap-2 mt-6">
              <Button type="submit" disabled={create.isPending}>
                Create project
              </Button>
              <Button variant="outline-secondary" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </Form>
        </div>
      </div>
    </>
  );
}
