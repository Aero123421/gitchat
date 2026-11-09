// Glue for one chat tab: follows the site's in-app navigation, keeps the widget in sync with the
// background worker, stages answers as they finish, and runs init for untracked chats.
//
// Every capture is bound to the conversation it was read from: a route generation counter changes
// whenever the chat changes, the page identity (id, URL, title, time) is frozen at the DOM read, and
// a result whose generation changed while it was being enriched is dropped. Captures run one at a
// time, in the order they were read, so an older read can never arrive after a newer one.

import { chatKey, type ChatKey, type ChatStatus, type Settings } from '../shared/types';
import { EVENTS_PORT, request, type BackgroundEvent, type ContentCurrent, type RefreshResult, type SnapshotReason, type ToContent } from '../shared/protocol';
import { log } from '../shared/log';
import { t } from '../shared/i18n';
import type { Adapter } from './adapters/types';
import { UiStore } from './bridge';
import { Widget } from './widget';
import { AiObserver } from './capture/observer';
import { attachArtifacts, isAtEnd, makeSnapshot, readPage, type PageRead } from './capture/snapshot';
import type { CapturedMessage } from '../shared/types';
import { captureFullHistory, InitIncompleteError, type InitProgress } from './capture/init';

/** Assumed length of an answer stream, used only to pace the "answer forming" animation. */
const STREAM_PACE_MS = 8000;
/** How long to wait for a freshly opened tracked chat to settle before reading it. */
const READY_TIMEOUT_MS = 20_000;

/** The conversation a piece of work belongs to. */
interface Route {
  gen: number;
  key: ChatKey;
  chatId: string;
}

/** What a queued capture was asked for: the route and the AI turn current at that moment. */
interface Ticket {
  gen: number;
  turn: number;
}

type SnapResult = { ok: true } | { ok: false; error: string };

