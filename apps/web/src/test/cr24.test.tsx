import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CONVERSATION_POLL_MS,
  MENTION_LIMIT_MESSAGE,
  PROJECT_POLL_MS,
  pollInterval,
  unreadLabel,
  type MessageDto,
  type NotificationDto,
  type SystemRole,
} from '@xc8/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { failuresInARow, usePoll } from '../api/poll';
import { MENTION_LIMIT_PICKER, MentionInput } from '../components/MentionInput';
import { withTokens, type PickedMention } from '../lib/mentions';
import { PID, api, project, task, type Route } from './m2fixtures';
import { renderAt } from './utils';

/** CR-24: auto refresh, Conversation unread pill, divider, @mentions (UIE CR24 v0.9.22, 96c3915). */
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

const hex = (n: number) => n.toString(16).padStart(24, 'a');
const MARIA = { id: hex(2), name: 'Maria Member', active: true };
const DEV = { id: hex(3), name: 'Dev Two', active: true };
const FORMER = { id: hex(9), name: 'Former Tester', active: false };

const msg = (over: Partial<MessageDto>): MessageDto => ({
  id: 'm1',
  text: 'Hello',
  type: 'NOTE',
  author: { id: MARIA.id, name: MARIA.name, active: true },
  at: '2026-11-12T01:30:00.000Z',
  task: null,
  contacts: [],
  hidden: null,
  mentions: [],
  ...over,
});

function projectApi(
  role: SystemRole,
  opts: {
    unread?: number;
    messages?: () => MessageDto[];
    lastReadAt?: string | null;
    extra?: Route;
  } = {},
) {
  return api(role, (url, init) => {
    const r = opts.extra?.(url, init);
    if (r) return r;
    if (url.includes('/messages/seen')) return { status: 200, body: { unread: 0 } };
    if (url.includes('/messages') && init?.method === 'POST')
      return { status: 201, body: { message: msg({ id: 'new' }) } };
    if (url.includes('/messages'))
      return {
        status: 200,
        body: {
          items: opts.messages?.() ?? [],
          can: { post: role !== 'VIEWER', hide: false },
          lastReadAt: opts.lastReadAt ?? null,
        },
      };
    if (url.includes(`/projects/${PID}/tasks`)) return { status: 200, body: { items: [task()] } };
    if (url.endsWith(`/projects/${PID}`))
      return {
        status: 200,
        body: {
          project: project({ conversationUnread: opts.unread ?? 0, members: [MARIA, DEV, FORMER] }),
        },
      };
    return undefined;
  });
}

describe('CR-24 FR-ARF-01..07: polling options (in-scope screens only)', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const state = (over: Record<string, unknown> = {}) =>
    ({
      state: {
        status: 'success',
        dataUpdatedAt: 2,
        errorUpdatedAt: 0,
        errorUpdateCount: 0,
        ...over,
      },
    }) as never;

  it('10 s / 30 s intervals with focus refetch, none in background; off when offline', () => {
    expect([CONVERSATION_POLL_MS, PROJECT_POLL_MS]).toEqual([10_000, 30_000]);
    const { result } = renderHook(() => usePoll(CONVERSATION_POLL_MS), { wrapper });
    expect(result.current).toMatchObject({
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      staleTime: 0,
    });
    const every = result.current.refetchInterval!;
    expect(every(state())).toBe(10_000);
    onlineManager.setOnline(false);
    expect(every(state())).toBe(false);
    // Not opted in: nothing (the app-wide defaults apply).
    expect(renderHook(() => usePoll(false), { wrapper }).result.current).toEqual({});
  });

  it('FR-ARF-07: backs off after failures in a row, at most 60 s, and resets after a success', () => {
    expect([1, 2, 3, 9].map((n) => pollInterval(10_000, n))).toEqual([
      20_000, 40_000, 60_000, 60_000,
    ]);
    const q = state({ status: 'error', dataUpdatedAt: 1, errorUpdatedAt: 5, errorUpdateCount: 2 });
    expect(failuresInARow(q)).toBe(2);
    const { result } = renderHook(() => usePoll(PROJECT_POLL_MS), { wrapper });
    expect(result.current.refetchInterval!(q)).toBe(60_000);
  });

  it('Q-182: no timed check while a save from this browser is in flight', async () => {
    const qc = new QueryClient();
    let finish = () => {};
    const { result } = renderHook(() => ({ poll: usePoll(CONVERSATION_POLL_MS) }), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    act(() => {
      void qc
        .getMutationCache()
        .build(qc, { mutationFn: () => new Promise<void>((r) => (finish = r)) })
        .execute(undefined);
    });
    await waitFor(() => expect(result.current.poll.refetchInterval!(state())).toBe(false));
    await act(async () => finish());
    await waitFor(() => expect(result.current.poll.refetchInterval!(state())).toBe(10_000));
  });

  it('AC-79.7: the app-wide defaults in main.tsx are unchanged', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    expect(main).toContain('staleTime: 30_000');
    expect(main).toContain('refetchOnWindowFocus: false');
    expect(main).not.toContain('refetchInterval');
  });
});

