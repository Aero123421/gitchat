// Live updates over EVENTS_PORT. A content script's port belongs to its tab and only receives the
// status of the chat that tab shows; extension pages (popup, options) receive everything.

import type { BackgroundEvent } from '../shared/protocol';
import type { ChatKey, ChatStatus } from '../shared/types';
import type { Emitter } from './engine';

export class Events implements Emitter {
  /** Port → tab id (undefined for extension pages). */
  private readonly ports = new Map<chrome.runtime.Port, number | undefined>();
  private readonly tabChats = new Map<number, ChatKey>();

  constructor(private readonly isExtensionPage: (sender: chrome.runtime.MessageSender | undefined) => boolean) {}

  attach(port: chrome.runtime.Port): void {
    const tabId = this.isExtensionPage(port.sender) ? undefined : port.sender?.tab?.id;
    this.ports.set(port, tabId);
    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      if (tabId !== undefined && ![...this.ports.values()].includes(tabId)) this.tabChats.delete(tabId);
    });
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
