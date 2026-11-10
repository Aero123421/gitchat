// Init: capture the whole history of a chat, however long.
//
// 1. Loading — scroll the conversation to the very top again and again until the site stops adding
//    older messages (it loads them lazily, in batches). Reported as a growing message count. Only a
//    long quiet period at the top ends loading: no site gives a trustworthy start marker (Claude's
//    aria-posinset="1" is the first *loaded* row). Running out of time is an error, never a success.
//    The start is confirmed only when the transcript fits on screen or the chat is too short to
//    load in batches. Otherwise the background keeps saved messages above this capture.
// 2. Reading — virtualized lists (only ~20 rows in the DOM at a time) are walked from the top to the
//    bottom in overlapping steps, collecting every message by ID and every visualization while it is
//    mounted. After each step we wait until rows are rendered in the viewport. Coverage is checked:
//    against the site's row positions where it has them (Claude), otherwise by requiring every step
//    to overlap the previous one (a gap triggers one finer pass). Missing coverage is an error. A
//    message row counts as read only once its body has content: a row whose body renders late is
//    visited again. A walk that stops moving (no scroll progress, no new messages) fails as stalled.
//    Lists that keep all loaded messages in the DOM are read once. Reported as 0–100 %.
// 3. If the AI is still answering, wait for it to finish; then read the end again — that settled read
//    replaces earlier, provisional text and visualizations.
// The original scroll position is restored afterwards (also on cancel or failure) while the
// conversation still owns the scroller. The anchor is the message that was visible, so growth
// below the viewport does not move the user. Switching to another scroller measures that
// element again.

import type { Adapter, CapturedArtifact } from '../adapters/types';
import type { CapturedMessage } from '../../shared/types';
import { assignIds, captureMessage, scrollReversed } from './snapshot';

export interface InitProgress {
  stage: 'loading' | 'reading';
  /** Messages found so far. */
  count: number;
  /** Overall progress 0..1 (loading fills 0–0.25 slowly, reading 0.25–1). */
  progress: number;
}

export interface InitOptions {
  signal: AbortSignal;
  onProgress(p: InitProgress): void;
  /** Give up loading older messages after this long (the capture then fails as incomplete). */
  maxLoadMs?: number;
  /** Collect visualizations as they are mounted (frames already collected are passed in `skip`). */
  artifacts?(skip: ReadonlySet<string>): Promise<CapturedArtifact[]>;
  /** True while the AI is thinking or answering; init waits for it before finishing. */
  busy?(): boolean;
  /** Give up waiting for a running answer after this long (default 10 minutes). */
  maxBusyWaitMs?: number;
  /** False once the scroller no longer belongs to this conversation (then the scroll is left alone). */
  owns?(): boolean;
  /** How long to wait for rows to render in the viewport after a scroll step (default 3 s). */
  rowWaitMs?: number;
  /** Fail the reading walk when it makes no progress for this long (default 25 s). */
  stallMs?: number;
}

export interface InitResult {
  messages: CapturedMessage[];
  artifacts: CapturedArtifact[];
  /** ISO time of the last read of the page. */
  readAt: string;
  /**
   * The capture is known to begin at the conversation's first message: once loading stopped, the
   * whole transcript fit in its scroller. Otherwise older history may simply not have loaded.
   */
  startConfirmed: boolean;
}

/** At most this many messages: the chat came in one piece (see the end of captureFullHistory). */
const SMALL_CHAT_MESSAGES = 8;

/** The history could not be loaded completely; nothing partial is ever reported as complete. */
export class InitIncompleteError extends Error {
  /**
   * `stale`: the page still showed the previous chat's messages (the new one had not rendered).
   * `stalled`: reading stopped making progress (the list would not scroll further).
   */
  constructor(readonly reason: 'timeout' | 'busy' | 'no-scroller' | 'empty' | 'one-sided' | 'coverage' | 'stale' | 'stalled') {
    super(`init incomplete: ${reason}`);
    this.name = 'InitIncompleteError';
  }
}