describe('CR-24 FR-CNV-09 / Q-171: the unread pill', () => {
  it('shows the server count on the Conversation tab, 99+ above 99, nothing at 0', async () => {
    expect([unreadLabel(5), unreadLabel(99), unreadLabel(100)]).toEqual(['5', '99', '99+']);
    projectApi('PROJECT_MANAGER', { unread: 120 });
    renderAt(`/projects/${PID}`, <App />);
    const tab = await screen.findByRole('link', { name: 'Conversation, 120 unread' });
    expect(within(tab).getByText('99+')).toHaveClass('unread-count');
  });

  it('is hidden at 0', async () => {
    projectApi('PROJECT_MANAGER', { unread: 0 });
    renderAt(`/projects/${PID}`, <App />);
    const tab = await screen.findByRole('link', { name: 'Conversation' });
    expect(tab.querySelector('.unread-count')).toBeNull();
  });

  it('project row: a pill links to the Conversation; first load makes no counts or thread request', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url) =>
      url.includes('/projects?')
        ? {
            status: 200,
            body: {
              items: [
                project({ conversationUnread: 4 }),
                project({ id: hex(7), name: 'Quiet one', conversationUnread: 0 }),
              ],
              page: 1,
              pageSize: 100,
              total: 2,
              counts: { ALL: 2 },
            },
          }
        : undefined,
    );
    renderAt('/projects', <App />);
    const pill = await screen.findByRole('link', { name: 'SAP B1 Rollout Conversation, 4 unread' });
    expect(pill).toHaveAttribute('href', `/projects/${PID}/conversation`);
    expect(within(pill).getByText('4')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Quiet one Conversation/ })).toBeNull();
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/conversation-unread'))).toBe(false);
    expect(urls.some((u) => u.includes('/messages'))).toBe(false);
  });

  it('FR-ARF-08: the focus check asks for counts only, one batch for the listed projects', async () => {
    const fetchMock = api('PROJECT_MANAGER', (url) =>
      url.includes('/conversation-unread')
        ? { status: 200, body: { counts: { [PID]: 7 } } }
        : url.includes('/projects?')
          ? {
              status: 200,
              body: {
                items: [project({ conversationUnread: 1 })],
                page: 1,
                pageSize: 100,
                total: 1,
                counts: {},
              },
            }
          : undefined,
    );
    renderAt('/projects', <App />);
    await screen.findByRole('link', { name: 'SAP B1 Rollout Conversation, 1 unread' });
    // 30 s later the counts are stale, so the focus check runs.
    const later = Date.now() + PROJECT_POLL_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(
      await screen.findByRole('link', { name: 'SAP B1 Rollout Conversation, 7 unread' }),
    ).toBeInTheDocument();
    const counts = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/conversation-unread'));
    expect(counts.length).toBeGreaterThan(0);
    expect(counts[0]).toContain(`ids=${PID}`);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/messages'))).toBe(false);
    focusManager.setFocused(undefined);
  });
});

