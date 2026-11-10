// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureFullHistory, InitIncompleteError, OrderedMessages, readStep } from '../../src/content/capture/init';
import { assignIds, isAtEnd } from '../../src/content/capture/snapshot';
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

  it('keeps a repeated reply\'s identity when the next window starts on it', () => {
    const raw = (markdown: string) => ({ id: null, role: 'assistant' as const, markdown });
    const acc = new OrderedMessages();
    acc.add(assignIds([raw('OK'), raw('OK')]));
    acc.add(assignIds([raw('OK'), raw('next')], acc.list()));
    expect(acc.list().map((x) => x.markdown)).toEqual(['OK', 'OK', 'next']);
  });

  it('replaces a short fragment when the same reply grows', () => {
    const raw = (markdown: string) => ({ id: null, role: 'assistant' as const, markdown });
    const acc = new OrderedMessages();
    acc.add(assignIds([raw('Hel')]));
    acc.add(assignIds([raw('Hello')], acc.list()));
    expect(acc.list().map((x) => x.markdown)).toEqual(['Hello']);
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

  it('fails when the latched scroller is replaced by a detached node', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = harness({ total: 40, batch: 20, delayMs: 100, virtualized: false });
    const live = adapter.scrollContainer;
    adapter.scrollContainer = (doc) => {
      if (performance.now() > 1000) {
        const dead = document.createElement('div');
        Object.defineProperty(dead, 'clientHeight', { get: () => 0 });
        Object.defineProperty(dead, 'scrollHeight', { get: () => 0 });
        return dead;
      }
      return live(doc);
    };
    let result: unknown = 'pending';
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} }).then(
      () => {
        result = 'ok';
      },
      (e: unknown) => {
        result = e;
      },
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
    expect(result).toBeInstanceOf(InitIncompleteError);
    expect((result as InitIncompleteError).reason).toBe('no-scroller');
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

  it('does not count a message row as read before its body has rendered (review 1-4)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    // 30 numbered rows; answer 17's body renders only after 5 s (the reviewer saw 29 messages at 4.8 s)
    const { adapter } = slowList({ total: 30, renderDelayMs: 0, positions: true, lateBody: { index: 17, untilMs: 5000 } });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await run;
    expect(res.messages.map((m) => m.id)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
    expect(res.messages[17]?.markdown).toBe('message 17');
  });

  it('accepts a message row that stays empty through every visit (an empty reply), without failing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = slowList({ total: 30, renderDelayMs: 0, positions: true, lateBody: { index: 17, untilMs: Infinity } });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(300_000);
    const res = await run;
    expect(res.messages).toHaveLength(29);
    expect(res.messages.some((m) => m.id === 'm17')).toBe(false);
  });

  it('waits for a late body on a list without row numbers too', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = slowList({ total: 30, renderDelayMs: 0, lateBody: { index: 17, untilMs: 5000 } });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(120_000);
    const res = await run;
    expect(res.messages.map((m) => m.id)).toContain('m17');
    expect(res.messages).toHaveLength(30);
  });

  it('fails as stalled when the reading walk stops moving, instead of reading forever (review 2-1)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    const { adapter } = slowList({ total: 30, renderDelayMs: 0, stuck: true });
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, stallMs: 20_000 });
    const failed = expect(run).rejects.toMatchObject({ reason: 'stalled' });
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
  });

  it('confirms the start of a full read once the oldest end stays quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    // 4 messages of 100 px in a 500 px scroller: everything is on screen
    const short = harness({ total: 4, batch: 4, delayMs: 10, virtualized: false });
    let run = captureFullHistory(short.adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await run).startConfirmed).toBe(true);
    // a short chat taller than the screen (a long answer to an edited first question) is still whole
    const tall = harness({ total: 6, batch: 6, delayMs: 10, virtualized: false });
    run = captureFullHistory(tall.adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await run).startConfirmed).toBe(true);
    const longer = harness({ total: 12, batch: 12, delayMs: 10, virtualized: false });
    run = captureFullHistory(longer.adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await run).startConfirmed).toBe(true);
    // a long chat that reached the oldest end and went quiet is the whole branch, not a prefix
    const long = harness({ total: 96, batch: 32, delayMs: 2500, virtualized: false });
    run = captureFullHistory(long.adapter, document, { signal: new AbortController().signal, onProgress: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await run;
    expect(res.messages).toHaveLength(96);
    expect(res.messages[0]?.id).toBe('m0');
    expect(res.startConfirmed).toBe(true);
  });

  it('keeps the visible message in place when the transcript grows below it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    document.body.innerHTML = '';
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    const row = 100;
    const client = 200;
    const n = 10;
    let top = 100;
    let extra = 0;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
      el.textContent = `message ${i}`;
      const index = i;
      el.getBoundingClientRect = () => {
        const y = index * row - top;
        return { top: y, bottom: y + row, height: row, left: 0, right: 80, width: 80, x: 0, y, toJSON() {} } as DOMRect;
      };
      scroller.appendChild(el);
    }
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: client, height: client, left: 0, right: 80, width: 80, x: 0, y: 0, toJSON() {} }) as DOMRect;
    Object.defineProperty(scroller, 'clientHeight', { get: () => client });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => n * row + extra });
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, n * row + extra - client));
      },
    });
    const adapter: Adapter = {
      service: 'claude',
      virtualized: false,
      chatId: () => 'c',
      title: () => 't',
      messages: () =>
        Array.from(scroller.children).map((el): MessageNode => ({ el, role: el.getAttribute('data-role') as 'user' | 'assistant', id: `m${el.getAttribute('data-i')}` })),
      body: (n0) => n0.el,
      markdown: {},
      scrollContainer: () => scroller,
      isGenerating: () => false,
      isLoadingOlder: () => false,
      isAtStart: () => false,
      loadedCount: () => n,
      aiPhase: () => 'idle',
      composer: () => null,
      theme: () => 'light',
      topQuietMs: 200,
    };
    let grew = false;
    const run = captureFullHistory(adapter, document, {
      signal: new AbortController().signal,
      onProgress: () => {},
      rowWaitMs: 20,
      busy: () => {
        if (grew) return false;
        grew = true;
        extra = 400;
        return true;
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await run;
    expect(scroller.scrollTop).toBe(100);
  });

  it('measures the new scroller when the page replaces it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    document.body.innerHTML = '';
    const make = (height: number, scrollHeight: number, start: number, text: string) => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      let top = start;
      Object.defineProperty(el, 'clientHeight', { get: () => height });
      Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight });
      Object.defineProperty(el, 'scrollTop', {
        get: () => top,
        set: (v: number) => {
          top = Math.max(0, Math.min(v, scrollHeight - height));
        },
      });
      const row = document.createElement('div');
      row.textContent = text;
      row.setAttribute('data-role', 'user');
      el.appendChild(row);
      return el;
    };
    const older = make(500, 1000, 100, 'on the first scroller');
    const newer = make(200, 3000, 40, 'on the replacement');
    let calls = 0;
    const adapter: Adapter = {
      service: 'claude',
      virtualized: false,
      chatId: () => 'c',
      title: () => 't',
      messages: () => {
        const root = calls >= 2 ? newer : older;
        return Array.from(root.children).map((el): MessageNode => ({ el, role: 'user', id: el.textContent }));
      },
      body: (node) => node.el,
      markdown: {},
      scrollContainer: () => {
        calls += 1;
        return calls === 1 ? older : newer;
      },
      isGenerating: () => false,
      isLoadingOlder: () => false,
      isAtStart: () => false,
      loadedCount: () => 1,
      aiPhase: () => 'idle',
      composer: () => null,
      theme: () => 'light',
      topQuietMs: 200,
    };
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, rowWaitMs: 20 });
    await vi.advanceTimersByTimeAsync(30_000);
    await run;
    expect(newer.scrollTop).toBe(40);
  });

  it('walks a column-reverse transcript from older history toward scrollTop 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    document.body.innerHTML = '';
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    const client = 300;
    const total = 12;
    const scrollHeight = total * 100;
    let top = -200;
    for (let i = 0; i < total; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
      el.textContent = `message ${i}`;
      scroller.appendChild(el);
    }
    Object.defineProperty(scroller, 'clientHeight', { get: () => client });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => scrollHeight });
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        const min = Math.min(0, client - scrollHeight);
        top = Math.max(min, Math.min(0, v));
      },
    });
    const adapter: Adapter = {
      service: 'claude',
      virtualized: true,
      chatId: () => 'c',
      title: () => 't',
      messages: () =>
        Array.from(scroller.children).map((el): MessageNode => ({ el, role: el.getAttribute('data-role') as 'user' | 'assistant', id: `m${el.getAttribute('data-i')}` })),
      body: (node) => node.el,
      markdown: {},
      scrollContainer: () => scroller,
      isGenerating: () => false,
      isLoadingOlder: () => false,
      isAtStart: () => false,
      loadedCount: () => total,
      aiPhase: () => 'idle',
      composer: () => null,
      theme: () => 'light',
      topQuietMs: 200,
    };
    (adapter as { scrollReversed?: boolean }).scrollReversed = true;
    const run = captureFullHistory(adapter, document, { signal: new AbortController().signal, onProgress: () => {}, rowWaitMs: 20, stallMs: 8_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await run;
    expect(res.messages.map((m) => m.id)).toEqual(Array.from({ length: total }, (_, i) => `m${i}`));
    expect(res.startConfirmed).toBe(true);
    expect(scroller.scrollTop).toBe(-200);
  });

  it('treats scrollTop 0 as the newest end only on a reversed scroller', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { get: () => 300 });
    Object.defineProperty(el, 'scrollHeight', { get: () => 1200 });
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => (top = v) });
    const adapter = { virtualized: true, scrollContainer: () => el } as unknown as Adapter;
    (adapter as { scrollReversed?: boolean }).scrollReversed = true;
    top = 0;
    expect(isAtEnd(adapter, document)).toBe(true);
    top = -400;
    expect(isAtEnd(adapter, document)).toBe(false);
    (adapter as { scrollReversed?: boolean }).scrollReversed = false;
    top = 0;
    expect(isAtEnd(adapter, document)).toBe(false);
    top = 900;
    expect(isAtEnd(adapter, document)).toBe(true);
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
function slowList(opts: {
  total: number;
  renderDelayMs: number;
  positions?: boolean;
  claimTotal?: number;
  /** This row's body is empty until `untilMs` after the list was made (Infinity: always). */
  lateBody?: { index: number; untilMs: number };
  /** The list never scrolls (the site keeps resetting it). */
  stuck?: boolean;
}) {
  document.body.innerHTML = '';
  const scroller = document.createElement('div');
  document.body.appendChild(scroller);
  let top = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const made = performance.now();
  const late = (i: number) => opts.lateBody?.index === i && performance.now() - made < opts.lateBody.untilMs;
  const rowRect = (i: number) => ({ top: i * 100 - top, bottom: i * 100 - top + 100, height: 100, left: 0, right: 100, width: 100, x: 0, y: i * 100 - top, toJSON() {} });
  const render = () => {
    scroller.innerHTML = '';
    const first = Math.max(0, Math.floor(top / 100) - 2);
    const last = Math.min(opts.total - 1, Math.floor((top + 500) / 100) + 2);
    for (let i = first; i <= last; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
      el.textContent = late(i) ? '' : `message ${i}`;
      el.getBoundingClientRect = () => rowRect(i) as DOMRect;
      scroller.appendChild(el);
    }
  };
  render();
  // the late body appears on its own (the site finishes rendering it)
  if (opts.lateBody && Number.isFinite(opts.lateBody.untilMs)) setTimeout(render, opts.lateBody.untilMs);
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
  Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => opts.total * 100 });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      if (opts.stuck) return;
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