const aborted = () => new DOMException('Cancelled', 'AbortError');

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(t);
      reject(aborted());
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** Resolve after `quietMs` without DOM changes under `root`, or after `maxMs`. */
function settle(root: Node, quietMs: number, maxMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted());
    let quiet = 0;
    const finish = (err?: DOMException) => {
      mo.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => finish(aborted());
    const mo = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = window.setTimeout(() => finish(), quietMs);
    });
    mo.observe(root, { subtree: true, childList: true });
    quiet = window.setTimeout(() => finish(), quietMs);
    const cap = window.setTimeout(() => finish(), maxMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Move toward older messages. A reversed scroller's oldest end is the negative `scrollTop`. */
function scrollTowardOldest(el: HTMLElement, reversed: boolean): void {
  el.scrollTop = reversed ? Math.min(0, el.clientHeight - el.scrollHeight) : 0;
  el.dispatchEvent(new Event('scroll'));
  // some lists only react to user-like wheel input (wheel up, toward older turns)
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, bubbles: true }));
}

/** `scrollTop` of the oldest end. Reversed lists keep the newest end at 0. */
function oldestScroll(el: HTMLElement, reversed: boolean): number {
  return reversed ? Math.min(0, el.clientHeight - el.scrollHeight) : 0;
}

/** `scrollTop` of the newest end. */
function newestScroll(el: HTMLElement, reversed: boolean): number {
  return reversed ? 0 : Math.max(0, el.scrollHeight - el.clientHeight);
}

function atOldest(el: HTMLElement, reversed: boolean): boolean {
  return reversed ? el.scrollTop <= oldestScroll(el, true) + 2 : el.scrollTop <= 2;
}

function atNewest(el: HTMLElement, reversed: boolean): boolean {
  return reversed ? el.scrollTop >= -2 : el.scrollTop >= newestScroll(el, false) - 2;
}

function clampScroll(el: HTMLElement, reversed: boolean, y: number): number {
  return reversed ? Math.max(oldestScroll(el, true), Math.min(0, y)) : Math.max(0, Math.min(newestScroll(el, false), y));
}

/** 0 at the oldest end, 1 at the newest. */
function walkProgress(el: HTMLElement, reversed: boolean): number {
  if (reversed) {
    const span = -oldestScroll(el, true);
    return span > 0 ? (el.scrollTop - oldestScroll(el, true)) / span : 1;
  }
  const max = el.scrollHeight - el.clientHeight;
  return max > 0 ? el.scrollTop / max : 1;
}

/** The message that was on screen, so restore does not use distance-from-bottom. */
interface ViewAnchor {
  /** Service id, or role plus the start of the text when the row has none. */
  key: string | null;
  /** Distance from the scroller's top edge to the message's top edge. */
  viewportOffset: number;
  scrollTop: number;
  /** Fallback when no message can be measured (no layout). */
  fromBottom: number;
  placed: boolean;
}

