// Init: capture the whole history of a chat, however long.
//
// 1. Loading — scroll the conversation to the very top again and again until the site stops adding
//    older messages (it loads them lazily, in batches). Reported as a growing message count. Only a
//    long quiet period at the top counts as "the start": no site gives a trustworthy marker (Claude's
//    aria-posinset="1" is the first *loaded* row). Running out of time is an error, never a success.
// 2. Reading — virtualized lists (only ~20 rows in the DOM at a time) are walked from the top to the
//    bottom in overlapping steps, collecting every message by ID and every visualization while it is
//    mounted. After each step we wait until rows are rendered in the viewport. Coverage is checked:
//    against the site's row positions where it has them (Claude), otherwise by requiring every step
//    to overlap the previous one (a gap triggers one finer pass). Missing coverage is an error.
//    Lists that keep all loaded messages in the DOM are read once. Reported as 0–100 %.
// 3. If the AI is still answering, wait for it to finish; then read the end again — that settled read
//    replaces earlier, provisional text and visualizations.
// The original scroll position is restored afterwards (also on cancel or failure) while the
// conversation still owns the scroller.

import type { Adapter, CapturedArtifact } from '../adapters/types';
import type { CapturedMessage } from '../../shared/types';
import { assignIds, captureMessage } from './snapshot';

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
}

export interface InitResult {
  messages: CapturedMessage[];
  artifacts: CapturedArtifact[];
  /** ISO time of the last read of the page. */
  readAt: string;
}

/** The history could not be loaded completely; nothing partial is ever reported as complete. */
export class InitIncompleteError extends Error {
  constructor(readonly reason: 'timeout' | 'busy' | 'no-scroller' | 'empty' | 'one-sided' | 'coverage') {
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

function scrollToTop(el: HTMLElement): void {
  el.scrollTop = 0;
  el.dispatchEvent(new Event('scroll'));
  // some lists only react to user-like wheel input
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, bubbles: true }));
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
  const scroller = adapter.scrollContainer(doc);
  if (!scroller) throw new InitIncompleteError('no-scroller');
  const restoreTo = scroller.scrollTop;
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const maxLoadMs = opts.maxLoadMs ?? 10 * 60_000;
  const rowWaitMs = opts.rowWaitMs ?? 3000;
  const acc = new OrderedMessages();
  const arts = new Map<string, CapturedArtifact>();
  /** Positions of every row seen (also rows without content), and each message's position. */
  const seenPos = new Set<number>();
  const posById = new Map<string, number>();
  let readAt = new Date().toISOString();
  /** Previous window's ids, to tell whether consecutive windows overlap. */
  let lastWindow: Set<string> | null = null;

  const read = (): CapturedMessage[] => {
    const rows = adapter.messages(doc).map((node) => ({ node, msg: captureMessage(adapter, node), pos: adapter.positionOf?.(node) ?? null }));
    for (const r of rows) if (r.pos) seenPos.add(r.pos);
    for (const p of adapter.rowPositions?.(doc) ?? []) seenPos.add(p);
    const kept = rows.filter((r) => r.msg.markdown || r.msg.kinds?.length);
    const msgs = assignIds(kept.map((r) => r.msg));
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
    const max = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTop = Math.max(0, Math.min(max, y));
    scroller.dispatchEvent(new Event('scroll'));
    await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
  };
  /** One walk from the top to the bottom; returns whether every step overlapped the previous one. */
  const walk = async (step: number, report: boolean): Promise<boolean> => {
    let gapless = true;
    lastWindow = null;
    await scrollTo(0);
    for (;;) {
      signal.throwIfAborted();
      if (!harvest()) gapless = false;
      await collectArtifacts();
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (report) onProgress({ stage: 'reading', count: acc.size, progress: 0.25 + 0.75 * (max > 0 ? scroller.scrollTop / max : 1) });
      if (scroller.scrollTop >= max - 2) return gapless;
      await scrollTo(scroller.scrollTop + step);
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
      scrollToTop(scroller);
      await settle(scroller, 450, 4000, signal);
      const count = adapter.loadedCount(doc) ?? adapter.messages(doc).length;
      const height = scroller.scrollHeight;
      const unchanged = count === lastCount && height === lastHeight && scroller.scrollTop <= 2;
      stable = unchanged && !adapter.isLoadingOlder(doc) ? stable + 1 : 0;
      if (stable === 1) quietSince = performance.now();
      lastCount = count;
      lastHeight = height;
      onProgress({ stage: 'loading', count, progress: 0.25 * (1 - Math.exp(-count / 400)) });
      // sites re-anchor the scroll after every batch and none marks the true start reliably, so only
      // a long, complete quiet period at the top counts as having reached it
      if (stable >= 2 && performance.now() - quietSince >= topQuietMs) break;
    }

    // ---- 2. read top to bottom
    if (adapter.virtualized) {
      const step = readStep(scroller.clientHeight);
      const gapless = await walk(step, true);
      if (adapter.positionOf) {
        // the site numbers its rows: every position up to the total must have been read
        for (let attempt = 0; ; attempt++) {
          const total = adapter.loadedCount(doc);
          const missing = total ? missingRanges(seenPos, total) : [];
          if (!missing.length) break;
          if (attempt >= 3) throw new InitIncompleteError('coverage');
          for (const [from, to] of missing) {
            const at = (p: number) => ((p - 1) / total!) * scroller.scrollHeight;
            for (let y = at(from) - scroller.clientHeight / 2; y <= at(to) + scroller.clientHeight / 2; y += step) {
              await scrollTo(y);
              harvest();
              await collectArtifacts();
            }
          }
        }
        acc.sortBy(posById);
      } else if (!gapless) {
        // two consecutive windows shared no message: something may have been skipped, read again finer
        if (!(await walk(Math.max(1, Math.round(step / 2)), false))) throw new InitIncompleteError('coverage');
      }
    } else {
      // every loaded message is in the DOM: one read is enough
      await waitForRows(adapter, doc, scroller, signal, rowWaitMs);
      harvest();
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
    if (adapter.virtualized) await scrollTo(scroller.scrollHeight);
    if (!rowsInView(adapter, doc, scroller)) throw new InitIncompleteError('coverage');
    harvest(true);
    await collectArtifacts(true);
    onProgress({ stage: 'reading', count: acc.size, progress: 1 });
    return { messages: acc.list(), artifacts: [...arts.values()], readAt };
  } finally {
    // back to where the user was (measured from the bottom: the list grew above them) — also after
    // a cancel or a failure, but only while this conversation still owns the scroller
    if (scroller.isConnected && (opts.owns?.() ?? true)) {
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - fromBottom);
      if (Math.abs(scroller.scrollTop - restoreTo) < 4) scroller.scrollTop = restoreTo;
    }
  }
}
