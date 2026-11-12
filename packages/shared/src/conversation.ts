import { z } from 'zod';

/**
 * CR-24: auto refresh, Conversation unread and @mentions (FR-ARF-01..08, FR-CNV-09..15,
 * FR-NTF-14/15, Lean v0.1.2 rulings).
 */

/** FR-ARF-01/02: Conversation and an open task panel's Follow-ups refresh every 10 s. */
export const CONVERSATION_POLL_MS = 10_000;
/** FR-ARF-03 / Q-173: project header, Checklist, Board, Timeline and Projects-list unread, 30 s. */
export const PROJECT_POLL_MS = 30_000;
/** FR-ARF-07: after failed checks the interval doubles, up to this cap. */
export const POLL_BACKOFF_MAX_MS = 60_000;

/** FR-ARF-07: the next interval after `failures` failed checks in a row. */
export function pollInterval(base: number, failures: number): number {
  if (failures <= 0) return base;
  return Math.min(POLL_BACKOFF_MAX_MS, base * 2 ** Math.min(failures, 10));
}

/** Q-171: the Conversation tab and project-row pill cap at 99+ (the bell stays 9+). */
export function unreadLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

// ---------- Mentions (FR-CNV-13; Lean v0.1.2 rulings 3 and 4) ----------

/** Lean ruling 4: at most 10 people per message. */
export const MAX_MENTIONS = 10;
export const MENTION_LIMIT_MESSAGE = 'You can mention up to 10 people.';

/** Lean ruling 3: a mention is stored in the message text as `<@userId>`. */
export const mentionToken = (userId: string) => `<@${userId}>`;
const TOKEN = /<@([a-f0-9]{24})>/g;

/** Every distinct user id in the text's mention tokens, in first-seen order. */
export function mentionTokenIds(text: string): string[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]!))];
}

export type MentionPart = { text: string } | { mention: string };

/** Splits text into plain parts and mention tokens (`{ mention: userId }`). */
export function splitMentions(text: string): MentionPart[] {
  const out: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ mention: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Text with every token shown as `@Name` (an id with no user as "@Unknown user"). */
export function mentionsAsText(text: string, nameOf: (id: string) => string | undefined): string {
  return splitMentions(text)
    .map((p) => ('mention' in p ? `@${nameOf(p.mention) ?? UNKNOWN_USER}` : p.text))
    .join('');
}

/** Lean (e): a token whose user can't be found. */
export const UNKNOWN_USER = 'Unknown user';

/** Lean ruling 2: the bell row's quote, plain text, at most this many characters. */
export const MENTION_EXCERPT_MAX = 140;
export function mentionExcerpt(text: string, nameOf: (id: string) => string | undefined): string {
  // Code points, so an emoji or other surrogate pair is never split (UIE 96c3915).
  const plain = [...mentionsAsText(text, nameOf).replace(/\s+/g, ' ').trim()];
  return plain.length <= MENTION_EXCERPT_MAX
    ? plain.join('')
    : `${plain
        .slice(0, MENTION_EXCERPT_MAX - 1)
        .join('')
        .trimEnd()}…`;
}

/** A person the composer can mention (Q-177: active PM or team member). */
export interface MentionCandidate {
  id: string;
  name: string;
  /** "Project manager" or "Member", as on the Team tab. */
  role: string;
}

/**
 * UIE §4.2: `@` filters by the start of any word in the name, case-insensitive; the query may hold
 * one space ("@dev t" finds Dev Two).
 */
export function matchMentions(query: string, people: MentionCandidate[]): MentionCandidate[] {
  const q = query.toLowerCase();
  return people.filter((p) => {
    const name = p.name.toLowerCase();
    if (!q) return true;
    const words = name.split(/\s+/);
    return words.some((_, i) => words.slice(i).join(' ').startsWith(q));
  });
}

/** `GET /projects/conversation-unread?ids=…` (FR-ARF-08): counts only, for the listed projects. */
export interface ConversationUnreadDto {
  counts: Record<string, number>;
}

/** `POST /projects/:id/messages/seen`: read up to `at` (the newest message shown), or to now. */
export const conversationSeenSchema = z.strictObject({ at: z.iso.datetime().optional() });
export type ConversationSeenInput = z.input<typeof conversationSeenSchema>;

/** `GET /projects/conversation-unread?ids=a,b` (FR-ARF-08): at most one page of the list. */
export const conversationUnreadQuerySchema = z.strictObject({
  ids: z
    .string()
    .max(100 * 25)
    .transform((s) => [...new Set(s.split(',').filter(Boolean))])
    .pipe(z.array(z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id.')).max(100)),
});
