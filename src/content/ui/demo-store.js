// Fake git state for the playground and the settings page previews. No network, no real git.
// Rule: auto-push needs auto-commit. Turning push on turns commit on; turning commit off turns push off.

let seq = 0;
const uid = (p = 'c') => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const KINDS = ['text', 'math', 'viz', 'code', 'text'];

export { fmtAgo } from './core/format.js';

function sample() {
  const ago = (m) => Date.now() - m * 60000;
  return {
    tracked: true,
    service: 'claude',
    path: 'claude/2026-11-09-state-design--a1b2c3.md',
    webUrl: 'https://github.com/you/ai-chats/blob/main/claude/2026-11-09-state-design--a1b2c3.md',
    captureStage: 'loading', // loading (older messages) | reading
    captureCount: 0,
    staged: [
      { id: uid('s'), role: 'user', kind: 'text' },
      { id: uid('s'), role: 'ai', kind: 'math' },
      { id: uid('s'), role: 'ai', kind: 'viz' },
    ],
    commits: [
      { id: uid(), n: 4, t: ago(12), pushed: false },
      { id: uid(), n: 2, t: ago(41), pushed: false },
      { id: uid(), n: 6, t: ago(190), pushed: true },
      { id: uid(), n: 3, t: ago(600), pushed: true },
      { id: uid(), n: 8, t: ago(1500), pushed: true },
      { id: uid(), n: 12, t: ago(3000), pushed: true },
      { id: uid(), n: 5, t: ago(4300), pushed: true },
    ],
    settings: { autoCommit: false, autoPush: false },
    phase: 'idle', // idle | capturing | pushing | error
    ai: 'idle', // idle | thinking | streaming (what the chat's AI is doing)
    progress: 0,
    failNext: false,
  };
}

