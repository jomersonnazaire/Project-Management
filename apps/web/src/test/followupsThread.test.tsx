import { render, screen, within } from '@testing-library/react';
import type { FollowUpDto } from '@xc8/shared';
import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_RUN_GAP_MS, followUpDayLabel, threadLayout } from '../lib/followUps';
import { avatarInitials, avatarTone } from '../lib/avatar';
import { FollowUpThread } from '../pages/projects/FollowUpThread';

/** CR-20 follow-ups as a chat thread (UI spec v0.9.19; seen state is covered in cr20.test). */
const ME = 'me';
const fu = (id: string, author: string, at: Date | string, over: Partial<FollowUpDto> = {}) => ({
  id,
  note: `Note ${id}`,
  author: { id: author, name: author === ME ? 'Me PM' : 'Maria Member' },
  contact: null,
  at: typeof at === 'string' ? at : at.toISOString(),
  emailedAt: null,
  ...over,
});
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

const show = (followUps: FollowUpDto[], newIds: string[] = []) =>
  render(<FollowUpThread taskId="k1" followUps={followUps} meId={ME} newIds={new Set(newIds)} />);

describe('Follow-ups thread (CR-20)', () => {
  it('is a list; my messages sit on the right (named You), others on the left', () => {
    show([fu('a', 'u2', minutesAgo(30)), fu('b', ME, minutesAgo(20))]);
    const list = screen.getByRole('list', { name: 'Follow-up messages' });
    expect(list).toBeInTheDocument();
    expect(within(list).getByTestId('follow-up-b')).toHaveAttribute('data-own', 'true');
    expect(screen.getByTestId('follow-up-b')).toHaveClass('own');
    expect(within(screen.getByTestId('follow-up-b')).getByText('You')).toBeInTheDocument();
    expect(screen.getByTestId('follow-up-a')).toHaveAttribute('data-own', 'false');
    expect(screen.getByTestId('follow-up-a')).toHaveClass('fu-msg');
    expect(within(screen.getByTestId('follow-up-a')).getByText('Maria Member')).toBeInTheDocument();
  });

  it('groups a run by one author: avatar and name once until a 5-minute gap', () => {
    show([
      fu('a', 'u2', minutesAgo(30)),
      fu('b', 'u2', minutesAgo(28)),
      fu('c', 'u2', minutesAgo(10)),
      fu('d', ME, minutesAgo(9)),
    ]);
    expect(screen.getByTestId('follow-up-a')).toHaveAttribute('data-run-start', 'true');
    expect(screen.getByTestId('follow-up-b')).toHaveAttribute('data-run-start', 'false');
    expect(screen.getByTestId('follow-up-c')).toHaveAttribute('data-run-start', 'true');
    expect(screen.getByTestId('follow-up-d')).toHaveAttribute('data-run-start', 'true');
    expect(screen.getByTestId('follow-up-b').querySelector('[data-testid="avatar"]')).toBeNull();
    const spacer = screen.getByTestId('follow-up-b').querySelector('.fu-av.sp');
    expect(spacer).not.toBeNull();
    expect(spacer).toHaveClass('fu-av', 'sp');
    expect(
      screen.getByTestId('follow-up-a').querySelector('[data-testid="avatar"]'),
    ).toHaveTextContent('MM');
    expect(screen.getByTestId('follow-up-b')).toHaveTextContent('Maria Member');
  });

  it('puts a day chip above each new day', () => {
    show([
      fu('a', 'u2', '2026-10-01T01:00:00Z'),
      fu('b', 'u2', '2026-10-01T01:02:00Z'),
      fu('c', 'u2', minutesAgo(1)),
    ]);
    const days = screen.getAllByTestId('follow-ups-day').map((d) => d.textContent);
    expect(days).toEqual(['Oct 1', 'Today']);
    expect(screen.getAllByTestId('follow-ups-day')[0]!.nextElementSibling).toBe(
      screen.getByTestId('follow-up-a'),
    );
  });

  it('labels a previous calendar day as Yesterday on the day chip', () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    y.setHours(15, 0, 0, 0);
    show([fu('y', 'u2', y), fu('t', 'u2', minutesAgo(1))]);
    expect(screen.getAllByTestId('follow-ups-day').map((d) => d.textContent)).toEqual([
      'Yesterday',
      'Today',
    ]);
  });

  it('shows Emailed as a labelled envelope icon, not meta text', () => {
    show([
      fu('a', 'u2', minutesAgo(5), { emailedAt: minutesAgo(5).toISOString() }),
      fu('b', 'u2', minutesAgo(4)),
    ]);
    const mailed = within(screen.getByTestId('follow-up-a')).getByTitle('Emailed');
    expect(mailed).toHaveAttribute('title', 'Emailed');
    expect(mailed.querySelector('.bx-envelope')).not.toBeNull();
    expect(within(screen.getByTestId('follow-up-a')).getByText('Emailed')).toBeInTheDocument();
    expect(within(screen.getByTestId('follow-up-b')).queryByTitle('Emailed')).toBeNull();
    expect(screen.getByTestId('follow-up-a').textContent).not.toMatch(/· Emailed/);
  });

  it('shows the New divider only when something is unseen, above the first unseen one', () => {
    const items = [
      fu('a', 'u2', minutesAgo(30)),
      fu('b', 'u2', minutesAgo(3)),
      fu('c', 'u2', minutesAgo(2)),
    ];
    const { unmount } = show(items);
    expect(screen.queryByTestId('follow-ups-new-divider')).toBeNull();
    unmount();
    show(items, ['c', 'b']);
    expect(screen.getAllByTestId('follow-ups-new-divider')).toHaveLength(1);
    expect(screen.getByTestId('follow-ups-new-divider').nextElementSibling).toBe(
      screen.getByTestId('follow-up-b'),
    );
    expect(screen.getByTestId('follow-ups-new-divider').previousElementSibling).toBe(
      screen.getByTestId('follow-up-a'),
    );
  });

  it('says so when there are none, with a prompt to post the first note', () => {
    show([]);
    expect(screen.getByText('No follow-ups yet')).toBeInTheDocument();
    expect(
      screen.getByText('Post the first note below. The team will see it here.'),
    ).toBeInTheDocument();
  });
});

