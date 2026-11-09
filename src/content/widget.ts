// Mounts the chosen widget (creature / line / dot) into the page inside its own shadow root.

import type { WidgetStyle } from '../shared/types';
import { t } from '../shared/i18n';
import type { UiStore } from './bridge';
// The UI kit is framework-free JavaScript shared with the playground and the settings previews.
import { mountCreature } from './ui/variants/creature.js';
import { mountLine } from './ui/variants/line.js';
import { mountDot } from './ui/variants/dot.js';

interface Mounted {
  destroy(): void;
  act?(name: string): void;
}

type MountFn = (host: HTMLElement, store: UiStore, options: { label(key: string): string; openSettings(): void }) => Mounted;

const MOUNT: Record<WidgetStyle, MountFn> = {
  creature: mountCreature as unknown as MountFn,
  line: mountLine as unknown as MountFn,
  dot: mountDot as unknown as MountFn,
};

export class Widget {
  private host: HTMLElement | null = null;
  private mounted: Mounted | null = null;
  private style: WidgetStyle | null = null;
  private keepAlive = 0;

  constructor(
    private readonly store: UiStore,
    private readonly openSettings: () => void,
  ) {}

  show(style: WidgetStyle, theme: 'light' | 'dark'): void {
    if (this.host && this.style === style) {
      this.setTheme(theme);
      return;
    }
    this.hide();
    const host = document.createElement('gitchat-ui');
    host.dataset.theme = theme;
    document.documentElement.appendChild(host);
    this.host = host;
    this.style = style;
    this.mounted = MOUNT[style](host, this.store, { label: (k) => t(k), openSettings: this.openSettings });
    // Some apps rebuild parts of the document; put the widget back if it gets removed.
    this.keepAlive = window.setInterval(() => {
      if (this.host && !this.host.isConnected) document.documentElement.appendChild(this.host);
    }, 2000);
  }

  setTheme(theme: 'light' | 'dark'): void {
    if (this.host && this.host.dataset.theme !== theme) this.host.dataset.theme = theme;
  }

  hide(): void {
    clearInterval(this.keepAlive);
    this.mounted?.destroy();
    this.host?.remove();
    this.mounted = null;
    this.host = null;
    this.style = null;
  }

  get visible(): boolean {
    return !!this.host;
  }
}