describe('CR-24 Conversation: divider, last-read, mentions', () => {
  it('"New messages" sits before the first newer message by someone else; opening posts seen up to the newest', async () => {
    const fetchMock = projectApi('PROJECT_MANAGER', {
      lastReadAt: '2026-11-12T02:00:00.000Z',
      messages: () => [
        msg({ id: 'a', text: 'Old one', at: '2026-11-12T01:00:00.000Z' }),
        msg({ id: 'b', text: 'Fresh one', at: '2026-11-12T03:00:00.000Z' }),
        msg({ id: 'c', text: 'Fresher', at: '2026-11-12T04:00:00.000Z' }),
      ],
    });
    renderAt(`/projects/${PID}/conversation`, <App />);
    const sep = await screen.findByRole('separator', {
      name: 'New messages since you last opened this Conversation',
    });
    expect(sep.nextElementSibling).toHaveTextContent('Fresh one');
    await waitFor(() => {
      const seen = fetchMock.mock.calls.find(([u]) => String(u).includes('/messages/seen'));
      expect(JSON.parse(String(seen?.[1]?.body))).toEqual({ at: '2026-11-12T04:00:00.000Z' });
    });
  });

  it('L-3: tokens show the current name; you are a solid chip; a deactivated person is a muted, unfocusable chip', async () => {
    projectApi('PROJECT_MANAGER', {
      messages: () => [
        msg({
          author: { id: hex(8), name: 'Someone', active: true },
          text: `Hi <@${hex(1)}> and <@${DEV.id}>, ask <@${FORMER.id}> or <@${hex(4)}>, not <@${hex(5)}>`,
          mentions: [
            { id: hex(1), name: 'Renamed Me', active: true, chip: true },
            { id: DEV.id, name: DEV.name, active: true, chip: true },
            { id: FORMER.id, name: FORMER.name, active: false, chip: true },
            { id: hex(4), name: 'Outside Person', active: true, chip: false },
          ],
        }),
      ],
    });
    renderAt(`/projects/${PID}/conversation`, <App />);
    const dev = await screen.findByText('@Dev Two');
    expect(dev).toHaveClass('mention');
    const off = screen.getByText('Former Tester (deactivated)').closest('.mention')!;
    expect(off).toHaveClass('off');
    expect(off.tagName).toBe('SPAN');
    expect(off).not.toHaveAttribute('tabindex');
    expect(screen.getByText('@Renamed Me')).toBeInTheDocument();
    // (d) not on the team: plain text, no chip. (e) no such user: grey "Unknown user" chip.
    expect(screen.getByText('@Outside Person')).not.toHaveClass('mention');
    const unknown = screen.getByText('Unknown user');
    expect(unknown).toHaveClass('mention', 'off');
    expect(unknown).not.toHaveAttribute('tabindex');
  });

  it('picking a member from @ inserts the name, shows who gets notified and posts a <@id> token', async () => {
    const fetchMock = projectApi('PROJECT_MANAGER');
    const user = userEvent.setup();
    renderAt(`/projects/${PID}/conversation`, <App />);
    const box = await screen.findByRole('combobox', { name: 'Message' });
    await user.type(box, 'Ping @ma');
    const list = screen.getByRole('listbox', { name: 'Project members' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['MMMaria MemberMember']);
    // Deactivated people are never offered.
    await user.clear(box);
    await user.type(box, '@');
    expect(within(screen.getByRole('listbox')).queryByText('Former Tester')).toBeNull();
    await user.type(box, 'ma');
    await user.keyboard('{Enter}please check');
    expect(box).toHaveValue('@Maria Member please check');
    expect(screen.getByTestId('mention-hint')).toHaveTextContent(
      'Notifies Maria Member in the bell.',
    );
    await user.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/messages') && i?.method === 'POST',
      );
      expect(JSON.parse(String(call?.[1]?.body)).text).toBe(`<@${MARIA.id}> please check`);
    });
    expect(
      await screen.findByText('Posted. Maria Member gets a bell notification.'),
    ).toBeInTheDocument();
  });

  it('Esc closes the list and keeps the text; no match says only team members can be mentioned', async () => {
    projectApi('PROJECT_MANAGER');
    const user = userEvent.setup();
    renderAt(`/projects/${PID}/conversation`, <App />);
    const box = await screen.findByRole('combobox', { name: 'Message' });
    await user.type(box, '@zz');
    expect(screen.getByTestId('mention-picker')).toHaveTextContent(
      "No project member matches @zz. Only people on this project's team can be mentioned.",
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('mention-picker')).toBeNull();
    expect(box).toHaveValue('@zz');
  });

  it('L-4: the server refusal is the inline error and the draft is kept', async () => {
    projectApi('PROJECT_MANAGER', {
      extra: (url, init) =>
        url.endsWith('/messages') && init?.method === 'POST'
          ? {
              status: 422,
              body: {
                error: { code: 'MENTION_LIMIT', message: MENTION_LIMIT_MESSAGE },
                requestId: 'r',
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderAt(`/projects/${PID}/conversation`, <App />);
    const box = await screen.findByRole('combobox', { name: 'Message' });
    await user.type(box, 'Too many');
    await user.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can mention up to 10 people.');
    expect(box).toHaveValue('Too many');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.type(box, '!');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FR-ARF-06: a refresh that brings new messages keeps the draft and its mention', async () => {
    let list = [msg({ id: 'a', text: 'First' })];
    projectApi('PROJECT_MANAGER', { messages: () => list });
    const user = userEvent.setup();
    renderAt(`/projects/${PID}/conversation`, <App />);
    const box = await screen.findByRole('combobox', { name: 'Message' });
    await user.type(box, 'Draft for @ma{Enter}');
    list = [...list, msg({ id: 'b', text: 'Arrived meanwhile', at: '2026-11-12T05:00:00.000Z' })];
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByText('Arrived meanwhile')).toBeInTheDocument();
    expect(box).toHaveValue('Draft for @Maria Member ');
    expect(screen.getByTestId('mention-hint')).toHaveTextContent(
      'Notifies Maria Member in the bell.',
    );
    focusManager.setFocused(undefined);
  });
});

describe('CR-24 L-4: the picker stops at 10 people', () => {
  function Harness({ picked }: { picked: PickedMention[] }) {
    const [text, setText] = useState(picked.map((p) => `@${p.name}`).join(' ') + ' ');
    const [p, setP] = useState(picked);
    return (
      <MentionInput
        label="Message"
        value={text}
        picked={p}
        people={[{ id: hex(50), name: 'Eleventh Person', role: 'Member' }]}
        error={null}
        onChange={(t, next) => {
          setText(t);
          setP(next);
        }}
      />
    );
  }
  it('at 10 distinct people, @ shows the limit note instead of names; repeats count once', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ id: hex(100 + i), name: `Person ${i}` }));
    const user = userEvent.setup();
    render(<Harness picked={[...ten, ten[0]!]} />);
    const box = screen.getByRole('combobox', { name: 'Message' });
    await user.click(box);
    await user.keyboard('{End}@');
    expect(screen.getByTestId('mention-picker')).toHaveTextContent(MENTION_LIMIT_PICKER);
    expect(screen.queryByRole('option')).toBeNull();
    // Nine people: names again.
    const nine = ten.slice(0, 9);
    expect(withTokens(`@${nine[0]!.name} x`, nine)).toBe(`<@${nine[0]!.id}> x`);
  });
});

