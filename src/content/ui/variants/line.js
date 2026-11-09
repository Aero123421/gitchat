// Variant B: Line.
// A thin glass capsule on the screen edge that always shows the commit graph.
//   hollow ring = uncommitted, blue dots = unpushed, gray dots = on GitHub, hairline = origin
// Hover widens it and magnifies the dots under the cursor (dock-style). Click the ring to commit,
// the hairline to push, anywhere else to open the panel.

import { Spring, onFrame, clamp, smooth, lerp, FULL, moving, wake } from '../core/spring.js';
import { pointer } from '../core/pointer.js';
import { glassCSS, setLight } from '../core/glass.js';
import { createActions, actionsCSS, BTN, BTN_GAP } from '../core/actions.js';
import { createPanel, panelCSS } from '../core/panel.js';
import { icon, nestedIcon } from '../core/icons.js';
import { fmtAgo } from '../core/format.js';
import { setHTML } from '../core/html.js';

const BW = 150;
const BH = 420;
const MARGIN = 7;
const MAXR = 9;
const W_C = 8;
const W_E = 24;
const G_C = 11;
const G_E = 20;
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

const css = `
.box { position: fixed; right: 0; top: 0; width: ${BW}px; height: ${BH}px; pointer-events: none; }
.cap { position: absolute; right: ${MARGIN}px; top: 0; width: ${W_C}px; height: 40px; cursor: pointer; pointer-events: auto; touch-action: none; }
.box.drag .cap { cursor: grabbing; }
.cap:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 3px; }
.cap > .lg-b { -webkit-backdrop-filter: blur(8px) saturate(1.4); backdrop-filter: blur(8px) saturate(1.4); }
.untracked .cap > .lg-h { box-shadow: inset 0 0 0 .5px var(--ink-3), 0 1px 2px var(--shadow); }
.marks { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.wk { fill: none; stroke: var(--ink); stroke-width: 1.1; }
.bd.empty .wk { stroke: var(--ink-3); }
.dt { fill: var(--dot); transition: fill .2s; }
.bd.ahead .dt { fill: var(--accent); }
.origin { stroke: var(--ink-3); stroke-width: 1; stroke-linecap: round; }
.sending .origin { stroke: var(--accent); }
.err .origin { stroke: var(--err); }
.prog { stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; }
.initg { color: var(--ink-2); }
.tip { position: absolute; top: 0; right: 0; height: 22px; padding: 0 8px; display: flex; align-items: center; gap: 6px;
  --r: 7px; border-radius: 7px; color: var(--ink); white-space: nowrap; pointer-events: none;
  opacity: 0; transform: translateX(4px); transition: opacity .15s, transform .25s var(--spring); }
.tip.on { opacity: 1; transform: none; }
.tip > .lg-b { background: var(--tint-strong); }
.tip .t { position: relative; display: flex; align-items: center; gap: 6px; font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.tip svg.i { width: 12px; height: 12px; stroke-width: 1.8; }
.tip .mu { color: var(--ink-3); }
.tip .a { color: var(--accent); display: flex; }
`;

