// Glue for one chat tab: follows the site's in-app navigation, keeps the widget in sync with the
// background worker, stages answers as they finish, and runs init for untracked chats.
//
// Every capture is bound to the conversation it was read from: a route generation counter changes
// whenever the chat changes, the page identity (id, URL, title, time) is frozen at the DOM read, and
// a result whose generation changed while it was being enriched is dropped. Captures run one at a
// time, in the order they were read, so an older read can never arrive after a newer one.
//
// After a navigation the page may still show the previous chat for a moment (or keep a hidden copy
// of it). The previous chat's message ids are remembered, and a read made only of them is not a read
// of the new chat: nothing is saved until a message of the new chat is on the page (however long
// that takes — no time limit turns an old page into the new chat). A chat branched from the
// previous one shares its first messages, so one new message is enough. Where the page names its
// own conversation, that id clears this guard when it matches the URL, and blocks captures while it
// still names the previous chat. Any other mismatch is not trusted either way: the page's id can lag
// behind the URL right after a chat is created.
//
// A URL change that keeps the chat id (an account slot, a query) is checked against the message ids
// already seen on this visit. A page that shares none of them is not written into the open chat.
// The check stops at the first non-empty sample, so a later scroll to another part of the same chat
// is not mistaken for a different transcript.
//
// The AI observer and the page watchers only run while a chat of an enabled service is shown.

import { chatKey, type ChatKey, type ChatSnapshot, type ChatStatus, type Settings } from '../shared/types';
import { EVENTS_PORT, request, type BackgroundEvent, type ContentCurrent, type RefreshResult, type SnapshotReason, type ToContent } from '../shared/protocol';
import { log } from '../shared/log';
import { t } from '../shared/i18n';
import type { Adapter } from './adapters/types';
import { UiStore } from './bridge';
import { Widget } from './widget';
import { AiObserver } from './capture/observer';
import { attachArtifacts, canonicalPageUrl, isAtEnd, makeSnapshot, readPage, type PageRead } from './capture/snapshot';
import type { CapturedMessage } from '../shared/types';
import { captureFullHistory, InitIncompleteError, type InitProgress } from './capture/init';

/** Assumed length of an answer stream, used only to pace the "answer forming" animation. */
const STREAM_PACE_MS = 8000;
/** How long to wait for a freshly opened tracked chat to settle before reading it. */
const READY_TIMEOUT_MS = 20_000;
/** How often the ids on the page are noted while a chat is shown (to recognise it after navigating). */
const SAMPLE_MS = 1500;
/** How long init waits for the new chat to replace the previous one on the page before giving up. */
const OWN_PAGE_WAIT_MS = 10_000;
/** At most one automatic full read per visit of a chat in this period. */
const AUTO_RESCAN_MS = 60_000;
/**
 * After a URL change that keeps the chat id, how long to wait for the other transcript to appear.
 * The other account's DOM can land a moment after the address bar. Past this, an empty page is not
 * treated as a different chat.
 */
const SAME_CHAT_WATCH_MS = 4000;
/**
 * How long a copy waits for the page to be staged. Chrome's user activation lasts about 5 s and the
 * clipboard write needs it, so a slow read is skipped (the copy then has the last capture).
 */
