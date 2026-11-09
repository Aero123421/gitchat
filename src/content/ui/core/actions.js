// Hover buttons shared by every widget.
//
// Which buttons exist depends on the chat, so each widget gets the same rules:
//   untracked            → [start]           (start saving this chat; init)
//   capturing (init)     → [cancel]
//   tracked              → [commit] [push]   minus whichever is automatic:
//                          auto-commit on → no commit button, auto-push on → no push button
// Push is enabled when there is anything to send, including uncommitted work (it commits first).

import { icon } from './icons.js';
import { applyLens } from './glass.js';
import { Spring, clamp, moving, wake } from './spring.js';
import { setHTML } from './html.js';
import { availableActions } from '../../../shared/actions.js';

export const BTN = 26;
export const BTN_GAP = 6;

export const actionsCSS = `
.ab { all: unset; position: absolute; left: 0; top: 0; width: ${BTN}px; height: ${BTN}px; --r: 50%; border-radius: 50%;
  display: grid; place-items: center; color: var(--ink); cursor: pointer; opacity: 0; pointer-events: none; }
.ab > svg.i { position: relative; width: 13px; height: 13px; stroke-width: 1.7; transition: opacity .2s; }
.ab.dim > svg.i { opacity: .3; }
.ab:hover > .lg-b { background: var(--tint-strong); }
.ab:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 2px; }
.ab .spin { position: absolute; inset: 5px; width: 16px; height: 16px; display: none; overflow: visible; }
.ab .spin circle { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: ab-spin .8s linear infinite; }
.ab.push.sending > svg.i { opacity: 0; }
.ab.push.sending .spin { display: block; }
.ab.push.err { color: var(--err); }
.ab.cancel { color: var(--ink-2); }
@keyframes ab-spin { to { transform: rotate(360deg); } }
`;

const LABELS = { track: 'Start saving this chat', cancel: 'Cancel', commit: 'Commit', push: 'Push' };

/**
 * @param {ShadowRoot} root   shadow root of the widget (for the glass lens filters)
 * @param {HTMLElement} parent element the buttons are positioned in (absolute coordinates)
 * @param {object} store      UI store (see demo-store.js for the interface)
 * @param {(key: string) => string} [label] localized label lookup
 */
