// Merging captures into a chat and working out what is staged (changed since the last commit).

import type { CapturedAsset, CapturedMessage, ChatSnapshot, StagedItem } from '../shared/types';
import { MARKER_LINE, assetNameOf, markerLine, markers, parseMarker, type Marker } from './assets';
import { hash53 } from './hash';
import type { CommittedRef, PageRead } from './model';

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

export type MergeResult = { ok: true; messages: CapturedMessage[] } | { ok: false; code: 'empty' | 'invalid' | 'ambiguous'; message: string };

const AMBIGUOUS: MergeResult = { ok: false, code: 'ambiguous', message: 'The capture could not be placed in the saved chat; the whole chat has to be read again.' };

/**
 * Applies a capture to the messages we already have. `reads` is what captures on this device read on
 * the page before (see ChatRecord.pageReads); without it every known message counts as read.
 *
 * - A complete capture (init) is the whole conversation from its first message on: it replaces the
 *   list from there and may remove messages. Saved messages before its first message are kept unless
 *   the capture is known to start at the chat's beginning (`startConfirmed`), which a full reread
 *   sets even when the chat is long or taller than the viewport. A capture sharing no message with
 *   the saved ones replaces them only then. If the start is not confirmed, that capture is not
 *   concatenated onto the saved chat: the saved messages stay as they are.
 *   An empty capture, or one with questions but no answers at all, is refused.
 * - A live capture may hold only the part of a long chat that is in the DOM, so it is an upsert:
 *   known ids are updated in place and messages absent from it are kept. New ids after the last
 *   known one are appended; new ids between known ones are left for a later capture to place.
 *   An unknown id after a known one, where the saved chat's next message is a different one this
 *   view could have shown and the capture does not contain, replaced that turn. It is refused unless
 *   the capture reaches the end,
 *   which replaces the branch instead of appending it.
 * - Except when a live capture reaches the end of the chat (`atEnd`) and disagrees with what was read
 *   on the page after its first known message — a new id in the middle, read messages skipped over,
 *   or new messages where read ones followed. That is an edited or regenerated branch: the capture
 *   is authoritative from that message on, and the turns the page no longer shows are dropped.
 *   Only messages the capturing page view could have shown can be dropped this way: ones this device
 *   read before the view started, or ones the view read itself. Messages that came from another
 *   device's copy, or that another tab read later, prove nothing by their absence.
 * - A live capture that cannot be placed safely is refused as 'ambiguous': it shares no message with
 *   a chat that has some (e.g. the first question was edited), it reaches the end but stops before
 *   messages the view read there (the end got shorter), or it shows a replaced turn before the end.
 *   Only a complete capture can tell.
 *
 * A message the page still shows exactly as the capturing view read it last (or, for a view that never
 * read it, as this device read it last) keeps the version we have: it may hold another device's edit,
 * merged since. Messages keep their saved visualizations when the new capture could not read them
 * (see keepArtifacts).
 */
