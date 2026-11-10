// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grok } from '../../src/content/adapters/grok';
import { claude } from '../../src/content/adapters/claude';
import { AiObserver } from '../../src/content/capture/observer';
import type { Adapter } from '../../src/content/adapters/types';
import type { AiPhase } from '../../src/shared/types';

function setup(over: Partial<Adapter> = {}, opts = {}) {
  document.body.innerHTML = '<div id="t"><p id="a">answer</p></div>';
  let phase: AiPhase = 'idle';
  let turnInDom = true;
  const adapter = {
    service: 'chatgpt',
    virtualized: true,
    chatId: () => 'c',
    title: () => '',
    messages: () => [],
    body: (n: { el: Element }) => n.el,
    markdown: {},
    scrollContainer: () => document.getElementById('t'),
    isGenerating: () => phase !== 'idle',
    isLoadingOlder: () => false,
    isAtStart: () => false,
    loadedCount: () => null,
    aiPhase: () => phase,
    composer: () => null,
    theme: () => 'light',
    doneQuietMs: 3000,
    activeTurnId: () => (phase !== 'idle' ? 'turn-1' : null),
    hasTurn: () => turnInDom,
    ...over,
  } as Adapter;
  const events: string[] = [];
  const obs = new AiObserver(adapter, document, { phase: (p) => events.push(`phase:${p}`), sent: () => events.push('sent'), answered: () => events.push('answered') }, opts);
  obs.start();
  return {
    obs,
    events,
    set: (p: AiPhase) => {
      phase = p;
      document.getElementById('t')!.setAttribute('aria-busy', String(p !== 'idle')); // a watched attribute nudges the observer
    },
    unmount: (gone: boolean) => (turnInDom = !gone),
  };
}

describe('AiObserver', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('does not call a Work-mode turn done during its complete → in progress flicker', async () => {
    const { events, set, obs } = setup();
    set('streaming');
    await vi.advanceTimersByTimeAsync(2000);
    set('idle'); // "complete" …
    await vi.advanceTimersByTimeAsync(1900);
    set('streaming'); // … "in progress" again 1.9 s later
    await vi.advanceTimersByTimeAsync(300);
    set('idle');
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.filter((e) => e === 'answered')).toHaveLength(1);
    expect(events.filter((e) => e === 'sent')).toHaveLength(1);
    obs.stop();
  });

  it('keeps waiting while the answer text is still changing', async () => {
    const { events, set, obs } = setup();
    set('streaming');
    await vi.advanceTimersByTimeAsync(500);
    set('idle');
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      document.getElementById('a')!.textContent += ' more';
    }
    expect(events).not.toContain('answered');
    await vi.advanceTimersByTimeAsync(3500);
    expect(events).toContain('answered');
    obs.stop();
  });

  it('is not fooled by a virtualized list unmounting the busy turn', async () => {
    const { events, set, unmount, obs } = setup();
    set('streaming');
    await vi.advanceTimersByTimeAsync(500);
    unmount(true);
    set('idle'); // the busy turn left the DOM, so the site's signals are gone
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).not.toContain('answered');
    unmount(false); // scrolled back: the turn is there and complete
    set('idle');
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toContain('answered');
    obs.stop();
  });

  it('gives up on a stalled turn without reporting an answer, and does not re-send', async () => {
    const { events, set, obs } = setup({}, { stallMs: 60_000 });
    set('thinking');
    await vi.advanceTimersByTimeAsync(70_000);
    expect(obs.current).toBe('idle');
    expect(events).not.toContain('answered');
    expect(events.filter((e) => e === 'sent')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.filter((e) => e === 'sent')).toHaveLength(1);
    obs.stop();
  });

  it('keeps a stalled turn outstanding and still reports its late answer (N6)', async () => {
    const stalls: boolean[] = [];
    const { events, set, obs } = setup({}, { stallMs: 60_000 });
    (obs as unknown as { on: { stalled?: (b: boolean) => void } }).on.stalled = (b) => stalls.push(b);
    set('thinking');
    await vi.advanceTimersByTimeAsync(70_000);
    expect(obs.current).toBe('idle'); // the widget stops "thinking"…
    expect(obs.stalled).toBe(true);
    expect(obs.settled).toBe(false); // …but nothing may treat the turn as finished
    set('idle'); // the site finally completes
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toContain('answered');
    expect(obs.settled).toBe(true);
    expect(stalls).toEqual([true, false]);
    obs.stop();
  });

  it('counts turns, so queued work can tell that a new one began', async () => {
    const { set, obs } = setup();
    const first = obs.turn;
    set('streaming');
    await vi.advanceTimersByTimeAsync(200);
    expect(obs.turn).toBe(first + 1);
    expect(obs.settled).toBe(false);
    set('idle');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(obs.settled).toBe(true);
    expect(obs.turn).toBe(first + 1);
    obs.stop();
  });

  it('reports a Grok answer after remounting with a server id and the same gateway key', async () => {
    const row = (id: string, busy: boolean) => `<div data-testid="chat-transcript-scroller">
      <div data-plane-row="gateway:client-id"><div id="response-${id}">
        <div data-testid="assistant-message"><div class="response-content-markdown"><p ${busy ? 'data-sd-animate="true"' : ''}>answer</p></div></div>
        <div class="action-buttons last-response">${busy ? '' : '<button></button>'}</div>
      </div></div></div>`;
    document.body.innerHTML = row('client-id', true);
    const answered = vi.fn();
    const sent = vi.fn();
    const obs = new AiObserver(grok, document, { phase: () => {}, sent, answered });
    obs.start();
    await vi.advanceTimersByTimeAsync(500);
    document.body.innerHTML = '<div data-testid="chat-transcript-scroller"></div>';
    await vi.advanceTimersByTimeAsync(5000);
    expect(answered).not.toHaveBeenCalled();
    document.body.innerHTML = row('server-id', false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(answered).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(obs.settled).toBe(true);
    obs.stop();
  });

  it('does not report a Claude answer finished while its row is unmounted', async () => {
    document.body.innerHTML = '<div data-autoscroll-container></div>';
    const events: string[] = [];
    const obs = new AiObserver(claude, document, {
      phase: () => {},
      sent: () => events.push('sent'),
      answered: () => events.push('answered'),
    });
    obs.start();
    document.body.innerHTML = `<div data-autoscroll-container>
      <div data-testid="assistant-message" data-turn-key="turn-9-hub-reply" data-is-streaming="true"><p>partial</p></div>
    </div><button data-testid="chat-input-stop"></button>`;
    await vi.advanceTimersByTimeAsync(1500);
    expect(events).toContain('sent');
    document.body.innerHTML = '<div data-autoscroll-container></div>';
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events).not.toContain('answered');
    document.body.innerHTML = `<div data-autoscroll-container>
      <div data-testid="assistant-message" data-turn-key="turn-9-hub-reply"><p>done</p></div>
    </div>`;
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toContain('answered');
    obs.stop();
  });
});
