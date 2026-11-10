// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Adapter, CapturedArtifact, MessageNode } from '../../src/content/adapters/types';
import type { ChatSnapshot, ChatStatus } from '../../src/shared/types';
import { grok } from '../../src/content/adapters/grok';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

vi.mock('../../src/content/widget', () => ({ Widget: class { show() {} hide() {} setTheme() {} } }));
const { Controller } = await import('../../src/content/controller');

type Sent = { type: string; payload: Record<string, unknown> };
let sent: Sent[];
let handlers: Record<string, (p: Record<string, unknown>) => unknown>;
let popupListener: ((msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown) | null;

const status = (key: string, over: Partial<ChatStatus> = {}): ChatStatus => ({
  key: key as ChatStatus['key'],
  service: 'claude',
  chatId: key.split(':')[1]!,
  tracked: true,
  staged: [],
  commits: [],
  aheadTotal: 0,
  phase: 'idle',
  ...over,
});

function installChrome() {
  sent = [];
  popupListener = null;
  handlers = {
    'chat/open': (p) => status(`claude:${p.chatId as string}`),
    'chat/snapshot': (p) => status(`claude:${(p.snapshot as ChatSnapshot).chatId}`, { staged: [{ id: 'x', role: 'assistant', kind: 'text' }] }),
    'chat/commit': (p) => status(p.key as string),
    'chat/push': (p) => status(p.key as string),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test',
      sendMessage: async (env: { type: string; payload: Record<string, unknown> }) => {
        sent.push({ type: env.type, payload: env.payload });
        const h = handlers[env.type];
        if (!h) return { ok: true, data: null };
        try {
          return { ok: true, data: await h(env.payload) };
        } catch (e) {
          return { ok: false, error: (e as Error).message, code: 'busy' };
        }
      },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }),
      onMessage: { addListener: (fn: typeof popupListener) => (popupListener = fn) },
    },
    i18n: { getMessage: () => '' },
  };
}

/** Messages are `<div data-m=id data-role=…>` elements; the page shows one chat at a time. */
function showChat(chatId: string, n = 2, height = 500) {
  history.replaceState(null, '', `/chat/${chatId}`);
  document.body.innerHTML = '';
  const scroller = document.createElement('div');
  scroller.id = 'scroller';
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.setAttribute('data-m', `${chatId}-${i}`);
    el.setAttribute('data-role', i % 2 ? 'assistant' : 'user');
    el.textContent = `${chatId} message ${i}`;
    scroller.appendChild(el);
  }
  Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => height });
  document.body.appendChild(scroller);
}

function makeAdapter(over: Partial<Adapter> = {}): Adapter {
  return {
    service: 'claude',
    virtualized: false,
    chatId: (url) => /^\/chat\/(\w+)/.exec(url.pathname)?.[1] ?? null,
    title: () => document.title,
    messages: () =>
      Array.from(document.querySelectorAll('[data-m]')).map((el): MessageNode => ({ el, role: el.getAttribute('data-role') as 'user' | 'assistant', id: el.getAttribute('data-m') })),
    body: (n) => n.el,
    markdown: {},
    scrollContainer: () => document.getElementById('scroller'),
    isGenerating: () => false,
    isLoadingOlder: () => false,
    isAtStart: () => false,
    loadedCount: () => null,
    aiPhase: () => 'idle',
    composer: () => null,
    theme: () => 'light',
    topQuietMs: 100,
    ...over,
  };
}

/** Controllers made by a test: their page watchers are stopped afterwards (they share `document`). */
const made: Array<Record<string, any>> = [];

/** A controller with its settings loaded, showing `chatId` (open + reconcile done). */
async function open(adapter: Adapter, chatId = 'a') {
  const c = new Controller(adapter) as unknown as Record<string, any>;
  made.push(c);
  c.settings = { ...DEFAULT_SETTINGS };
  showChat(chatId);
  await c.checkRoute(true);
  await vi.advanceTimersByTimeAsync(3000);
  return c;
}

const snapshots = () => sent.filter((s) => s.type === 'chat/snapshot').map((s) => ({ ...(s.payload.snapshot as ChatSnapshot), reason: s.payload.reason }));

