// Merging captures into a chat and working out what is staged (changed since the last commit).

import type { CapturedMessage, ChatSnapshot, StagedItem } from '../shared/types';
import { hash53 } from './hash';
import type { CommittedRef } from './model';

/**
 * Identity of a message's content. Whitespace-insensitive at the edges, and assets count through the
 * links in the markdown, so a message read back from the repository hashes like the live capture.
 */
export function messageHash(m: CapturedMessage): string {
  const md = m.markdown.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return hash53(`${m.role}\n${md}`);
}

export function refsOf(messages: CapturedMessage[]): CommittedRef[] {
  return messages.map((m) => ({ id: m.id, role: m.role, hash: messageHash(m) }));
}

const KIND_ORDER = ['viz', 'math', 'code', 'image', 'table'];

/** The most notable kind of content in a message, for the widget. */
export function primaryKind(m: CapturedMessage): string {
  const kinds = m.kinds ?? [];
  return KIND_ORDER.find((k) => kinds.includes(k)) ?? 'text';
}

/** New or changed messages, plus messages that disappeared (kind "removed"). */
export function diffStaged(current: CapturedMessage[], committed: CommittedRef[]): StagedItem[] {
  const before = new Map(committed.map((c) => [c.id, c]));
  const staged: StagedItem[] = [];
  for (const m of current) {
    const ref = before.get(m.id);
    if (!ref || ref.hash !== messageHash(m)) staged.push({ id: m.id, role: m.role, kind: primaryKind(m) });
  }
  const now = new Set(current.map((m) => m.id));
  for (const c of committed) if (!now.has(c.id)) staged.push({ id: c.id, role: c.role, kind: 'removed' });
  return staged;
}

export type MergeResult = { ok: true; messages: CapturedMessage[] } | { ok: false; code: 'empty'; message: string };

/**
 * Applies a capture to the messages we already have.
 *
 * - A complete capture (init) is the whole conversation: it replaces the list and may remove
 *   messages (e.g. after a branch edit). An empty complete capture is refused.
 * - A live capture (after a turn) may miss messages the site has not loaded or has unloaded, so it
 *   is an upsert: known ids are updated in place, new ids are appended in the capture's order, and
 *   messages absent from the capture are kept.
 */
export function mergeSnapshot(known: CapturedMessage[], snap: ChatSnapshot): MergeResult {
  const incoming = uniqueIds(snap.messages);
  if (snap.complete) {
    if (!incoming.length) return { ok: false, code: 'empty', message: 'The capture found no messages, so nothing was changed.' };
    return { ok: true, messages: incoming };
  }
  const out = [...known];
  const index = new Map(out.map((m, i) => [m.id, i]));
  for (const m of incoming) {
    const i = index.get(m.id);
    if (i === undefined) {
      index.set(m.id, out.length);
      out.push(m);
    } else {
      out[i] = m;
    }
  }
  return { ok: true, messages: out };
}

/** Repeated ids within one capture get a deterministic suffix, so the same capture maps the same way. */
function uniqueIds(messages: CapturedMessage[]): CapturedMessage[] {
  const seen = new Map<string, number>();
  return messages.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    return n === 1 ? m : { ...m, id: `${m.id}#${n}` };
  });
}