const STRENGTH: Record<SnapshotReason, number> = { manual: 0, sent: 1, answered: 2 };
const stronger = (a: SnapshotReason | null, b: SnapshotReason): SnapshotReason => (a && STRENGTH[a] >= STRENGTH[b] ? a : b);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Controller {
  private settings!: Settings;
  private readonly store: UiStore;
  private readonly widget: Widget;
  private readonly observer: AiObserver;
  private port: chrome.runtime.Port | null = null;
  private key: ChatKey | null = null;
  private chatId: string | null = null;
  /** Changes whenever the conversation shown in this tab changes. */
  private gen = 0;
  private lastUrl = '';
  private abort: AbortController | null = null;
  private lastProgressSent = 0;
  /** Captures run strictly one after another (see the file comment). */
  private chain: Promise<void> = Promise.resolve();
  /** The strongest capture request that arrived while init was running; replayed afterwards. */
  private suppressed: SnapshotReason | null = null;
  /** Route generation of a running "read the chat once it is ready" job. */
  private reconciling = -1;

  constructor(private readonly adapter: Adapter) {
    this.store = new UiStore({
      commit: () => void this.call('chat/commit'),
      push: () => void this.call('chat/push'),
      init: () => void this.init(),
      cancelInit: () => this.abort?.abort(),
      setAuto: (key, value) => void this.setAuto(key, value),
    });
    this.widget = new Widget(this.store, () => void request('app/open-settings', {}).catch(() => {}));
    this.observer = new AiObserver(adapter, document, {
      phase: (p) => this.store.setAi(p, p === 'streaming' ? STREAM_PACE_MS : undefined),
      sent: () => void this.snapshot('sent'),
      answered: () => void this.snapshot('answered'),
      stalled: (on) => this.store.setStalled(on),
    });
  }

  async start(): Promise<void> {
    this.settings = await request('settings/get', {});
    this.store.applySettings(this.settings);
    this.connect();
    this.listenToPopup();
    this.observer.start();
    this.adapter.watch?.(document);
    // Single-page apps change the URL without reloading: poll for it (content scripts cannot hook
    // the page's history API from their isolated world).
    window.setInterval(() => void this.checkRoute(), 400);
    window.setInterval(() => this.widget.setTheme(this.adapter.theme(document)), 1500);
    await this.checkRoute(true);
  }

  // ---- background connection

  private connect(): void {
    try {
      this.port = chrome.runtime.connect({ name: EVENTS_PORT });
    } catch {
      return; // the extension was reloaded or removed; this tab's script is orphaned
    }
    this.port.onMessage.addListener((ev: BackgroundEvent) => this.onEvent(ev));
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      // the service worker went to sleep or restarted: reconnect and re-announce the chat
      window.setTimeout(() => {
        if (!chrome.runtime?.id) return;
        this.connect();
        void this.checkRoute(true);
      }, 1000);
    });
  }

  private onEvent(ev: BackgroundEvent): void {
    if (ev.type === 'status') {
      const was = this.store.state.tracked;
      this.store.applyStatus(ev.status);
      // tracked from elsewhere (another device's file was adopted, another tab ran init)
      const route = this.route();
      if (!was && this.store.state.tracked && route && ev.status.key === route.key && !this.abort) void this.reconcile(route);
    } else if (ev.type === 'sync') {
      this.store.setAhead(ev.sync.pending);
    } else if (ev.type === 'settings') {
      const prev = this.settings;
      this.settings = ev.settings;
      this.store.applySettings(ev.settings);
      if (prev.widget !== ev.settings.widget || prev.services[this.adapter.service] !== ev.settings.services[this.adapter.service]) {
        this.widget.hide();
        void this.checkRoute(true);
      }
    }
  }

  private listenToPopup(): void {
    chrome.runtime.onMessage.addListener((msg: ToContent, _sender, reply) => {
      if (!msg || msg.gitchat !== 1) return;
      if (msg.type === 'content/current') {
        const current: ContentCurrent = {
          service: this.adapter.service,
          chatId: this.chatId,
          title: this.adapter.title(document),
          status: this.key ? this.statusSnapshot() : null,
        };
        reply(current);
      } else if (msg.type === 'content/init') {
        void this.init();
        reply(null);
      } else if (msg.type === 'content/rescan') {
        // read a tracked chat again from the top (complete capture)
        void this.init({ rescan: true });
        reply(null);
      } else if (msg.type === 'content/refresh') {
        // the popup is about to commit or push: stage what the page shows right now first
        void this.refresh().then(
          (r) => reply(r),
          () => reply({ ok: false, error: t('errCaptureFailed') } satisfies RefreshResult),
        );
        return true;
      }
    });
  }

  private statusSnapshot(): ChatStatus | null {
    if (!this.key || !this.chatId) return null;
    const s = this.store.state;
    return {
      key: this.key,
      service: this.adapter.service,
      chatId: this.chatId,
      tracked: s.tracked,
      path: s.path || undefined,
      staged: s.staged,
      commits: s.commits,
      aheadTotal: this.store.ahead,
      phase: s.phase,
      progress: s.progress,
      webUrl: s.webUrl || undefined,
    };
  }

  // ---- navigation

  private route(): Route | null {
    return this.key && this.chatId ? { gen: this.gen, key: this.key, chatId: this.chatId } : null;
  }

  /** The route is still the one shown in this tab. */
  private live(r: Route): boolean {
    return r.gen === this.gen && this.key === r.key;
  }

  /** The page's URL still belongs to the route (the route itself is only polled every 400 ms). */
  private onPage(r: Route): boolean {
    return this.adapter.chatId(new URL(location.href)) === r.chatId;
  }

  private async checkRoute(force = false): Promise<void> {
    const href = location.href;
    if (!force && href === this.lastUrl) return;
    this.lastUrl = href;
    const chatId = this.settings.services[this.adapter.service] ? this.adapter.chatId(new URL(href)) : null;
    if (!force && chatId === this.chatId) return;

    if (chatId !== this.chatId) {
      this.gen++;
      // the old chat's init cleans up on its own and no longer touches this tab's UI
      this.abort?.abort();
      this.abort = null;
      this.suppressed = null;
      this.observer.reset();
      this.store.setAi('idle');
      this.store.setStalled(false);
      // the widget belongs to the new chat right away, before the background has answered
      this.store.switchTo(chatId ? chatKey(this.adapter.service, chatId) : '', null);
    }
    this.chatId = chatId;
    if (!chatId) {
      this.key = null;
      this.store.switchTo('', null);
      this.widget.hide();
      return;
    }
    const key = chatKey(this.adapter.service, chatId);
    this.key = key;
    const route: Route = { gen: this.gen, key, chatId };
    this.widget.show(this.settings.widget, this.adapter.theme(document));
    try {
      const status = await request('chat/open', { service: this.adapter.service, chatId, url: href, title: this.adapter.title(document) });
      if (!this.live(route)) return;
      // an init running for this same chat keeps its local progress
      if (this.abort) this.store.applyStatus(status);
      else this.store.switchTo(key, status);
      if (status.tracked && !this.abort) void this.reconcile(route);
    } catch (e) {
      log.warn('could not open chat', e);
      if (this.live(route)) this.store.switchTo(key, null);
    }
  }

  // ---- staging

  /**
   * Queue a capture; resolves once it (and every capture before it) has been handled. The job is
   * bound to the chat and the AI turn current now: it is dropped if the chat changes, and an
   * "answered" job is dropped if the AI has started on another turn by the time it runs (the next
   * turn's own captures include the finished answer).
   */
  private snapshot(reason: SnapshotReason): Promise<SnapResult> {
    if (this.abort) {
      this.suppressed = stronger(this.suppressed, reason);
      return Promise.resolve({ ok: true });
    }
    const ticket: Ticket = { gen: this.gen, turn: this.observer.turn };
    const job = this.chain.then(() => this.runSnapshot(reason, ticket));
    this.chain = job.catch((e) => log.warn('snapshot failed', e));
    return job.then(
      () => ({ ok: true }) as const,
      (e) => ({ ok: false, error: captureError(e) }) as const,
    );
  }

  private async runSnapshot(reason: SnapshotReason, ticket: Ticket): Promise<void> {
    if (ticket.gen !== this.gen) return;
    if (reason === 'answered' && (ticket.turn !== this.observer.turn || !this.observer.settled)) return;
    const route = this.route();
    if (!route || !this.store.state.tracked || this.abort) return;
    if (!this.onPage(route)) {
      void this.checkRoute();
      return;
    }
    // one synchronous read: messages and the page's identity at the same moment
    const read = readPage(this.adapter, document);
    if (!read.messages.length) return;
    // only a settled capture may drop turns that vanished (a 'sent' one is taken mid-change)
    const atEnd = reason !== 'sent' && this.observer.settled && isAtEnd(this.adapter, document);
    const messages = await this.withArtifacts(read.messages);
    if (!this.live(route) || this.abort) return;
    const status = await request('chat/snapshot', { snapshot: makeSnapshot(this.adapter, route.chatId, read, messages, false, atEnd), reason });
    if (this.live(route)) this.store.applyStatus(status);
  }

  /** Read a freshly opened tracked chat once it has settled, so answers missed while away are staged. */
  private async reconcile(route: Route): Promise<void> {
    if (this.reconciling === route.gen) return;
    this.reconciling = route.gen;
    try {
      if (await this.whenReady(route, READY_TIMEOUT_MS)) await this.snapshot('manual');
    } finally {
      if (this.reconciling === route.gen) this.reconciling = -1;
    }
  }

  /** True once messages are shown, the AI is idle and the list has not changed for `stableMs`. */
  private async whenReady(route: Route, maxMs: number, stableMs = 1000): Promise<boolean> {
    const start = performance.now();
    let sig = '';
    let since = start;
    while (performance.now() - start < maxMs) {
      if (!this.live(route) || !this.onPage(route) || this.abort) return false;
      const msgs = this.adapter.messages(document);
      const last = msgs[msgs.length - 1];
      const now = msgs.length ? `${msgs.length}:${last ? (this.adapter.body(last).textContent ?? '').length : 0}` : '';
      if (now !== sig) {
        sig = now;
        since = performance.now();
      } else if (now && this.observer.settled && performance.now() - since >= stableMs) {
        return true;
      }
      await wait(250);
    }
    return false;
  }

  /**
   * Stage what the page shows right now, if it can be read now (tracked, no turn in progress,
   * messages shown). `ok: false` only when reading or staging failed — then nothing may be
   * committed or pushed on top of it.
   */
  private async refresh(): Promise<RefreshResult> {
    const route = this.route();
    if (!route || !this.store.state.tracked || this.abort || !this.observer.settled) return { ok: true };
    if (!this.adapter.messages(document).length) return { ok: true };
    const r = await this.snapshot('manual');
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }

  // ---- init (whole history)

  /** Capture the whole history: starts tracking an untracked chat, or (rescan) re-reads a tracked one. */
  async init(opts: { rescan?: boolean } = {}): Promise<void> {
    const route = this.route();
    const rescan = !!opts.rescan;
    if (!route || this.abort || rescan !== this.store.state.tracked || !this.onPage(route)) return;
    const abort = new AbortController();
    this.abort = abort;
    let heartbeat = 0;
    let initId: string | null = null;
    let lastProgress = 0;
    const progress = (p: InitProgress) => {
      if (!this.live(route)) return;
      lastProgress = p.progress;
      this.store.setCapture(p);
      const now = performance.now();
      if (initId && now - this.lastProgressSent > 500) {
        this.lastProgressSent = now;
        void request('chat/init/progress', { key: route.key, initId, progress: p.progress }).catch(() => {});
      }
    };
    try {
      progress({ stage: 'loading', count: 0, progress: 0 });
      const started = await request('chat/init/start', { key: route.key });
      initId = started.initId;
      // The background ends an init session that goes quiet (e.g. a closed tab). Waiting for a long
      // answer is not quiet: keep reporting while the capture runs.
      heartbeat = window.setInterval(() => {
        if (initId && this.live(route)) void request('chat/init/progress', { key: route.key, initId, progress: lastProgress }).catch(() => {});
      }, 20_000);
      if (!this.live(route)) throw new DOMException('Cancelled', 'AbortError');
      this.store.applyStatus(started.status);
      const artifacts = this.settings.saveVisualizations ? this.adapter.artifacts?.bind(this.adapter) : undefined;
      const result = await captureFullHistory(this.adapter, document, {
        signal: abort.signal,
        onProgress: progress,
        ...(artifacts ? { artifacts: (skip: ReadonlySet<string>) => artifacts(document, { skip }).catch(() => []) } : {}),
        // a stalled turn is not finished: only a settled observer counts as done
        busy: () => !this.observer.settled,
        // restore the scroll only while this chat still owns the page
        owns: () => this.live(route) && this.onPage(route),
      });
      abort.signal.throwIfAborted();
      if (!this.live(route) || !this.onPage(route)) throw new DOMException('Cancelled', 'AbortError');
      const messages = attachArtifacts(result.messages, result.artifacts);
      if (!messages.length) throw new InitIncompleteError('empty');
      // a history without a single answer means the answers were not found: never save that as complete
      if (!messages.some((m) => m.role === 'assistant')) throw new InitIncompleteError('one-sided');
      const read: PageRead = { messages, url: location.href.split('#')[0] ?? location.href, title: this.adapter.title(document), capturedAt: result.readAt };
      const status = await request('chat/init/done', { snapshot: makeSnapshot(this.adapter, route.chatId, read, messages, true), initId });
      if (this.live(route)) {
        this.store.setCapture(null);
        this.store.applyStatus(status);
        if (rescan) this.store.captureDone(true);
      }
    } catch (e) {
      // after a navigation the widget belongs to another chat: leave it alone
      const here = this.live(route);
      if (here) this.store.setCapture(null);
      const cancelled = isAbort(e);
      if (!cancelled) log.warn('init failed', e);
      if (initId) {
        try {
          const status = await request('chat/init/cancel', { key: route.key, initId });
          if (this.live(route)) this.store.applyStatus(status);
        } catch {
          // background unavailable; the next status event will fix the UI
        }
      }
      if (this.live(route)) {
        if (rescan) this.store.captureDone(false);
        if (!cancelled) this.store.fail('init', initError(e));
      }
    } finally {
      clearInterval(heartbeat);
      if (this.abort === abort) this.abort = null;
      const replay = this.suppressed;
      this.suppressed = null;
      if (replay && this.live(route) && this.store.state.tracked) void this.snapshot(replay);
    }
  }

  private async withArtifacts(messages: CapturedMessage[]): Promise<CapturedMessage[]> {
    if (!this.settings.saveVisualizations || !this.adapter.artifacts || !messages.length) return messages;
    try {
      return attachArtifacts(messages, await this.adapter.artifacts(document));
    } catch {
      return messages;
    }
  }

  // ---- actions

  private async call(type: 'chat/commit' | 'chat/push'): Promise<void> {
    const route = this.route();
    if (!route) return;
    // commit what the page shows now, not what was last captured — and nothing if that failed
    const fresh = await this.refresh();
    if (!this.live(route)) return;
    if (!fresh.ok) return this.store.fail(type === 'chat/commit' ? 'commit' : 'push', fresh.error ?? t('errCaptureFailed'));
    const s = this.store.state;
    if (type === 'chat/commit' && !s.staged.length) return this.store.nope('commit');
    if (type === 'chat/push' && !s.staged.length && !this.store.ahead && s.phase !== 'error') return this.store.nope('push');
    try {
      const status = await request(type, { key: route.key });
      if (status && this.live(route)) this.store.applyStatus(status);
    } catch (e) {
      log.warn(`${type} failed`, e);
    }
  }

  private async setAuto(key: 'autoCommit' | 'autoPush', value: boolean): Promise<void> {
    try {
      this.settings = await request('settings/set', { patch: { [key]: value } });
      this.store.applySettings(this.settings);
    } catch (e) {
      log.warn('could not save settings', e);
    }
  }
}

/** What the widget says when the page could not be read and staged. */
function captureError(e: unknown): string {
  log.warn('capture failed', e);
  return t('errCaptureFailed');
}

/** What the widget says when init could not finish. */
function initError(e: unknown): string {
  if (e instanceof InitIncompleteError) {
    if (e.reason === 'busy') return t('errInitBusy');
    if (e.reason === 'empty' || e.reason === 'one-sided') return t('errInitEmpty');
    if (e.reason === 'coverage') return t('errInitCoverage');
    return t('errInitIncomplete');
  }
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'busy') return t('errInitOtherTab');
  if (code === 'stale-init') return t('errInitStale');
  return e instanceof Error && e.message ? e.message : t('errGeneric');
}
