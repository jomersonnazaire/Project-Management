/** "Oct 12, 2026" in Philippine time (UIE §2.1, 2.7). */
export const savedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
