import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { weekRangeShort, whereWorkingQuestion } from '../lib/format';
import { LOOKUPS } from './fixtures';
import { api } from './m2fixtures';
import { trackerDay } from './m5fixtures';
import { renderAt } from './utils';

/** M8 polish: DR-39..DR-42 (UIE re-check of M4–M7). */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Pretend the screen is a 390px phone (or a desktop). */
function screenWidth(px: number) {
  vi.stubGlobal('matchMedia', (q: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    return {
      matches: max ? px <= Number(max[1]) : false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    };
  });
}

const week = {
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  items: [],
  total: 0,
  capacity: 40,
};
const timeRoute = (url: string) =>
  /\/api\/v1\/time(\?|$)/.test(url) ? { status: 200, body: week } : undefined;

describe('DR-40: the page title leaves the top bar on phones', () => {
  it('phone: the title is a heading in the page, the top bar has none', async () => {
    screenWidth(390);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const h = await screen.findByRole('heading', { level: 1, name: 'Time logging' });
    expect(h.closest('.page-heading-phone')).not.toBeNull();
    expect(container.querySelector('.topbar-title')).toBeEmptyDOMElement();
  });

  it('desktop: the title stays in the top bar', async () => {
    screenWidth(1440);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const h = await screen.findByRole('heading', { level: 1, name: 'Time logging' });
    expect(container.querySelector('.topbar-title')).toContainElement(h);
  });
});

describe('DR-39: Time logging week switcher on phones', () => {
  it('phone: "‹ Oct 5–11 ›" sits in the page body, not the top bar', async () => {
    screenWidth(390);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const label = await screen.findByRole('button', { name: 'Oct 5–11' });
    const group = screen.getByRole('group', { name: 'Week' });
    expect(group).toContainElement(label);
    expect(within(group).getByRole('button', { name: 'Previous week' })).toBeInTheDocument();
    expect(container.querySelector('.topbar-actions')).not.toContainElement(group);
    expect(screen.queryByText(/Week of/)).not.toBeInTheDocument();
  });

  it('desktop: "Week of Oct 5" stays in the top bar', async () => {
    screenWidth(1440);
    api('MEMBER', timeRoute);
    const { container } = renderAt('/time', <App />);
    const label = await screen.findByRole('button', { name: 'Week of Oct 5' });
    expect(container.querySelector('.topbar-actions')).toContainElement(label);
  });

  it('short labels cross months', () => {
    expect(weekRangeShort('2026-10-05')).toBe('Oct 5–11');
    expect(weekRangeShort('2026-09-28')).toBe('Sep 28–Oct 4');
  });
});

describe('DR-41: the location question for a past day', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T04:00:00Z'));
  });

  it('wording by day', () => {
    expect(whereWorkingQuestion('2026-10-09', '2026-10-09')).toBe('Where are you working today?');
    expect(whereWorkingQuestion('2026-10-07', '2026-10-09')).toBe(
      'Where were you working on Wed, Oct 7?',
    );
  });

  it('Add entry on Wed, Oct 7 asks "Where were you working on Wed, Oct 7?"', async () => {
    screenWidth(1440);
    const past = trackerDay({ date: '2026-10-07', location: null, entries: [] });
    api('MEMBER', (url) => {
      if (url.endsWith('/lookups')) return { status: 200, body: LOOKUPS };
      if (url.includes('/tracker/day')) return { status: 200, body: { day: past } };
      if (url.includes('/tracker/running'))
        return { status: 200, body: { entry: null, now: '2026-10-09T04:00:00.000Z' } };
      if (url.includes('/tracker/people'))
        return { status: 200, body: { items: [{ id: 'me', name: 'Me' }] } };
      return undefined;
    });
    renderAt('/my-tasks?tab=day&date=2026-10-07', <App />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add entry' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        within(dialog).getByLabelText('Where were you working on Wed, Oct 7? *'),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).queryByText(/working today/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Every entry that day uses it/)).toBeInTheDocument();
  });
});