export function mergeSnapshot(known: CapturedMessage[], snap: ChatSnapshot, reads?: ReadonlyMap<string, PageRead>): MergeResult {
  const incoming = uniqueIds(snap.messages);
  const byId = new Map(known.map((m) => [m.id, m]));
  const view = snap.view;
  /** What the capturing view read last; a view that never read the message goes by this device's last reading. */
  const lastRead = (id: string) => {
    const r = reads?.get(id);
    return r && (view && r.hv && view.id in r.hv ? r.hv[view.id] : r.h);
  };
  const place = (m: CapturedMessage) => {
    const old = byId.get(m.id);
    if (!old) return m;
    if (lastRead(m.id) === messageHash(m)) return old;
    return keepArtifacts(old, m);
  };

  if (snap.complete) {
    if (!incoming.length) return { ok: false, code: 'empty', message: 'The capture found no messages, so nothing was changed.' };
    const users = incoming.filter((m) => m.role === 'user').length;
    if (users >= 2 && users === incoming.length) {
      return { ok: false, code: 'invalid', message: 'The capture looked incomplete, so nothing was changed.' };
    }
    const placed = incoming.map(place);
    if (snap.startConfirmed === true || !known.length) return { ok: true, messages: placed };
    // the start is not confirmed: what lies before the capture's first shared message is kept.
    // Nothing in common is another branch only once the start is confirmed; concatenating the two
    // histories would save the old branch and the new one as one chat.
    const at = new Map(known.map((m, i) => [m.id, i]));
    const first = incoming.find((m) => at.has(m.id));
    if (!first) return { ok: true, messages: known };
    const captured = new Set(incoming.map((m) => m.id));
    return { ok: true, messages: [...known.slice(0, at.get(first.id)).filter((m) => !captured.has(m.id)), ...placed] };
  }

  if (!incoming.length) return { ok: true, messages: known };
  const observed = (m: CapturedMessage) => {
    if (!reads) return true;
    const r = reads.get(m.id);
    return !!r && (!view || r.at <= view.since || !!r.v?.includes(view.id));
  };
  const index = new Map(known.map((m, i) => [m.id, i]));
  const firstKnown = incoming.findIndex((m) => index.has(m.id));
  if (firstKnown < 0) return known.length ? AMBIGUOUS : { ok: true, messages: incoming };

  if (snap.atEnd && branchChanged(incoming, firstKnown, known, index, observed)) {
    const anchorAt = index.get(incoming[firstKnown]!.id)!;
    const captured = new Set(incoming.map((m) => m.id));
    let out = [...known.slice(0, anchorAt).filter((m) => !captured.has(m.id)), ...incoming.map(place)];
    if (known.slice(anchorAt).some((m) => !captured.has(m.id) && !observed(m))) {
      const kept = new Set(out.map((m) => m.id));
      out = unionMessages(out, known.filter((m) => kept.has(m.id) || !observed(m)));
    }
    return { ok: true, messages: out };
  }

  if (snap.atEnd) {
    const lastAt = index.get(incoming.at(-1)!.id);
    const captured = new Set(incoming.map((m) => m.id));
    if (lastAt !== undefined && known.slice(lastAt + 1).some((m) => !captured.has(m.id) && observed(m))) return AMBIGUOUS;
  }

  // Away from the end, appending an unknown id after a known one would keep both branches when the
  // saved chat continues with a message this capture could have shown and does not. A successor this
  // view never saw (another device's turn) is not that: the new ids are still an append.
  if (!snap.atEnd && diverged(incoming, known, index, observed)) return AMBIGUOUS;

  let lastKnown = firstKnown;
  incoming.forEach((m, i) => {
    if (index.has(m.id)) lastKnown = i;
  });
  const out = [...known];
  incoming.forEach((m, i) => {
    const at = index.get(m.id);
    if (at !== undefined) out[at] = place(m);
    else if (i > lastKnown) {
      index.set(m.id, out.length);
      out.push(m);
    }
  });
  return { ok: true, messages: out };
}

/**
 * After the first known message, a capture of the chat's end should repeat what was read, in order,
 * and then add new messages. A new id followed by a known one, read messages skipped between two
 * captured ones, or new messages where read ones still followed, means another branch.
 */
/**
 * After a known message K, the capture has an unknown id, and the saved message right after K is a
 * different one this view could have shown and the capture does not contain. A new turn after the
 * last saved message has no such successor, a window of known ids only has no unknown id, and a
 * successor this view never saw belongs to another device, so none of those count.
 */
function diverged(
  incoming: CapturedMessage[],
  known: CapturedMessage[],
  index: Map<string, number>,
  observed: (m: CapturedMessage) => boolean,
): boolean {
  const captured = new Set(incoming.map((m) => m.id));
  for (let i = 0; i < incoming.length; i++) {
    const at = index.get(incoming[i]!.id);
    if (at === undefined) continue;
    const next = known[at + 1];
    if (!next || captured.has(next.id) || !observed(next)) continue;
    if (incoming.slice(i + 1).some((m) => !index.has(m.id))) return true;
  }
  return false;
}

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

/**
 * The page reads after a capture: every captured message's latest reading (first-read time kept,
 * the capturing view added), for the messages the chat still has.
 */
export function recordReads(
  reads: ReadonlyMap<string, PageRead>,
  captured: CapturedMessage[],
  chat: CapturedMessage[],
  view: { id: string } | undefined,
  now: number,
): Record<string, PageRead> {
  const next = new Map(reads);
  for (const m of captured) {
    const prev = reads.get(m.id);
    const h = messageHash(m);
    // `v` stays short (which views may prune). `hv` keeps every view that has read this message,
    // including ones that fell off `v`: an open tab must not look like a new edit of an older text.
    const v = view ? [view.id, ...(prev?.v ?? []).filter((x) => x !== view.id)].slice(0, 4) : prev?.v;
    const hv: Record<string, string> = {};
    const remembered = new Set([...(v ?? []), ...Object.keys(prev?.hv ?? {})]);
    if (view) remembered.add(view.id);
    for (const id of remembered) {
      const was = view && id === view.id ? h : prev?.hv?.[id];
      if (was !== undefined) hv[id] = was;
    }
    next.set(m.id, { h, at: prev ? prev.at : now, ...(v?.length ? { v } : {}), ...(Object.keys(hv).length ? { hv } : {}) });
  }
  const out: Record<string, PageRead> = {};
  for (const m of chat) {
    const r = next.get(m.id);
    if (r) out[m.id] = r;
  }
  return out;
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
