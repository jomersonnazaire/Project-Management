import { teamSchema, type TeamDto } from '@xc8/shared';
import { useState } from 'react';
import { Button, Form, InputGroup, Modal } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { useArchiveTeam, useSaveTeam, useTeams } from '../../api/hooks';
import { ActiveBadge } from '../../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';

function TeamNameForm({
  initial = '',
  onSave,
  submitLabel,
  id,
}: {
  initial?: string;
  onSave: (name: string) => Promise<void>;
  submitLabel: string;
  id: string;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = teamSchema.safeParse({ name });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid name.');
    setBusy(true);
    setError(null);
    try {
      await onSave(parsed.data.name);
      setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the team.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Form noValidate onSubmit={(e) => void submit(e)}>
      <Form.Label htmlFor={id}>Team name</Form.Label>
      <InputGroup hasValidation>
        <Form.Control
          id={id}
          value={name}
          onChange={(e) => setName(e.target.value)}
          isInvalid={!!error}
        />
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
      </InputGroup>
    </Form>
  );
}

/** Teams (FR-USR-04, AC-03.1). */
export function TeamsPanel() {
  const [showArchived, setShowArchived] = useState(false);
  const teams = useTeams(showArchived);
  const save = useSaveTeam();
  const archive = useArchiveTeam();
  const [renaming, setRenaming] = useState<TeamDto | null>(null);

  return (
    <div className="row g-6">
      <div className="col-xxl-8">
        <div className="card">
          <div className="card-body">
            <Form.Check
              type="switch"
              id="show-archived"
              label="Show archived teams"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="mb-3"
            />
            <ErrorAlert error={teams.error ?? archive.error} />
            {teams.isPending ? (
              <LoadingRows />
            ) : teams.data?.items.length === 0 ? (
              <EmptyState icon="bx-group" title="No teams yet">
                Create teams such as Consulting, Development, Support, QA and Technical.
              </EmptyState>
            ) : (
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">Active members</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.data?.items.map((t) => (
                      <tr key={t.id}>
                        <td className="text-heading">{t.name}</td>
                        <td>{t.memberCount}</td>
                        <td>
                          {t.archived ? (
                            <span className="badge bg-label-secondary text-uppercase">
                              Archived
                            </span>
                          ) : (
                            <ActiveBadge active />
                          )}
                        </td>
                        <td className="text-end text-nowrap">
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            className="me-2"
                            onClick={() => setRenaming(t)}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            onClick={() => archive.mutate({ id: t.id, archive: !t.archived })}
                          >
                            {t.archived ? 'Unarchive' : 'Archive'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="col-xxl-4">
        <div className="card">
          <div className="card-body">
            <h5 className="mb-4">New team</h5>
            <TeamNameForm
              id="new-team"
              submitLabel="Add"
              onSave={async (name) => void (await save.mutateAsync({ name }))}
            />
            <p className="form-text mt-3 mb-0">
              A user can belong to several teams. Archived teams are hidden from pickers.
            </p>
          </div>
        </div>
      </div>
      {renaming && (
        <Modal show onHide={() => setRenaming(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title as="h5">Rename {renaming.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <TeamNameForm
              id="rename-team"
              initial={renaming.name}
              submitLabel="Save"
              onSave={async (name) => {
                await save.mutateAsync({ id: renaming.id, name });
                setRenaming(null);
              }}
            />
          </Modal.Body>
        </Modal>
      )}
    </div>
  );
}
