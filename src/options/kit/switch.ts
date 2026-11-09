import { h, icon, type IconName } from './dom';

export interface SwitchHandle {
  el: HTMLButtonElement;
  get(): boolean;
  /** Update the visual state. `delay` + `flash` are used when another switch caused the change. */
  set(on: boolean, opts?: { delay?: number; flash?: boolean }): void;
  setDisabled(disabled: boolean): void;
}

export interface SwitchOptions {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  iconName?: IconName;
  describedBy?: string;
}

export function createSwitch(o: SwitchOptions): SwitchHandle {
  let on = o.checked;
  let disabled = false;
  let timer = 0;
  const el = h(
    'button',
    {
      class: 'sw',
      type: 'button',
      role: 'switch',
      'aria-checked': String(on),
      'aria-label': o.label,
      title: o.label,
      'aria-describedby': o.describedBy,
      onClick: () => {
        if (!disabled) o.onChange(!on);
      },
    },
    o.iconName ? icon(o.iconName) : null,
    h('span', { class: 'tr' }, h('span', { class: 'kn' })),
  );
  const apply = (v: boolean, flash: boolean) => {
    on = v;
    el.setAttribute('aria-checked', String(v));
    if (flash) {
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 520);
    }
  };
  return {
    el,
    get: () => on,
    set(v, opts = {}) {
      clearTimeout(timer);
      if (opts.delay) timer = window.setTimeout(() => apply(v, !!opts.flash), opts.delay);
      else apply(v, !!opts.flash);
    },
    setDisabled(d) {
      disabled = d;
      el.setAttribute('aria-disabled', String(d));
    },
  };
}
