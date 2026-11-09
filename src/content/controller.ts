// Glue for one chat tab: follows the site's in-app navigation, keeps the widget in sync with the
// background worker, stages answers as they finish, and runs init for untracked chats.

import { chatKey, type ChatKey, type ChatStatus, type Settings } from '../shared/types';
import { EVENTS_PORT, request, type BackgroundEvent, type ContentCurrent, type SnapshotReason, type ToContent } from '../shared/protocol';
import { log } from '../shared/log';
import type { Adapter } from './adapters/types';
import { UiStore } from './bridge';
import { Widget } from './widget';
import { AiObserver } from './capture/observer';
import { attachArtifacts, captureVisible, makeSnapshot } from './capture/snapshot';
import type { CapturedMessage } from '../shared/types';
import { captureFullHistory, type InitProgress } from './capture/init';

/** Assumed length of an answer stream, used only to pace the "answer forming" animation. */
const STREAM_PACE_MS = 8000;

export class Controller {
  private settings!: Settings;
  private readonly store: UiStore;
  private readonly widget: Widget;
  private readonly observer: AiObserver;
  private port: chrome.runtime.Port | null = null;
  private key: ChatKey | null = null;
  private chatId: string | null = null;
  private lastUrl = '';
  private abort: AbortController | null = null;
  private lastProgressSent = 0;

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
    });
  }

  async start(): Promise<void> {
    this.settings = await request('settings/get', {});
    this.store.applySettings(this.settings);
    this.connect();
    this.listenToPopup();
    this.observer.start();
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
    if (ev.type === 'status') this.store.applyStatus(ev.status);
    else if (ev.type === 'settings') {
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

  private async checkRoute(force = false): Promise<void> {
    const href = location.href;
    if (!force && href === this.lastUrl) return;
    this.lastUrl = href;
    const chatId = this.settings.services[this.adapter.service] ? this.adapter.chatId(new URL(href)) : null;
    if (!force && chatId === this.chatId) return;

    if (chatId !== this.chatId) {
      this.abort?.abort();
      this.observer.reset();
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
    this.widget.show(this.settings.widget, this.adapter.theme(document));
    try {
      const status = await request('chat/open', { service: this.adapter.service, chatId, url: href, title: this.adapter.title(document) });
      if (this.key === key) this.store.switchTo(key, status);
    } catch (e) {
      log.warn('could not open chat', e);
      if (this.key === key) this.store.switchTo(key, null);
    }
  }

  // ---- staging

  private async snapshot(reason: SnapshotReason): Promise<void> {
    const key = this.key;
    if (!key || !this.chatId || !this.store.state.tracked || this.abort) return;
    const messages = await this.withArtifacts(captureVisible(this.adapter, document));
    if (!messages.length) return;
    try {
      const status = await request('chat/snapshot', { snapshot: makeSnapshot(this.adapter, document, this.chatId, messages, false), reason });
      this.store.applyStatus(status);
    } catch (e) {
      log.warn('snapshot failed', e);
    }
  }

  // ---- init (whole history)

  async init(): Promise<void> {
    const key = this.key;
    const chatId = this.chatId;
    if (!key || !chatId || this.abort || this.store.state.tracked) return;
    const abort = new AbortController();
    this.abort = abort;
    const progress = (p: InitProgress) => {
      if (this.key !== key) return;
      this.store.setCapture(p);
      const now = performance.now();
      if (now - this.lastProgressSent > 500) {
        this.lastProgressSent = now;
        void request('chat/init/progress', { key, progress: p.progress }).catch(() => {});
      }
    };
    try {
      progress({ stage: 'loading', count: 0, progress: 0 });
      await request('chat/init/start', { key });
      const messages = await this.withArtifacts(await captureFullHistory(this.adapter, document, { signal: abort.signal, onProgress: progress }));
      if (abort.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const status = await request('chat/init/done', { snapshot: makeSnapshot(this.adapter, document, chatId, messages, true) });
      this.store.setCapture(null);
      this.store.applyStatus(status);
    } catch (e) {
      this.store.setCapture(null);
      if (!(e instanceof DOMException && e.name === 'AbortError')) log.warn('init failed', e);
      try {
        this.store.applyStatus(await request('chat/init/cancel', { key }));
      } catch {
        // background unavailable; the next status event will fix the UI
      }
    } finally {
      if (this.abort === abort) this.abort = null;
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
    const key = this.key;
    if (!key) return;
    try {
      const status = await request(type, { key });
      if (status) this.store.applyStatus(status);
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
