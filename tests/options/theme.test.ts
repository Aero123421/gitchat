// @vitest-environment happy-dom
// The settings page and the popup both paint with applyPageTheme.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPageTheme } from '../../src/options/kit/theme';
import { applySettingsPatch, DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';

// The preview host is what the page theme drives. The drawings themselves are covered elsewhere.
vi.mock('../../src/content/ui/variants/creature.js', () => ({ mountCreature: () => ({ destroy() {} }) }));
vi.mock('../../src/content/ui/variants/line.js', () => ({ mountLine: () => ({ destroy() {} }) }));
vi.mock('../../src/content/ui/variants/dot.js', () => ({ mountDot: () => ({ destroy() {} }) }));

describe('applyPageTheme', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets data-theme for light and dark, and removes it for auto', () => {
    applyPageTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyPageTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    applyPageTheme('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('theme control', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete (globalThis as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  async function setup() {
    vi.resetModules();
    const calls: Partial<Settings>[] = [];
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: (env: { type: string; payload: { patch?: Partial<Settings> } }) => {
          if (env.type === 'settings/set') calls.push(env.payload.patch ?? {});
          return Promise.resolve({ ok: true, data: { ...DEFAULT_SETTINGS, ...(env.payload.patch ?? {}) } });
        },
      },
      i18n: { getMessage: (key: string) => key },
    };
    const state = await import('../../src/options/state');
    const { createThemePicker } = await import('../../src/options/prefs');
    const el = createThemePicker(() => {});
    document.body.append(el);
    return { state, calls, el, buttons: [...el.querySelectorAll('button')] };
  }

  it('saves the chosen theme through patchSettings and marks the selected button', async () => {
    const { state, calls, el, buttons } = await setup();
    expect(buttons.map((b) => b.textContent)).toEqual(['themeAuto', 'themeLight', 'themeDark']);
    expect(buttons[0]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[0]!.tabIndex).toBe(0);
    expect(buttons[1]!.tabIndex).toBe(-1);

    buttons[2]!.click();
    expect(state.app.settings.theme).toBe('dark');
    expect(calls.at(-1)).toEqual({ theme: 'dark' });
    expect(buttons[2]!.getAttribute('aria-checked')).toBe('true');
    expect(buttons[0]!.getAttribute('aria-checked')).toBe('false');

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(state.app.settings.theme).toBe('auto');
    expect(calls.at(-1)).toEqual({ theme: 'auto' });
    expect(document.activeElement).toBe(buttons[0]);
  });
});

describe('settings page theme', () => {
  type MediaListener = () => void;
  type Gate = { patch: Partial<Settings>; resolve: (s: Settings) => void; reject: (e: Error) => void };
  const media = new Map<string, { matches: boolean; listeners: Set<MediaListener> }>();
  let saved: Settings;
  let gates: Gate[];

  function slot(query: string): { matches: boolean; listeners: Set<MediaListener> } {
    let s = media.get(query);
    if (!s) media.set(query, (s = { matches: false, listeners: new Set() }));
    return s;
  }

  function setDark(matches: boolean): void {
    const s = slot('(prefers-color-scheme: dark)');
    s.matches = matches;
    for (const fn of s.listeners) fn();
  }

  function themeButton(theme: Settings['theme']): HTMLButtonElement {
    const btn = document.querySelector<HTMLButtonElement>(`[aria-label="theme"] [data-theme="${theme}"]`);
    if (!btn) throw new Error(`missing ${theme} button`);
    return btn;
  }

  function host(): HTMLElement {
    const el = document.querySelector<HTMLElement>('gitchat-ui');
    if (!el) throw new Error('preview is not mounted');
    return el;
  }

  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-theme');
    media.clear();
    delete (globalThis as { chrome?: unknown }).chrome;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function openPage(): Promise<void> {
    saved = { ...DEFAULT_SETTINGS, repo: { owner: 'octocat', name: 'ai-chats', branch: 'main' } };
    gates = [];
    media.clear();
    const matchMediaMock = (query: string): MediaQueryList => {
      const s = slot(query);
      const add = (fn: EventListenerOrEventListenerObject) => {
        if (typeof fn === 'function') s.listeners.add(fn as MediaListener);
      };
      const remove = (fn: EventListenerOrEventListenerObject) => {
        if (typeof fn === 'function') s.listeners.delete(fn as MediaListener);
      };
      return {
        get matches() {
          return s.matches;
        },
        media: query,
        onchange: null,
        addListener: add,
        removeListener: remove,
        addEventListener: (_type: string, fn: EventListenerOrEventListenerObject) => add(fn),
        removeEventListener: (_type: string, fn: EventListenerOrEventListenerObject) => remove(fn),
        dispatchEvent: () => true,
      } as MediaQueryList;
    };
    vi.stubGlobal('matchMedia', matchMediaMock);
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        readonly root = null;
        readonly rootMargin = '';
        readonly thresholds = [0];
        constructor(private cb: IntersectionObserverCallback) {}
        observe(target: Element): void {
          const hit = target.id === 'appearance' || target.id === 'behavior';
          this.cb(
            [
              {
                target,
                isIntersecting: hit,
                intersectionRatio: hit ? 1 : 0,
                boundingClientRect: target.getBoundingClientRect(),
                intersectionRect: target.getBoundingClientRect(),
                rootBounds: null,
                time: 0,
              } as IntersectionObserverEntry,
            ],
            this as unknown as IntersectionObserver,
          );
        }
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      },
    );

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: 'ext-test',
        sendMessage: (env: { type: string; payload?: { patch?: Partial<Settings> } }) => {
          if (env.type === 'settings/get') return Promise.resolve({ ok: true, data: saved });
          if (env.type === 'auth/get') return Promise.resolve({ ok: true, data: null });
          if (env.type === 'sync/status') return Promise.resolve({ ok: true, data: { repo: saved.repo, pending: 0 } });
          if (env.type === 'settings/set') {
            return new Promise((res) => {
              gates.push({
                patch: env.payload?.patch ?? {},
                resolve: (s) => res({ ok: true, data: s }),
                reject: (e) => res({ ok: false, error: e.message }),
              });
            });
          }
          return Promise.resolve({ ok: true, data: null });
        },
      },
      i18n: { getMessage: (key: string) => key, getUILanguage: () => 'en' },
      storage: { onChanged: { addListener() {}, removeListener() {} } },
    };

    await import('../../src/options/options');
    await vi.waitFor(() => expect(document.querySelector('gitchat-ui')).toBeTruthy());
  }

  it('paints the page and the preview, returns to Auto, and rolls back a rejected save', async () => {
    await openPage();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(host().dataset.theme).toBe('light');

    themeButton('dark').click();
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    expect(host().dataset.theme).toBe('dark');

    gates[0]!.reject(new Error('quota'));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false));
    expect(host().dataset.theme).toBe('light');
    expect(themeButton('auto').getAttribute('aria-checked')).toBe('true');

    setDark(true);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(host().dataset.theme).toBe('dark');

    themeButton('light').click();
    await vi.waitFor(() => expect(gates.length).toBe(2));
    gates[1]!.resolve(applySettingsPatch(saved, gates[1]!.patch));
    await vi.waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
    expect(host().dataset.theme).toBe('light');

    setDark(false);
    expect(host().dataset.theme).toBe('light');

    themeButton('auto').click();
    await vi.waitFor(() => expect(gates.length).toBe(3));
    setDark(true);
    gates[2]!.resolve(applySettingsPatch(saved, gates[2]!.patch));
    await vi.waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false));
    expect(host().dataset.theme).toBe('dark');
  });
});
