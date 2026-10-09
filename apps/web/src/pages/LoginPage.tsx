import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput, type UserDto } from '@xc8/shared';
import { useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AuthCard, safeNext } from '../components/AuthCard';
import { BrandLogo } from '../components/BrandLogo';

export function LoginPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [showForgot, setShowForgot] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={safeNext(params.get('next'))} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<{ user: UserDto }>('/auth/login', {
        method: 'POST',
        body: values,
        quiet401: true,
      });
      setUser(res.user);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  });

  const reason = params.get('reason');
  return (
    <AuthCard>
      <div className="app-brand justify-content-center mb-4">
        <BrandLogo />
      </div>
      <h4 className="mb-1">Sign in</h4>
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
      <p className="text-center mt-3 mb-2">
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowForgot((v) => !v)}
          aria-expanded={showForgot}
        >
          Forgot password?
        </Button>
      </p>
      {showForgot && (
        <p className="small text-body-secondary">
          Ask your administrator for a password reset link. (Email reset links arrive in a later
          release.)
        </p>
      )}
      <p className="small text-body-secondary mb-0">
        Only invited Xceler8 staff can sign in. Client contacts don&apos;t have accounts.
      </p>
    </AuthCard>
  );
}
