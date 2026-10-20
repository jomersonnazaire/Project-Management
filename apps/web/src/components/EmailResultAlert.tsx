import { ACTION_EMAIL_NOT_LINKED } from '@xc8/shared';
import { Alert } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';

const ERRORS: Record<string, string> = {
  admin_consent_required:
    'Email not sent: your organization must approve OpsTrack sending mail for you (admin consent).',
  consent_declined: 'Email not sent: you cancelled or declined the Microsoft prompt.',
  wrong_account: 'Email not sent: sign in with the Microsoft account linked to OpsTrack.',
  send_forbidden: 'Email not sent: Microsoft refused to send from your mailbox.',
  no_mailbox: 'Email not sent: your Microsoft account has no Outlook mailbox.',
  already_emailed: 'This follow-up was already emailed.',
  no_recipients: 'Email not sent: there was nobody to email.',
  microsoft_not_linked: `Email not sent. ${ACTION_EMAIL_NOT_LINKED}`,
  email_disabled: 'Email not sent: emails are switched off.',
};

/** Result of an action email after the Microsoft round trip (`?email=` / `?email_error=`). */
export function EmailResultAlert() {
  const [params, setParams] = useSearchParams();
  const ok = params.get('email');
  const error = params.get('email_error');
  if (!ok && !error) return null;
  const dismiss = () => {
    const next = new URLSearchParams(params);
    next.delete('email');
    next.delete('email_error');
    setParams(next, { replace: true });
  };
  return (
    <Alert
      variant={error ? 'warning' : 'success'}
      dismissible
      onClose={dismiss}
      role="status"
      data-testid="email-result"
    >
      {error
        ? (ERRORS[error] ?? 'Email not sent. The change itself was saved.')
        : ok === 'partial'
          ? 'Email sent to some people; the others are in the audit log.'
          : 'Email sent from your Outlook.'}
    </Alert>
  );
}
