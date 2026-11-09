// The UI kit's store, backed by the real extension.
//
// The widgets (src/content/ui) only know the small store interface of `demo-store.js`: a `state`
// object, `subscribe()`, and actions such as `commit()`. This class implements that interface on top
// of the background worker: it turns each new ChatStatus into the animation events the widgets
// expect ("staged", "committed", "pushed", …) by comparing it with the previous one.

import type { AiPhase, ChatStatus, CommitInfo, Settings, StagedItem } from '../shared/types';
import type { InitProgress } from './capture/init';

export interface UiState {
  tracked: boolean;
  staged: StagedItem[];
  commits: CommitInfo[];
  settings: { autoCommit: boolean; autoPush: boolean };
  phase: 'idle' | 'capturing' | 'pushing' | 'error';
  progress: number;
  captureStage: 'loading' | 'reading';
  captureCount: number;
  path: string;
  webUrl: string;
  error: string;
  ai: AiPhase;
}

export interface UiActions {
  commit(): void;
  push(): void;
  init(): void;
  cancelInit(): void;
  setAuto(key: 'autoCommit' | 'autoPush', value: boolean): void;
}

type Listener = (type: string, detail: Record<string, unknown>, state: UiState) => void;

const emptyState = (): UiState => ({
  tracked: false,
  staged: [],
  commits: [],
  settings: { autoCommit: false, autoPush: false },
  phase: 'idle',
  progress: 0,
  captureStage: 'loading',
  captureCount: 0,
  path: '',
  webUrl: '',
  error: '',
  ai: 'idle',
});

export class UiStore {
  readonly state: UiState = emptyState();
  private subs = new Set<Listener>();
  private key = '';
  private aheadTotal = 0;
  /** Set while init runs in this tab: the local progress wins over the background's copy. */
  private capturingHere = false;

  constructor(private readonly actions: UiActions) {}

  /** Commits waiting to be pushed (all chats — a push sends all of them). */
  get ahead(): number {
    return this.aheadTotal;
  }

  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit(type: string, detail: Record<string, unknown> = {}): void {
    for (const fn of [...this.subs]) fn(type, detail, this.state);
  }

  // ---- actions called by the widgets

  commit(): void {
    if (!this.state.tracked || this.state.phase === 'capturing') return;
    if (!this.state.staged.length) return this.emit('nope', { action: 'commit' });
    this.actions.commit();
  }

  push(): void {
    if (this.state.phase === 'pushing' || this.state.phase === 'capturing') return;
    if (!this.state.staged.length && !this.aheadTotal && this.state.phase !== 'error') return this.emit('nope', { action: 'push' });
    this.actions.push();
  }

  init(): void {
    if (this.state.tracked || this.state.phase === 'capturing') return;
    this.actions.init();
  }

  cancelInit(): void {
    if (this.state.phase === 'capturing') this.actions.cancelInit();
  }

  setAuto(key: 'autoCommit' | 'autoPush', value: boolean): void {
    this.actions.setAuto(key, value);
  }

  // ---- updates from the controller

  /** A different chat (or no chat) is showing. */
  switchTo(key: string, status: ChatStatus | null): void {
    this.key = key;
    this.capturingHere = false;
    const s = this.state;
    Object.assign(s, emptyState(), { settings: s.settings, ai: s.ai });
    if (status) this.copy(status);
    this.emit('reset');
  }

  applyStatus(status: ChatStatus): void {
    if (status.key !== this.key) return;
    const s = this.state;
    const prev = { tracked: s.tracked, phase: s.phase, staged: s.staged, commits: s.commits };
    this.copy(status);

    const prevIds = new Set(prev.staged.map((i) => i.id));
    const added = s.staged.filter((i) => !prevIds.has(i.id));
    const prevCommitIds = new Set(prev.commits.map((c) => c.id));
    const newCommit = s.commits.find((c) => !prevCommitIds.has(c.id) && !c.pushed);
    const nowPushed = s.commits.filter((c) => c.pushed && prev.commits.some((p) => p.id === c.id && !p.pushed));

    if (!prev.tracked && s.tracked) {
      this.emit('captured', { items: s.staged });
      return;
    }
    if (prev.phase === 'capturing' && s.phase !== 'capturing' && !s.tracked) this.emit('captureCancel');
    if (newCommit) this.emit('committed', { commit: newCommit });
    else if (added.length) {
      const user = added.filter((i) => i.role === 'user');
      const ai = added.filter((i) => i.role === 'assistant');
      if (user.length) this.emit('staged', { items: user, from: 'input' });
      if (ai.length) this.emit('staged', { items: ai, from: 'stream' });
    }
    if (prev.phase !== 'pushing' && s.phase === 'pushing') this.emit('pushStart', { commits: s.commits.filter((c) => !c.pushed) });
    if (nowPushed.length) this.emit('pushed', { commits: nowPushed });
    if (prev.phase !== 'error' && s.phase === 'error') this.emit('error', { action: 'push' });
    this.emit('status');
  }

  applySettings(settings: Settings): void {
    const before = this.state.settings;
    const next = { autoCommit: settings.autoCommit, autoPush: settings.autoPush };
    this.state.settings = next;
    const changed = (['autoPush', 'autoCommit'] as const).filter((k) => before[k] !== next[k]);
    if (!changed.length) return;
    // the first change is the one the user made; the other one followed the auto rule
    const key = changed.length === 2 ? (next.autoPush ? 'autoPush' : 'autoCommit') : changed[0]!;
    const linked = changed.find((k) => k !== key) ?? null;
    this.emit('settings', { key, value: next[key], linked });
  }

  setAi(phase: AiPhase, ms?: number): void {
    if (this.state.ai === phase) return;
    this.state.ai = phase;
    this.emit('ai', { phase, ms });
  }

  setCapture(p: InitProgress | null): void {
    const s = this.state;
    if (!p) {
      this.capturingHere = false;
      return;
    }
    const starting = s.phase !== 'capturing';
    this.capturingHere = true;
    s.phase = 'capturing';
    s.captureStage = p.stage;
    s.captureCount = p.count;
    s.progress = p.progress;
    if (starting) this.emit('captureStart');
    this.emit('progress', { p: p.progress, stage: p.stage, count: p.count });
  }

  private copy(st: ChatStatus): void {
    const s = this.state;
    s.tracked = st.tracked;
    s.staged = st.staged;
    s.commits = st.commits;
    s.path = st.path ?? '';
    s.webUrl = st.webUrl ?? '';
    s.error = st.error ?? '';
    this.aheadTotal = st.aheadTotal;
    // while init runs in this tab, its local progress is the truth; afterwards the background is
    if (!this.capturingHere) {
      s.phase = st.phase;
      if (st.phase === 'capturing' && st.progress != null) s.progress = st.progress;
    }
  }
}
