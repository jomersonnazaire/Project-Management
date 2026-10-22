import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DAR_EXPORT_NAME,
  DAR_NOTIFIED,
  DAR_NOTIFY_RECENT,
  DAR_PASSWORD_ONLY,
  DAR_SEND_RATE_LIMITED,
  DAR_TOO_LARGE,
  type DarReportDto,
  type SavedReportSummaryDto,
} from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { DarSendStatus } from '../api/darHooks';
import { api, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** DAR Send web states (doc 14 §N, §11; PR #29 QA D2, D3, D5, D7). */
afterEach(() => vi.unstubAllGlobals());

const report: DarReportDto = {
  user: { id: 'u1', name: 'Maria Member' },
  supervisor: { id: 'u9', name: 'Supervisor Sam' },
  cc: [],
  from: '2026-10-13',
  to: '2026-10-13',
  shownTo: '2026-10-13',
  generatedAt: '2026-10-13T09:00:00.000Z',
  exportName: DAR_EXPORT_NAME,
  totalActivities: 1,
  totalMinutes: 60,
  totalRendered: '01:00',
  rows: [],
  days: [],
  runningExcluded: 0,
};

const item: SavedReportSummaryDto = {
  id: 's1',
  savedAt: '2026-10-13T09:10:00.000Z',
  from: '2026-10-13',
  to: '2026-10-13',
  totalActivities: 1,
  totalMinutes: 60,
  totalRendered: '01:00',
  tag: null,
  changedDates: [],
  sentAt: null,
  sentBy: null,
  sentRecipientCount: null,
};

const SAM = { name: 'Supervisor Sam', email: 'sup@xceler8.example' };
const linked: DarSendStatus = {
  enabled: true,
  reason: null,
  canNotify: false,
  to: SAM,
  cc: ['cc@xceler8.example'],
};
const passwordOnly: DarSendStatus = {
  enabled: false,
  reason: 'not_linked',
  canNotify: true,
  to: SAM,
  cc: [],
};

function savedRoutes(status: DarSendStatus, extra: Route = () => undefined): Route {
  return (url, init) =>
    extra(url, init) ??
    (url.includes('/dar/send-status')
      ? { status: 200, body: status }
      : url.includes('/dar/saved/s1')
        ? { status: 200, body: { item: { ...item, report } } }
        : url.includes('/dar/saved')
          ? { status: 200, body: { items: [item] } }
          : undefined);
}

async function openSaved() {
  const rows = await screen.findAllByRole('row');
  await userEvent.click(within(rows[1]!).getByRole('button', { name: 'View' }));
  return screen.findByRole('dialog');
}

describe('password-only users (AC-57.4, FR-DAR-24, §11)', () => {
  it('see Export and Notify supervisor with the §11 text, and no Send button', async () => {
    let notifies = 0;
    const fetch = api(
      'MEMBER',
      savedRoutes(passwordOnly, (url, init) => {
        if (url.endsWith('/dar/saved/s1/notify-supervisor') && init?.method === 'POST') {
          notifies += 1;
          return notifies === 1
            ? { status: 200, body: { notified: 1 } }
            : {
                status: 409,
                body: { error: { code: 'NOTIFY_RECENT', message: 'raw server text' } },
              };
        }
        return undefined;
      }),
    );
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    expect(await within(dialog).findByTestId('dar-password-only')).toHaveTextContent(
      DAR_PASSWORD_ONLY,
    );
    expect(within(dialog).queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/coming with Microsoft sign-in/i)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Export PDF' })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Notify supervisor' }));
    expect(await screen.findByText('Notify Supervisor Sam?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(await within(dialog).findByText(DAR_NOTIFIED)).toBeInTheDocument();
    const post = fetch.mock.calls.find(([u]) => String(u).endsWith('/notify-supervisor'));
    expect(JSON.parse(String(post![1]!.body))).toEqual({});

    // D7: a second notice within the hour gets the friendly message.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Notify supervisor' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Notify' }));
    expect(await within(dialog).findByText(DAR_NOTIFY_RECENT)).toBeInTheDocument();
    expect(within(dialog).queryByText('raw server text')).not.toBeInTheDocument();
  });

  it('with no supervisor: no Notify button, and they are told to ask an Admin', async () => {
    api('MEMBER', savedRoutes({ ...passwordOnly, canNotify: false, to: null }));
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    const note = await within(dialog).findByTestId('dar-password-only');
    expect(note).toHaveTextContent(DAR_PASSWORD_ONLY);
    expect(note).toHaveTextContent('Ask an Admin to set your supervisor.');
    expect(
      within(dialog).queryByRole('button', { name: 'Notify supervisor' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /send/i })).not.toBeInTheDocument();
  });

  it('the report page shows the §11 text instead of a "coming soon" note', async () => {
    api('MEMBER', (url) =>
      url.includes('/dar/send-status')
        ? { status: 200, body: passwordOnly }
        : /\/dar(\?|$)/.test(url)
          ? { status: 200, body: { report } }
          : undefined,
    );
    renderAt('/dar?from=2026-10-13&to=2026-10-13', <App />);
    expect(await screen.findByTestId('dar-send-note')).toHaveTextContent(DAR_PASSWORD_ONLY);
    expect(screen.queryByText(/coming with Microsoft sign-in/i)).not.toBeInTheDocument();
  });
});

describe('Microsoft-linked users', () => {
  it('no supervisor: Send is disabled with the hint', async () => {
    api(
      'MEMBER',
      savedRoutes({ enabled: false, reason: 'no_supervisor', canNotify: false, to: null, cc: [] }),
    );
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    expect(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    ).toBeDisabled();
    expect(within(dialog).getByText('Ask an Admin to set your supervisor.')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Notify supervisor' }),
    ).not.toBeInTheDocument();
  });

  it('D5: a 429 from Send shows a friendly message, not raw JSON, and does not navigate', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api(
      'MEMBER',
      savedRoutes(linked, (url, init) =>
        url.endsWith('/dar/saved/s1/send') && init?.method === 'POST'
          ? {
              status: 429,
              body: { error: { code: 'DAR_SEND_RATE_LIMITED', message: '{"raw":true}' } },
            }
          : undefined,
      ),
    );
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByText(DAR_SEND_RATE_LIMITED)).toBeInTheDocument();
    expect(within(dialog).queryByText(/raw/)).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('cancelling the confirm sends nothing', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = api('MEMBER', savedRoutes(linked));
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    );
    expect(
      await screen.findByText(/To: Supervisor Sam · CC: cc@xceler8.example/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/send'))).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('return from Microsoft (?sent= and ?send_error=)', () => {
  it('?sent= shows "Report sent to {supervisor} and n CC."', async () => {
    api('MEMBER', savedRoutes(linked));
    const { router } = renderAt('/dar/saved?sent=s1', <App />);
    expect(await screen.findByText('Report sent to Supervisor Sam and 1 CC.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByText('Report sent to Supervisor Sam and 1 CC.')).toBeInTheDocument();
  });

  it.each([
    ['no_mailbox', 'This Microsoft account has no mailbox. Use Export instead.'],
    [
      'consent_declined',
      "You didn't allow OpsTrack to send email as you, so nothing was sent. Press Send again and choose Accept, or export the report.",
    ],
    [
      'admin_consent_required',
      'Your organisation needs an administrator to approve OpsTrack sending email for you. Ask your IT admin to approve it, then press Send again. You can export the report meanwhile.',
    ],
    ['wrong_account', 'Pick the same Microsoft account you use for OpsTrack.'],
    ['too_large', DAR_TOO_LARGE],
    [
      'graph_unavailable',
      "We couldn't send your report: graph unavailable. Try again, or export it and send it yourself.",
    ],
  ])('?send_error=%s shows its message', async (reason, text) => {
    api('MEMBER', savedRoutes(linked));
    const { router } = renderAt(`/dar/saved?send_error=${reason}`, <App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    // The URL is cleaned, and the message stays.
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
});
