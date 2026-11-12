import { useEffect, useState } from 'react';
import { UnreadPill } from '../../components/UnreadPill';

/**
 * CR-24 UIE §2.1: on a phone the tab strip scrolls and Conversation starts off screen. While its
 * tab (and pill) is out of view, a cue on the strip's right edge shows the pill and a chevron;
 * tapping it scrolls the strip to Conversation and focuses that tab.
 */
export function TabEdgeCue({ targetId, count }: { targetId: string; count: number }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const tab = document.getElementById(targetId);
    if (!tab || typeof IntersectionObserver === 'undefined') return;
    const strip = tab.closest('.nav-scrollable');
    const io = new IntersectionObserver(
      ([e]) => setHidden(Boolean(e && e.intersectionRatio < 0.99)),
      { root: strip, threshold: [0, 0.99] },
    );
    io.observe(tab);
    return () => io.disconnect();
  }, [targetId]);
  if (!hidden) return null;
  return (
    <button
      type="button"
      className="tab-edge-cue"
      onClick={() => {
        const tab = document.getElementById(targetId);
        tab?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
        tab?.focus();
      }}
    >
      <span className="visually-hidden">More tabs. Conversation has {count} unread.</span>
      <span aria-hidden="true">
        <UnreadPill count={count} srText={false} />
        <i className="bx bx-chevron-right" />
      </span>
    </button>
  );
}