describe('CR-24 FR-NTF-14 / L-2: the bell row', () => {
  it('"{Name} mentioned you in {project}", the stored excerpt, and it opens the Conversation at the message', async () => {
    const n: NotificationDto = {
      id: 'n1',
      type: 'CONVERSATION_MENTION',
      actor: { id: DEV.id, name: 'Test PM' },
      task: null,
      issue: null,
      project: { id: PID, name: 'Acme Test Co Rollout' },
      message: null,
      link: `/projects/${PID}/conversation?message=m1`,
      messageId: 'm1',
      excerpt: '@Dev One can you confirm the cutover window?',
      read: false,
      at: new Date().toISOString(),
    };
    projectApi('PROJECT_MANAGER', {
      extra: (url) =>
        url.endsWith('/notifications')
          ? { status: 200, body: { items: [n], unread: 1 } }
          : url.includes('/notifications/unread-count')
            ? { status: 200, body: { unread: 1 } }
            : undefined,
      messages: () => [msg({ id: 'm1', text: 'Target message' })],
    });
    const user = userEvent.setup();
    const { router } = renderAt('/projects', <App />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    const row = await screen.findByText('mentioned you in', { exact: false });
    const button = row.closest('button')!;
    expect(button).toHaveTextContent('Test P. mentioned you in Acme Test Co Rollout');
    expect(button).not.toHaveTextContent('· Acme Test Co Rollout');
    expect(within(button).getByText(n.excerpt!)).toHaveClass('notif-quote');
    await user.click(button);
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        `/projects/${PID}/conversation?message=m1`,
      ),
    );
    expect((await screen.findByText('Target message')).closest('.cnv-msg')).toHaveClass(
      'is-target',
    );
  });
});