describe('Controller', () => {
  beforeEach(() => {
    installChrome();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  });
  afterEach(() => {
    for (const c of made.splice(0)) c.setWatching(false);
    vi.useRealTimers();
  });

  it('reads a tracked chat once it has settled after opening (answers finished while away)', async () => {
    await open(makeAdapter());
    const [snap] = snapshots();
    expect(snap?.reason).toBe('manual');
    expect(snap?.chatId).toBe('a');
    expect(snap?.atEnd).toBe(true);
    expect(snap?.messages.map((m) => m.id)).toEqual(['a-0', 'a-1']);
  });

  it('never sends one chat’s messages under another chat’s id when navigation happens mid-capture', async () => {
    let release!: (v: CapturedArtifact[]) => void;
    const adapter = makeAdapter({ artifacts: () => new Promise((r) => (release = r)) });
    const c = await open(adapter);
    sent.length = 0;
    void c.snapshot('answered'); // reads chat a, then waits for its visualizations…
    await vi.advanceTimersByTimeAsync(10);
    showChat('b'); // …while the user switches to chat b
    await c.checkRoute();
    release([]);
    await vi.advanceTimersByTimeAsync(3000);
    for (const s of snapshots()) for (const m of s.messages) expect(m.id.startsWith(`${s.chatId}-`)).toBe(true);
    expect(snapshots().some((s) => s.chatId === 'a')).toBe(false);
  });

  it('sends captures in the order they were read, each stamped at its read', async () => {
    let release!: (v: CapturedArtifact[]) => void;
    let calls = 0;
    const adapter = makeAdapter({ artifacts: () => (++calls === 2 ? new Promise((r) => (release = r)) : Promise.resolve([])) });
    const c = await open(adapter);
    sent.length = 0;
    void c.snapshot('sent'); // slow to enrich
    await vi.advanceTimersByTimeAsync(5);
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(50);
    release([]);
    await vi.advanceTimersByTimeAsync(50);
    const order = snapshots();
    expect(order.map((s) => s.reason)).toEqual(['sent', 'answered']);
    expect(Date.parse(order[0]!.capturedAt)).toBeLessThanOrEqual(Date.parse(order[1]!.capturedAt));
    expect(order[0]?.atEnd).toBe(false); // a 'sent' capture never drops turns
  });

  it('re-reads the page before an explicit commit', async () => {
    const c = await open(makeAdapter());
    sent.length = 0;
    c.store.commit();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.map((s) => s.type)).toEqual(['chat/snapshot', 'chat/commit']);
  });

  it('follows the global pending count from sync events', async () => {
    const c = await open(makeAdapter());
    c.onEvent({ type: 'sync', sync: { repo: null, pending: 2 } });
    expect(c.store.ahead).toBe(2);
  });

  it('resets the AI state when the chat changes', async () => {
    const c = await open(makeAdapter());
    c.store.setAi('streaming');
    showChat('b');
    await c.checkRoute();
    expect(c.store.state.ai).toBe('idle');
  });

  it('runs init with the background’s init id and replays an answer that finished meanwhile', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'init-1' });
    handlers['chat/init/done'] = (p) => status(`claude:${(p.snapshot as ChatSnapshot).chatId}`);
    const c = await open(makeAdapter());
    sent.length = 0;
    void c.init();
    await vi.advanceTimersByTimeAsync(200);
    void c.snapshot('answered'); // suppressed while init runs
    await vi.advanceTimersByTimeAsync(20_000);
    const done = sent.find((s) => s.type === 'chat/init/done');
    expect(done?.payload.initId).toBe('init-1');
    expect((done?.payload.snapshot as ChatSnapshot).complete).toBe(true);
    const after = sent.slice(sent.indexOf(done!));
    expect(after.some((s) => s.type === 'chat/snapshot' && s.payload.reason === 'answered')).toBe(true);
  });

  it('shows why init could not start when another tab is already saving the chat', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = () => {
      throw new Error('Another tab is already saving this chat.');
    };
    const c = await open(makeAdapter());
    await c.init();
    expect(c.store.state.phase).toBe('error');
    // the 'busy' code is shown in the user's language (t() returns the key in tests)
    expect(c.store.state.error).toBe('errInitOtherTab');
    expect(sent.some((s) => s.type === 'chat/init/done')).toBe(false);
  });

  it('scrolls up at once, without waiting for the background to answer the start', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    let answer!: (v: unknown) => void;
    handlers['chat/init/start'] = () => new Promise((r) => (answer = r));
    const c = await open(makeAdapter());
    showChat('a', 2, 2000);
    const scroller = document.getElementById('scroller')!;
    scroller.scrollTop = 1500;
    void c.init();
    await vi.advanceTimersByTimeAsync(50);
    expect(sent.some((s) => s.type === 'chat/init/start')).toBe(true);
    expect(scroller.scrollTop).toBe(0); // moving before the answer
    answer({ status: status('claude:a', { tracked: false, phase: 'capturing' }), initId: 'i-a' });
    c.abort?.abort();
    await vi.advanceTimersByTimeAsync(3000);
  });

  it('puts the scroll back when the background refuses the start', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = async () => {
      await new Promise((r) => setTimeout(r, 300));
      throw new Error('Another tab is already saving this chat.');
    };
    const c = await open(makeAdapter());
    showChat('a', 2, 2000);
    const scroller = document.getElementById('scroller')!;
    scroller.scrollTop = 1500;
    const run = c.init();
    await vi.advanceTimersByTimeAsync(5000);
    await run;
    expect(c.store.state.error).toBe('errInitOtherTab');
    expect(scroller.scrollTop).toBe(1500);
    expect(sent.some((s) => s.type === 'chat/init/cancel')).toBe(false);
  });

  it('cancels with its init id and reports an incomplete history instead of saving it', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false }), initId: 'init-2' });
    handlers['chat/init/cancel'] = (p) => status(p.key as string, { tracked: false });
    let n = 0;
    const c = await open(makeAdapter({ loadedCount: () => ++n })); // the history never stops growing
    sent.length = 0;
    void c.init();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(sent.some((s) => s.type === 'chat/init/done')).toBe(false);
    expect(sent.find((s) => s.type === 'chat/init/cancel')?.payload.initId).toBe('init-2');
    expect(c.store.state.phase).toBe('error');
    expect(c.store.state.error).toBe('errInitIncomplete');
  });

  it('switches the widget to the new chat at once when navigating during init (R4 / N4)', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'i' });
    let releaseCancel!: () => void;
    handlers['chat/init/cancel'] = (p) => new Promise((r) => (releaseCancel = () => r(status(p.key as string, { tracked: false })))); // slow cleanup
    const c = await open(makeAdapter({ loadedCount: () => Math.random() })); // init stays in its loading phase
    void c.init();
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.store.state.phase).toBe('capturing');
    showChat('b');
    await c.checkRoute(); // chat/open for b answers while a's cancellation is still running
    await vi.advanceTimersByTimeAsync(100);
    expect(c.store.state.phase).not.toBe('capturing');
    releaseCancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(c.store.state.phase).not.toBe('capturing');
    c.onEvent({ type: 'status', status: status('claude:b', { tracked: false, staged: [{ id: 'q', role: 'user', kind: 'text' }] }) });
    expect(c.store.state.staged.map((i: { id: string }) => i.id)).toEqual(['q']); // b's statuses apply
    expect(c.abort).toBeNull();
  });

  it('drops a queued "answered" capture once the AI has started on another turn (R9 / R2-M2)', async () => {
    let phase: 'idle' | 'streaming' = 'idle';
    let release!: (v: CapturedArtifact[]) => void;
    let calls = 0;
    const adapter = makeAdapter({ aiPhase: () => phase, artifacts: () => (++calls === 2 ? new Promise((r) => (release = r)) : Promise.resolve([])) });
    const c = await open(adapter);
    c.observer.start();
    sent.length = 0;
    void c.snapshot('manual'); // holds the queue on its visualizations
    await vi.advanceTimersByTimeAsync(5);
    void c.snapshot('answered'); // the previous answer finished…
    phase = 'streaming'; // …and the user already sent the next message
    await vi.advanceTimersByTimeAsync(1500);
    release([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots().some((x) => x.reason === 'answered')).toBe(false);
    c.observer.stop();
  });

  it('drops queued captures of a chat that is no longer shown (N5)', async () => {
    let release!: (v: CapturedArtifact[]) => void;
    let calls = 0;
    const adapter = makeAdapter({ artifacts: () => (++calls === 2 ? new Promise((r) => (release = r)) : Promise.resolve([])) });
    const c = await open(adapter);
    sent.length = 0;
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(5);
    void c.snapshot('answered'); // queued for chat a
    showChat('b');
    await c.checkRoute();
    release([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshots().some((x) => x.reason === 'answered')).toBe(false);
  });

  it('stops Commit and shows why when the fresh capture fails (R15)', async () => {
    const c = await open(makeAdapter());
    handlers['chat/snapshot'] = () => {
      throw new Error('Asset too large');
    };
    sent.length = 0;
    c.store.commit();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.some((x) => x.type === 'chat/commit')).toBe(false);
    expect(c.store.state.phase).toBe('error');
    expect(c.store.state.error).toBe('errCaptureFailed');
  });

  it("answers the popup's refresh with whether the page was staged (R15)", async () => {
    const c = await open(makeAdapter());
    c.listenToPopup();
    const ask = () =>
      new Promise((resolve) => {
        const keepOpen = popupListener!({ gitchat: 1, type: 'content/refresh' }, {}, resolve);
        expect(keepOpen).toBe(true);
      });
    const ok = ask();
    await vi.advanceTimersByTimeAsync(100);
    expect(await ok).toEqual({ ok: true });
    handlers['chat/snapshot'] = () => {
      throw new Error('nope');
    };
    const failed = ask();
    await vi.advanceTimersByTimeAsync(100);
    expect(await failed).toEqual({ ok: false, error: 'errCaptureFailed' });
    expect(c.store.state.tracked).toBe(true);
  });

  it('rescans a tracked chat with a complete capture when the popup asks', async () => {
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { phase: 'capturing' }), initId: 'r1' });
    handlers['chat/init/done'] = (p) => status(`claude:${(p.snapshot as ChatSnapshot).chatId}`);
    const c = await open(makeAdapter());
    c.listenToPopup();
    const events: string[] = [];
    c.store.subscribe((type: string) => events.push(type));
    sent.length = 0;
    let replied: unknown = 'none';
    popupListener!({ gitchat: 1, type: 'content/rescan' }, {}, (r: unknown) => (replied = r));
    expect(replied).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    const done = sent.find((x) => x.type === 'chat/init/done');
    expect(done?.payload.initId).toBe('r1');
    expect((done?.payload.snapshot as ChatSnapshot).complete).toBe(true);
    expect(events).toContain('captureStart');
    expect(events).toContain('captured');
  });

  it('does not read the previous chat as the new one while it is still on the page (c-services H1)', async () => {
    const c = await open(makeAdapter());
    sent.length = 0;
    history.replaceState(null, '', '/chat/b'); // the URL moved on, the page still shows chat a
    await c.checkRoute();
    await vi.advanceTimersByTimeAsync(5000);
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshots()).toEqual([]);
    showChat('b'); // chat b renders
    await vi.advanceTimersByTimeAsync(3000);
    const [snap] = snapshots();
    expect(snap?.chatId).toBe('b');
    expect(snap?.messages.map((m) => m.id)).toEqual(['b-0', 'b-1']);
  });

  it('stamps every capture with this visit of the chat, and a new visit after navigating', async () => {
    const c = await open(makeAdapter());
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(100);
    const [first, second] = snapshots();
    expect(first?.view?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second?.view).toEqual(first?.view);
    showChat('b');
    await c.checkRoute();
    await vi.advanceTimersByTimeAsync(3000);
    const b = snapshots().find((x) => x.chatId === 'b');
    expect(b?.view?.id).not.toBe(first?.view?.id);
    expect(b!.view!.since).toBeGreaterThanOrEqual(first!.view!.since);
  });

  it('drops a queued "answered" capture when the page shows the next turn before the observer looks (a-extension M1)', async () => {
    let phase: 'idle' | 'streaming' = 'idle';
    let release!: (v: CapturedArtifact[]) => void;
    let calls = 0;
    const adapter = makeAdapter({ aiPhase: () => phase, artifacts: () => (++calls === 2 ? new Promise((r) => (release = r)) : Promise.resolve([])) });
    const c = await open(adapter); // the observer has not looked at the page since the new turn began
    sent.length = 0;
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(5);
    void c.snapshot('answered');
    phase = 'streaming';
    release([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(snapshots().map((x) => x.reason)).toEqual(['manual']);
    expect(snapshots()[0]?.atEnd).toBe(true); // read before the next turn started
  });

  it('reads the whole chat again when the background could not place a capture, at most once a minute', async () => {
    handlers['chat/snapshot'] = (p) => ({ ...status(`claude:${(p.snapshot as ChatSnapshot).chatId}`), fullRead: true });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { phase: 'capturing' }), initId: 'auto' });
    handlers['chat/init/done'] = (p) => status(`claude:${(p.snapshot as ChatSnapshot).chatId}`);
    const c = await open(makeAdapter()); // its first read already asks for a full read
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.filter((x) => x.type === 'chat/init/start')).toHaveLength(1);
    expect(sent.find((x) => x.type === 'chat/init/done')?.payload.initId).toBe('auto');
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.filter((x) => x.type === 'chat/init/start')).toHaveLength(1); // not again within a minute
    expect(c.store.state.phase).not.toBe('error');
    await vi.advanceTimersByTimeAsync(60_000);
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.filter((x) => x.type === 'chat/init/start')).toHaveLength(2);
  });

  it('passes Cancel on while the background saves the capture; the cancel that wins leaves the chat untracked', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'i9' });
    let refuse!: () => void;
    handlers['chat/init/done'] = () =>
      new Promise((_r, reject) => {
        refuse = () => reject(new Error('This capture was cancelled or replaced. Start again.'));
      });
    handlers['chat/init/cancel'] = (p) => status(p.key as string, { tracked: false });
    const c = await open(makeAdapter());
    sent.length = 0;
    void c.init();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.some((x) => x.type === 'chat/init/done')).toBe(true);
    c.store.cancelInit(); // pressed while the save is on its way
    await vi.advanceTimersByTimeAsync(10);
    expect(sent.find((x) => x.type === 'chat/init/cancel')?.payload.initId).toBe('i9');
    refuse(); // the background took the cancel first and refused the save
    await vi.advanceTimersByTimeAsync(10);
    expect(c.store.state.tracked).toBe(false);
    expect(c.store.state.phase).not.toBe('error');
    expect(c.abort).toBeNull();
  });

  it('keeps a finished capture when the user only navigates away while it is being saved', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'i10' });
    let finish!: () => void;
    handlers['chat/init/done'] = (p) => new Promise((r) => (finish = () => r(status(`claude:${(p.snapshot as ChatSnapshot).chatId}`))));
    const c = await open(makeAdapter());
    sent.length = 0;
    void c.init();
    await vi.advanceTimersByTimeAsync(20_000);
    showChat('b');
    await c.checkRoute();
    finish();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.some((x) => x.type === 'chat/init/cancel')).toBe(false);
  });

  it('never saves the previous chat as the new one, however long it stays on the page (review 1-2)', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: p.chatId !== 'b' });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'i-b' });
    handlers['chat/init/cancel'] = (p) => status(p.key as string, { tracked: false });
    const c = await open(makeAdapter());
    sent.length = 0;
    history.replaceState(null, '', '/chat/b'); // the URL moved on, the DOM still shows chat a
    await c.checkRoute();
    await vi.advanceTimersByTimeAsync(31_000); // longer than the old 30 s limit
    void c.init();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent.some((x) => x.type === 'chat/init/done')).toBe(false);
    // the page is checked before the background is asked: no init session is opened, none to cancel
    expect(sent.some((x) => x.type === 'chat/init/start')).toBe(false);
    expect(c.store.state.error).toBe('errInitPrevChat');
    expect(snapshots()).toEqual([]);
  });

  it('takes a chat branched from the previous one as soon as a message of its own shows', async () => {
    const c = await open(makeAdapter());
    sent.length = 0;
    history.replaceState(null, '', '/chat/b');
    await c.checkRoute();
    // chat b was branched from a: it starts with a's messages, then has its own
    const own = document.createElement('div');
    own.setAttribute('data-m', 'b-2');
    own.setAttribute('data-role', 'user');
    own.textContent = 'b message 2';
    document.getElementById('scroller')!.appendChild(own);
    await vi.advanceTimersByTimeAsync(3000);
    const [snap] = snapshots();
    expect(snap?.chatId).toBe('b');
    expect(snap?.messages.map((m) => m.id)).toEqual(['a-0', 'a-1', 'b-2']);
  });

  it('confirms the start only when the transcript fits or the chat is small', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false, phase: 'capturing' }), initId: 'i-fit' });
    handlers['chat/init/done'] = (p) => status(`claude:${(p.snapshot as ChatSnapshot).chatId}`);
    const c = await open(makeAdapter()); // 2 short messages in a 500 px scroller
    void c.init();
    await vi.advanceTimersByTimeAsync(30_000);
    const done = sent.find((x) => x.type === 'chat/init/done')?.payload.snapshot as ChatSnapshot;
    expect(done.complete).toBe(true);
    expect(done.startConfirmed).toBe(true);
    // A quiet oldest end does not prove that older history finished loading.
    sent.length = 0;
    showChat('a', 12, 2000);
    c.store.switchTo('claude:a', status('claude:a', { tracked: false }));
    void c.init();
    await vi.advanceTimersByTimeAsync(30_000);
    const again = sent.find((x) => x.type === 'chat/init/done')?.payload.snapshot as ChatSnapshot;
    expect(again.complete).toBe(true);
    expect(again.startConfirmed).toBeUndefined();
  });

  it('tells the popup why init failed, and keeps saying so after the background’s next status (review 2-2)', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    handlers['chat/init/start'] = (p) => ({ status: status(p.key as string, { tracked: false }), initId: 'i-err' });
    handlers['chat/init/cancel'] = (p) => status(p.key as string, { tracked: false });
    let n = 0;
    const c = await open(makeAdapter({ loadedCount: () => ++n })); // the history never stops growing
    c.listenToPopup();
    void c.init();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    const ask = () =>
      new Promise<{ status: ChatStatus | null }>((resolve) => popupListener!({ gitchat: 1, type: 'content/current' }, {}, (r) => resolve(r as { status: ChatStatus | null })));
    let cur = await ask();
    expect(cur.status).toMatchObject({ phase: 'error', error: 'errInitIncomplete' });
    // the background has ended the init, so its status says nothing about it
    c.onEvent({ type: 'status', status: status('claude:a', { tracked: false }) });
    cur = await ask();
    expect(cur.status).toMatchObject({ phase: 'error', error: 'errInitIncomplete' });
    // trying again clears it
    handlers['chat/init/start'] = () => new Promise(() => {});
    c.store.init();
    await vi.advanceTimersByTimeAsync(10);
    expect(c.store.state.phase).toBe('capturing');
  });

  it('watches the page only while a chat of an enabled service is shown (review 5-1)', async () => {
    const c = await open(makeAdapter());
    expect(c.observer.running).toBe(true);
    history.replaceState(null, '', '/settings');
    await c.checkRoute();
    expect(c.observer.running).toBe(false);
    showChat('a');
    await c.checkRoute();
    expect(c.observer.running).toBe(true);
    // the service is turned off in the settings
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, services: { ...DEFAULT_SETTINGS.services, claude: false } } });
    await vi.advanceTimersByTimeAsync(10);
    expect(c.observer.running).toBe(false);
  });

  it('stops all its work when the extension goes away under it', async () => {
    handlers['settings/get'] = () => ({ ...DEFAULT_SETTINGS });
    const c = new Controller(makeAdapter()) as unknown as Record<string, any>;
    made.push(c);
    showChat('a');
    await c.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(c.observer.running).toBe(true);
    expect(c.timers.length).toBe(2);
    (globalThis as unknown as { chrome: { runtime: { id?: string } } }).chrome.runtime.id = undefined; // the extension was reloaded
    await vi.advanceTimersByTimeAsync(500);
    expect(c.observer.running).toBe(false);
    expect(c.timers).toEqual([]);
    sent.length = 0;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
  });

  it('applies Light or Dark over the site theme immediately, and follows the site again on Auto', async () => {
    let site: 'light' | 'dark' = 'dark';
    const c = await open(makeAdapter({ theme: () => site }));
    const setTheme = vi.spyOn(c.widget, 'setTheme');
    const show = vi.spyOn(c.widget, 'show');
    const hide = vi.spyOn(c.widget, 'hide');
    sent.length = 0;
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, theme: 'light' } });
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(hide).not.toHaveBeenCalled();
    expect(sent.some((s) => s.type === 'chat/open')).toBe(false);
    setTheme.mockClear();
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, theme: 'dark' } });
    expect(setTheme).toHaveBeenCalledWith('dark');
    setTheme.mockClear();
    site = 'light';
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, theme: 'auto' } });
    expect(setTheme).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith('light');
    // a style change remounts at once in the chosen theme, still without waiting for the poll
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, widget: 'line', theme: 'dark' } });
    expect(show).toHaveBeenCalledWith('line', 'dark');
  });

  it('opens in the chosen theme and the site poll does not override it', async () => {
    handlers['settings/get'] = () => ({ ...DEFAULT_SETTINGS, theme: 'light' });
    const site = 'dark' as const;
    const c = new Controller(makeAdapter({ theme: () => site })) as unknown as Record<string, any>;
    made.push(c);
    const show = vi.spyOn(c.widget, 'show');
    const setTheme = vi.spyOn(c.widget, 'setTheme');
    showChat('a');
    await c.start();
    expect(show).toHaveBeenCalledWith('creature', 'light');
    setTheme.mockClear();
    await vi.advanceTimersByTimeAsync(1500);
    expect(setTheme).toHaveBeenCalled();
    expect(setTheme.mock.calls.every((call) => call[0] === 'light')).toBe(true);
    setTheme.mockClear();
    c.onEvent({ type: 'settings', settings: { ...DEFAULT_SETTINGS, theme: 'auto' } });
    expect(setTheme).toHaveBeenCalledWith('dark');
    for (const id of c.timers as number[]) clearInterval(id);
  });

  it('does not rescan an untracked chat or start tracking through rescan', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    const c = await open(makeAdapter());
    sent.length = 0;
    await c.init({ rescan: true });
    expect(sent.some((x) => x.type === 'chat/init/start')).toBe(false);
  });

  /** Same chat id with or without a `/u/<n>` slot, so a slot change is not a new chat. */
  function slotAdapter(over: Partial<Adapter> = {}): Adapter {
    return makeAdapter({
      chatId: (url) => /^(?:\/u\/\d+)?\/chat\/(\w+)/.exec(url.pathname)?.[1] ?? null,
      ...over,
    });
  }

  function showMessages(ids: string[]) {
    document.body.innerHTML = '';
    const scroller = document.createElement('div');
    scroller.id = 'scroller';
    for (const id of ids) {
      const el = document.createElement('div');
      el.setAttribute('data-m', id);
      el.setAttribute('data-role', 'user');
      el.textContent = id;
      scroller.appendChild(el);
    }
    Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 500 });
    document.body.appendChild(scroller);
  }

  it('does not write a different transcript into the same chat id', async () => {
    const c = await open(slotAdapter());
    sent.length = 0;
    history.replaceState(null, '', '/u/1/chat/a');
    showMessages(['other-0', 'other-1']);
    await c.checkRoute();
    void c.snapshot('answered');
    await c.init({ rescan: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.filter((s) => s.type === 'chat/snapshot' || s.type === 'chat/init/start' || s.type === 'chat/init/done')).toEqual([]);
    showMessages(['a-0', 'a-1']);
    await c.checkRoute();
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(50);
    expect(snapshots().map((s) => s.messages.map((m) => m.id))).toEqual([['a-0', 'a-1']]);
    expect(c.stale).toBeNull();
    expect(c.foreign).toBe(false);
  });

  it('captures a rid-only branch switch even when every message id changes', async () => {
    const c = await open(makeAdapter({ sameChatUrl: grok.sameChatUrl }));
    history.replaceState(null, '', '/chat/a?rid=old-answer');
    await c.checkRoute();
    sent.length = 0;
    history.replaceState(null, '', '/chat/a?rid=new-answer');
    showMessages(['branch-user', 'branch-answer']);
    await c.checkRoute();
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(50);
    expect(c.foreign).toBe(false);
    expect(snapshots().map((s) => s.messages.map((m) => m.id))).toEqual([['branch-user', 'branch-answer']]);
  });

  it.each(['?rid=new-answer&account=other', '?account=other', '?rid=new-answer#other'])(
    'still refuses a different transcript on a non-branch URL change: %s', async (query) => {
      const c = await open(makeAdapter({ sameChatUrl: grok.sameChatUrl }));
      sent.length = 0;
      history.replaceState(null, '', `/chat/a${query}`);
      showMessages(['other-user', 'other-answer']);
      await c.checkRoute();
      void c.snapshot('answered');
      await c.init({ rescan: true });
      await vi.advanceTimersByTimeAsync(50);
      expect(c.foreign).toBe(true);
      expect(sent).toEqual([]);
    },
  );

  it('keeps capturing when a same-id URL change still shows this chat', async () => {
    const c = await open(slotAdapter());
    sent.length = 0;
    history.replaceState(null, '', '/u/0/chat/a?hl=ja');
    await c.checkRoute();
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(50);
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(50);
    const snaps = snapshots();
    expect(snaps).toHaveLength(2);
    expect(snaps[0]?.messages.map((m) => m.id)).toEqual(['a-0', 'a-1']);
    expect(snaps[0]?.url).toBe(`${location.origin}/u/0/chat/a`);
    expect(c.stale).toBeNull();
    expect(c.foreign).toBe(false);
  });

  it('stores origin and path, without the query or hash', async () => {
    const c = new Controller(makeAdapter()) as unknown as Record<string, any>;
    made.push(c);
    c.settings = { ...DEFAULT_SETTINGS };
    showChat('a');
    history.replaceState(null, '', '/chat/a?model=x#h');
    await c.checkRoute(true);
    expect(sent.find((s) => s.type === 'chat/open')?.payload.url).toBe(`${location.origin}/chat/a`);
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshots()[0]?.url).toBe(`${location.origin}/chat/a`);
  });

  it('saves a branched chat as soon as the page names it, before a message of its own', async () => {
    let pageId: string | null = null;
    const c = await open(makeAdapter({ pageChatId: () => pageId }));
    sent.length = 0;
    pageId = 'b';
    history.replaceState(null, '', '/chat/b');
    await c.checkRoute();
    await vi.advanceTimersByTimeAsync(3000);
    const [snap] = snapshots();
    expect(snap?.chatId).toBe('b');
    expect(snap?.messages.map((m) => m.id)).toEqual(['a-0', 'a-1']);
    expect(c.store.state.error).not.toBe('errInitPrevChat');
  });

  it('does not capture while the page still names the previous chat', async () => {
    let pageId: string | null = 'a';
    const c = await open(makeAdapter({ pageChatId: () => pageId }));
    sent.length = 0;
    history.replaceState(null, '', '/chat/b'); // the URL moved on, the page still names chat a
    await c.checkRoute();
    const extra = document.createElement('div');
    extra.setAttribute('data-m', 'new-9');
    extra.setAttribute('data-role', 'user');
    extra.textContent = 'new';
    document.getElementById('scroller')!.appendChild(extra);
    void c.snapshot('answered');
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshots()).toEqual([]);
    pageId = 'b';
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(3000);
    expect(snapshots().at(-1)?.chatId).toBe('b');
  });

  it('keeps saving when the page id differs from the URL but is not the previous chat', async () => {
    // right after a chat is created the page can still carry a provisional id
    const c = await open(makeAdapter({ pageChatId: () => 'local-provisional' }));
    sent.length = 0;
    const extra = document.createElement('div');
    extra.setAttribute('data-m', 'new-9');
    extra.setAttribute('data-role', 'user');
    extra.textContent = 'new';
    document.getElementById('scroller')!.appendChild(extra);
    void c.snapshot('manual');
    await vi.advanceTimersByTimeAsync(50);
    expect(snapshots()).toHaveLength(1);
  });

  describe('copy as Markdown', () => {
    let writeText: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      vi.stubGlobal('ClipboardItem', undefined);
      writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      handlers['chat/markdown'] = () => ({ markdown: '# T\n\n## User\n\nhi\n' });
    });
    afterEach(() => vi.unstubAllGlobals());

    function promiseClipboard() {
      class Item {
        constructor(readonly data: Record<string, Promise<Blob>>) {}
      }
      vi.stubGlobal('ClipboardItem', Item);
      const written: string[] = [];
      const write = vi.fn(async ([item]: Item[]) => {
        const blob = await item!.data['text/plain']!;
        written.push(await blob.text());
      });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
      return { write, written };
    }

    it('starts the clipboard write synchronously, even when the background takes longer than activation', async () => {
      const c = await open(makeAdapter());
      const { write, written } = promiseClipboard();
      let answer!: (v: unknown) => void;
      handlers['chat/markdown'] = () => new Promise((r) => (answer = r));
      const copied = c.store.copyMarkdown();
      expect(write).toHaveBeenCalledTimes(1); // Before yielding even a microtask.
      expect(written).toEqual([]);
      await vi.advanceTimersByTimeAsync(6000);
      answer({ markdown: '# delayed\n' });
      await vi.advanceTimersByTimeAsync(1);
      await expect(copied).resolves.toBe(true);
      expect(written).toEqual(['# delayed\n']);
      expect(writeText).not.toHaveBeenCalled();
    });

    it.each([false, true])('writes nothing when the URL changes before the route poll (ClipboardItem: %s)', async (modern) => {
      const c = await open(makeAdapter());
      const clipboard = modern ? promiseClipboard() : null;
      let answer!: (v: unknown) => void;
      handlers['chat/markdown'] = () => new Promise((r) => (answer = r));
      const copied = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(50);
      showChat('b');
      answer({ markdown: '# a\n' });
      await vi.advanceTimersByTimeAsync(1);
      await expect(copied).resolves.toBe(false);
      expect(c.key).toBe('claude:a'); // The cached route has not caught up yet.
      expect(clipboard?.written ?? []).toEqual([]);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('rejects the clipboard data when navigation happens during refresh', async () => {
      const c = await open(makeAdapter());
      const { written } = promiseClipboard();
      handlers['chat/snapshot'] = () => new Promise(() => {});
      sent.length = 0;
      const copied = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(50);
      showChat('b');
      await vi.advanceTimersByTimeAsync(1500);
      await expect(copied).resolves.toBe(false);
      expect(written).toEqual([]);
      expect(sent.some((s) => s.type === 'chat/markdown')).toBe(false);
    });

    it('stages what the page shows, then copies the background’s text', async () => {
      const c = await open(makeAdapter());
      sent.length = 0;
      const copied = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(50);
      await expect(copied).resolves.toBe(true);
      expect(sent.map((s) => s.type)).toEqual(['chat/snapshot', 'chat/markdown']);
      expect(sent[1]?.payload).toEqual({ key: 'claude:a' });
      expect(writeText).toHaveBeenCalledWith('# T\n\n## User\n\nhi\n');
    });

    it('does not let a slow page read use up the click (the copy goes ahead without it)', async () => {
      const c = await open(makeAdapter());
      handlers['chat/snapshot'] = () => new Promise(() => {});
      sent.length = 0;
      const copied = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(1000);
      expect(sent.map((s) => s.type)).toEqual(['chat/snapshot']);
      await vi.advanceTimersByTimeAsync(600);
      await expect(copied).resolves.toBe(true);
      expect(sent.map((s) => s.type)).toEqual(['chat/snapshot', 'chat/markdown']);
    });

    it('copies nothing for a chat that is not being saved', async () => {
      handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
      const c = await open(makeAdapter());
      sent.length = 0;
      await expect(c.store.copyMarkdown()).resolves.toBe(false);
      expect(sent).toEqual([]);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('reports a failed copy, and never copies a chat the tab has left', async () => {
      const c = await open(makeAdapter());
      writeText.mockRejectedValueOnce(new Error('denied'));
      const failed = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(50);
      await expect(failed).resolves.toBe(false);

      let answer!: (v: unknown) => void;
      handlers['chat/markdown'] = () => new Promise((r) => (answer = r));
      writeText.mockClear();
      const left = c.store.copyMarkdown();
      await vi.advanceTimersByTimeAsync(50);
      showChat('b');
      await c.checkRoute();
      answer({ markdown: '# a\n' });
      await vi.advanceTimersByTimeAsync(50);
      await expect(left).resolves.toBe(false);
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
