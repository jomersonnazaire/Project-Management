import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DAR_EXPORT_NAME,
  DAR_NOTIFIED,
  DAR_NOTIFY_RECENT,
  DAR_PASSWORD_ONLY,
  DAR_SEND_RATE_LIMITED,
  DAR_SEND_UNCONFIRMED,
  DAR_STATUS_UNCONFIRMED,
  DAR_TOO_LARGE,
  darResendConfirmMessage,
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
  sendUnknownAt: null,
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

const isSendPost = (url: string, init?: RequestInit) =>
  url.endsWith('/dar/saved/s1/send') && init?.method === 'POST';
const microsoftUrl: Route = (url, init) =>
  isSendPost(url, init)
    ? { status: 200, body: { url: 'https://login.microsoftonline.com/mock' } }
    : undefined;
/** Holds POST /send open until the returned function is called. */
function holdSend(fetch: ReturnType<typeof api>) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const orig = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    if (isSendPost(String(input), init)) await gate;
    return orig(input, init);
  });
  return () => release();
}

describe('return from Microsoft (?sent= and ?send_error=)', () => {
  const RESULT = {
    sentAt: '2026-10-13T09:20:00.000Z',
    from: '2026-10-13',
    to: '2026-10-13',
    recipient: { name: 'Supervisor Sam', email: 'sup@xceler8.example' },
    cc: [
      { name: 'Cee One', email: 'cc1@xceler8.example' },
      { name: 'Cee Two', email: 'cc2@xceler8.example' },
    ],
  };
  const withResult = (status: DarSendStatus, result: unknown = RESULT) =>
    savedRoutes(status, (url) =>
      url.endsWith('/dar/saved/s1/send-result') ? { status: 200, body: { result } } : undefined,
    );

  it('?sent= names the recipients the send returned (not today’s supervisor), role=status', async () => {
    // Today's supervisor differs from who the report was sent to.
    api(
      'MEMBER',
      withResult({ ...linked, to: { name: 'New Boss', email: 'boss@xceler8.example' }, cc: [] }),
    );
    const { router } = renderAt('/dar/saved?sent=s1', <App />);
    const banner = await screen.findByTestId('dar-send-sent');
    const text =
      'Report for Oct 13, 2026 sent to Supervisor Sam (sup@xceler8.example). CC: Cee One, Cee Two.';
    expect(banner).toHaveTextContent(text);
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveAttribute('tabindex', '-1');
    await waitFor(() => expect(banner).toHaveFocus());
    expect(banner).not.toHaveTextContent('New Boss');
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByTestId('dar-send-sent')).toHaveTextContent(text);
  });

  it('?sent= with no CC leaves the CC part out; a range shows both dates', async () => {
    api('MEMBER', withResult(linked, { ...RESULT, from: '2026-10-13', to: '2026-10-17', cc: [] }));
    renderAt('/dar/saved?sent=s1', <App />);
    expect(await screen.findByTestId('dar-send-sent')).toHaveTextContent(
      /^Report for Oct 13 to Oct 17, 2026 sent to Supervisor Sam \(sup@xceler8\.example\)\.$/,
    );
  });

  it.each([
    ['ms_auth_failed', 'Microsoft sign-in failed, so nothing was sent. Try again.'],
    [
      'send_forbidden',
      "Your Microsoft account isn't allowed to send email from OpsTrack. Ask your Admin to allow it.",
    ],
    ['bad_recipient', "Your supervisor's email address isn't valid. Ask your Admin to check it."],
    ['graph_unavailable', "Microsoft isn't responding right now. Try again in a few minutes."],
    ['not_found', "We couldn't find this saved report. Refresh the page and try again."],
    ['not_enabled', "Sending reports isn't turned on. Export the report and send it yourself."],
    ['no_mailbox', 'This Microsoft account has no mailbox. Use Export instead.'],
    [
      'consent_declined',
      "You didn't allow OpsTrack to send email as you. Press Send again and choose Accept, or export the report.",
    ],
    [
      'admin_consent_required',
      'Your organization needs an administrator to approve OpsTrack sending email for you. Ask your IT admin to approve it, then press Send again. You can export the report meanwhile.',
    ],
    ['wrong_account', 'Pick the same Microsoft account you use for OpsTrack.'],
    ['too_large', DAR_TOO_LARGE],
    ['send_failed', 'Something went wrong. Try again, or export the report and send it yourself.'],
    [
      'some_new_code',
      'Something went wrong. Try again, or export the report and send it yourself.',
    ],
  ])('?send_error=%s: "Your report wasn\'t sent." + its line, role=alert', async (reason, line) => {
    api('MEMBER', savedRoutes(linked));
    const { router } = renderAt(`/dar/saved?send_error=${reason}&report=s1`, <App />);
    const banner = await screen.findByRole('alert');
    const text = `Your report wasn't sent. ${line}`;
    expect(banner).toHaveTextContent(text);
    expect(banner).not.toHaveTextContent(reason);
    // The URL is cleaned, and the message stays.
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('failure banner shows the report’s range and Retry; Retry says "Opening Microsoft…" while it runs', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = api('MEMBER', savedRoutes(linked, microsoftUrl));
    const release = holdSend(fetch);
    renderAt('/dar/saved?send_error=graph_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-failed');
    expect(await within(banner).findByTestId('dar-send-failed-range')).toHaveTextContent(
      'Report: Oct 13, 2026',
    );
    await userEvent.click(await within(banner).findByRole('button', { name: 'Retry' }));
    // Retry opens the same To, CC and attachment confirm as "Send to supervisor" first.
    expect(
      await screen.findByText(
        "To: Supervisor Sam · CC: cc@xceler8.example (Set by Admin). It's sent from your Microsoft 365 mailbox with the PDF attached. The first time, Microsoft may ask you to allow this.",
      ),
    ).toBeInTheDocument();
    expect(fetch.mock.calls.some(([u, i]) => isSendPost(String(u), i))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const busy = await within(banner).findByRole('button', { name: 'Opening Microsoft…' });
    expect(busy).toBeDisabled();
    release();
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/mock'),
    );
    const posts = fetch.mock.calls.filter(([u]) => String(u).endsWith('/dar/saved/s1/send'));
    expect(posts).toHaveLength(1);
  });

  it('a failed Retry shows the reason (never a raw code) and offers Retry again', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api(
      'MEMBER',
      savedRoutes(linked, (url, init) =>
        url.endsWith('/dar/saved/s1/send') && init?.method === 'POST'
          ? {
              status: 409,
              body: {
                error: {
                  code: 'SEND_UNAVAILABLE',
                  message: 'not_enabled',
                  details: { reason: 'not_enabled' },
                },
              },
            }
          : undefined,
      ),
    );
    renderAt('/dar/saved?send_error=graph_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-failed');
    await userEvent.click(await within(banner).findByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText(
        "Your report wasn't sent. Sending reports isn't turned on. Export the report and send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('not_enabled')).not.toBeInTheDocument();
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('without a report id there is no Retry (older links), and the dates say unavailable', async () => {
    api('MEMBER', savedRoutes(linked));
    renderAt('/dar/saved?send_error=send_forbidden', <App />);
    const banner = await screen.findByTestId('dar-send-failed');
    expect(within(banner).queryByRole('button')).not.toBeInTheDocument();
    expect(within(banner).getByTestId('dar-send-failed-range')).toHaveTextContent(
      /^Report dates unavailable$/,
    );
  });

  it('if the report dates can\'t load, the banner says "Report dates unavailable"', async () => {
    api(
      'MEMBER',
      savedRoutes(linked, (url) =>
        /\/dar\/saved\/s1(\?|$)/.test(url)
          ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } }
          : undefined,
      ),
    );
    renderAt('/dar/saved?send_error=graph_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-failed');
    expect(await within(banner).findByTestId('dar-send-failed-range')).toHaveTextContent(
      /^Report dates unavailable$/,
    );
  });

  it('on load, keyboard focus moves to the failure banner', async () => {
    api('MEMBER', savedRoutes(linked));
    renderAt('/dar/saved?send_error=graph_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-failed');
    await waitFor(() => expect(banner).toHaveFocus());
  });

  it('the modal Send button says "Opening Microsoft…" and is disabled while starting', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const release = holdSend(api('MEMBER', savedRoutes(linked, microsoftUrl)));
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(
      await within(dialog).findByRole('button', { name: 'Opening Microsoft…' }),
    ).toBeDisabled();
    release();
    await waitFor(() => expect(assign).toHaveBeenCalled());
  });
});

