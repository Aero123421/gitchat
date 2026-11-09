// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFullHistory, InitIncompleteError, OrderedMessages, readStep } from '../../src/content/capture/init';
import type { Adapter, MessageNode } from '../../src/content/adapters/types';
import type { CapturedMessage } from '../../src/shared/types';

const m = (id: string, markdown = id): CapturedMessage => ({ id, role: id.startsWith('u') ? 'user' : 'assistant', markdown });

describe('OrderedMessages (harvest while scrolling a virtualized list)', () => {
  it('merges overlapping windows top to bottom without duplicates', () => {
    const acc = new OrderedMessages();
    acc.add([m('u1'), m('a1'), m('u2')]);
    acc.add([m('a1'), m('u2'), m('a2'), m('u3')]);
    acc.add([m('u3'), m('a3')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  });

  it('inserts rows that appear between known ones in the right place', () => {
    const acc = new OrderedMessages();
    acc.add([m('u1'), m('a2')]);
    acc.add([m('u1'), m('a1'), m('u2'), m('a2')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keeps the most complete rendering of a row', () => {
    const acc = new OrderedMessages();
    acc.add([m('a1', 'partial')]);
    acc.add([m('a1', 'partial and complete')]);
    expect(acc.list()[0]?.markdown).toBe('partial and complete');
  });

  it('appends a window that does not overlap the previous one (reading downwards)', () => {
    const acc = new OrderedMessages();
    acc.add([m('u1'), m('a1')]);
    acc.add([m('u2'), m('a2')]);
    acc.add([m('a2'), m('u3')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
  });

  it('puts unknown rows above the first known one before it', () => {
    const acc = new OrderedMessages();
    acc.add([m('u2'), m('a2')]);
    acc.add([m('u1'), m('a1'), m('u2')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('stays fast on long histories', () => {
    const acc = new OrderedMessages();
    const all = Array.from({ length: 4000 }, (_, i) => m(`${i % 2 ? 'a' : 'u'}${i}`));
    const t0 = performance.now();
    for (let i = 0; i < all.length; i += 10) acc.add(all.slice(Math.max(0, i - 10), i + 20));
    expect(acc.size).toBe(4000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('always scrolls less than a viewport so windows overlap', () => {
    for (const h of [80, 150, 300, 900]) expect(readStep(h)).toBeLessThan(h);
  });
});

/** A scroller with a fake layout: every loaded message is 100 px tall. */
function harness(opts: { total: number; batch: number; delayMs: number; virtualized: boolean; startMarker?: boolean; neverSettles?: boolean }) {
  document.body.innerHTML = '';
  const scroller = document.createElement('div');
  document.body.appendChild(scroller);
  let loaded = Math.min(opts.total, opts.batch);
  let top = 0;
  let fetching = false;
  let extra = 0;
  const render = () => {
    scroller.innerHTML = '';
    const first = opts.total - loaded;
    for (let i = first; i < opts.total; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
      el.textContent = `message ${i}`;
      scroller.appendChild(el);
    }
  };
  render();
  Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => loaded * 100 + extra });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, loaded * 100 - 500));
      if (top === 0 && loaded < opts.total && !fetching) {
        // the site fetches the next batch of older messages after a delay
        fetching = true;
        setTimeout(() => {
          loaded = Math.min(opts.total, loaded + opts.batch);
          fetching = false;
          top = opts.batch * 100; // re-anchored to where the user was
          render();
        }, opts.delayMs);
      }
    },
  });
  const adapter: Adapter = {
    service: 'claude',
    virtualized: opts.virtualized,
    chatId: () => 'c',
    title: () => 't',
    messages: () =>
      Array.from(scroller.children).map((el): MessageNode => ({ el, role: el.getAttribute('data-role') as 'user' | 'assistant', id: `m${el.getAttribute('data-i')}` })),
    body: (n) => n.el,
    markdown: {},
    scrollContainer: () => scroller,
    isGenerating: () => false,
    isLoadingOlder: () => false,
    isAtStart: () => !!opts.startMarker, // a "first loaded row" marker, like Claude's aria-posinset
    loadedCount: () => {
      if (opts.neverSettles) extra += 1;
      return loaded + (opts.neverSettles ? extra : 0);
    },
    aiPhase: () => 'idle',
    composer: () => null,
    theme: () => 'light',
    topQuietMs: 2500,
  };
  return { adapter, scroller, setTop: (v: number) => (top = v) };
}

describe('captureFullHistory', () => {
  afterEach(() => vi.useRealTimers());

  it('does not stop at a "first loaded row" marker while older history is still coming', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = harness({ total: 96, batch: 32, delayMs: 2500, virtualized: false, startMarker: true });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await run;
    expect(res.messages).toHaveLength(96);
    expect(res.messages[0]?.id).toBe('m0');
  });

  it('fails instead of reporting a partial history as complete when loading never settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller, setTop } = harness({ total: 40, batch: 40, delayMs: 100, virtualized: false, neverSettles: true });
    setTop(1600);
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, maxLoadMs: 20_000 });
    const failed = expect(run).rejects.toBeInstanceOf(InitIncompleteError);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    // and the user is back at the same message (measured from the bottom: the list grew above it)
    expect(scroller.scrollHeight - scroller.scrollTop).toBe(fromBottom);
  });

  it('restores the scroll position when cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller, setTop } = harness({ total: 64, batch: 32, delayMs: 500, virtualized: true });
    setTop(2000);
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    const abort = new AbortController();
    const run = captureFullHistory(adapter, document, { signal: abort.signal, onProgress: () => {} });
    const failed = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(700);
    abort.abort();
    await vi.advanceTimersByTimeAsync(10);
    await failed;
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollHeight - scroller.scrollTop).toBe(fromBottom);
  });

  it('refuses an already cancelled signal right away', async () => {
    const { adapter } = harness({ total: 4, batch: 4, delayMs: 10, virtualized: false });
    const abort = new AbortController();
    abort.abort();
    await expect(captureFullHistory(adapter, document, { signal: abort.signal, onProgress: () => {} })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('waits for a running answer before finishing, then reads the end again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller } = harness({ total: 4, batch: 4, delayMs: 10, virtualized: false });
    let busy = true;
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, busy: () => busy });
    await vi.advanceTimersByTimeAsync(10_000);
    // the answer finishes while init waits
    const last = scroller.lastElementChild!;
    last.textContent = 'message 3, now complete';
    busy = false;
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await run;
    expect(res.messages.at(-1)?.markdown).toBe('message 3, now complete');
  });

  it('collects visualizations while reading, without asking a frame twice', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = harness({ total: 20, batch: 20, delayMs: 10, virtualized: true });
    const asked: string[] = [];
    const artifacts = async (skip: ReadonlySet<string>) => {
      const out = [];
      for (const key of ['k1', 'k2']) {
        if (skip.has(key)) continue;
        asked.push(key);
        out.push({ key, messageId: null, title: key, html: `<p>${key}</p>` });
      }
      return out;
    };
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, artifacts });
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await run;
    expect(res.artifacts.map((a) => a.key)).toEqual(['k1', 'k2']);
    // once while walking, and once more for the settled final read
    expect(asked).toEqual(['k1', 'k2', 'k1', 'k2']);
  });

  it('lets the settled final read replace provisional text and visualizations (R2-M3 / N13)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller } = harness({ total: 4, batch: 4, delayMs: 10, virtualized: false });
    const last = scroller.lastElementChild!;
    last.textContent = 'a long provisional answer that will be rewritten';
    let html = 'DRAFT';
    let busy = true;
    const artifacts = async () => [{ key: 'k', messageId: 'm3', title: 'Chart', html }];
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, busy: () => busy, artifacts });
    await vi.advanceTimersByTimeAsync(10_000);
    last.textContent = 'short final';
    html = 'FINAL';
    busy = false;
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await run;
    expect(res.messages.at(-1)?.markdown).toBe('short final');
    expect(res.artifacts[0]?.html).toBe('FINAL');
  });

  it('waits for rows to render in the viewport after each step, so a slow virtualizer is read in full (N3)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller } = slowList({ total: 40, renderDelayMs: 300 });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await run;
    expect(res.messages.map((m) => m.id)).toEqual(Array.from({ length: 40 }, (_, i) => `m${i}`));
    expect(scroller.isConnected).toBe(true);
  });

  it('fails when the site numbers more rows than could be read (N3)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = slowList({ total: 20, renderDelayMs: 0, positions: true, claimTotal: 22 });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    const failed = expect(run).rejects.toMatchObject({ reason: 'coverage' });
    await vi.advanceTimersByTimeAsync(300_000);
    await failed;
  });

  it('reads every numbered row and orders by position (N3)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = slowList({ total: 30, renderDelayMs: 0, positions: true });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await run;
    expect(res.messages.map((m) => m.id)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
  });

  it('leaves the scroll alone on cancel when the conversation no longer owns the scroller (N16)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter, scroller, setTop } = harness({ total: 64, batch: 32, delayMs: 500, virtualized: true });
    setTop(2000);
    let owns = true;
    const abort = new AbortController();
    const run = captureFullHistory(adapter, document, { signal: abort.signal, onProgress: () => {}, owns: () => owns });
    const failed = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(700);
    owns = false; // another conversation now uses the same scroller…
    setTop(1800);
    abort.abort();
    await vi.advanceTimersByTimeAsync(10);
    await failed;
    expect(scroller.scrollTop).toBe(1800); // …and its position is untouched
  });
});

