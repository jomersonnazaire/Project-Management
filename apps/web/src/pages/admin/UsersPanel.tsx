import { zodResolver } from '@hookform/resolvers/zod';
import {
  JOB_ROLES,
  JOB_ROLE_LABELS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_LABELS,
  inviteUserSchema,
  updateUserSchema,
  type InviteResultDto,
  type TeamDto,
  type UserDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Button, Dropdown, Form, Modal } from 'react-bootstrap';
import { Controller, useForm, type Control } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError } from '../../api/client';
import {
  useInviteUser,
  useReissueLink,
  useTeams,
  useUpdateUser,
  useUserAction,
  useUsers,
} from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { UserStatusBadge } from '../../components/Badges';
import { EmptyState, ErrorAlert, LoadingRows } from '../../components/Feedback';
import { CopyLinkField } from '../../components/CopyLinkField';
import { hoursUntil } from '../../components/linkExpiry';
import { InviteLinkModal } from '../../components/InviteLinkModal';
import { TopbarActions } from '../../components/PageHeader';

type InviteIn = z.input<typeof inviteUserSchema>;
type InviteOut = z.output<typeof inviteUserSchema>;

function TeamChecklist({
  teams,
  value,
  onChange,
  idPrefix,
}: {
  teams: TeamDto[];
  value: string[];
  onChange: (v: string[]) => void;
  idPrefix: string;
}) {
  if (!teams.length)
    return <p className="form-text mb-0">No teams yet. Create teams in the Teams tab.</p>;
  return (
    <div className="d-flex flex-wrap gap-x-4 column-gap-4">
      {teams.map((t) => (
        <Form.Check
          key={t.id}
          id={`${idPrefix}-${t.id}`}
          type="checkbox"
          label={t.name}
          checked={value.includes(t.id)}
          onChange={(e) =>
            onChange(e.target.checked ? [...value, t.id] : value.filter((v) => v !== t.id))
          }
        />
      ))}
    </div>
  );
}

function RoleSelects({
  control,
  disableAccess,
  errors,
  idPrefix,
}: {
  control: Control<InviteIn>;
  disableAccess?: boolean;
  errors: Partial<Record<'systemRole' | 'jobRole', { message?: string }>>;
  idPrefix: string;
}) {
  return (
    <>
      <Form.Group className="mb-3" controlId={`${idPrefix}-access`}>
        <Form.Label>Access role * (what they can do)</Form.Label>
        <Controller
          control={control}
          name="systemRole"
          render={({ field }) => (
            <Form.Select {...field} disabled={disableAccess} isInvalid={!!errors.systemRole}>
              <option value="">Choose…</option>
              {SYSTEM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {SYSTEM_ROLE_LABELS[r]}
                </option>
              ))}
            </Form.Select>
          )}
        />
        {disableAccess && <Form.Text>You can&apos;t change your own access role.</Form.Text>}
        <Form.Control.Feedback type="invalid">{errors.systemRole?.message}</Form.Control.Feedback>
      </Form.Group>
      <Form.Group className="mb-3" controlId={`${idPrefix}-job`}>
        <Form.Label>Job role * (what they do)</Form.Label>
        <Controller
          control={control}
          name="jobRole"
          render={({ field }) => (
            <Form.Select {...field} isInvalid={!!errors.jobRole}>
              <option value="">Choose…</option>
              {JOB_ROLES.map((r) => (
                <option key={r} value={r}>
                  {JOB_ROLE_LABELS[r]}
                </option>
              ))}
            </Form.Select>
          )}
        />
        <Form.Control.Feedback type="invalid">{errors.jobRole?.message}</Form.Control.Feedback>
      </Form.Group>
    </>
  );
}

