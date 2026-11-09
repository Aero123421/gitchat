// Widget style picker and the auto commit / auto push switches (with the push-implies-commit link).

import { t } from '../shared/i18n';
import { applySettingsPatch } from '../shared/settings';
import type { Settings, WidgetStyle } from '../shared/types';
import { h, s } from './kit/dom';
import { errorText } from './kit/errors';
import { createSwitch, type SwitchHandle } from './kit/switch';
import { app, on, patchSettings } from './state';
import type { WidgetPreview } from './preview';

const STYLES: WidgetStyle[] = ['creature', 'line', 'dot'];
const LABEL: Record<WidgetStyle, string> = { creature: 'styleCreature', line: 'styleLine', dot: 'styleDot' };

/** Small static drawings of each widget, in the widgets' own vocabulary. */
function glyph(style: WidgetStyle): SVGSVGElement {
  const svg = s('svg', { class: 'g', viewBox: '0 0 64 44', 'aria-hidden': 'true' });
  if (style === 'creature') {
    svg.append(
      s('circle', { class: 'g-sat', cx: 17, cy: 13, r: 3.6 }),
      s('circle', { class: 'g-body', cx: 34, cy: 23, r: 13 }),
      s('rect', { class: 'g-eye', x: 28.6, y: 17.5, width: 2.2, height: 5.6, rx: 1.1 }),
      s('rect', { class: 'g-eye', x: 35.2, y: 17.5, width: 2.2, height: 5.6, rx: 1.1 }),
      s('circle', { class: 'g-acc', cx: 41.5, cy: 29, r: 1.4 }),
      s('circle', { class: 'g-acc', cx: 43.2, cy: 25.6, r: 1.4 }),
    );
  } else if (style === 'line') {
    svg.append(
      s('rect', { class: 'g-cap', x: 40, y: 3, width: 9, height: 38, rx: 4.5 }),
      s('circle', { class: 'g-dot', cx: 44.5, cy: 10, r: 1.6 }),
      s('circle', { class: 'g-dot', cx: 44.5, cy: 16, r: 1.6 }),
      s('line', { class: 'g-origin', x1: 41.5, x2: 47.5, y1: 19.5, y2: 19.5 }),
      s('circle', { class: 'g-acc', cx: 44.5, cy: 23, r: 1.6 }),
      s('circle', { class: 'g-acc', cx: 44.5, cy: 29, r: 1.6 }),
      s('circle', { class: 'g-ring', cx: 44.5, cy: 35, r: 1.9 }),
    );
  } else {
    const ticks = [-90, -66, -42].map((a) => {
      const r = (a * Math.PI) / 180;
      return s('circle', { class: 'g-acc', cx: 32 + Math.cos(r) * 11, cy: 22 + Math.sin(r) * 11, r: 1.5 });
    });
    svg.append(s('circle', { class: 'g-cap', cx: 32, cy: 22, r: 16 }), s('circle', { class: 'g-trk', cx: 32, cy: 22, r: 11 }), ...ticks);
    const num = s('text', { class: 'g-num', x: 32, y: 25.5 });
    num.textContent = '3';
    svg.append(num);
  }
  return svg;
}

export function createStylePicker(preview: WidgetPreview | null, onError: (msg: string) => void): HTMLElement {
  const group = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': t('widgetStyle') });
  const tiles = STYLES.map((style) =>
    h(
      'button',
      {
        class: 'choice',
        type: 'button',
        role: 'radio',
        'aria-checked': String(app.settings.widget === style),
        tabindex: app.settings.widget === style ? 0 : -1,
        'data-style': style,
        onClick: () => choose(style),
      },
      glyph(style),
      h('span', { class: 'lb' }, t(LABEL[style])),
      style === 'creature' ? h('span', { class: 'tag' }, t('defaultTag')) : null,
    ),
  );
  group.append(...tiles);

  const sync = () => {
    for (const b of tiles) {
      const on = b.dataset.style === app.settings.widget;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };

  async function choose(style: WidgetStyle): Promise<void> {
    preview?.show(style);
    if (app.settings.widget === style) return;
    try {
      await patchSettings({ widget: style });
    } catch (e) {
      onError(errorText(e));
    }
  }

  group.addEventListener('keydown', (e) => {
    const i = STYLES.indexOf(app.settings.widget);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % STYLES.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + STYLES.length - 1) % STYLES.length;
    if (next < 0) return;
    e.preventDefault();
    const style = STYLES[next]!;
    void choose(style);
    tiles[next]?.focus();
  });

  on('settings', sync);
  return group;
}

export interface AutoSwitches {
  commit: SwitchHandle;
  push: SwitchHandle;
}

/**
 * The two auto switches. Turning push on turns commit on; turning commit off turns push off —
 * the dependent switch follows a beat later so the link is visible, like in the on-page panel.
 */
export function createAutoSwitches(preview: WidgetPreview | null, onError: (msg: string) => void): AutoSwitches {
  const handles = {} as AutoSwitches;
  const change = async (key: 'autoCommit' | 'autoPush', value: boolean) => {
    const before: Settings = app.settings;
    const next = applySettingsPatch(before, { [key]: value });
    const mine = key === 'autoCommit' ? handles.commit : handles.push;
    const other = key === 'autoCommit' ? handles.push : handles.commit;
    const otherKey = key === 'autoCommit' ? 'autoPush' : 'autoCommit';
    mine.set(value);
    if (next[otherKey] !== before[otherKey]) other.set(next[otherKey], { delay: 160, flash: true });
    preview?.syncAuto(next.autoCommit, next.autoPush);
    try {
      await patchSettings({ [key]: value });
    } catch (e) {
      onError(errorText(e));
    }
  };
  handles.commit = createSwitch({
    label: t('autoCommit'),
    checked: app.settings.autoCommit,
    onChange: (v) => void change('autoCommit', v),
    describedBy: 'gc-hint-autocommit',
  });
  handles.push = createSwitch({
    label: t('autoPush'),
    checked: app.settings.autoPush,
    onChange: (v) => void change('autoPush', v),
    describedBy: 'gc-hint-autopush',
  });
  on('settings', () => {
    if (handles.commit.get() !== app.settings.autoCommit) handles.commit.set(app.settings.autoCommit);
    if (handles.push.get() !== app.settings.autoPush) handles.push.set(app.settings.autoPush);
  });
  return handles;
}

/** A settings row: title, hint, control on the right. */
export function row(title: string, hint: string | null, control: HTMLElement, hintId?: string, iconEl?: Element | null): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'text' }, h('div', { class: 'title' }, iconEl ?? null, title), hint ? h('div', { class: 'hint', id: hintId }, hint) : null),
    control,
  );
}
