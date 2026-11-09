// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Adapter, CapturedArtifact, MessageNode } from '../../src/content/adapters/types';
import type { ChatSnapshot, ChatStatus } from '../../src/shared/types';
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
function showChat(chatId: string, n = 2) {
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
  Object.defineProperty(scroller, 'scrollHeight', { get: () => 500 });
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

/** A controller with its settings loaded, showing `chatId` (open + reconcile done). */
async function open(adapter: Adapter, chatId = 'a') {
  const c = new Controller(adapter) as unknown as Record<string, any>;
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
  afterEach(() => vi.useRealTimers());

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

  it('does not rescan an untracked chat or start tracking through rescan', async () => {
    handlers['chat/open'] = (p) => status(`claude:${p.chatId as string}`, { tracked: false });
    const c = await open(makeAdapter());
    sent.length = 0;
    await c.init({ rescan: true });
    expect(sent.some((x) => x.type === 'chat/init/start')).toBe(false);
  });
});
