import { shortName, type ProjectDto, type TaskDto, type TimeType } from '@xc8/shared';

/** Small UI helpers for Milestone 3 screens. */

/** "9+" above nine (mockup v0.7 notifications). */
export const badgeCount = (n: number) => (n > 9 ? '9+' : String(n));

export const TIME_TYPE_BADGE: Record<TimeType, string> = {
  EXECUTION: 'bg-label-info',
  WAITING: 'bg-label-warning',
  REWORK: 'bg-label-danger',
};

/** "Maria P., Ken L. (reviewer) and Jomerson N. (PM)": who a follow-up notifies (FR-NTF-02). */
export function followUpRecipients(t: TaskDto, project: ProjectDto, meId?: string): string {
  const seen = new Set<string>(meId ? [meId] : []);
  const out: string[] = [];
  const add = (p: { id: string; name: string } | null | undefined, tag = '') => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    out.push(`${shortName(p.name)}${tag}`);
  };
  add(t.owner);
  t.assignees.forEach((a) => add(a));
  add(t.reviewer, ' (reviewer)');
  add(project.manager, ' (PM)');
  if (out.length <= 1) return out.join('');
  return `${out.slice(0, -1).join(', ')} and ${out[out.length - 1]}`;
}