/**
 * A virtualized list with layout: rows are 100 px, the viewport 500 px, and only rows near the
 * viewport are in the DOM — rendered `renderDelayMs` after each scroll.
 */
function slowList(opts: { total: number; renderDelayMs: number; positions?: boolean; claimTotal?: number }) {
  document.body.innerHTML = '';
  const scroller = document.createElement('div');
  document.body.appendChild(scroller);
  let top = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rowRect = (i: number) => ({ top: i * 100 - top, bottom: i * 100 - top + 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: i * 100 - top, toJSON() {} });
  const render = () => {
    scroller.innerHTML = '';
    const first = Math.max(0, Math.floor(top / 100) - 2);
    const last = Math.min(opts.total - 1, Math.floor((top + 500) / 100) + 2);
    for (let i = first; i <= last; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
      el.textContent = `message ${i}`;
      el.getBoundingClientRect = () => rowRect(i) as DOMRect;
      scroller.appendChild(el);
    }
  };
  render();
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => opts.total * 100 });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, opts.total * 100 - 500));
      if (timer) clearTimeout(timer);
      if (opts.renderDelayMs) timer = setTimeout(render, opts.renderDelayMs);
      else render();
    },
  });
  const adapter: Adapter = {
    service: 'claude',
    virtualized: true,
    chatId: () => 'c',
    title: () => 't',
    messages: () =>
      Array.from(scroller.children).map((el): MessageNode => ({ el, role: el.getAttribute('data-role') as 'user' | 'assistant', id: `m${el.getAttribute('data-i')}` })),
    body: (n) => n.el,
    markdown: {},
    scrollContainer: () => scroller,
    isGenerating: () => false,
    isLoadingOlder: () => false,
    isAtStart: () => false,
    loadedCount: () => opts.claimTotal ?? opts.total,
    aiPhase: () => 'idle',
    composer: () => null,
    theme: () => 'light',
    topQuietMs: 500,
    ...(opts.positions ? { positionOf: (n: MessageNode) => Number(n.el.getAttribute('data-i')) + 1 } : {}),
  };
  return { adapter, scroller };
}
