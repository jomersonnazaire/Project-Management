import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DAR_EXPORT_NAME, type DarReportDto, type SavedReportSummaryDto } from '@xc8/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { DarSendStatus } from '../api/darHooks';
import { api } from './m2fixtures';
import { renderAt } from './utils';

/** Sent / Not sent status on Saved reports (Lean's AC 1, 5). */
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

const base: SavedReportSummaryDto = {
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
// 01:52 UTC is 9:52 AM in UTC+8.
const sent = {
  ...base,
  id: 's1',
  sentAt: '2026-10-21T01:52:00.000Z',
  sentBy: 'u1',
  sentRecipientCount: 2,
};
const notSent = { ...base, id: 's2', from: '2026-10-14', to: '2026-10-14' };

const status: DarSendStatus = {
  enabled: true,
  reason: null,
  canNotify: false,
  to: { name: 'Supervisor Sam', email: 'sup@xceler8.example' },
  cc: [],
};

function routes() {
  return api('MEMBER', (url) => {
    if (url.includes('/dar/send-status')) return { status: 200, body: status };
    if (url.includes('/dar/saved/s1')) return { status: 200, body: { item: { ...sent, report } } };
    if (url.includes('/dar/saved/s2'))
      return { status: 200, body: { item: { ...notSent, report } } };
    if (url.includes('/dar/saved')) {
      const items = url.includes('sent=SENT')
        ? [sent]
        : url.includes('sent=NOT_SENT')
          ? [notSent]
          : [sent, notSent];
      return { status: 200, body: { items } };
    }
    return undefined;
  });
}

describe('Saved reports: sent status', () => {
  it('shows "Sent" with the UTC+8 date, time and recipient count, or "Not sent"', async () => {
    routes();
    renderAt('/dar/saved', <App />);
    const rows = await screen.findAllByRole('row');
    expect(rows[0]).toHaveTextContent('Status');
    const s1 = within(rows[1]!).getByTestId('dar-sent-status');
    expect(s1).toHaveTextContent('Sent Oct 21, 2026 · 9:52 AM (UTC+8) · 2 recipients');
    expect(within(s1).getByText('Sent')).toHaveClass('badge', 'bg-label-success');
    const s2 = within(rows[2]!).getByTestId('dar-sent-status');
    expect(s2).toHaveTextContent(/^Not sent$/);
    expect(s2).toHaveClass('badge', 'bg-label-secondary');
  });

  it('the report view shows the same status', async () => {
    routes();
    renderAt('/dar/saved', <App />);
    const rows = await screen.findAllByRole('row');
    await userEvent.click(within(rows[1]!).getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('dar-sent-status')).toHaveTextContent(
      'Sent Oct 21, 2026 · 9:52 AM (UTC+8) · 2 recipients',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await userEvent.click(within(rows[2]!).getByRole('button', { name: 'View' }));
    const d2 = await screen.findByRole('dialog');
    expect(await within(d2).findByTestId('dar-sent-status')).toHaveTextContent('Not sent');
  });

  it('the Status filter asks the API for sent or not sent reports', async () => {
    const fetch = routes();
    renderAt('/dar/saved', <App />);
    await screen.findAllByRole('row');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'SENT');
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(2));
    expect(fetch.mock.calls.some(([u]) => String(u).includes('sent=SENT'))).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'NOT_SENT');
    await waitFor(() =>
      expect(screen.getAllByRole('row')[1]).toHaveTextContent(/Oct 14.*Not sent/),
    );
  });
});