describe('unconfirmed send (Graph timeout) and the re-send confirm', () => {
  const LAST_ATTEMPT = '2026-10-13T09:20:00.000Z';
  const SENT_CONFIRM =
    'Already sent on Oct 13, 2026, 5:20 PM: report for Oct 13, 2026. Send it again?';
  const UNKNOWN_CONFIRM =
    "We couldn't confirm your last send of the report for Oct 13, 2026 on Oct 13, 2026, 5:20 PM. Microsoft may already have sent it, so check your Outlook Sent Items. Send it again anyway?";
  const resend409 = (state: 'sent' | 'unknown') => ({
    status: 409,
    body: {
      error: {
        code: 'ALREADY_SENT_OR_UNKNOWN',
        message: darResendConfirmMessage(state, LAST_ATTEMPT, {
          from: '2026-10-13',
          to: '2026-10-13',
        }),
        details: { state, lastAttemptAt: LAST_ATTEMPT },
      },
    },
  });
  const sendPosts = (fetch: ReturnType<typeof api>) =>
    fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/dar/saved/s1/send') && i?.method === 'POST',
    );

  it('?send_error=result_unavailable is a warning to check Sent Items, not a failure', async () => {
    api('MEMBER', savedRoutes(linked));
    const { router } = renderAt('/dar/saved?send_error=result_unavailable', <App />);
    expect(await screen.findByTestId('dar-send-unknown')).toHaveTextContent(DAR_SEND_UNCONFIRMED);
    expect(screen.getByTestId('dar-send-unknown')).toHaveClass('alert-warning');
    expect(screen.getByTestId('dar-send-unknown')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't send your report/)).not.toBeInTheDocument();
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByTestId('dar-send-unknown')).toBeInTheDocument();
  });

  it('a report whose last send is unknown shows "Not confirmed"', async () => {
    api(
      'MEMBER',
      savedRoutes(linked, (url) =>
        url.includes('/dar/saved') && !url.includes('/dar/saved/s1')
          ? {
              status: 200,
              body: { items: [{ ...item, sendUnknownAt: '2026-10-13T09:20:00.000Z' }] },
            }
          : undefined,
      ),
    );
    renderAt('/dar/saved', <App />);
    expect(await screen.findByText(DAR_STATUS_UNCONFIRMED)).toBeInTheDocument();
    expect(screen.getByText(DAR_STATUS_UNCONFIRMED)).toHaveAttribute('title', DAR_SEND_UNCONFIRMED);
  });

  it('409 ALREADY_SENT_OR_UNKNOWN asks again; "Send again" retries with confirmResend: true', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    let posts = 0;
    const fetch = api(
      'MEMBER',
      savedRoutes(linked, (url, init) => {
        if (url.endsWith('/dar/saved/s1/send') && init?.method === 'POST') {
          posts += 1;
          return posts === 1
            ? resend409('unknown')
            : { status: 200, body: { url: 'https://login.microsoftonline.com/mock' } };
        }
        return undefined;
      }),
    );
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(UNKNOWN_CONFIRM)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/mock'),
    );
    const bodies = sendPosts(fetch).map(([, i]) => JSON.parse(String(i!.body)));
    expect(bodies).toEqual([{}, { confirmResend: true }]);
  });

  it('cancelling the re-send confirm sends nothing more', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = api(
      'MEMBER',
      savedRoutes(linked, (url, init) =>
        url.endsWith('/dar/saved/s1/send') && init?.method === 'POST'
          ? resend409('sent')
          : undefined,
      ),
    );
    renderAt('/dar/saved', <App />);
    const dialog = await openSaved();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Send to supervisor' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(SENT_CONFIRM)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(SENT_CONFIRM)).not.toBeInTheDocument());
    expect(sendPosts(fetch)).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('the unknown banner shows "Report: {range}" and takes focus on load', async () => {
    api('MEMBER', savedRoutes(linked));
    renderAt('/dar/saved?send_error=result_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-unknown');
    expect(await within(banner).findByTestId('dar-send-unknown-range')).toHaveTextContent(
      /^Report: Oct 13, 2026$/,
    );
    await waitFor(() => expect(banner).toHaveFocus());
  });

  it('Retry after an unknown result: To/CC confirm, then the "couldn\'t confirm" confirm, never straight to Microsoft', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = api(
      'MEMBER',
      savedRoutes(linked, (url, init) => {
        if (!(url.endsWith('/dar/saved/s1/send') && init?.method === 'POST')) return undefined;
        const body = JSON.parse(String(init.body)) as { confirmResend?: boolean };
        return body.confirmResend
          ? { status: 200, body: { url: 'https://login.microsoftonline.com/mock' } }
          : resend409('unknown');
      }),
    );
    renderAt('/dar/saved?send_error=result_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-unknown');
    await userEvent.click(await within(banner).findByRole('button', { name: 'Retry' }));
    expect(
      await screen.findByText(/^To: Supervisor Sam · CC: cc@xceler8\.example/),
    ).toBeInTheDocument();
    expect(sendPosts(fetch)).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(UNKNOWN_CONFIRM)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://login.microsoftonline.com/mock'),
    );
    expect(sendPosts(fetch).map(([, i]) => JSON.parse(String(i!.body)))).toEqual([
      {},
      { confirmResend: true },
    ]);
  });

  it('Retry after an unknown result: cancelling either confirm sends nothing more', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fetch = api(
      'MEMBER',
      savedRoutes(linked, (url, init) =>
        url.endsWith('/dar/saved/s1/send') && init?.method === 'POST'
          ? resend409('unknown')
          : undefined,
      ),
    );
    renderAt('/dar/saved?send_error=result_unavailable&report=s1', <App />);
    const banner = await screen.findByTestId('dar-send-unknown');
    await userEvent.click(await within(banner).findByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(sendPosts(fetch)).toHaveLength(0);
    await userEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByText(UNKNOWN_CONFIRM)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(UNKNOWN_CONFIRM)).not.toBeInTheDocument());
    expect(sendPosts(fetch)).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
