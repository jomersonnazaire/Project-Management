import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks whether a horizontally scrollable element has more content to the right, so the page can
 * show an edge fade as a scroll hint (DR-11). Re-checks on scroll, resize and content changes.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [fade, setFade] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setFade(
      el.scrollWidth - el.clientWidth > 1 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    );
  }, []);
  useEffect(() => {
    const el = ref.current;
    // Measured after layout, outside React's render.
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (el && observer) observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [update]);
  return { ref, fade, update };
}
