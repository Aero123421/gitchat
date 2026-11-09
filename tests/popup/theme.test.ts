// @vitest-environment happy-dom
// The popup applies its theme once, then must follow chrome.storage while it stays open.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

describe('popup theme', () => {
  const listeners = new Set<StorageListener>();

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-theme');
    listeners.clear();
    delete (globalThis as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  function emit(theme: Settings['theme']): void {
    for (const fn of listeners) fn({ settings: { newValue: { ...DEFAULT_SETTINGS, theme } } }, 'sync');
  }

  it('follows a synced theme while open and stops on unload', async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'ext-test',
        sendMessage: (env: { type: string }) => {
          if (env.type === 'settings/get') return Promise.resolve({ ok: true, data: { ...DEFAULT_SETTINGS, theme: 'dark' } });
          if (env.type === 'auth/get') return Promise.resolve({ ok: true, data: null });
          return Promise.resolve({ ok: true, data: null });
        },
        openOptionsPage() {},
      },
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
      storage: {
        onChanged: {
          addListener(fn: StorageListener) {
            listeners.add(fn);
          },
          removeListener(fn: StorageListener) {
            listeners.delete(fn);
          },
        },
      },
    };
    document.body.innerHTML = '<div id="app"></div>';

    await import('../../src/popup/popup');
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    expect(listeners.size).toBe(1);

    emit('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    emit('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    window.dispatchEvent(new Event('unload'));
    expect(listeners.size).toBe(0);
    emit('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