/** Invite form in a modal opened from "+ Invite user" in the top bar (DR-01, mockup v0.4.2). */
function InviteUserModal({ teams, onClose }: { teams: TeamDto[]; onClose: () => void }) {
  const invite = useInviteUser();
  const [created, setCreated] = useState<InviteResultDto | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteIn, unknown, InviteOut>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      name: '',
      email: '',
      systemRole: '' as never,
      jobRole: '' as never,
      teamIds: [],
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await invite.mutateAsync(values);
      reset();
      setCreated(res);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_IN_USE')
        setError('email', { message: e.message });
      else if (e instanceof ApiError) {
        const fields = e.fieldErrors();
        if (Object.keys(fields).length) {
          for (const [k, m] of Object.entries(fields))
            setError(k as keyof InviteIn, { message: m });
        } else setError('root', { message: e.message });
      }
    }
  });

  return (
    <Modal show onHide={onClose} centered aria-labelledby="invite-title">
      <Modal.Header closeButton>
        <Modal.Title as="h5" id="invite-title">
          Invite user
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form noValidate onSubmit={(e) => void onSubmit(e)} aria-labelledby="invite-title">
          <Form.Group className="mb-3" controlId="invite-name">
            <Form.Label>Full name *</Form.Label>
            <Form.Control {...register('name')} isInvalid={!!errors.name} />
            <Form.Control.Feedback type="invalid">{errors.name?.message}</Form.Control.Feedback>
          </Form.Group>
          <Form.Group className="mb-3" controlId="invite-email">
            <Form.Label>Email *</Form.Label>
            <Form.Control type="email" {...register('email')} isInvalid={!!errors.email} />
            <Form.Control.Feedback type="invalid">{errors.email?.message}</Form.Control.Feedback>
          </Form.Group>
          <RoleSelects control={control} errors={errors} idPrefix="invite" />
          <fieldset className="mb-4">
            <legend className="form-label fs-6">Teams</legend>
            <Controller
              control={control}
              name="teamIds"
              render={({ field }) => (
                <TeamChecklist
                  teams={teams}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  idPrefix="invite-team"
                />
              )}
            />
          </fieldset>
          {errors.root && <div className="text-danger small mb-2">{errors.root.message}</div>}
          <Button type="submit" className="w-100" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create invite link'}
          </Button>
          {created ? (
            <div className="mt-4">
              <CopyLinkField
                id="invite-link"
                label={`Invite link for ${created.user.name} (single use, expires in ${hoursUntil(created.inviteExpiresAt)} hours, share it yourself)`}
                url={created.inviteUrl}
              />
            </div>
          ) : (
            <p className="form-text mt-2 mb-0">
              You&apos;ll get a single-use invite link to share yourself; the person sets their own
              password.
            </p>
          )}
        </Form>
      </Modal.Body>
    </Modal>
  );
}

/** Team names joined as "Management, Consulting"; each name keeps its comma when wrapping (DR-04). */
export function TeamNames({ names }: { names: string[] }) {
  if (!names.length) return <>–</>;
  // One wrapper element: in the stacked phone layout the cell is a flex row (DR-03).
  return (
    <span>
      {names.map((n, i) => (
        <span key={`${n}-${i}`} className="text-nowrap">
          {n}
          {i < names.length - 1 ? ', ' : ''}
        </span>
      ))}
    </span>
  );
}

/**
 * Row action for invite/reset links. Between 768px and 1400px (sidebar visible, narrower
 * content) it shrinks to an icon so the actions column stays visible (DR-01).
 */
function LinkButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline-secondary"
      className="me-2"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <i className="bx bx-link d-none d-md-inline d-xxl-none" aria-hidden="true" />
      <span className="d-md-none d-xxl-inline">{label}</span>
    </Button>
  );
}

type EditOut = z.output<typeof updateUserSchema>;

