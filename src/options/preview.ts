// Live preview of the on-page widget, mounted on the right edge of the settings page while the user
// chooses a style. It is the real widget code driven by the demo store, so what you see is exactly
// what appears on ChatGPT, Claude and Gemini.

import { createStore } from '../content/ui/demo-store.js';
import { mountCreature } from '../content/ui/variants/creature.js';
import { mountDot } from '../content/ui/variants/dot.js';
import { mountLine } from '../content/ui/variants/line.js';
import type { WidgetStyle } from '../shared/types';
import { t } from '../shared/i18n';

type Instance = { destroy(): void };
type DemoStore = ReturnType<typeof createStore>;
const MOUNT: Record<WidgetStyle, (host: HTMLElement, store: DemoStore, options?: { label(key: string): string }) => Instance> = {
  creature: mountCreature,
  line: mountLine,
  dot: mountDot,
};

const dark = matchMedia('(prefers-color-scheme: dark)');

function currentTheme(): 'light' | 'dark' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return dark.matches ? 'dark' : 'light';
}

export class WidgetPreview {
  private store: DemoStore = createStore();
  private host: HTMLElement | null = null;
  private inst: Instance | null = null;
  private style: WidgetStyle | null = null;
  private timer = 0;
  private wanted = false;

  constructor() {
    dark.addEventListener('change', () => this.syncTheme());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(this.timer);
      else if (this.inst) this.schedule(4000);
    });
  }

  get visible(): boolean {
    return !!this.inst;
  }

  /** Show (or switch to) a style. */
  show(style: WidgetStyle): void {
    this.wanted = true;
    if (this.inst && this.style === style) {
      this.syncTheme();
      return;
    }
    this.unmount();
    const host = document.createElement('gitchat-ui');
    host.dataset.theme = currentTheme();
    host.setAttribute('aria-label', 'Widget preview');
    document.body.appendChild(host);
    this.host = host;
    this.style = style;
    this.inst = MOUNT[style](host, this.store, { label: (k: string) => t(k) });
    document.body.classList.add('previewing');
    this.schedule(1400);
  }

  hide(): void {
    this.wanted = false;
    this.unmount();
  }

  /** Follow the page: a chosen light/dark, or the OS when the attribute is absent (Auto). */
  syncTheme(): void {
    if (this.host) this.host.dataset.theme = currentTheme();
  }

  /** Mirror the auto commit/push settings so the preview shows the right buttons. */
  syncAuto(autoCommit: boolean, autoPush: boolean): void {
    const st = this.store.state.settings;
    if (autoPush && !st.autoPush) this.store.setAuto('autoPush', true);
    if (!autoPush && st.autoPush) this.store.setAuto('autoPush', false);
    if (autoCommit !== this.store.state.settings.autoCommit) this.store.setAuto('autoCommit', autoCommit);
  }

  private unmount(): void {
    clearTimeout(this.timer);
    this.inst?.destroy();
    this.host?.remove();
    this.inst = null;
    this.host = null;
    this.style = null;
    if (!this.wanted) document.body.classList.remove('previewing');
  }

  /** Every so often, play one chat turn so the preview shows thinking → streaming → staged. */
  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.inst || document.hidden) return;
      if (this.store.state.ai === 'idle' && this.store.state.phase === 'idle') this.store.aiTurn();
      this.schedule(11000);
    }, ms);
  }
}
