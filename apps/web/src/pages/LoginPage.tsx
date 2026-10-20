import { zodResolver } from '@hookform/resolvers/zod';
import {
  APP_NAME,
  loginSchema,
  type LoginInput,
  type PermissionGrid,
  type UserDto,
} from '@xc8/shared';
import { useEffect, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api, authErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthCard, safeNext } from '../components/AuthCard';

export function LoginPage() {
  const { user, setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [msEnabled, setMsEnabled] = useState(false);
  useEffect(() => {
    void api<{ microsoft: boolean }>('/auth/providers', { quiet401: true })
      .then((r) => setMsEnabled(r.microsoft))
      .catch(() => setMsEnabled(false));
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ user: UserDto; permissions?: PermissionGrid }>('/auth/login', {
        method: 'POST',
        body: values,
        quiet401: true,
      });
      setSession(res);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (e) {
      setError(authErrorMessage(e));
    }
  });

  const reason = params.get('reason');
  const msError = params.get('error') === 'ms_signin_failed';
  const msNoEmail = params.get('error') === 'ms_no_email';
  return (
    <AuthCard title="Sign in">
      <h4 className="mb-1">Sign in to {APP_NAME}</h4>
      {msNoEmail && (
        <Alert variant="danger" className="mt-3">
          Your Microsoft account has no email address. Ask an admin to check your account.
        </Alert>
      )}
      {msError && (
        <Alert variant="danger" className="mt-3">
          We couldn&apos;t sign you in with Microsoft. Try again or use your email and password, or
          contact an Admin if the problem continues.
        </Alert>
      )}
      {reason === 'expired' && (
        <Alert variant="warning" className="mt-3">
          Your session expired after 30 minutes of inactivity. Please sign in again.
        </Alert>
      )}
      {reason === 'signedout' && (
        <Alert variant="warning" className="mt-3">
          You were signed out. Please sign in again.
        </Alert>
      )}
      <Form noValidate onSubmit={(e) => void onSubmit(e)} className="mt-4">
        <Form.Group className="mb-4" controlId="email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            autoComplete="username"
            autoFocus
            isInvalid={!!errors.email}
            {...register('email')}
          />
          <Form.Control.Feedback type="invalid">{errors.email?.message}</Form.Control.Feedback>
        </Form.Group>
        <Form.Group className="mb-2" controlId="password">
          <Form.Label>Password</Form.Label>
          <Form.Control
            type="password"
            autoComplete="current-password"
            isInvalid={!!errors.password}
            {...register('password')}
          />
          <Form.Control.Feedback type="invalid">{errors.password?.message}</Form.Control.Feedback>
        </Form.Group>
        <div
          role="alert"
          aria-live="assertive"
          className="text-danger small mb-3"
          style={{ minHeight: '1.25rem' }}
        >
          {error}
        </div>
        <Button type="submit" className="w-100" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </Form>
      {msEnabled && (
        <div className="mt-3">
          <a href="/api/auth/microsoft/login" className="btn btn-outline-secondary w-100">
            Sign in with Microsoft
          </a>
        </div>
      )}
      <p className="small text-body-secondary text-center mt-3 mb-1">
        You&apos;ll land on your Dashboard.
      </p>
      <p className="small text-body-secondary text-center mb-3">
        Forgot your password? Ask an {APP_NAME} Admin for a reset link.
      </p>
      <p className="small text-body-secondary mb-0">
        Only invited Xceler8 staff can sign in to {APP_NAME}. Client contacts don&apos;t have
        accounts.
      </p>
    </AuthCard>
  );
}
