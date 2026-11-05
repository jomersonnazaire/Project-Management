/** CR-20 FR-NTF-09..13: "3 follow-ups, 1 new" / "1 follow-up" (the badge's accessible name). */
export function followUpBadgeLabel(total: number, unseen: number): string {
  const count = `${total} follow-up${total === 1 ? '' : 's'}`;
  return unseen > 0 ? `${count}, ${unseen} new` : count;
}
