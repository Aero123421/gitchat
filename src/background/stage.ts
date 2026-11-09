// Merging captures into a chat and working out what is staged (changed since the last commit).

import type { CapturedAsset, CapturedMessage, ChatSnapshot, StagedItem } from '../shared/types';
import { MARKER_LINE, assetNameOf, markerLine, markers, parseMarker, type Marker } from './assets';
import { hash53 } from './hash';
import type { CommittedRef } from './model';

/** CRLF → LF and no blank lines around the body; whitespace inside it (hard breaks, indents) counts. */
export function canonicalMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
}

/**
 * Links to a message's assets, live (`gitchat-asset:<name>`) or as written to the repository
 * (`<chat>.assets/<name>`). Capture group 1 is the (URL-encoded) file name.
 */
const ASSET_LINK = /\]\((?:gitchat-asset:|[^()\s/]+\.assets\/)([^()\s]+)\)/g;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Asset file names a message links to. */
export function linkedAssetNames(md: string): string[] {
  return [...md.matchAll(ASSET_LINK)].map((m) => decode(m[1] ?? ''));
}

function assetDigest(a: CapturedAsset): string {
  return a.sha ?? `h${hash53(`${a.encoding}\n${a.data}`)}`;
}

/**
 * Identity of a message's content: role, Markdown (asset links in one canonical form) and the
 * content of every asset it carries.
 */
export function messageHash(m: CapturedMessage): string {
  const md = canonicalMarkdown(m.markdown).replace(ASSET_LINK, (_s, name: string) => `](asset:${decode(name)})`);
  const own = new Map((m.assets ?? []).map((a) => [a.name, assetDigest(a)]));
  const names = [...new Set([...linkedAssetNames(m.markdown), ...own.keys()])].sort();
  return hash53(`${m.role}\n${md}\n${names.map((n) => `${n}=${own.get(n) ?? ''}`).join('\n')}`);
}

export function refsOf(messages: CapturedMessage[]): CommittedRef[] {
  return messages.map((m) => ({ id: m.id, role: m.role, hash: messageHash(m) }));
}

export const hashesOf = (refs: CommittedRef[] | undefined) => new Map((refs ?? []).map((r) => [r.id, r.hash]));

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

export type MergeResult = { ok: true; messages: CapturedMessage[] } | { ok: false; code: 'empty' | 'invalid'; message: string };

/**
 * Applies a capture to the messages we already have.
 *
 * - A complete capture (init) is the whole conversation: it replaces the list and may remove
 *   messages. An empty capture, or one with questions but no answers at all, is refused.
 * - A live capture may hold only the part of a long chat that is in the DOM, so it is an upsert:
 *   known ids are updated in place and messages absent from it are kept. New ids after the last
 *   known one are appended; new ids between known ones are left for a later capture to place.
 * - Except when a live capture reaches the end of the chat (`atEnd`) and disagrees with what this
 *   device saw on the page after its first known message — a new id in the middle, seen messages
 *   skipped over, or new messages where seen ones followed. That is an edited or regenerated branch:
 *   the capture is authoritative from that message on, and the turns the page no longer shows are
 *   dropped. Only messages this device saw on the page (`seen`) can be dropped this way: messages
 *   that came from another device's copy were never on this page, so their absence proves nothing.
 *
 * Messages keep their saved visualizations when the new capture could not read them (see
 * keepArtifacts).
 */