export function createStore() {
  const state = sample();
  const subs = new Set();
  const timers = { commit: 0, push: 0, cap: 0, push2: 0, ai1: 0, ai2: 0 };
  const emit = (type, detail = {}) => {
    for (const fn of [...subs]) fn(type, detail, state);
  };
  const aheadList = () => state.commits.filter((c) => !c.pushed);
  const clearAll = () => Object.values(timers).forEach((id) => clearTimeout(id));
  const scheduleCommit = (ms = 1500) => {
    clearTimeout(timers.commit);
    timers.commit = setTimeout(() => api.commit(), ms);
  };
  const schedulePush = (ms = 900) => {
    clearTimeout(timers.push);
    timers.push = setTimeout(() => api.push(), ms);
  };
  const newItems = (count, start = 0) =>
    Array.from({ length: count }, (_, i) => {
      const ai = (start + i) % 2 === 1;
      return { id: uid('s'), role: ai ? 'ai' : 'user', kind: ai ? KINDS[Math.floor(Math.random() * KINDS.length)] : 'text' };
    });

  const api = {
    state,
    get ahead() {
      return aheadList().length;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    // A new exchange appeared in the chat. Tracked chats stage it automatically.
    reply(count = 2) {
      if (!state.tracked || state.phase === 'capturing') return;
      const items = newItems(count);
      state.staged.push(...items);
      emit('staged', { items });
      if (state.settings.autoCommit) scheduleCommit();
    },

    // One full turn as the extension would see it on the page:
    // user message sent → AI thinking → AI streaming its answer → answer done.
    // The user message is staged right away; auto-commit waits for the answer to finish.
    aiTurn({ withUser = true, thinkMs = 1700, streamMs = 2800 } = {}) {
      if (state.phase === 'capturing') return;
      clearTimeout(timers.ai1);
      clearTimeout(timers.ai2);
      clearTimeout(timers.commit);
      const tracked = state.tracked;
      if (withUser && tracked) {
        const items = [{ id: uid('s'), role: 'user', kind: 'text' }];
        state.staged.push(...items);
        emit('staged', { items, from: 'input' });
      }
      state.ai = 'thinking';
      emit('ai', { phase: 'thinking' });
      timers.ai1 = setTimeout(() => {
        state.ai = 'streaming';
        emit('ai', { phase: 'streaming', ms: streamMs });
      }, thinkMs);
      timers.ai2 = setTimeout(() => {
        if (state.tracked) {
          const items = [{ id: uid('s'), role: 'ai', kind: KINDS[Math.floor(Math.random() * KINDS.length)] }];
          state.staged.push(...items);
          emit('staged', { items, from: 'stream' });
        }
        state.ai = 'idle';
        emit('ai', { phase: 'idle' });
        if (state.tracked && state.settings.autoCommit) scheduleCommit();
      }, thinkMs + streamMs);
    },

    commit() {
      clearTimeout(timers.commit);
      if (!state.tracked || state.phase === 'capturing') return;
      if (!state.staged.length) return emit('nope', { action: 'commit' });
      const commit = { id: uid(), n: state.staged.length, t: Date.now(), pushed: false };
      state.staged = [];
      state.commits.unshift(commit);
      emit('committed', { commit });
      if (state.settings.autoPush) schedulePush();
    },

    // Push sends everything: anything still staged is committed first.
    push() {
      clearTimeout(timers.push);
      if (state.phase === 'pushing' || state.phase === 'capturing') return;
      if (state.tracked && state.staged.length) {
        api.commit();
        if (!state.settings.autoPush) schedulePush(650);
        return;
      }
      const list = aheadList();
      if (!list.length) return emit('nope', { action: 'push' });
      state.phase = 'pushing';
      emit('pushStart', { commits: list });
      timers.push2 = setTimeout(() => {
        if (state.phase !== 'pushing') return;
        if (state.failNext) {
          state.failNext = false;
          state.phase = 'error';
          return emit('error', { action: 'push' });
        }
        list.forEach((c) => (c.pushed = true));
        state.phase = 'idle';
        emit('pushed', { commits: list });
      }, 1500);
    },

    // Start tracking: scroll to the top loading older messages (count grows), then read every
    // message top to bottom (0–100%). Long chats take a while, so both stages report progress.
    init() {
      if (state.tracked || state.phase === 'capturing') return;
      state.phase = 'capturing';
      state.progress = 0;
      state.captureStage = 'loading';
      state.captureCount = 0;
      emit('captureStart');
      const total = 180;
      const t0 = performance.now();
      const loadMs = 3200;
      const readMs = 2400;
      const tick = () => {
        const el = performance.now() - t0;
        if (el < loadMs) {
          state.captureStage = 'loading';
          // older messages arrive in batches, like on the sites
          state.captureCount = Math.min(total, 30 * (1 + Math.floor(el / 480)));
          state.progress = 0.25 * (el / loadMs);
        } else {
          state.captureStage = 'reading';
          state.captureCount = total;
          state.progress = 0.25 + 0.75 * Math.min(1, (el - loadMs) / readMs);
        }
        emit('progress', { p: state.progress, stage: state.captureStage, count: state.captureCount });
        if (el < loadMs + readMs) {
          timers.cap = setTimeout(tick, 50);
          return;
        }
        state.tracked = true;
        state.phase = 'idle';
        state.staged = newItems(14);
        emit('captured', { items: state.staged });
        if (state.settings.autoCommit) scheduleCommit(1200);
      };
      tick();
    },

    cancelInit() {
      if (state.phase !== 'capturing') return;
      clearTimeout(timers.cap);
      state.phase = 'idle';
      state.progress = 0;
      emit('captureCancel');
    },

    untrack() {
      clearAll();
      Object.assign(state, { tracked: false, staged: [], commits: [], phase: 'idle', ai: 'idle', progress: 0, failNext: false });
      emit('reset');
    },

    resetSample() {
      clearAll();
      const s = sample();
      s.settings = state.settings;
      Object.assign(state, s);
      emit('reset');
    },

    // The playground has no chat to copy: report success without touching the clipboard.
    copyMarkdown() {
      return Promise.resolve(state.tracked);
    },

    failNextPush() {
      state.failNext = true;
      emit('armed');
    },

    setAuto(key, value) {
      const s = state.settings;
      let linked = null;
      if (key === 'autoPush') {
        if (value && !s.autoCommit) {
          s.autoCommit = true;
          linked = 'autoCommit';
        }
        s.autoPush = value;
      } else {
        if (!value && s.autoPush) {
          s.autoPush = false;
          linked = 'autoPush';
        }
        s.autoCommit = value;
      }
      emit('settings', { key, value, linked });
      if (s.autoCommit && state.staged.length) scheduleCommit(1100);
      else if (s.autoPush && aheadList().length) schedulePush(800);
    },
  };
  return api;
}
