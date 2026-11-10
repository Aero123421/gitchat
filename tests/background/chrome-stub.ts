// A small in-memory stand-in for the chrome.* APIs the background uses.
import { vi } from 'vitest';

type Change = Record<string, chrome.storage.StorageChange>;
type ChangeListener = (changes: Change, area: string) => void;

function area(name: string, listeners: Set<ChangeListener>) {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    data,
    async get(keys?: string | string[] | null) {
      const list = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
      return out;
    },
    async set(items: Record<string, unknown>) {
      const changes: Change = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) };
        data.set(k, clone(v));
      }
      listeners.forEach((l) => l(changes, name));
    },
    async remove(keys: string | string[]) {
      const changes: Change = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        changes[k] = { oldValue: clone(data.get(k)) };
        data.delete(k);
      }
      listeners.forEach((l) => l(changes, name));
    },
    async setAccessLevel(_access: { accessLevel: string }) {
      return undefined;
    },
  };
}

export function installChrome() {
  const listeners = new Set<ChangeListener>();
  const stub = {
    storage: {
      local: area('local', listeners),
      sync: area('sync', listeners),
      session: area('session', listeners),
      onChanged: {
        addListener: (l: ChangeListener) => listeners.add(l),
        removeListener: (l: ChangeListener) => listeners.delete(l),
      },
    },
    runtime: {
      id: 'test-ext',
      getURL: (p: string) => `chrome-extension://test-ext/${p}`,
      getPlatformInfo: vi.fn(async () => ({ os: 'mac' })),
      openOptionsPage: vi.fn(async () => undefined),
    },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    i18n: { getMessage: () => '' },
  };
  vi.stubGlobal('chrome', stub);
  return stub;
}

export const EXTENSION_PAGE = { id: 'test-ext', url: 'chrome-extension://test-ext/options.html' } as chrome.runtime.MessageSender;
export const CONTENT_SCRIPT = { id: 'test-ext', url: 'https://claude.ai/chat/abc', origin: 'https://claude.ai', frameId: 0, tab: { id: 7 } } as chrome.runtime.MessageSender;
