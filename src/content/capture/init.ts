// Init: capture the whole history of a chat, however long.
//
// 1. Loading — scroll the conversation to the very top again and again until the site stops adding
//    older messages (it loads them lazily, in batches). Reported as a growing message count.
// 2. Reading — walk from the top to the bottom in steps and collect every message by ID. Lists that
//    are virtualized (only ~20 rows in the DOM at a time) are read correctly because we harvest
//    while scrolling. Reported as 0–100 %.
// Then the original scroll position is restored. Can be cancelled with an AbortSignal.

import type { Adapter } from '../adapters/types';
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
  /** Give up loading older messages after this long (huge chats can still be read partially). */
  maxLoadMs?: number;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });

/** Resolve after `quietMs` without DOM changes under `root`, or after `maxMs`. */
function settle(root: Node, quietMs: number, maxMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let quiet = 0;
    const done = () => {
      mo.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve();
    };
    const mo = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = window.setTimeout(done, quietMs);
    });
    mo.observe(root, { subtree: true, childList: true });
    quiet = window.setTimeout(done, quietMs);
    const cap = window.setTimeout(done, maxMs);
    signal.addEventListener(
      'abort',
      () => {
        mo.disconnect();
        clearTimeout(quiet);
        clearTimeout(cap);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

function scrollToTop(el: HTMLElement): void {
  el.scrollTop = 0;
  el.dispatchEvent(new Event('scroll'));
  // some lists only react to user-like wheel input
  el.dispatchEvent(new WheelEvent('wheel', { deltaY: -800, bubbles: true }));
}

/** Insert newly seen messages keeping conversation order (they arrive in DOM order). */
export class OrderedMessages {
  private order: string[] = [];
  private byId = new Map<string, CapturedMessage>();

  add(batch: CapturedMessage[]): void {
    let anchor = -1; // index in `order` of the last known message from this batch
    for (const m of batch) {
      const at = this.order.indexOf(m.id);
      if (at >= 0) {
        // keep the longest rendering (a row may have been half-rendered on an earlier pass)
        const prev = this.byId.get(m.id);
        if (!prev || m.markdown.length >= prev.markdown.length) this.byId.set(m.id, m);
        anchor = at;
        continue;
      }
      this.order.splice(anchor + 1, 0, m.id);
      this.byId.set(m.id, m);
      anchor++;
    }
  }

  get size(): number {
    return this.order.length;
  }

  list(): CapturedMessage[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }
}

export async function captureFullHistory(adapter: Adapter, doc: Document, opts: InitOptions): Promise<CapturedMessage[]> {
  const { signal, onProgress } = opts;
  const scroller = adapter.scrollContainer(doc);
  if (!scroller) throw new Error('Could not find the conversation’s scroll area');
  const restoreTo = scroller.scrollTop;
  const fromBottom = scroller.scrollHeight - scroller.scrollTop;
  const maxLoadMs = opts.maxLoadMs ?? 10 * 60_000;

  // ---- 1. load everything above
  const loadStart = performance.now();
  const topQuietMs = adapter.topQuietMs ?? 2500;
  let quietSince = 0;
  let stable = 0;
  let lastCount = -1;
  let lastHeight = -1;
  while (performance.now() - loadStart < maxLoadMs) {
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
    // the site says the first message is here, or nothing changed for a while (sites without a
    // start marker re-anchor the scroll after every batch, so be patient before calling it the top)
    if (adapter.isAtStart(doc) && stable >= 1) break;
    if (stable >= 2 && performance.now() - quietSince >= topQuietMs) break;
  }

  // ---- 2. read top to bottom
  const acc = new OrderedMessages();
  const harvest = () => acc.add(assignIds(adapter.messages(doc).map((n) => captureMessage(adapter, n)).filter((m) => m.markdown || m.kinds?.length)));
  scroller.scrollTop = 0;
  await sleep(120, signal);
  for (;;) {
    harvest();
    const max = scroller.scrollHeight - scroller.clientHeight;
    const progress = max > 0 ? scroller.scrollTop / max : 1;
    onProgress({ stage: 'reading', count: acc.size, progress: 0.25 + 0.75 * progress });
    if (scroller.scrollTop >= max - 2) break;
    scroller.scrollTop = Math.min(max, scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.7));
    scroller.dispatchEvent(new Event('scroll'));
    await settle(scroller, 120, 1200, signal);
  }
  harvest();

  // ---- back to where the user was (measured from the bottom: the list grew above them)
  scroller.scrollTop = Math.max(0, scroller.scrollHeight - fromBottom);
  if (Math.abs(scroller.scrollTop - restoreTo) < 4) scroller.scrollTop = restoreTo;
  return acc.list();
}