export function mergeSnapshot(known: CapturedMessage[], snap: ChatSnapshot, seen?: ReadonlySet<string>): MergeResult {
  const incoming = uniqueIds(snap.messages);
  const byId = new Map(known.map((m) => [m.id, m]));
  const withKept = (m: CapturedMessage) => {
    const old = byId.get(m.id);
    return old ? keepArtifacts(old, m) : m;
  };

  if (snap.complete) {
    if (!incoming.length) return { ok: false, code: 'empty', message: 'The capture found no messages, so nothing was changed.' };
    const users = incoming.filter((m) => m.role === 'user').length;
    if (users >= 2 && users === incoming.length) {
      return { ok: false, code: 'invalid', message: 'The capture looked incomplete, so nothing was changed.' };
    }
    return { ok: true, messages: incoming.map(withKept) };
  }

  const observed = (m: CapturedMessage) => !seen || seen.has(m.id);
  const index = new Map(known.map((m, i) => [m.id, i]));
  const firstKnown = incoming.findIndex((m) => index.has(m.id));
  if (firstKnown < 0) return { ok: true, messages: [...known, ...incoming] };

  if (snap.atEnd && branchChanged(incoming, firstKnown, known, index, observed)) {
    const anchorAt = index.get(incoming[firstKnown]!.id)!;
    const captured = new Set(incoming.map((m) => m.id));
    let out = [...known.slice(0, anchorAt).filter((m) => !captured.has(m.id)), ...incoming.map(withKept)];
    if (known.slice(anchorAt).some((m) => !captured.has(m.id) && !observed(m))) {
      const kept = new Set(out.map((m) => m.id));
      out = unionMessages(out, known.filter((m) => kept.has(m.id) || !observed(m)));
    }
    return { ok: true, messages: out };
  }

  let lastKnown = firstKnown;
  incoming.forEach((m, i) => {
    if (index.has(m.id)) lastKnown = i;
  });
  const out = [...known];
  incoming.forEach((m, i) => {
    const at = index.get(m.id);
    if (at !== undefined) out[at] = withKept(m);
    else if (i > lastKnown) {
      index.set(m.id, out.length);
      out.push(m);
    }
  });
  return { ok: true, messages: out };
}

/**
 * After the first known message, a capture of the chat's end should repeat what this device saw, in
 * order, and then add new messages. A new id followed by a known one, seen messages skipped between
 * two captured ones, or new messages where seen ones still followed, means another branch.
 */
function branchChanged(
  incoming: CapturedMessage[],
  firstKnown: number,
  known: CapturedMessage[],
  index: Map<string, number>,
  observed: (m: CapturedMessage) => boolean,
): boolean {
  const skipsSeen = (from: number, to: number) => known.slice(from, to).some(observed);
  let expected = index.get(incoming[firstKnown]!.id)! + 1;
  let sawNew = false;
  for (const m of incoming.slice(firstKnown + 1)) {
    const at = index.get(m.id);
    if (at === undefined) {
      sawNew = true;
      continue;
    }
    if (sawNew || at < expected || skipsSeen(expected, at)) return true;
    expected = at + 1;
  }
  return sawNew && skipsSeen(expected, known.length);
}

/** Repeated ids within one capture get a deterministic suffix, so the same capture maps the same way. */
export function uniqueIds(messages: CapturedMessage[]): CapturedMessage[] {
  const seen = new Map<string, number>();
  return messages.map((m) => {
    const n = (seen.get(m.id) ?? 0) + 1;
    seen.set(m.id, n);
    return n === 1 ? m : { ...m, id: `${m.id}#${n}` };
  });
}

// ---- visualizations

/**
 * A visualization can only be read while its frame is on the page. When a new capture of the same
 * message shows a plain card (`**Artifact:**` or `**File:**`, exactly the same title) where we had a
 * saved copy, keep the saved link and file. When it brings a fresh copy under another file name,
 * keep the name we used before, so the repository file is updated in place. Cards are matched as
 * whole lines, in order, per kind and title.
 */
