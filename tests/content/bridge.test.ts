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
  const actions = { commit: vi.fn(), push: vi.fn(), init: vi.fn(), cancelInit: vi.fn(), setAuto: vi.fn() };
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
    expect(events.map(([t]) => t).filter((t) => t !== 'status')).toEqual(['committed', 'pushStart', 'pushed']);
  });

  it('reports captured when a chat becomes tracked', () => {
    const { store, events } = setup(status({ tracked: false }));
    store.applyStatus(status({ staged: [{ id: 'u', role: 'user', kind: 'text' }] }));
    expect(events[0]?.[0]).toBe('captured');
  });

  it('refuses a commit with nothing staged and a push with nothing pending', () => {
    const { store, actions, events } = setup(status());
    store.commit();
    store.push();
    expect(actions.commit).not.toHaveBeenCalled();
    expect(actions.push).not.toHaveBeenCalled();
    expect(events.map(([t, d]) => `${t}:${d.action}`)).toEqual(['nope:commit', 'nope:push']);
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
});