export function mountLine(host, store, options = {}) {
  const root = host.attachShadow({ mode: 'open' });
  setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css}</style>
  <div class="box">
    <div class="cap lg" role="button" tabindex="0"><div class="lg-b"></div><div class="lg-h"></div></div>
    <svg class="marks" viewBox="0 0 ${BW} ${BH}">
      <line class="prog"/>
      <line class="origin"/>
      <g class="beads"></g>
      <g class="initg">${nestedIcon('init', 12, -6, -6, 1.8)}</g>
    </svg>
    <div class="tip lg"><div class="lg-b"></div><div class="lg-h"></div><span class="t"></span></div>
  </div>`);

  const $ = (s) => root.querySelector(s);
  const box = $('.box');
  const cap = $('.cap');
  const beadsG = $('.beads');
  const origin = $('.origin');
  const prog = $('.prog');
  const initg = $('.initg');
  const tip = $('.tip');
  const tipT = $('.tip .t');
  const actions = createActions(root, box, store, options.label);
  let pinUntil = 0; // keep the buttons out for a moment after a click (touch / untracked)

  let frac = 0.5;
  const cY = new Spring(frac * innerHeight, { stiffness: 420, damping: 40 });
  const exp = new Spring(0, { stiffness: 380, damping: 36 });
  const fy = new Spring(BH / 2, { stiffness: 500, damping: 45 });
  const len = new Spring(40, { stiffness: 320, damping: 34 });
  const originY = new Spring(BH / 2, { stiffness: 260, damping: 32 });
  const originO = new Spring(0, { stiffness: 400, damping: 40 });
  const lx = new Spring(-0.6, { stiffness: 90, damping: 18 });
  const ly = new Spring(-0.8, { stiffness: 90, damping: 18 });
  let pressed = null;
  let dragging = false;
  let panelOpen = false;
  let target = null;
  let geo = null;
  let snapNext = true;
  const beads = new Map();

  const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });

  // Same order as the chat: oldest at the top, newest at the bottom, uncommitted below that.
  const rows = () => {
    const st = store.state;
    if (!st.tracked) return [];
    const cs = st.commits
      .slice(0, MAXR)
      .reverse()
      .map((c) => ({ id: c.id, type: 'commit', c }));
    return [...cs, { id: 'work', type: 'work' }];
  };

  function sync(spawnY = null) {
    const rs = rows();
    const keep = new Set();
    rs.forEach((r, i) => {
      let b = beads.get(r.id);
      if (!b) {
        const g = mk('g', { class: `bd ${r.type}` }, beadsG);
        const shape = r.type === 'work' ? mk('circle', { class: 'wk', r: 2.6 }, g) : mk('circle', { class: 'dt', r: 2 }, g);
        b = {
          id: r.id,
          r,
          g,
          shape,
          idx: i,
          y: new Spring(spawnY ?? (geo ? beadY(i) : 0), { stiffness: 380, damping: 38 }),
          o: new Spring(0, { stiffness: 400, damping: 40 }).set(1),
          dead: false,
          pv: r.c?.pushed,
        };
        if (r.type === 'commit') g.classList.toggle('ahead', !b.pv);
        beads.set(r.id, b);
      }
      b.r = r;
      b.idx = i;
      b.dead = false;
      keep.add(r.id);
    });
    for (const b of beads.values()) {
      if (!keep.has(b.id) && !b.dead) {
        b.dead = true;
        b.o.set(0);
      }
    }
    const st = store.state;
    originO.set(st.tracked && st.commits.some((c) => c.pushed) ? 1 : 0);
    const w = beads.get('work');
    if (w) w.g.classList.toggle('empty', !st.staged.length);
    box.classList.toggle('untracked', !st.tracked);
    box.classList.toggle('sending', st.phase === 'pushing');
    box.classList.toggle('err', st.phase === 'error');
  }

  const beadY = (i) => geo.y0 + geo.pad + i * geo.gap;

  const unsub = store.subscribe((type, d) => {
    if (type === 'committed') {
      // the new commit is left behind where the ring was; the ring moves down one step
      const w = beads.get('work');
      sync(w ? w.y.value : null);
    } else if (type === 'reset' || type === 'captured') {
      snapNext = true;
      sync();
    } else sync();
  });

  // ---- input
  cap.addEventListener('pointerdown', (e) => {
    pressed = { y: e.clientY, dy: e.clientY - cY.value };
    cap.setPointerCapture(e.pointerId);
  });
  cap.addEventListener('pointermove', (e) => {
    if (!pressed || panelOpen) return;
    if (!dragging && Math.abs(e.clientY - pressed.y) > 5) {
      dragging = true;
      box.classList.add('drag');
    }
    if (dragging) frac = clamp(e.clientY - pressed.dy, 60, innerHeight - 60) / innerHeight;
  });
  const release = () => {
    if (!pressed) return;
    pressed = null;
    if (dragging) {
      dragging = false;
      box.classList.remove('drag');
      return;
    }
    if (panelOpen) return closePanel();
    if (!store.state.tracked || store.state.phase === 'capturing') {
      // nothing to show in a panel yet: reveal the start (or cancel) button instead
      pinUntil = performance.now() + 3000;
      return;
    }
    if (target?.kind === 'work' && store.state.staged.length) store.commit();
    else if (target?.kind === 'origin' && store.ahead) store.push();
    else openPanel();
  };
  cap.addEventListener('pointerup', release);
  cap.addEventListener('pointercancel', release);

  // keyboard: the capsule is the widget's button
  cap.setAttribute('aria-label', options.label?.('widgetName') ?? 'gitchat');
  cap.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    wake();
    if (panelOpen) closePanel();
    else if (!store.state.tracked || store.state.phase === 'capturing') actions.focusFirst();
    else openPanel(true);
  });

  const capRect = () => cap.getBoundingClientRect();
  function openPanel(focus = false) {
    panelOpen = true;
    panel.open(capRect(), { right: MARGIN + W_C + 10, centerY: cY.value }, { focus });
  }
  function closePanel() {
    if (!panel.isOpen) return;
    const r = capRect();
    const hadFocus = panel.el.contains(root.activeElement);
    panel.close({ left: r.left, top: r.top, width: W_C, height: r.height }).then(() => {
      panelOpen = false;
      if (hadFocus) cap.focus();
    });
  }

  function showTip(t, x) {
    if (!t) return tip.classList.remove('on');
    const st = store.state;
    let html = '';
    if (t.kind === 'work') html = st.staged.length ? `+${st.staged.length}` : `<span class="mu">0</span>`;
    else if (t.kind === 'origin') html = `<span class="a">${icon.push}</span>${store.ahead}`;
    else if (t.kind === 'commit') html = `+${t.c.n}<span class="mu">${fmtAgo(t.c.t)}</span>`;
    else if (t.kind === 'init')
      html =
        st.phase !== 'capturing'
          ? `<span class="a">${icon.init}</span>`
          : st.captureStage === 'reading'
            ? `${Math.round(((st.progress - 0.25) / 0.75) * 100)}%`
            : `<span class="a">${icon.up}</span>${st.captureCount ?? 0}`;
    if (tipT.innerHTML !== html) setHTML(tipT, html);
    tip.style.right = `${(BW - x + 8).toFixed(1)}px`;
    tip.style.top = `${(t.y - 11).toFixed(1)}px`;
    tip.classList.add('on');
  }

  // ---- frame
  const stop = onFrame((dt) => {
    const st = store.state;
    cY.set(clamp(frac * innerHeight, 60, Math.max(60, innerHeight - 60)));
    if (snapNext) cY.snap();
    cY.step(dt);
    const top = cY.value - BH / 2;
    box.style.top = `${top.toFixed(1)}px`;
    const px = pointer.x - (innerWidth - BW);
    const py = pointer.y - top;

    exp.step(dt);
    const e = clamp(exp.value, 0, 1);
    const w = lerp(W_C, W_E, e);
    const gap = lerp(G_C, G_E, e);
    const capturing = st.phase === 'capturing';
    const rs = rows();
    const n = capturing ? 6 : Math.max(1, rs.length);
    const pad = Math.max(w / 2, 7);
    len.set(st.tracked || capturing ? 2 * pad + (n - 1) * gap : 2 * pad + gap);
    if (snapNext) len.snap();
    len.step(dt);
    const L = len.value;
    const y0 = BH / 2 - L / 2;
    const cx = BW - MARGIN - w / 2;
    geo = { y0, gap, pad, cx, w };

    cap.style.width = `${w.toFixed(2)}px`;
    cap.style.height = `${L.toFixed(2)}px`;
    cap.style.top = `${y0.toFixed(2)}px`;
    cap.style.borderRadius = `${(w / 2).toFixed(2)}px`;

    const onCap = px > cx - w / 2 - 14 && px < BW && py > y0 - 10 && py < y0 + L + 10;
    // once open, the buttons below the line count as part of it
    const onBtns = e > 0.2 && actions.covers(px, py);
    const inside = (pointer.active && !panelOpen && (onCap || onBtns)) || performance.now() < pinUntil || (actions.focused && !panelOpen);
    exp.set(inside || dragging ? 1 : 0);
    fy.set(clamp(py, y0, y0 + L));
    fy.step(dt);
    const lens = (y) => (inside ? Math.exp(-((y - fy.value) ** 2) / (2 * 20 * 20)) : 0);

    const ccx = innerWidth - BW + cx;
    const ccy = top + y0 + L / 2;
    const ddx = pointer.x - ccx;
    const ddy = pointer.y - ccy;
    const dd = Math.hypot(ddx, ddy);
    const near = pointer.active && dd < 360;
    lx.set(near ? ddx / (dd || 1) : -0.6);
    ly.set(near ? ddy / (dd || 1) : -0.8);
    lx.step(dt);
    ly.step(dt);
    setLight(cap, lx.value, ly.value);

    // origin hairline: everything above it is on GitHub. Pushing moves it down.
    const firstAhead = rs.findIndex((r) => r.type === 'commit' && !r.c.pushed);
    const oT = beadY((firstAhead === -1 ? rs.length - 1 : firstAhead) - 0.5);
    originY.set(oT);
    if (snapNext) originY.snap();
    originY.step(dt);
    originO.step(dt);
    const oY = originY.value;
    const inset = Math.max(1.5, w * 0.22);
    origin.setAttribute('x1', (cx - w / 2 + inset).toFixed(2));
    origin.setAttribute('x2', (cx + w / 2 - inset).toFixed(2));
    origin.setAttribute('y1', oY.toFixed(2));
    origin.setAttribute('y2', oY.toFixed(2));
    origin.setAttribute('opacity', clamp(originO.value, 0, 1).toFixed(3));

    let nearest = null;
    let nd = 1e9;
    for (const [id, b] of beads) {
      b.y.set(beadY(b.idx));
      if (snapNext) b.y.snap();
      b.y.step(dt);
      b.o.step(dt);
      if (b.dead && b.o.value < 0.02) {
        b.g.remove();
        beads.delete(id);
        continue;
      }
      const y = b.y.value;
      if (b.r.type === 'commit' && !b.dead) {
        const pv = b.r.c.pushed && oY > y;
        if (pv !== b.pv) {
          b.pv = pv;
          b.g.classList.toggle('ahead', !pv);
        }
      }
      const s = 1 + e * 0.3 + lens(y) * 0.9;
      b.g.setAttribute('transform', `translate(${cx.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(3)})`);
      b.g.setAttribute('opacity', clamp(b.o.value, 0, 1).toFixed(3));
      if (!b.dead && Math.abs(py - y) < nd) {
        nd = Math.abs(py - y);
        nearest = b;
      }
    }

    // buttons slide out under the line, one after the other
    const buttonsMoving = actions.frame(dt, { reveal: Math.max(e, st.phase === 'capturing' ? 1 : 0), x: cx, y: y0 + L + BTN_GAP + 2, dir: 'column' });

    // capture progress: a hairline filling top to bottom
    if (capturing) {
      prog.setAttribute('x1', cx.toFixed(2));
      prog.setAttribute('x2', cx.toFixed(2));
      prog.setAttribute('y1', (y0 + pad).toFixed(2));
      prog.setAttribute('y2', (y0 + pad + (L - 2 * pad) * st.progress).toFixed(2));
      prog.style.display = '';
    } else prog.style.display = 'none';
    initg.style.display = !st.tracked && !capturing ? '' : 'none';
    initg.setAttribute('transform', `translate(${cx.toFixed(2)} ${(y0 + L / 2).toFixed(2)}) scale(${(0.55 + e * 0.45).toFixed(3)})`);
    initg.setAttribute('opacity', (0.4 + e * 0.6).toFixed(3));

    target = null;
    if (st.phase === 'capturing') target = { kind: 'init', y: y0 + L / 2 };
    else if (inside && !dragging) {
      if (!st.tracked) target = { kind: 'init', y: y0 + L / 2 };
      else if (originO.value > 0.5 && Math.abs(py - oY) < 5 && store.ahead) target = { kind: 'origin', y: oY };
      else if (nearest && nd < gap / 2) target = nearest.r.type === 'work' ? { kind: 'work', y: nearest.y.value } : { kind: 'commit', c: nearest.r.c, y: nearest.y.value };
    }
    showTip(target, cx - w / 2);
    snapNext = false;
    // the line has no ambient motion: draw only while something moves
    let beadsMoving = false;
    for (const b of beads.values()) if (moving([b.y, b.o])) beadsMoving = true;
    const busy = dragging || buttonsMoving || beadsMoving || performance.now() < pinUntil || moving([cY, exp, fy, len, originY, originO, lx, ly]);
    return busy ? FULL : 0;
  });

  sync();

  return {
    destroy() {
      stop();
      unsub();
      actions.destroy();
      panel.destroy();
    },
  };
}
