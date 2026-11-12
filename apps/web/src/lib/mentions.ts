import { MAX_MENTIONS, mentionToken, type MentionCandidate } from '@xc8/shared';

/** A person picked in the draft: the text shows `@Name`, the id goes out as a `<@id>` token. */
export interface PickedMention {
  id: string;
  name: string;
}

/**
 * UIE §4.2: the `@` the caret is in, if any. It must start the text or follow white space; the
 * query runs to the caret, has no line break and at most one space.
 */
export function findTrigger(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
  const query = before.slice(at + 1);
  if (/\n/.test(query) || (query.match(/ /g) ?? []).length > 1 || query.length > 40) return null;
  return { start: at, query };
}

const sortedByLength = (picked: PickedMention[]) =>
  [...picked].sort((a, b) => b.name.length - a.name.length);

/** UIE §4.3: a mention whose `@Name` was edited away is dropped (it is plain text now). */
export function prunePicked(text: string, picked: PickedMention[]): PickedMention[] {
  return picked.filter((p) => text.includes(`@${p.name}`));
}

/** Distinct people in the draft (L-4: repeats count once). */
export const distinctMentions = (picked: PickedMention[]) => new Set(picked.map((p) => p.id)).size;
export const atMentionLimit = (picked: PickedMention[]) => distinctMentions(picked) >= MAX_MENTIONS;

/** L-3: on send, each picked `@Full Name` becomes the `<@userId>` token. */
export function withTokens(text: string, picked: PickedMention[]): string {
  let out = text;
  for (const p of sortedByLength(prunePicked(text, picked))) {
    out = out.split(`@${p.name}`).join(mentionToken(p.id));
  }
  return out;
}

/** The highlight layer: plain runs and picked `@Name` runs, character for character. */
export function highlightRuns(
  text: string,
  picked: PickedMention[],
): { text: string; mention: boolean }[] {
  const names = sortedByLength(picked).map((p) => `@${p.name}`);
  if (!names.length) return [{ text, mention: false }];
  const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), mention: false });
    out.push({ text: m[0], mention: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/** Q-177: the active PM and team members, as the Team tab names their role. */
export function mentionCandidates(
  manager: { id: string; name: string; active: boolean } | null,
  members: { id: string; name: string; active: boolean }[],
  meId?: string,
): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  const seen = new Set<string>();
  const add = (u: { id: string; name: string; active: boolean }, role: string) => {
    if (!u.active || seen.has(u.id) || u.id === meId) return;
    seen.add(u.id);
    out.push({ id: u.id, name: u.name, role });
  };
  if (manager) add(manager, 'Project manager');
  for (const m of members) add(m, 'Member');
  return out;
}
