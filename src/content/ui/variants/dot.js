// Variant A: Dot.
// A small glass dial on the right edge.
//   center number = uncommitted messages (a faint dot when clean)
//   blue ticks on the ring = unpushed commits; they sweep back to 12 o'clock when pushed
// Motion is near-critically damped: it follows the cursor a few pixels and never bounces.

import { Spring, onFrame, clamp, smooth, FULL, moving, wake } from '../core/spring.js';
import { pointer } from '../core/pointer.js';
import { glassCSS, applyLens, setLight } from '../core/glass.js';
import { createPanel, panelCSS, rollText } from '../core/panel.js';
import { nestedIcon } from '../core/icons.js';
import { createActions, actionsCSS } from '../core/actions.js';
import { setHTML } from '../core/html.js';

const S = 40;
const R = S / 2;
const EDGE = 18;
const RING = 13.5;
const STEP = 24; // degrees between ticks
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

const css = `
.dock { position: fixed; right: ${EDGE}px; top: 0; width: ${S}px; height: ${S}px; }
.orb { position: absolute; inset: 0; --r: 50%; border-radius: 50%; cursor: pointer; touch-action: none; }
.orb.dragging { cursor: grabbing; }
.orb .in { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.trk { fill: none; stroke: var(--ink-4); stroke-width: 1; }
.orb[data-s="untracked"] .trk { stroke: var(--ink-3); stroke-dasharray: 1.2 2.4; }
.orb[data-s="error"] .trk { stroke: var(--err); }
.arc { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; opacity: 0; transition: opacity .2s; }
.orb[data-s="capturing"] .arc { opacity: 1; }
.orb[data-s="pushing"] .arc { opacity: 1; stroke-dasharray: .16 .84; stroke-dashoffset: 0;
  transform-box: fill-box; transform-origin: center; animation: spin .9s linear infinite; }
.tick { fill: var(--accent); }
.num { font: 600 11.5px/1 var(--mono); fill: var(--ink); text-anchor: middle; dominant-baseline: central;
  font-variant-numeric: tabular-nums; transition: opacity .15s; }
.cdot { fill: var(--ink-3); transition: opacity .2s; }
.orb:not([data-s="clean"]):not([data-s="ahead"]):not([data-s="pushing"]) .cdot { opacity: 0; }
.orb[data-s="untracked"] .num, .orb[data-s="error"] .num { opacity: 0; }
.orb[data-s="capturing"] .num { font-size: 9px; fill: var(--accent); }
.gl { opacity: 0; transition: opacity .2s; }
.gl-init { color: var(--ink-2); }
.gl-up { color: var(--accent); }
.gl-err { color: var(--err); }
.orb[data-s="untracked"] .gl-init, .orb[data-s="error"] .gl-err { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

export function mountDot(host, store, options = {}) {
  // an untracked chat has nothing for the panel to show — except why saving it failed
  const noPanel = () => (!store.state.tracked && store.state.phase !== 'error') || store.state.phase === 'capturing';
  const root = host.attachShadow({ mode: 'open' });
  setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css}</style>
  <div class="dock">
    <div class="orb lg" role="button" tabindex="0">
      <div class="lg-b"></div>
      <svg class="in" viewBox="${-R} ${-R} ${S} ${S}">
        <circle class="trk" r="${RING}"/>
        <g transform="rotate(-90)"><circle class="arc" r="${RING}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></g>
        <g class="ticks"></g>
        <circle class="cdot" r="1.5"/>
        <text class="num" y=".5"></text>
        <g class="gl gl-init">${nestedIcon('init', 14, -7, -7, 1.8)}</g>
        <g class="gl gl-up">${nestedIcon('up', 12, -6, -6, 2)}</g>
        <g class="gl gl-err"><path d="M0-4.2V1.2M0 4.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>
      </svg>
      <div class="lg-h"></div>
    </div>
  </div>`);

  const $ = (s) => root.querySelector(s);
  const dock = $('.dock');
  const actions = createActions(root, dock, store, options.label);
  let pinUntil = 0; // keep the buttons out for a moment after a click (touch / untracked)
  const orb = $('.orb');
  orb.setAttribute('aria-label', options.label?.('widgetName') ?? 'gitchat');
  const arc = $('.arc');
  const num = $('.num');
  const ticksG = $('.ticks');
  applyLens(root, $('.orb > .lg-b'), { w: S, h: S, r: R, bezel: 10, scale: 18, blur: 0.6, sat: 1.3 });

  const ox = new Spring(0, { stiffness: 320, damping: 34 });
  const oy = new Spring(0, { stiffness: 320, damping: 34 });
  const sc = new Spring(0, { stiffness: 520, damping: 44 }).set(1);
  const reveal = new Spring(0, { stiffness: 380, damping: 36 });
  const lx = new Spring(-0.6, { stiffness: 90, damping: 18 });
  const ly = new Spring(-0.8, { stiffness: 90, damping: 18 });

  let frac = 0.56;
  let anchorY = 0;
  const syncAnchor = () => (anchorY = clamp(frac * innerHeight, R + 14, Math.max(R + 14, innerHeight - R - 14)));
  syncAnchor();
  let pressed = false;
  let dragging = false;
  let down = null;
  let grab = { x: 0, y: 0 };
  let panelOpen = false;
  const ticks = [];

  const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });
  const orbRect = () => ({ left: innerWidth - EDGE - S, top: anchorY - R, width: S, height: S });

  function stateName() {
    const st = store.state;
    if (st.phase === 'capturing') return 'capturing';
    if (!st.tracked) return 'untracked';
    if (st.phase === 'error') return 'error';
    if (st.phase === 'pushing') return 'pushing';
    if (st.staged.length) return 'dirty';
    if (store.ahead) return 'ahead';
    return 'clean';
  }

  function syncTicks() {
    const want = store.state.phase === 'pushing' ? ticks.filter((t) => !t.dying).length : Math.min(store.ahead, 9);
    const alive = ticks.filter((t) => !t.dying);
    while (alive.length < want) {
      const t = { el: mk('circle', { class: 'tick', r: 1.8 }, ticksG), a: new Spring(-90, { stiffness: 260, damping: 30 }), o: new Spring(0, { stiffness: 400, damping: 40 }).set(1), dying: false };
      ticks.push(t);
      alive.push(t);
    }
    while (alive.length > want) {
      const t = alive.pop();
      t.dying = true;
      t.o.set(0);
    }
    // newest commit sits at 12 o'clock, older ones step clockwise
    alive.forEach((t, i) => t.a.set(-90 + (alive.length - 1 - i) * STEP));
  }

  function collectTicks() {
    // pushed: every tick sweeps back to 12 o'clock and fades
    ticks.forEach((t, i) => {
      t.dying = true;
      t.a.set(-90);
      setTimeout(() => t.o.set(0), 120 + i * 30);
    });
  }

  function render() {
    const st = store.state;
    orb.dataset.s = stateName();
    arc.setAttribute('stroke-dashoffset', st.phase === 'capturing' ? String(1 - st.progress) : '0');
    // during init the center counts loaded messages, then shows the reading percentage
    const capText =
      st.captureStage === 'reading' ? String(Math.round(((st.progress - 0.25) / 0.75) * 100)) : String(st.captureCount ?? 0);
    rollText(num, st.phase === 'capturing' ? capText : st.tracked && st.staged.length ? String(st.staged.length) : '');
    syncTicks();
  }

  const unsub = store.subscribe((type) => {
    if (type === 'pushed') collectTicks();
    render();
  });

  // ---- input
  orb.addEventListener('pointerdown', (e) => {
    pressed = true;
    down = { x: e.clientX, y: e.clientY };
    grab = { x: e.clientX - (innerWidth - EDGE - R + ox.value), y: e.clientY - (anchorY + oy.value) };
    orb.setPointerCapture(e.pointerId);
  });
  orb.addEventListener('pointermove', (e) => {
    if (!pressed || dragging || panelOpen) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      dragging = true;
      orb.classList.add('dragging');
      ox.config(900, 60);
      oy.config(900, 60);
    }
  });
  const release = () => {
    if (!pressed) return;
    pressed = false;
    if (dragging) {
      dragging = false;
      orb.classList.remove('dragging');
      ox.config(320, 34);
      oy.config(320, 34);
      const visual = anchorY + oy.value;
      const next = clamp(visual, R + 14, innerHeight - R - 14);
      oy.value = visual - next;
      oy.target = 0;
      frac = next / innerHeight;
      syncAnchor();
    } else if (panelOpen) closePanel();
    else if (noPanel()) pinUntil = performance.now() + 3000;
    else openPanel();
  };
  orb.addEventListener('pointerup', release);
  orb.addEventListener('pointercancel', release);
  orb.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    wake();
    if (panelOpen) closePanel();
    else if (noPanel()) actions.focusFirst();
    else openPanel(true);
  });

  function openPanel(focus = false) {
    panelOpen = true;
    sc.set(0);
    panel.open(orbRect(), { right: EDGE - 2, centerY: anchorY }, { focus });
  }
  function closePanel() {
    if (!panel.isOpen) return;
    const hadFocus = panel.el.contains(root.activeElement);
    panel.close(orbRect()).then(() => {
      panelOpen = false;
      sc.set(1);
      if (hadFocus) orb.focus();
    });
  }

  // ---- frame
  const stop = onFrame((dt) => {
    syncAnchor();
    const cx = innerWidth - EDGE - R;
    const cy = anchorY;
    dock.style.top = `${(cy - R).toFixed(1)}px`;
    const dx = pointer.x - (cx + ox.value);
    const dy = pointer.y - (cy + oy.value);
    const d = Math.hypot(dx, dy);
    const hovered = pointer.active && d < R + 2 && !panelOpen;
    // buttons stack under the dial; while they are out, hovering them keeps them out
    const lx0 = pointer.x - (innerWidth - EDGE - S);
    const ly0 = pointer.y - (cy - R);
    const onBtns = reveal.value > 0.2 && actions.covers(lx0, ly0);
    reveal.set((hovered || onBtns || performance.now() < pinUntil || store.state.phase === 'capturing' || actions.focused) && !panelOpen && !dragging ? 1 : 0);
    reveal.step(dt);
    const buttonsMoving = actions.frame(dt, { reveal: reveal.value, x: R, y: S + 8, dir: 'column' });

    if (dragging) {
      ox.set(pointer.x - grab.x - cx);
      oy.set(pointer.y - grab.y - cy);
    } else if (!panelOpen && pointer.active) {
      // a slight magnetic pull, capped at a few pixels
      const f = smooth(110, 20, d);
      ox.set(clamp(dx * 0.06 * f, -3, 3));
      oy.set(clamp(dy * 0.06 * f, -3, 3));
    } else {
      ox.set(0);
      oy.set(0);
    }
    ox.step(dt);
    oy.step(dt);
    sc.set(panelOpen ? 0 : pressed && !dragging ? 0.94 : hovered ? 1.06 : 1);
    sc.step(dt);
    orb.style.transform = `translate(${ox.value.toFixed(2)}px, ${oy.value.toFixed(2)}px) scale(${Math.max(0, sc.value).toFixed(3)})`;

    const near = pointer.active && d < 360;
    lx.set(near ? dx / (d || 1) : -0.6);
    ly.set(near ? dy / (d || 1) : -0.8);
    lx.step(dt);
    ly.step(dt);
    setLight(orb, lx.value, ly.value);

    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i];
      t.a.step(dt);
      t.o.step(dt);
      if (t.dying && t.o.value < 0.02) {
        t.el.remove();
        ticks.splice(i, 1);
        continue;
      }
      const a = (t.a.value * Math.PI) / 180;
      t.el.setAttribute('cx', (Math.cos(a) * RING).toFixed(2));
      t.el.setAttribute('cy', (Math.sin(a) * RING).toFixed(2));
      t.el.setAttribute('opacity', clamp(t.o.value, 0, 1).toFixed(3));
    }
    // a dial has no ambient motion: draw only while something moves
    const busy = dragging || buttonsMoving || performance.now() < pinUntil || moving([ox, oy, sc, reveal, lx, ly]) || ticks.some((x) => moving([x.a, x.o]));
    return busy ? FULL : 0;
  });

  render();

  return {
    destroy() {
      stop();
      unsub();
      actions.destroy();
      panel.destroy();
    },
  };
}
