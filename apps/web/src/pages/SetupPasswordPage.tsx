import { useQuery } from '@tanstack/react-query';
import {
  APP_NAME,
  checkPassword,
  isPasswordValid,
  type InviteInfoDto,
  type PermissionGrid,
  type UserDto,
} from '@xc8/shared';
import { useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, RATE_LIMITED_MESSAGE, api, authErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LoadingRows } from '../components/Feedback';
import { AuthCard } from '../components/AuthCard';

/**
 * Links carry the token in the URL fragment (`/setup-password#token=…`), which browsers never
 * send to a server. The API only ever receives it in a POST body (FR-AUTH-04/05).
 */
function readToken(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '';
}

/** First-time password setup (and admin-issued reset) via one-time link (FR-AUTH-04). */
export function SetupPasswordPage() {
  const [token] = useState(readToken);
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<InviteInfoDto>('/auth/invite/verify', { method: 'POST', body: { token } }),
    enabled: token.length > 0,
    retry: false,
  });

  const checks = checkPassword(password);
  const mismatch = touched && confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!isPasswordValid(password) || password !== confirm) return;
    setSaving(true);
    try {
      const res = await api<{ user: UserDto; permissions?: PermissionGrid }>(
        '/auth/setup-password',
        {
          method: 'POST',
          body: { token, password },
        },
      );
      // Remove the token from the address bar/history.
      window.history.replaceState(null, '', '/setup-password');
      setSession(res);
      navigate('/my-tasks', { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (info.error instanceof ApiError && info.error.status === 429) {
    return (
      <AuthCard>
        <h4 className="mb-2">Please wait</h4>
        <Alert variant="danger" className="py-2 small">
          {RATE_LIMITED_MESSAGE}
        </Alert>
        <Link to="/login">Back to sign in</Link>
      </AuthCard>
    );
  }

  if (!token || info.isError) {
    return (
      <AuthCard>
        <h4 className="mb-2">Link not valid</h4>
        <p>
          {info.error instanceof ApiError
            ? info.error.message
            : 'This link has expired. Ask an Admin for a new one.'}
        </p>
        <Link to="/login">Back to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={info.data?.purpose === 'RESET' ? 'Choose a new password' : 'Set your password'}
    >
      <h4 className="mb-1">
        {info.data?.purpose === 'RESET' ? 'Choose a new password' : 'Set your password'}
      </h4>
      {info.isPending ? (
        <LoadingRows rows={2} />
      ) : (
        <p className="small text-body-secondary">
          Welcome to {APP_NAME}, {info.data.name}.
          {info.data.invitedByName && info.data.purpose === 'INVITE'
            ? ` You were invited by ${info.data.invitedByName}.`
            : ''}{' '}
          <span className="d-block">{info.data.email}</span>
        </p>
      )}
      <Form noValidate onSubmit={(e) => void submit(e)}>
        <input
          type="email"
          hidden
          readOnly
          autoComplete="username"
          value={info.data?.email ?? ''}
        />
        <Form.Group className="mb-2" controlId="new-password">
          <Form.Label>New password</Form.Label>
          <Form.Control
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            isInvalid={touched && !isPasswordValid(password)}
            aria-describedby="password-rules"
          />
        </Form.Group>
        <ul
          id="password-rules"
          className="list-inline small password-checks mb-3"
          aria-live="polite"
        >
          {checks.map((c) => (
            <li key={c.id} className={`list-inline-item ${c.ok ? 'ok' : 'missing'}`}>
              <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}
              <span className="visually-hidden">{c.ok ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
        <Form.Group className="mb-2" controlId="confirm-password">
          <Form.Label>Confirm password</Form.Label>
          <Form.Control
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setTouched(true)}
            isInvalid={mismatch}
          />
          <Form.Control.Feedback type="invalid">Passwords don&apos;t match.</Form.Control.Feedback>
        </Form.Group>
        {error && (
          <Alert variant="danger" className="py-2 small">
            {error}
          </Alert>
        )}
        <Button type="submit" className="w-100 mt-2" disabled={saving || info.isPending}>
          {saving ? 'Saving…' : 'Set password & continue'}
        </Button>
      </Form>
    </AuthCard>
  );
}