export function keepArtifacts(old: CapturedMessage, next: CapturedMessage): CapturedMessage {
  const saved = new Map<string, Marker[]>();
  for (const m of markers(old.markdown)) if (m.target) saved.set(`${m.kind}\n${m.title}`, [...(saved.get(`${m.kind}\n${m.title}`) ?? []), m]);
  if (!saved.size) return next;
  const assets = [...(next.assets ?? [])];
  const used = new Map<string, number>();
  let carried = false;
  const markdown = next.markdown.replace(MARKER_LINE, (line, kind: string, rest: string) => {
    const now = parseMarker(kind, rest);
    const key = `${kind}\n${now.title}`;
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    const before = saved.get(key)?.[i];
    if (!before?.target) return line;
    const oldName = assetNameOf(before.target);
    if (now.target) {
      const newName = assetNameOf(now.target);
      if (!oldName || !newName || newName === oldName || !now.target.startsWith('gitchat-asset:') || assets.some((a) => a.name === oldName)) return line;
      const at = assets.findIndex((a) => a.name === newName);
      if (at < 0) return line;
      assets[at] = { ...assets[at]!, name: oldName };
      return markerLine({ ...now, target: `gitchat-asset:${encodeURIComponent(oldName)}` });
    }
    const file = oldName ? old.assets?.find((a) => a.name === oldName) : undefined;
    if (file && !assets.some((a) => a.name === file.name)) assets.push(file);
    carried = true;
    return markerLine(before);
  });
  if (markdown === next.markdown) return next;
  const out: CapturedMessage = { ...next, markdown };
  if (assets.length) out.assets = assets;
  if (carried) out.kinds = [...new Set([...(next.kinds ?? []), 'viz'])];
  return out;
}

// ---- combining two versions of a chat

/**
 * Both lists' messages, none lost. `primary` decides the order and its version wins for ids both
 * have; each message only `secondary` has goes right after the message it followed there.
 */
export function unionMessages(primary: CapturedMessage[], secondary: CapturedMessage[]): CapturedMessage[] {
  const out = [...primary];
  const has = new Set(out.map((m) => m.id));
  let after = -1;
  for (const m of secondary) {
    if (has.has(m.id)) {
      after = out.findIndex((x) => x.id === m.id);
      continue;
    }
    out.splice(after + 1, 0, m);
    has.add(m.id);
    after++;
  }
  return out;
}

/**
 * Three-way merge of two versions of a chat against their common base (message id → hash; null when
 * unknown). Per message: unchanged on one side → the other side's version; changed on both → the
 * newer capture's. Added on either side → kept. Deleted on one side and unchanged on the other →
 * deleted; deleted on one side but edited on the other → the edit is kept.
 */
export function threeWayMerge(base: ReadonlyMap<string, string> | null, ours: CapturedMessage[], theirs: CapturedMessage[], oursNewer: boolean): CapturedMessage[] {
  const o = new Map(ours.map((m) => [m.id, m]));
  const t = new Map(theirs.map((m) => [m.id, m]));
  const pick = (id: string): CapturedMessage | null => {
    const mine = o.get(id);
    const other = t.get(id);
    const b = base?.get(id);
    if (mine && other) {
      const mh = messageHash(mine);
      const th = messageHash(other);
      if (mh === th || b === th) return mine;
      if (b === mh) return other;
      return oursNewer ? mine : other;
    }
    const only = mine ?? other;
    if (!only) return null;
    return b !== undefined && messageHash(only) === b ? null : only;
  };
  const order = oursNewer ? unionMessages(ours, theirs) : unionMessages(theirs, ours);
  return order.map((m) => pick(m.id)).filter((m): m is CapturedMessage => !!m);
}

/**
 * A complete capture taken while other changes were being applied (e.g. by another tab): changes
 * made after the capture started — edits, new messages, deletions, relative to `base` (id → hash at
 * the start) — are kept over the capture's older reading.
 */
export function keepChangesSince(captured: CapturedMessage[], current: CapturedMessage[], base: ReadonlyMap<string, string>): CapturedMessage[] {
  const changed = new Map(current.filter((m) => base.get(m.id) !== messageHash(m)).map((m) => [m.id, m]));
  const now = new Set(current.map((m) => m.id));
  const deleted = new Set([...base.keys()].filter((id) => !now.has(id)));
  let out = captured.filter((m) => !deleted.has(m.id)).map((m) => changed.get(m.id) ?? m);
  const have = new Set(out.map((m) => m.id));
  if ([...changed.keys()].some((id) => !have.has(id))) out = unionMessages(out, current.filter((m) => changed.has(m.id) || have.has(m.id)));
  return out;
}
