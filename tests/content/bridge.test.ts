import { describe, expect, it, vi } from 'vitest';
import { UiStore } from '../../src/content/bridge';
import type { ChatStatus } from '../../src/shared/types';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';

const status = (over: Partial<ChatStatus> = {}): ChatStatus => ({
  key: 'claude:c1',
  service: 'claude',
  chatId: 'c1',
  tracked: true,
  staged: [],
  commits: [],
  aheadTotal: 0,
  phase: 'idle',
  ...over,
});

function setup(initial: ChatStatus) {
  const actions = { commit: vi.fn(), push: vi.fn(), init: vi.fn(), cancelInit: vi.fn(), setAuto: vi.fn(), copyMarkdown: vi.fn(async () => true) };
  const store = new UiStore(actions);
  const events: Array<[string, Record<string, unknown>]> = [];
  store.switchTo(initial.key, initial);
  store.subscribe((type, detail) => events.push([type, detail]));
  return { store, actions, events };
}

describe('UiStore (status → widget events)', () => {
  it('emits staged events split by origin', () => {
    const { store, events } = setup(status());
    store.applyStatus(status({ staged: [{ id: 'u', role: 'user', kind: 'text' }, { id: 'a', role: 'assistant', kind: 'math' }] }));
    const staged = events.filter(([t]) => t === 'staged');
    expect(staged.map(([, d]) => d.from)).toEqual(['input', 'stream']);
  });

  it('emits committed, pushStart and pushed in order', () => {
    const { store, events } = setup(status({ staged: [{ id: 'u', role: 'user', kind: 'text' }] }));
    store.applyStatus(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1 }));
    store.applyStatus(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1, phase: 'pushing' }));
    store.applyStatus(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: true }], aheadTotal: 0 }));
    expect(events.map(([t]) => t).filter((t) => t !== 'status')).toEqual(['committed', 'pushStart', 'pushed', 'pushEnd']);
    expect(events.find(([t]) => t === 'pushEnd')?.[1]).toEqual({ ok: true, pushed: 1 });
  });

  it('ends a push that sent nothing (every commit superseded) with pushEnd', () => {
    const { store, events } = setup(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1 }));
    store.applyStatus(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1, phase: 'pushing' }));
    store.applyStatus(status({ commits: [], aheadTotal: 0 }));
    expect(events.map(([t]) => t).filter((t) => t !== 'status')).toEqual(['pushStart', 'pushEnd']);
    expect(events.find(([t]) => t === 'pushEnd')?.[1]).toEqual({ ok: true, pushed: 0 });
  });

  it('ends a failed push with error, then pushEnd ok:false', () => {
    const { store, events } = setup(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1, phase: 'pushing' }));
    store.applyStatus(status({ commits: [{ id: 'k1', n: 1, t: 1, pushed: false }], aheadTotal: 1, phase: 'error', error: 'offline' }));
    expect(events.map(([t]) => t).filter((t) => t !== 'status')).toEqual(['error', 'pushEnd']);
    expect(events.find(([t]) => t === 'pushEnd')?.[1]).toEqual({ ok: false, pushed: 0 });
  });

  it('follows the global pending count, so Push works in a clean tab', () => {
    const { store, events } = setup(status());
    store.setAhead(3);
    expect(store.ahead).toBe(3);
    expect(events.at(-1)?.[0]).toBe('status');
  });

  it('shows an init failure on an untracked chat', () => {
    const { store, events } = setup(status({ tracked: false }));
    store.initFailed('Could not load the whole chat');
    expect(store.state.phase).toBe('error');
    expect(store.state.error).toBe('Could not load the whole chat');
    expect(events.map(([t, d]) => `${t}:${d.action ?? ''}`)).toContain('error:init');
  });

  it('reports captured when a chat becomes tracked', () => {
    const { store, events } = setup(status({ tracked: false }));
    store.applyStatus(status({ staged: [{ id: 'u', role: 'user', kind: 'text' }] }));
    expect(events[0]?.[0]).toBe('captured');
  });

  it('hands commit and push to the controller, which re-reads the page first and may answer nope', () => {
    const { store, actions, events } = setup(status());
    store.commit();
    store.push();
    expect(actions.commit).toHaveBeenCalled();
    expect(actions.push).toHaveBeenCalled();
    store.nope('commit');
    expect(events.map(([t, d]) => `${t}:${d.action}`)).toEqual(['nope:commit']);
  });

  it('does not commit an untracked chat or during init', () => {
    const { store, actions } = setup(status({ tracked: false }));
    store.commit();
    expect(actions.commit).not.toHaveBeenCalled();
  });

  it('push commits staged work too (it is allowed with staged items only)', () => {
    const { store, actions } = setup(status({ staged: [{ id: 'u', role: 'user', kind: 'text' }] }));
    store.push();
    expect(actions.push).toHaveBeenCalled();
  });

  it('tells which auto setting the user changed and which one followed', () => {
    const { store, events } = setup(status());
    store.applySettings({ ...DEFAULT_SETTINGS, autoCommit: true, autoPush: true });
    expect(events.at(-1)).toEqual(['settings', { key: 'autoPush', value: true, linked: 'autoCommit' }]);
  });

  it('copies only a tracked chat', async () => {
    const { store, actions } = setup(status({ tracked: false }));
    await expect(store.copyMarkdown()).resolves.toBe(false);
    expect(actions.copyMarkdown).not.toHaveBeenCalled();
    store.applyStatus(status({ tracked: true }));
    await expect(store.copyMarkdown()).resolves.toBe(true);
    expect(actions.copyMarkdown).toHaveBeenCalledTimes(1);
  });
});
