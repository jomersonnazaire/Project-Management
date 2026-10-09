import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? Boolean(window.matchMedia(query)?.matches)
    : false;
}

/** True while the media query matches; follows resizes and rotation. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    if (!mql) return;
    const update = () => setOn(Boolean(mql.matches));
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, [query]);
  return on;
}

/**
 * Phones and small tablets: below Bootstrap's md breakpoint (768px). DR-40 asks for the page title
 * to leave the top bar below 576px; between 576 and 767px the top bar is still too narrow for the
 * title, the page's actions and the timer, so the same layout applies there too.
 */
export const COMPACT_QUERY = '(max-width: 767.98px)';
export const useIsCompact = () => useMediaQuery(COMPACT_QUERY);