function anchorKey(node: { id: string | null; role: string; el: Element }): string | null {
  if (node.id) return node.id;
  const text = (node.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return text ? `${node.role}\n${text}` : null;
}

function measureAnchor(adapter: Adapter, doc: Document, scroller: HTMLElement): ViewAnchor {
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const blank: ViewAnchor = { key: null, viewportOffset: 0, scrollTop: scroller.scrollTop, fromBottom, placed: false };
  const box = scroller.getBoundingClientRect();
  if (box.height <= 0) return blank;
  for (const n of adapter.messages(doc)) {
    const r = n.el.getBoundingClientRect();
    if (r.height <= 0 || r.bottom <= box.top + 1 || r.top >= box.bottom - 1) continue;
    const key = anchorKey(n);
    if (!key) continue;
    return { key, viewportOffset: r.top - box.top, scrollTop: scroller.scrollTop, fromBottom, placed: true };
  }
  return blank;
}

/** Put the anchored message back where it was. False when it cannot be measured. */
function restoreAnchor(adapter: Adapter, doc: Document, scroller: HTMLElement, anchor: ViewAnchor): boolean {
  if (!anchor.placed || !anchor.key) return false;
  const el = adapter.messages(doc).find((n) => anchorKey(n) === anchor.key)?.el;
  if (!(el instanceof HTMLElement)) return false;
  const box = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (box.height <= 0 || r.height <= 0) return false;
  scroller.scrollTop = scroller.scrollTop + (r.top - box.top - anchor.viewportOffset);
  return true;
}

/**
 * Merges windows of a list read from top to bottom, keeping conversation order. Messages before the
 * first known one in a window go right before it; the rest follow their known neighbour; a window
 * with no known message at all comes after everything read so far (we only ever move down).
 */
export class OrderedMessages {
  private order: string[] = [];
  private byId = new Map<string, CapturedMessage>();
  private pos = new Map<string, number>();
  private posStale = false;

  /**
   * Adds one window. While walking, the longest rendering of a row wins (it may have been half
   * rendered before); a `settled` read (after the AI finished) replaces whatever was seen before.
   */
  add(batch: CapturedMessage[], opts: { settled?: boolean } = {}): void {
    let anchor: number | null = null; // index in `order` of the last known message from this batch
    let before: CapturedMessage[] = []; // new messages above the first known one
    for (const m of batch) {
      let at = this.indexOf(m.id);
      if (at >= 0) {
        const prev = this.byId.get(m.id);
        if (opts.settled || !prev || m.markdown.length >= prev.markdown.length) this.byId.set(m.id, m);
        if (anchor === null && before.length) {
          this.insert(at, before);
          at += before.length;
          before = [];
        }
        anchor = at;
      } else if (anchor === null) {
        before.push(m);
      } else {
        this.insert(anchor + 1, [m]);
        anchor++;
      }
    }
    if (before.length) this.insert(this.order.length, before);
  }

  get size(): number {
    return this.order.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Reorders by a known position per message (only when every message has one). */
  sortBy(pos: ReadonlyMap<string, number>): void {
    if (!this.order.every((id) => pos.has(id))) return;
    this.order.sort((a, b) => pos.get(a)! - pos.get(b)!);
    this.posStale = true;
  }

  list(): CapturedMessage[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  private indexOf(id: string): number {
    if (!this.byId.has(id)) return -1;
    if (this.posStale) {
      this.pos = new Map(this.order.map((x, i) => [x, i]));
      this.posStale = false;
    }
    return this.pos.get(id) ?? -1;
  }

  private insert(at: number, msgs: CapturedMessage[]): void {
    const append = at === this.order.length;
    this.order.splice(at, 0, ...msgs.map((m) => m.id));
    for (const [i, m] of msgs.entries()) {
      this.byId.set(m.id, m);
      if (append && !this.posStale) this.pos.set(m.id, at + i);
    }
    if (!append) this.posStale = true;
  }
}

/** Scroll step for the reading walk: always less than a viewport, so consecutive windows overlap. */
export function readStep(clientHeight: number): number {
  return Math.max(1, Math.min(clientHeight - 24, Math.round(clientHeight * 0.7)));
}

/** Some message row is rendered inside the scroller's visible box (true when there is no layout). */
function rowsInView(adapter: Adapter, doc: Document, scroller: HTMLElement): boolean {
  // A detached node is 0×0. That must not count as "every row is in view" or as the chat fitting.
  if (!scroller.isConnected) return false;
  const box = scroller.getBoundingClientRect();
  if (box.height <= 0) return true;
  return adapter.messages(doc).some((n) => {
    const r = n.el.getBoundingClientRect();
    return r.height > 0 && r.bottom > box.top && r.top < box.bottom;
  });
}

/** After a scroll: wait for the DOM to calm down and for rows to be rendered in the viewport. */
async function waitForRows(adapter: Adapter, doc: Document, scroller: HTMLElement, signal: AbortSignal, maxMs: number): Promise<void> {
  await settle(scroller, 120, 1200, signal);
  const start = performance.now();
  while (!rowsInView(adapter, doc, scroller) && performance.now() - start < maxMs) await settle(scroller, 80, 400, signal);
}

/** Missing positions 1..total, grouped into [from, to] ranges. */
function missingRanges(seen: ReadonlySet<number>, total: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let p = 1; p <= total; p++) {
    if (seen.has(p)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === p - 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

export async function captureFullHistory(adapter: Adapter, doc: Document, opts: InitOptions): Promise<InitResult> {
  const { signal, onProgress } = opts;
  signal.throwIfAborted();
  const found = adapter.scrollContainer(doc);
  if (!found?.isConnected) throw new InitIncompleteError('no-scroller');
  let scroller: HTMLElement = found;
  /**
   * The page can swap the scroller while older turns load. A disconnected node is 0×0, so keeping
   * it would mark the start as confirmed. A replacement is adopted only while the latched node is
   * still in the document; once that node is gone the read cannot be trusted. The visible message
   * is measured again on the new element: the previous distance belongs to the old one.
   */
  let anchor = measureAnchor(adapter, doc, scroller);
  const retarget = (): void => {
    if (!scroller.isConnected) throw new InitIncompleteError('no-scroller');
    const next = adapter.scrollContainer(doc);
    if (!next?.isConnected) throw new InitIncompleteError('no-scroller');
    if (next === scroller) return;
    scroller = next;
    anchor = measureAnchor(adapter, doc, scroller);
  };
  const maxLoadMs = opts.maxLoadMs ?? 10 * 60_000;
  const rowWaitMs = opts.rowWaitMs ?? 3000;
  const stallMs = opts.stallMs ?? 25_000;
  const acc = new OrderedMessages();
  const arts = new Map<string, CapturedArtifact>();
  // Coverage. A message row is covered once its body was read with content; a row the adapter does
  // not count as a message (e.g. a separator) is covered when seen. A message row seen only empty
  // (its body renders late) is not covered yet: it is visited again.
  /** Positions of message rows read with content. */
  const readPos = new Set<number>();
  /** Positions of rows that are not messages. */
  const otherPos = new Set<number>();
  /** Positions of message rows seen without content so far. */
  const emptyPos = new Set<number>();
  /** Service ids of messages seen without content (with where: the scroll offset), and of messages read with content. */
  const emptyAt = new Map<string, number>();
  const readIds = new Set<string>();
  const posById = new Map<string, number>();
  let readAt = new Date().toISOString();
  /** Previous window's ids, to tell whether consecutive windows overlap. */
  let lastWindow: Set<string> | null = null;
  const hasContent = (m: { markdown: string; kinds?: string[] }) => !!(m.markdown || m.kinds?.length);
  const covered = () => new Set([...readPos, ...[...otherPos].filter((p) => !emptyPos.has(p))]);
  /** Messages seen only without content (by service id). */
  const unread = () => [...emptyAt.keys()].filter((id) => !readIds.has(id));

  const read = (): CapturedMessage[] => {
    const rows = adapter.messages(doc).map((node) => ({ node, msg: captureMessage(adapter, node), pos: adapter.positionOf?.(node) ?? null }));
    const messagePos = new Set<number>();
    for (const r of rows) {
      if (r.pos) messagePos.add(r.pos);
      if (hasContent(r.msg)) {
        if (r.pos) {
          readPos.add(r.pos);
          emptyPos.delete(r.pos);
        }
        if (r.node.id) readIds.add(r.node.id);
      } else {
        if (r.pos && !readPos.has(r.pos)) emptyPos.add(r.pos);
        if (r.node.id && !emptyAt.has(r.node.id)) emptyAt.set(r.node.id, scroller.scrollTop);
      }
    }
    for (const p of adapter.rowPositions?.(doc) ?? []) if (!messagePos.has(p)) otherPos.add(p);
    const kept = rows.filter((r) => hasContent(r.msg));
    const msgs = assignIds(
      kept.map((r) => r.msg),
      acc.list(),
    );
    kept.forEach((r, i) => {
      if (r.pos) posById.set(msgs[i]!.id, r.pos);
    });
    return msgs;
  };
  /** Reads the current window; returns false when it did not overlap the previous one (a gap). */
  const harvest = (settled = false): boolean => {
    const batch = read();
    const overlaps = !lastWindow || !lastWindow.size || !batch.length || batch.some((m) => lastWindow!.has(m.id));
    if (batch.length) lastWindow = new Set(batch.map((m) => m.id));
    acc.add(batch, { settled });
    readAt = new Date().toISOString();
    return overlaps;
  };
  /** Visualizations mounted now. `fresh` asks again for ones already collected (final versions). */
  const collectArtifacts = async (fresh = false) => {
    if (!opts.artifacts) return;
    for (const a of await opts.artifacts(fresh ? new Set() : new Set(arts.keys()))) if (fresh || !arts.has(a.key)) arts.set(a.key, a);
  };
  const scrollTo = async (y: number) => {
    if (!scroller.isConnected) throw new InitIncompleteError('no-scroller');
    scroller.scrollTop = clampScroll(scroller, scrollReversed(adapter, scroller), y);
    scroller.dispatchEvent(new Event('scroll'));
    await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
  };
  /**
   * One walk from the top to the bottom; returns whether every step overlapped the previous one.
   * Fails as `stalled` when neither the scroll position nor the messages read move on for `stallMs`.
   */
  const walk = async (step: number, report: boolean): Promise<boolean> => {
    let gapless = true;
    lastWindow = null;
    const reversed = scrollReversed(adapter, scroller);
    await scrollTo(oldestScroll(scroller, reversed));
    // -Infinity so a reversed list, whose first position is negative, still counts as movement
    let furthest = -Infinity;
    let known = -1;
    let movedAt = performance.now();
    for (;;) {
      signal.throwIfAborted();
      if (!harvest()) gapless = false;
      await collectArtifacts();
      const axis = scrollReversed(adapter, scroller);
      if (report) onProgress({ stage: 'reading', count: acc.size, progress: 0.25 + 0.75 * walkProgress(scroller, axis) });
      if (atNewest(scroller, axis)) return gapless;
      if (scroller.scrollTop > furthest + 1 || acc.size > known) {
        furthest = Math.max(furthest, scroller.scrollTop);
        known = acc.size;
        movedAt = performance.now();
      } else if (performance.now() - movedAt >= stallMs) {
        throw new InitIncompleteError('stalled');
      }
      await scrollTo(scroller.scrollTop + step);
    }
  };
  /** A message row was seen only empty: give late bodies time to render, then read the window again. */
  const revisit = async () => {
    await sleep(rowWaitMs, signal);
    harvest();
    await collectArtifacts();
  };
  /**
   * Messages seen only without their body: go back to where each was seen, after a wait, twice at
   * most. What stays empty after that is an empty message (e.g. a reply that is only tool use).
   */
  const revisitUnread = async () => {
    for (let round = 0; round < 2 && unread().length; round++) {
      if (!adapter.virtualized) {
        await revisit();
        continue;
      }
      for (const y of new Set(unread().map((id) => emptyAt.get(id)!))) {
        await scrollTo(y);
        await revisit();
      }
    }
  };

  try {
    // ---- 1. load everything above
    const loadStart = performance.now();
    const topQuietMs = adapter.topQuietMs ?? 2500;
    let quietSince = 0;
    let stable = 0;
    let lastCount = -1;
    let lastHeight = -1;
    for (;;) {
      if (performance.now() - loadStart >= maxLoadMs) throw new InitIncompleteError('timeout');
      retarget();
      scrollTowardOldest(scroller, scrollReversed(adapter, scroller));
      await settle(scroller, 450, 4000, signal);
      const count = adapter.loadedCount(doc) ?? adapter.messages(doc).length;
      const height = scroller.scrollHeight;
      const unchanged = count === lastCount && height === lastHeight && atOldest(scroller, scrollReversed(adapter, scroller));
      stable = unchanged && !adapter.isLoadingOlder(doc) ? stable + 1 : 0;
      if (stable === 1) quietSince = performance.now();
      lastCount = count;
      lastHeight = height;
      onProgress({ stage: 'loading', count, progress: 0.25 * (1 - Math.exp(-count / 400)) });
      // Sites re-anchor after each batch. Quiet ends loading but does not prove the true start.
      if (stable >= 2 && performance.now() - quietSince >= topQuietMs) break;
    }
    retarget();
    const startConfirmed = scroller.scrollHeight <= scroller.clientHeight + 4 && adapter.messages(doc).length > 0;

    // ---- 2. read top to bottom
    if (adapter.virtualized) {
      const step = readStep(scroller.clientHeight);
      const gapless = await walk(step, true);
      if (adapter.positionOf) {
        // the site numbers its rows: every position up to the total must have been read
        for (let attempt = 0; ; attempt++) {
          const total = adapter.loadedCount(doc);
          const missing = total ? missingRanges(covered(), total) : [];
          if (!missing.length) break;
          if (attempt >= 3) {
            // rows never seen are a gap; message rows seen only empty get their late-body visits
            // below (revisitUnread), and what stays empty is an empty message, not a missing one
            const seen = (p: number) => readPos.has(p) || otherPos.has(p) || emptyPos.has(p);
            if (missing.some(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i).some((p) => !seen(p)))) {
              throw new InitIncompleteError('coverage');
            }
            break;
          }
          for (const [from, to] of missing) {
            const at = (p: number) => ((p - 1) / total!) * scroller.scrollHeight;
            for (let y = at(from) - scroller.clientHeight / 2; y <= at(to) + scroller.clientHeight / 2; y += step) {
              await scrollTo(y);
              harvest();
              await collectArtifacts();
            }
          }
        }
        await revisitUnread();
        acc.sortBy(posById);
      } else {
        // two consecutive windows shared no message: something may have been skipped, read again finer
        if (!gapless && !(await walk(Math.max(1, Math.round(step / 2)), false))) throw new InitIncompleteError('coverage');
        await revisitUnread();
      }
    } else {
      // every loaded message is in the DOM: one read is enough (plus a wait for late bodies)
      await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
      harvest();
      await revisitUnread();
      onProgress({ stage: 'reading', count: acc.size, progress: 0.9 });
    }

    // ---- 3. an answer still running? wait for it to finish
    if (opts.busy?.()) {
      const since = performance.now();
      const maxWait = opts.maxBusyWaitMs ?? 10 * 60_000;
      while (opts.busy()) {
        if (performance.now() - since > maxWait) throw new InitIncompleteError('busy');
        await sleep(400, signal);
      }
    }
    // the settled end of the conversation replaces anything provisional read before
    if (adapter.virtualized) await scrollTo(newestScroll(scroller, scrollReversed(adapter, scroller)));
    retarget();
    if (!rowsInView(adapter, doc, scroller)) throw new InitIncompleteError('coverage');
    harvest(true);
    await collectArtifacts(true);
    onProgress({ stage: 'reading', count: acc.size, progress: 1 });
    // No supported site loads so few messages in batches; a small chat can have a tall answer.
    const whole = startConfirmed || acc.size <= SMALL_CHAT_MESSAGES;
    return { messages: acc.list(), artifacts: [...arts.values()], readAt, startConfirmed: whole };
  } finally {
    // back to the message that was visible — also after a cancel or a failure, but only while this
    // conversation still owns the scroller. Growth below that message does not change its place.
    if (scroller.isConnected && (opts.owns?.() ?? true) && !restoreAnchor(adapter, doc, scroller, anchor)) {
      if (scrollReversed(adapter, scroller)) scroller.scrollTop = anchor.scrollTop;
      else {
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - anchor.fromBottom);
        if (Math.abs(scroller.scrollTop - anchor.scrollTop) < 4) scroller.scrollTop = anchor.scrollTop;
      }
    }
  }
}