const COPY_REFRESH_MS = 1500;
/** Abort reason when the tab moves to another chat: unlike Cancel, it does not undo a finished capture. */
const NAVIGATED = 'gitchat:navigated';

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
const newView = (): NonNullable<ChatSnapshot['view']> => ({ id: crypto.randomUUID(), since: Date.now() });
const byUser = (signal: AbortSignal) => !(signal.reason instanceof DOMException && signal.reason.message === NAVIGATED);

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
  /** This tab's visit to the current chat, sent with every capture (see ChatSnapshot.view). */
  private view = newView();
  /** Service message ids last seen on the page while the current chat was shown. */
  private sample: { chatId: string; ids: Set<string>; at: number } | null = null;
  /** Every service message id seen on this visit (a virtualized window is only the latest sample). */
  private visitIds: Set<string> | null = null;
  /** The page shows a transcript that shares no message with this visit: do not write it into the chat. */
  private foreign = false;
  /** Same-id URL change whose transcript has not been judged yet (see SAME_CHAT_WATCH_MS). */
  private hrefWatch = false;
  private watchUntil = 0;
  /** The previous chat's ids, until a message of the new chat is on the page. */
  private stale: { ids: Set<string> } | null = null;
  /** The chat shown before this one in the tab, for the page-named-id check. */
  private prevChatId: string | null = null;
  /** Interval timers, cleared when the extension goes away under this script. */
  private timers: number[] = [];
  private watching = false;
  /** The last automatic full read: route generation and time. */
  private autoRescan = { gen: -1, at: -Infinity };

  constructor(private readonly adapter: Adapter) {
    this.store = new UiStore({
      commit: () => void this.call('chat/commit'),
      push: () => void this.call('chat/push'),
      init: () => void this.init(),
      cancelInit: () => this.abort?.abort(),
      setAuto: (key, value) => void this.setAuto(key, value),
      copyMarkdown: () => this.copyMarkdown(),
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
    // Single-page apps change the URL without reloading: poll for it (content scripts cannot hook
    // the page's history API from their isolated world).
    this.timers.push(
      window.setInterval(() => {
        if (this.orphaned()) return;
        void this.checkRoute();
      }, 400),
      window.setInterval(() => {
        if (this.chatId) this.widget.setTheme(this.widgetTheme());
      }, 1500),
    );
    await this.checkRoute(true);
  }

  /** Watch the AI and the page only while a chat is shown (the route poll keeps running). */
  private setWatching(on: boolean): void {
    if (on === this.watching) return;
    this.watching = on;
    if (on) {
      this.adapter.watch?.(document);
      this.observer.start();
    } else {
      this.observer.stop();
    }
  }

  /**
   * The extension was reloaded or removed: this script can no longer reach it. Stop all work and
   * take the widget off the page (the tab needs a reload to get the new version).
   */
  private orphaned(): boolean {
    if (chrome.runtime?.id) return false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.setWatching(false);
    this.abort?.abort(new DOMException(NAVIGATED, 'AbortError'));
    this.widget.hide();
    return true;
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
        if (this.orphaned()) return;
        this.connect();
        void this.checkRoute(true);
      }, 1000);
    });
  }

  /** Chosen Light/Dark wins over the chat site; Auto keeps following the site. */
  private widgetTheme(): 'light' | 'dark' {
    const theme = this.settings.theme;
    return theme === 'light' || theme === 'dark' ? theme : this.adapter.theme(document);
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
      const widgetChanged = prev.widget !== ev.settings.widget;
      const serviceChanged = prev.services[this.adapter.service] !== ev.settings.services[this.adapter.service];
      if (widgetChanged || serviceChanged) {
        this.widget.hide();
        void this.checkRoute(true);
      } else if (prev.theme !== ev.settings.theme && this.chatId) {
        // A chosen theme, or a return to Auto, applies now — not on the next 1.5s poll.
        this.widget.setTheme(this.widgetTheme());
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
    // a failure only this tab knows about (e.g. init could not read the chat) goes with it
    const error = s.phase === 'error' && s.error ? { error: s.error } : {};
    return {
      ...error,
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
    const hrefChanged = href !== this.lastUrl;
    if (!force && !hrefChanged) {
      this.guardOtherChat();
      if (this.foreign || this.hrefWatch) this.confirmSameChat();
      else this.sampleIds();
      return;
    }
    this.lastUrl = href;
    const chatId = this.settings.services[this.adapter.service] ? this.adapter.chatId(new URL(href)) : null;
    if (chatId === this.chatId) {
      // A forced re-open (reconnect, settings) is not a navigation. Only a new href can be another transcript.
      if (chatId && hrefChanged) {
        this.hrefWatch = true;
        this.watchUntil = performance.now() + SAME_CHAT_WATCH_MS;
        this.confirmSameChat();
        this.guardOtherChat();
      }
      if (!force || this.foreign || this.namesOtherChat()) return;
    }

    if (chatId !== this.chatId) {
      this.gen++;
      this.view = newView();
      this.foreign = false;
      this.hrefWatch = false;
      this.watchUntil = 0;
      this.visitIds = null;
      // until the new chat's messages show, the previous chat's still on the page are not its own
      const prev = this.chatId && this.sample?.chatId === this.chatId ? this.sample.ids : null;
      this.prevChatId = this.chatId;
      this.stale = prev && chatId ? { ids: prev } : null;
      this.sample = null;
      // the old chat's init cleans up on its own and no longer touches this tab's UI (a capture it
      // already finished is still saved: only Cancel takes that back)
      this.abort?.abort(new DOMException(NAVIGATED, 'AbortError'));
      this.abort = null;
      this.suppressed = null;
      this.observer.reset();
      this.store.setAi('idle');
      this.store.setStalled(false);
      // the widget belongs to the new chat right away, before the background has answered
      this.store.switchTo(chatId ? chatKey(this.adapter.service, chatId) : '', null);
    }
    this.chatId = chatId;
    this.setWatching(!!chatId);
    if (!chatId) {
      this.key = null;
      this.store.switchTo('', null);
      this.widget.hide();
      return;
    }
    const key = chatKey(this.adapter.service, chatId);
    this.key = key;
    const route: Route = { gen: this.gen, key, chatId };
    this.widget.show(this.settings.widget, this.widgetTheme());
    try {
      const status = await request('chat/open', { service: this.adapter.service, chatId, url: canonicalPageUrl(this.adapter, href), title: this.adapter.title(document) });
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

  /** The service's own ids of the messages on the page (content-derived ids could repeat across chats). */
  private pageIds(): string[] {
    return this.adapter.messages(document).flatMap((n) => (n.id ? [n.id] : []));
  }

  /** Conversation id the page reports, compared case-insensitively with the URL id. Missing means unknown. */
  private pageConversationId(): string | null {
    const raw = this.adapter.pageChatId?.(document);
    if (!raw) return null;
    const id = raw.trim().toLowerCase();
    return id || null;
  }

  /** The page names the chat in the URL, so copied message ids are still this chat's. */
  private namesThisChat(): boolean {
    const page = this.pageConversationId();
    return !!this.chatId && page === this.chatId.toLowerCase();
  }

  /**
   * The page still names the chat this tab showed before. Only that is a disagreement: right after a
   * chat is created the page's id may lag behind the URL, and a missing id says nothing.
   */
  private namesOtherChat(): boolean {
    const page = this.pageConversationId();
    const prev = this.prevChatId?.toLowerCase();
    return !!this.chatId && !!page && !!prev && page === prev && page !== this.chatId.toLowerCase();
  }

  /** Stop writing into the open chat: another conversation is on the page, or this visit shares no message. */
  private refuseCapture(): boolean {
    return this.foreign || this.namesOtherChat();
  }

  /** A running init must not finish into this chat once the page names a different one. */
  private guardOtherChat(): void {
    if (!this.namesOtherChat() || !this.abort) return;
    this.suppressed = null;
    this.abort.abort(new DOMException(NAVIGATED, 'AbortError'));
    this.abort = null;
  }

  /**
   * Same chat id, new href. Overlap with this visit (or the page naming this chat) carries on.
   * A non-empty sample that shares nothing is another transcript under the same id: refuse until
   * the ids overlap again or the route changes. An empty read decides nothing.
   */
  private confirmSameChat(): void {
    const visible = this.pageIds();
    if (this.namesThisChat()) {
      this.foreign = false;
      if (visible.length) {
        this.hrefWatch = false;
        this.watchUntil = 0;
        this.sampleIds(visible);
      } else if (performance.now() >= this.watchUntil) this.hrefWatch = false;
      return;
    }
    const known = this.visitIds;
    if (!known?.size || !visible.length) {
      if (performance.now() >= this.watchUntil) this.hrefWatch = false;
      return;
    }
    if (visible.some((id) => known.has(id))) {
      this.foreign = false;
      this.hrefWatch = false;
      this.watchUntil = 0;
      this.sampleIds(visible);
      return;
    }
    if (this.foreign) return;
    this.foreign = true;
    this.hrefWatch = false;
    this.watchUntil = 0;
    this.suppressed = null;
    this.abort?.abort(new DOMException(NAVIGATED, 'AbortError'));
    this.abort = null;
  }

  /** Notes which messages the current chat shows (at most every SAMPLE_MS), for after a navigation. */
  private sampleIds(ids?: string[]): void {
    const chatId = this.chatId;
    if (!chatId || this.foreign || this.namesOtherChat()) return;
    const now = performance.now();
    if (!ids && this.sample?.chatId === chatId && now - this.sample.at < SAMPLE_MS) return;
    const list = ids ?? this.pageIds();
    if (list.length && !this.showsPrevious(list)) {
      this.sample = { chatId, ids: new Set(list), at: now };
      this.visitIds ??= new Set();
      for (const id of list) this.visitIds.add(id);
    }
  }

  /**
   * True while the page may still show the previous chat: every message id read belongs to it (or
   * nothing could be identified). The guard ends with the first read that holds a message of the new
   * chat — a chat branched from the previous one shares its first ids, so one new id is enough — or
   * when the page itself names this chat. There is no time limit: an old page never turns into the
   * new chat by waiting. A page that names a different chat stays blocked without forgetting the guard.
   */
  private showsPrevious(ids: readonly string[]): boolean {
    if (this.namesOtherChat()) return true;
    if (this.namesThisChat()) {
      this.stale = null;
      return false;
    }
    const st = this.stale;
    if (!st) return false;
    if (ids.some((id) => !st.ids.has(id))) {
      this.stale = null;
      return false;
    }
    return true;
  }

  /** Waits (up to `maxMs`) until the page shows the route's own chat rather than the previous one. */
  private async ownPage(route: Route, maxMs: number): Promise<boolean> {
    const start = performance.now();
    for (;;) {
      if (!this.live(route) || this.refuseCapture()) return false;
      if (!this.showsPrevious(this.pageIds())) return true;
      if (performance.now() - start >= maxMs) return false;
      await wait(250);
    }
  }

  /** The site's "AI is working" signal right now (the observer only looks every so often). */
  private aiBusy(): boolean {
    const phase = this.adapter.aiPhase(document);
    return phase ? phase !== 'idle' : this.adapter.isGenerating(document);
  }

  // ---- staging

  /**
   * Queue a capture; resolves once it (and every capture before it) has been handled. The job is
   * bound to the chat and the AI turn current now: it is dropped if the chat changes, and an
   * "answered" job is dropped if the AI has started on another turn by the time it runs (the next
   * turn's own captures include the finished answer).
   */
  private snapshot(reason: SnapshotReason): Promise<SnapResult> {
    if (this.refuseCapture()) return Promise.resolve({ ok: true });
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
    if (!route || !this.store.state.tracked || this.abort || this.refuseCapture()) return;
    if (!this.onPage(route)) {
      void this.checkRoute();
      return;
    }
    // the observer may not have seen the next turn start yet: ask the page itself, right before reading
    const busy = this.aiBusy();
    if (reason === 'answered' && busy) return;
    // one synchronous read: messages and the page's identity at the same moment
    const read = readPage(this.adapter, document);
    if (!read.messages.length || this.showsPrevious(read.serviceIds ?? [])) return;
    const view = this.view;
    // only a settled capture may drop turns that vanished (a 'sent' one is taken mid-change)
    const atEnd = reason !== 'sent' && !busy && this.observer.settled && isAtEnd(this.adapter, document);
    const messages = await this.withArtifacts(read.messages);
    if (!this.live(route) || this.abort || this.refuseCapture()) return;
    const { fullRead, ...status } = await request('chat/snapshot', { snapshot: makeSnapshot(this.adapter, route.chatId, read, messages, false, atEnd, view), reason });
    if (!this.live(route)) return;
    this.store.applyStatus(status);
    if (fullRead) this.readAgain(route);
  }

  /**
   * The background could not place a capture safely (e.g. the first question was edited, so no
   * message is shared with what was saved): read the whole chat again. At most once a minute per visit;
   * if it fails, the error shows and "Read the whole chat again" in the popup stays available.
   */
  private readAgain(route: Route): void {
    const now = performance.now();
    if (this.abort || !this.live(route) || this.refuseCapture() || (this.autoRescan.gen === route.gen && now - this.autoRescan.at < AUTO_RESCAN_MS)) return;
    this.autoRescan = { gen: route.gen, at: now };
    void this.init({ rescan: true });
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
      if (!this.live(route) || !this.onPage(route) || this.abort || this.refuseCapture()) return false;
      const msgs = this.adapter.messages(document);
      const ids = msgs.flatMap((n) => (n.id ? [n.id] : []));
      // the previous chat still on the page is not this chat's history
      const own = !this.showsPrevious(ids);
      if (own) this.sampleIds(ids);
      const last = msgs[msgs.length - 1];
      const now = msgs.length && own ? `${msgs.length}:${last ? (this.adapter.body(last).textContent ?? '').length : 0}` : '';
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
    if (!route || this.abort || rescan !== this.store.state.tracked || !this.onPage(route) || this.refuseCapture()) return;
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
      // right after a navigation the page may still show the previous chat: wait for this one
      if (!(await this.ownPage(route, OWN_PAGE_WAIT_MS))) {
        if (!this.live(route) || this.refuseCapture()) throw new DOMException(NAVIGATED, 'AbortError');
        throw new InitIncompleteError('stale');
      }
      if (this.refuseCapture()) throw new DOMException(NAVIGATED, 'AbortError');
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
      // the previous chat's messages are not this chat's history
      if (this.refuseCapture()) throw new DOMException(NAVIGATED, 'AbortError');
      if (this.showsPrevious(this.pageIds())) throw new InitIncompleteError('stale');
      const read: PageRead = { messages, url: canonicalPageUrl(this.adapter, location.href), title: this.adapter.title(document), capturedAt: result.readAt };
      const snapshot = makeSnapshot(this.adapter, route.chatId, read, messages, true, false, this.view, result.startConfirmed);
      // Cancel pressed while the background saves the capture is passed on. The background takes
      // them in order: a cancel that arrives first refuses the save; one that arrives after it
      // finds the chat saved. Either way the status of the later one is what stands.
      const id = initId;
      let cancelling: Promise<ChatStatus | null> | null = null;
      const forward = () => {
        if (byUser(abort.signal)) cancelling = request('chat/init/cancel', { key: route.key, initId: id }).catch(() => null);
      };
      abort.signal.addEventListener('abort', forward, { once: true });
      let status: ChatStatus | null = null;
      let saved = false;
      try {
        status = await request('chat/init/done', { snapshot, initId: id });
        saved = true;
      } catch (e) {
        if (!cancelling) throw e; // a failure, not the cancel winning
      } finally {
        abort.signal.removeEventListener('abort', forward);
      }
      if (cancelling) status = (await cancelling) ?? status;
      if (this.live(route)) {
        this.store.setCapture(null);
        if (status) this.store.applyStatus(status);
        if (rescan) this.store.captureDone(saved);
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

  /**
   * Copies the tracked chat as Markdown. The text comes from the background's working copy, so no
   * scroll through the history is needed; what the page shows now is staged first, but only for a
   * moment — the clipboard needs the click's user activation, which runs out after a few seconds.
   */
  private async copyMarkdown(): Promise<boolean> {
    const route = this.route();
    if (!route || !this.store.state.tracked || this.abort) return false;
    try {
      await Promise.race([this.refresh(), new Promise((r) => setTimeout(r, COPY_REFRESH_MS))]);
      if (!this.live(route)) return false;
      const { markdown } = await request('chat/markdown', { key: route.key });
      if (!this.live(route)) return false;
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch (e) {
      log.warn('copy failed', e);
      return false;
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
    if (e.reason === 'stalled') return t('errInitStalled');
    if (e.reason === 'stale') return t('errInitPrevChat');
    return t('errInitIncomplete');
  }
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'busy') return t('errInitOtherTab');
  if (code === 'stale-init') return t('errInitStale');
  return e instanceof Error && e.message ? e.message : t('errGeneric');
}