describe('follow-up thread helpers', () => {
  const now = new Date(2026, 10, 5, 16, 52);

  it('labels days Today / Yesterday / Nov 4 / with a year when not this year', () => {
    expect(followUpDayLabel(new Date(2026, 10, 5, 8).toISOString(), now)).toBe('Today');
    expect(followUpDayLabel(new Date(2026, 10, 4, 23).toISOString(), now)).toBe('Yesterday');
    expect(followUpDayLabel(new Date(2026, 10, 3, 9).toISOString(), now)).toBe('Nov 3');
    expect(followUpDayLabel(new Date(2025, 11, 31, 9).toISOString(), now)).toBe('Dec 31, 2025');
  });

  it('initials: first+last word, or first two letters of a single word; stable tone per name', () => {
    expect(avatarInitials('Maria Member')).toBe('MM');
    expect(avatarInitials('Ana')).toBe('AN');
    expect(avatarInitials('Ken L. (PM)')).toBe('KL');
    expect(avatarInitials(null)).toBe('?');
    expect(avatarTone('Rita R.')).toBe(avatarTone('Rita R.'));
  });

  it('orders oldest first', () => {
    const rows = threadLayout(
      [fu('b', 'u2', '2026-10-02T00:00:00Z'), fu('a', 'u2', '2026-10-01T00:00:00Z')],
      new Set(),
      now,
    );
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'b']);
  });

  it('a 4:59 gap stays one run; a 5:00 gap starts a new run', () => {
    const t0 = new Date('2026-11-05T08:00:00.000Z');
    const at459 = new Date(t0.getTime() + FOLLOW_UP_RUN_GAP_MS - 1_000);
    const at500 = new Date(t0.getTime() + FOLLOW_UP_RUN_GAP_MS);
    const same = threadLayout([fu('a', 'u2', t0), fu('b', 'u2', at459)], new Set(), t0);
    expect(same[1]!.runStart).toBe(false);
    const next = threadLayout([fu('a', 'u2', t0), fu('b', 'u2', at500)], new Set(), t0);
    expect(next[1]!.runStart).toBe(true);
  });

  it('a New divider also starts a new run, even under 5 minutes later', () => {
    const t0 = new Date('2026-11-05T08:00:00.000Z');
    const t1 = new Date(t0.getTime() + 60_000);
    const rows = threadLayout([fu('a', 'u2', t0), fu('b', 'u2', t1)], new Set(['b']), t0);
    expect(rows[1]!.newDivider).toBe(true);
    expect(rows[1]!.runStart).toBe(true);
  });
});
