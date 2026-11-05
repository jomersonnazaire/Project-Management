import { render, screen, within } from '@testing-library/react';
import type { FollowUpDto } from '@xc8/shared';
import { describe, expect, it } from 'vitest';
import { avatarTone, followUpDayLabel, initials, threadLayout } from '../lib/followUps';
import { FollowUpThread } from '../pages/projects/FollowUpThread';

/** CR-20 follow-ups as a chat thread (presentation only; seen state is covered in cr20.test). */
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
  it('is a list; my messages sit on the right, others on the left', () => {
    show([fu('a', 'u2', minutesAgo(30)), fu('b', ME, minutesAgo(20))]);
    const list = screen.getByRole('list', { name: 'Follow-up messages' });
    expect(within(list).getByTestId('follow-up-b')).toHaveAttribute('data-own', 'true');
    expect(screen.getByTestId('follow-up-b')).toHaveClass('followup-own');
    expect(screen.getByTestId('follow-up-a')).toHaveAttribute('data-own', 'false');
    expect(screen.getByTestId('follow-up-a')).toHaveClass('followup-other');
  });

  it('groups a run by one author within a few minutes: avatar and name once', () => {
    show([
      fu('a', 'u2', minutesAgo(30)),
      fu('b', 'u2', minutesAgo(28)),
      fu('c', 'u2', minutesAgo(10)),
      fu('d', ME, minutesAgo(9)),
    ]);
    expect(screen.getByTestId('follow-up-a')).toHaveClass('followup-group-start');
    expect(screen.getByTestId('follow-up-b')).toHaveClass('followup-grouped');
    // More than 5 minutes later starts a new group; so does another author.
    expect(screen.getByTestId('follow-up-c')).toHaveClass('followup-group-start');
    expect(screen.getByTestId('follow-up-d')).toHaveClass('followup-group-start');
    expect(screen.getByTestId('follow-up-b').querySelector('.followup-avatar')).toBeNull();
    expect(screen.getByTestId('follow-up-a').querySelector('.followup-avatar')).toHaveTextContent(
      'MM',
    );
    // Grouped ones still name the author for screen readers.
    expect(screen.getByTestId('follow-up-b')).toHaveTextContent('Maria Member');
  });

  it('puts a day separator above each new day', () => {
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

  it('shows Emailed as a labelled envelope icon, not meta text', () => {
    show([
      fu('a', 'u2', minutesAgo(5), { emailedAt: minutesAgo(5).toISOString() }),
      fu('b', 'u2', minutesAgo(4)),
    ]);
    const icon = within(screen.getByTestId('follow-up-a')).getByRole('img', { name: 'Emailed' });
    expect(icon).toHaveClass('bx-envelope');
    expect(
      within(screen.getByTestId('follow-up-b')).queryByRole('img', { name: 'Emailed' }),
    ).toBeNull();
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
    expect(screen.getByTestId('follow-up-b')).toHaveClass('followup-new');
    expect(screen.getByTestId('follow-up-a')).not.toHaveClass('followup-new');
  });

  it('says so when there are none', () => {
    show([]);
    expect(screen.getByText('No follow-ups yet.')).toBeInTheDocument();
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
  it('initials and a stable avatar tone per user', () => {
    expect(initials('Maria Member')).toBe('MM');
    expect(initials('Ana')).toBe('A');
    expect(initials(null)).toBe('?');
    expect(avatarTone('u2')).toBe(avatarTone('u2'));
  });
  it('orders oldest first', () => {
    const rows = threadLayout(
      [fu('b', 'u2', '2026-10-02T00:00:00Z'), fu('a', 'u2', '2026-10-01T00:00:00Z')],
      now,
    );
    expect(rows.map((r) => r.item.id)).toEqual(['a', 'b']);
  });
});