export function createActions(root, parent, store, label = (k) => LABELS[k] ?? k) {
  const make = (kind, glyph, extra = '') => {
    const b = document.createElement('button');
    b.className = `ab lg ${kind}`;
    const text = label(kind === 'start' ? 'track' : kind);
    b.setAttribute('aria-label', text);
    b.title = text;
    // reachable by keyboard only while the widget has focus (they are invisible otherwise)
    b.tabIndex = -1;
    setHTML(b, `<div class="lg-b"></div><div class="lg-h"></div>${glyph}${extra}`);
    parent.appendChild(b);
    applyLens(root, b.querySelector('.lg-b'), { w: BTN, h: BTN, r: BTN / 2, bezel: 8, scale: 12, blur: 0.8, sat: 1.3 });
    return b;
  };
  const buttons = {
    start: make('start', icon.init),
    cancel: make('cancel', icon.close),
    commit: make('commit', icon.commit),
    push: make('push', icon.push, '<svg class="spin" viewBox="-10 -10 20 20"><circle r="8" pathLength="1"/></svg>'),
  };
  const show = Object.fromEntries(Object.keys(buttons).map((k) => [k, new Spring(0, { stiffness: 420, damping: 38 })]));
  let order = [];
  let rect = null;
  let focused = false;

  // Keyboard: focusing the widget reveals its buttons and puts the visible ones in the tab order.
  const syncFocus = () => {
    const now = parent.contains(root.activeElement);
    if (now === focused) return;
    focused = now;
    syncTabs();
    wake();
  };
  const syncTabs = () => {
    for (const [kind, b] of Object.entries(buttons)) b.tabIndex = focused && order.includes(kind) ? 0 : -1;
  };
  parent.addEventListener('focusin', syncFocus);
  parent.addEventListener('focusout', () => queueMicrotask(syncFocus));

  buttons.start.addEventListener('click', () => store.init());
  buttons.cancel.addEventListener('click', () => store.cancelInit?.());
  buttons.commit.addEventListener('click', () => store.commit());
  buttons.push.addEventListener('click', () => store.push());

  function visible() {
    const st = store.state;
    return availableActions(st, st.settings);
  }

  function update() {
    const st = store.state;
    order = visible();
    syncTabs();
    const ahead = store.ahead ?? 0;
    buttons.commit.classList.toggle('dim', !st.staged.length);
    buttons.push.classList.toggle('dim', !st.staged.length && !ahead && st.phase !== 'error');
    buttons.push.classList.toggle('sending', st.phase === 'pushing');
    buttons.push.classList.toggle('err', st.phase === 'error');
  }

  /**
   * Lay the buttons out for this frame.
   * @param {number} dt
   * @param {{reveal:number, x:number, y:number, dir:'row'|'column'}} at  anchor: top-center of the group
   * @returns {boolean} true while the buttons are still moving
   */
  function frame(dt, at) {
    const n = order.length;
    const width = n * BTN + Math.max(0, n - 1) * BTN_GAP;
    let i = 0;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [kind, b] of Object.entries(buttons)) {
      const idx = order.indexOf(kind);
      const on = idx >= 0;
      const s = show[kind];
      s.set(on ? 1 : 0);
      s.step(dt);
      // stagger: the second button follows the first a little later
      const k = clamp((at.reveal - (on ? idx : i) * 0.15) / 0.85, 0, 1) * clamp(s.value, 0, 1);
      if (!on && s.value < 0.01) {
        b.style.opacity = '0';
        b.style.pointerEvents = 'none';
        continue;
      }
      const slot = on ? idx : 0;
      let x;
      let y;
      if (at.dir === 'row') {
        x = at.x - width / 2 + slot * (BTN + BTN_GAP);
        y = at.y;
      } else {
        x = at.x - BTN / 2;
        y = at.y + slot * (BTN + BTN_GAP);
      }
      b.style.transform = `translate(${x.toFixed(2)}px, ${(y - (1 - k) * 6).toFixed(2)}px) scale(${(0.6 + 0.4 * k).toFixed(3)})`;
      b.style.opacity = k.toFixed(3);
      b.style.pointerEvents = k > 0.6 ? 'auto' : 'none';
      if (on) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + BTN);
        y1 = Math.max(y1, y + BTN);
      }
      i++;
    }
    rect = n ? { x0, y0, x1, y1 } : null;
    return moving(Object.values(show));
  }

  /** True when (px, py), in the parent's coordinates, is over the visible buttons (with a margin). */
  function covers(px, py, margin = 8) {
    return !!rect && px > rect.x0 - margin && px < rect.x1 + margin && py > rect.y0 - margin && py < rect.y1 + margin;
  }

  function nudge(kind) {
    buttons[kind]?.animate([{ translate: '0 0' }, { translate: '-3px 0' }, { translate: '3px 0' }, { translate: '0 0' }], {
      duration: 240,
      easing: 'ease-out',
    });
  }

  const unsub = store.subscribe((type, d) => {
    update();
    if (type === 'nope') nudge(d.action);
    // every state change may start an animation in the widget that owns these buttons
    wake(1500);
  });
  update();

  return {
    frame,
    covers,
    update,
    /** True while keyboard focus is inside the widget: keep the buttons out. */
    get focused() {
      return focused;
    },
    /** Focus the first visible button (keyboard users after activating an untracked widget). */
    focusFirst() {
      const b = buttons[order[0]];
      if (b) {
        b.tabIndex = 0;
        b.focus();
      }
    },
    get count() {
      return order.length;
    },
    destroy() {
      unsub();
      Object.values(buttons).forEach((b) => b.remove());
    },
  };
}