function EditUserModal({
  user,
  teams,
  isSelf,
  onClose,
}: {
  user: UserDto;
  teams: TeamDto[];
  isSelf: boolean;
  onClose: () => void;
}) {
  const update = useUpdateUser();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<InviteIn>({
    defaultValues: {
      name: user.name,
      email: user.email,
      systemRole: user.systemRole,
      jobRole: user.jobRole,
      teamIds: user.teamIds,
      weeklyCapacityHours: user.weeklyCapacityHours,
    },
  });
  const [error, setError] = useState<unknown>(null);

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const body: EditOut = {
      name: v.name,
      jobRole: v.jobRole,
      teamIds: v.teamIds ?? [],
      weeklyCapacityHours: Number(v.weeklyCapacityHours),
      ...(isSelf ? {} : { systemRole: v.systemRole }),
    };
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      setError(
        new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input.'),
      );
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, body: parsed.data });
      onClose();
    } catch (e) {
      setError(e);
    }
  });

  return (
    <Modal show onHide={onClose} centered>
      <Form noValidate onSubmit={(e) => void onSubmit(e)}>
        <Modal.Header closeButton>
          <Modal.Title as="h5">Edit {user.name}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <ErrorAlert error={error} />
          <Form.Group className="mb-3" controlId="edit-name">
            <Form.Label>Full name *</Form.Label>
            <Form.Control {...register('name', { required: true })} isInvalid={!!errors.name} />
          </Form.Group>
          <Form.Group className="mb-3" controlId="edit-email">
            <Form.Label>Email</Form.Label>
            <Form.Control value={user.email} readOnly plaintext />
          </Form.Group>
          <RoleSelects control={control} errors={errors} disableAccess={isSelf} idPrefix="edit" />
          <fieldset className="mb-3">
            <legend className="form-label fs-6">Teams</legend>
            <Controller
              control={control}
              name="teamIds"
              render={({ field }) => (
                <TeamChecklist
                  teams={teams}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  idPrefix="edit-team"
                />
              )}
            />
          </fieldset>
          <Form.Group controlId="edit-capacity">
            <Form.Label>Weekly capacity (hours)</Form.Label>
            <Form.Control
              type="number"
              min={0}
              max={80}
              step={0.5}
              {...register('weeklyCapacityHours')}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Save
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export function UsersPanel() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const users = useUsers({ q: q || undefined, status: status || undefined });
  const teams = useTeams();
  const action = useUserAction();
  const reissue = useReissueLink();
  const [link, setLink] = useState<{ result: InviteResultDto; autoCopied: boolean } | null>(null);
  const issueLink = async (id: string) => {
    const result = await reissue.mutateAsync(id);
    let autoCopied = false;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      autoCopied = true;
    } catch {
      // Clipboard unavailable (e.g. permissions); the modal's Copy button still works.
    }
    setLink({ result, autoCopied });
  };
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [confirm, setConfirm] = useState<UserDto | null>(null);
  const [inviting, setInviting] = useState(false);
  const teamName = new Map((teams.data?.items ?? []).map((t) => [t.id, t.name]));

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setInviting(true)}>
          + Invite user
        </Button>
      </TopbarActions>
      <div className="card">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-3 mb-4">
            <Form.Control
              type="search"
              placeholder="Search name or email…"
              aria-label="Search users"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <Form.Select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ maxWidth: 200 }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INVITED">Invited</option>
              <option value="DEACTIVATED">Deactivated</option>
            </Form.Select>
          </div>
          <ErrorAlert error={users.error ?? action.error ?? reissue.error} />
          {users.isPending ? (
            <LoadingRows rows={4} />
          ) : users.data && users.data.items.length === 0 ? (
            <EmptyState icon="bx-user" title="No users match">
              Try clearing the search or status filter.
            </EmptyState>
          ) : (
            <div className="table-responsive">
              {/* Below 768px each row renders as a stacked card (DR-03, see main.scss). */}
              <table className="table table-stack-md users-table">
                <thead>
                  <tr>
                    <th scope="col">Name / email</th>
                    <th scope="col">Access</th>
                    <th scope="col">Job role</th>
                    <th scope="col">Teams</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.items.map((u) => (
                    <tr key={u.id}>
                      <td className="cell-primary">
                        <div className="text-heading">
                          {u.name}
                          {u.id === me?.id && <span className="text-body-secondary"> (you)</span>}
                        </div>
                        <small className="text-body-secondary text-break">{u.email}</small>
                      </td>
                      <td data-label="Access">{SYSTEM_ROLE_LABELS[u.systemRole]}</td>
                      <td data-label="Job role">{JOB_ROLE_LABELS[u.jobRole]}</td>
                      <td data-label="Teams">
                        <TeamNames
                          names={u.teamIds
                            .map((t) => teamName.get(t))
                            .filter((n): n is string => !!n)}
                        />
                      </td>
                      <td data-label="Status">
                        <UserStatusBadge status={u.status} />
                      </td>
                      <td className="cell-actions text-end text-nowrap">
                        {u.active && (
                          <LinkButton
                            label={u.status === 'INVITED' ? 'New invite link' : 'Copy reset link'}
                            disabled={reissue.isPending}
                            onClick={() => void issueLink(u.id)}
                          />
                        )}
                        <Dropdown align="end" className="d-inline-block">
                          <Dropdown.Toggle
                            variant="link"
                            size="sm"
                            className="hide-arrow p-0"
                            aria-label={`Actions for ${u.name}`}
                          >
                            <i className="bx bx-dots-vertical-rounded fs-5" aria-hidden="true" />
                          </Dropdown.Toggle>
                          <Dropdown.Menu>
                            <Dropdown.Item as="button" onClick={() => setEditing(u)}>
                              Edit
                            </Dropdown.Item>
                            {u.id !== me?.id &&
                              (u.active ? (
                                <Dropdown.Item
                                  as="button"
                                  className="text-danger"
                                  onClick={() => setConfirm(u)}
                                >
                                  Deactivate
                                </Dropdown.Item>
                              ) : (
                                <Dropdown.Item
                                  as="button"
                                  onClick={() => action.mutate({ id: u.id, action: 'reactivate' })}
                                >
                                  Reactivate
                                </Dropdown.Item>
                              ))}
                          </Dropdown.Menu>
                        </Dropdown>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small text-body-secondary mt-3 mb-0">
            Client contacts are managed under Clients and never appear here, because they don&apos;t
            have accounts. Reset links are single use and expire in 24 hours. Creating a new link
            cancels any earlier unused one.
          </p>
        </div>
      </div>

      {inviting && (
        <InviteUserModal teams={teams.data?.items ?? []} onClose={() => setInviting(false)} />
      )}

      <InviteLinkModal
        result={link?.result ?? null}
        autoCopied={link?.autoCopied}
        onClose={() => setLink(null)}
      />
      {editing && (
        <EditUserModal
          user={editing}
          teams={teams.data?.items ?? []}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
        />
      )}
      {confirm && (
        <Modal show onHide={() => setConfirm(null)} centered>
          <Modal.Header closeButton>
            <Modal.Title as="h5">Deactivate {confirm.name}?</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            They will be signed out and can&apos;t sign in. Their tasks and time entries are kept
            and shown as &quot;(inactive)&quot;. You can reactivate them later.
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline-secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                action.mutate({ id: confirm.id, action: 'deactivate' });
                setConfirm(null);
              }}
            >
              Deactivate
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </>
  );
}
