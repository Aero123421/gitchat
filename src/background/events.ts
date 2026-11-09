// Live updates over EVENTS_PORT. A content script's port belongs to its tab and only receives the
// status of the chat that tab shows; extension pages (popup, options) receive everything.

import type { BackgroundEvent } from '../shared/protocol';
import type { ChatKey, ChatStatus } from '../shared/types';
import type { Emitter } from './engine';
import { senderService } from './validate';

export class Events implements Emitter {
  /** Port → tab id (undefined for extension pages). */
  private readonly ports = new Map<chrome.runtime.Port, number | undefined>();
  private readonly tabChats = new Map<number, ChatKey>();

  constructor(
    private readonly isExtensionPage: (sender: chrome.runtime.MessageSender | undefined) => boolean,
    /** The last port of a tab closed: its page was closed, reloaded or navigated away. */
    private readonly onTabGone: (tabId: number) => void = () => undefined,
  ) {}

  /** Accepts ports from extension pages and from the top frame of the supported chat sites only. */
  attach(port: chrome.runtime.Port): boolean {
    const page = this.isExtensionPage(port.sender);
    if (!page && !senderService(port.sender)) {
      port.disconnect();
      return false;
    }
    const tabId = page ? undefined : port.sender?.tab?.id;
    this.ports.set(port, tabId);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      if (tabId !== undefined && ![...this.ports.values()].includes(tabId)) {
        this.tabChats.delete(tabId);
        this.onTabGone(tabId);
      }
    });
    return true;
  }

  setTabChat(tabId: number, key: ChatKey): void {
    this.tabChats.set(tabId, key);
  }

  status(status: ChatStatus): void {
    for (const [port, tabId] of this.ports) {
      if (tabId === undefined || this.tabChats.get(tabId) === status.key) this.post(port, { type: 'status', status });
    }
  }

  broadcast(event: BackgroundEvent): void {
    for (const port of this.ports.keys()) this.post(port, event);
  }

  shownKeys(): ChatKey[] {
    return [...new Set(this.tabChats.values())];
  }

  post(port: chrome.runtime.Port, event: BackgroundEvent): void {
    try {
      port.postMessage(event);
    } catch {
      this.ports.delete(port);
    }
  }
}
