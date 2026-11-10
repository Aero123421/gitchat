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
  /** The AI's turn made no progress for a long time (shown as idle, but not finished). */
  stalled: boolean;
}

export interface UiActions {
  commit(): void;
  push(): void;
  init(): void;
  cancelInit(): void;
  setAuto(key: 'autoCommit' | 'autoPush', value: boolean): void;
  /** Copies the tracked chat to the clipboard as Markdown; resolves to whether it was copied. */
  copyMarkdown(): Promise<boolean>;
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
  stalled: false,
});

export class UiStore {
  readonly state: UiState = emptyState();
  private subs = new Set<Listener>();
  private key = '';
  private aheadTotal = 0;
  /** Set while init runs in this tab: the local progress wins over the background's copy. */
  private capturingHere = false;
  /**
   * Why init failed in this tab. The background has already ended the init, so its status no longer
   * says so: the reason is kept (as phase 'error') until the user acts again or the chat changes.
   */
  private initError = '';

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

  // Commit and push first read the page again (it may show more than was last captured); the
  // controller answers with `nope()` when there turns out to be nothing to do.
  commit(): void {
    if (!this.state.tracked || this.state.phase === 'capturing') return;
    this.actions.commit();
  }

  push(): void {
    if (this.state.phase === 'pushing' || this.state.phase === 'capturing') return;
    this.actions.push();
  }

  /** The action had nothing to do (the widget gives a small "no" shake). */
  nope(action: 'commit' | 'push'): void {
    this.emit('nope', { action });
  }

  init(): void {
    if (this.state.tracked || this.state.phase === 'capturing') return;
    this.initError = '';
    this.actions.init();
  }

  cancelInit(): void {
    if (this.state.phase === 'capturing') this.actions.cancelInit();
  }

  setAuto(key: 'autoCommit' | 'autoPush', value: boolean): void {
    this.actions.setAuto(key, value);
  }

  /** Forward synchronously so the clipboard write still belongs to the trusted click. */
  copyMarkdown(): Promise<boolean> {
    if (!this.state.tracked) return Promise.resolve(false);
    return this.actions.copyMarkdown();
  }

  // ---- updates from the controller

  /** A different chat (or no chat) is showing. */
  switchTo(key: string, status: ChatStatus | null): void {
    this.key = key;
    this.capturingHere = false;
    this.initError = '';
    const s = this.state;
    Object.assign(s, emptyState(), { settings: s.settings, ai: s.ai, stalled: s.stalled });
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
    // a push always ends with one event, also when nothing was sent (e.g. every commit was superseded)
    if (prev.phase === 'pushing' && s.phase !== 'pushing') this.emit('pushEnd', { ok: s.phase !== 'error', pushed: nowPushed.length });
    this.emit('status');
  }

  /** Unpushed commits across all chats changed (another tab committed or pushed). */
  setAhead(n: number): void {
    if (n === this.aheadTotal) return;
    this.aheadTotal = n;
    this.emit('status');
  }

  /**
   * An action failed (init, or the fresh capture before a commit/push): show why. A commit/push
   * failure shows until the next status; an init failure until the user acts again (see initError).
   */
  fail(action: 'init' | 'commit' | 'push', message: string): void {
    const s = this.state;
    if (action === 'init') this.initError = message;
    s.phase = 'error';
    s.error = message;
    this.emit('error', { action, message });
    this.emit('status');
  }

  /** Init could not finish on an untracked chat. */
  initFailed(message: string): void {
    if (!this.state.tracked) this.fail('init', message);
  }

  /** A rescan of a tracked chat ended (the tracked flag never changes, so say it explicitly). */
  captureDone(ok: boolean): void {
    if (ok) this.emit('captured', { items: this.state.staged });
    else this.emit('captureCancel');
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

  setStalled(on: boolean): void {
    if (this.state.stalled === on) return;
    this.state.stalled = on;
    this.emit('stalled', { on });
  }

  setCapture(p: InitProgress | null): void {
    const s = this.state;
    if (!p) {
      this.capturingHere = false;
      return;
    }
    const starting = s.phase !== 'capturing';
    this.capturingHere = true;
    this.initError = '';
    s.phase = 'capturing';
    s.error = '';
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
    // the chat got tracked after all (e.g. from another tab): the old failure no longer applies
    if (st.tracked || st.phase !== 'idle') this.initError = '';
    if (this.initError) {
      s.phase = 'error';
      s.error = this.initError;
    }
  }
}
