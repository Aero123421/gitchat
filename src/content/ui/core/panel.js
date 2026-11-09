// Shared panel, stripped down: a hairline commit graph, three icon buttons, two auto switches.
// No header, no badges, no particles. Motion is near-critically damped (no bounce).

import { Spring, onFrame, springEasing, clamp } from './spring.js';
import { icon } from './icons.js';
import { fmtAgo } from './format.js';
import { applyLens, setLight } from './glass.js';
import { pointer } from './pointer.js';
import { setHTML } from './html.js';

const OPEN = springEasing({ stiffness: 380, damping: 38 });
const CLOSE = springEasing({ stiffness: 600, damping: 50 });
const NS = 'http://www.w3.org/2000/svg';

function mk(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

// Swap text with a short vertical slide, like a mechanical counter.
export function rollText(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!el.isConnected) return;
  // fast-changing counters (init progress) just update; only occasional changes roll
  const now = performance.now();
  const last = el._rollAt ?? 0;
  el._rollAt = now;
  if (now - last < 400) return;
  el.animate(
    [
      { transform: 'translateY(5px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ],
    { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' },
  );
}

export const panelCSS = `
.panel {
  position: fixed; top: 0; right: 0; width: 236px; --r: 16px; border-radius: 16px;
  display: none; transform-origin: 50% 50%; z-index: 5; color: var(--ink);
  font-size: 12px; line-height: 1; -webkit-font-smoothing: antialiased;
}
.panel.open { display: block; }
.panel > .lg-b { background: var(--tint-strong); }
.panel .content { position: relative; padding: 8px 8px 6px; }
.panel .graph { display: block; overflow: visible; }
.panel.untracked .graph, .panel.untracked .ib.commit, .panel.untracked .ib.push, .panel.untracked .ib.link { display: none; }
/* automatic actions need no button */
.panel.auto-commit .ib.commit, .panel.auto-push:not(.error) .ib.push { display: none; }

.panel .bar { display: flex; align-items: center; gap: 2px; margin-top: 4px; padding-top: 6px; border-top: .5px solid var(--line); }
.panel .ib { all: unset; position: relative; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
  color: var(--ink); cursor: pointer; transition: background .15s, opacity .2s, color .2s; }
.panel .ib:hover { background: var(--hover); }
.panel .ib.dim { opacity: .3; }
.panel .ib svg.i { width: 16px; height: 16px; stroke-width: 1.6; }
.panel .ib.done { color: var(--accent); }
.panel .ib .spin { position: absolute; inset: 6px; width: 18px; height: 18px; display: none; overflow: visible; }
.panel .ib .spin circle { fill: none; stroke: var(--accent); stroke-width: 1.5; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: spin .8s linear infinite; }
.pushing .ib.push svg.i { opacity: 0; }
.pushing .ib.push .spin { display: block; }
.error .ib.push { color: var(--err); opacity: 1; }
.panel .sp { flex: 1; }
.panel .msg { display: none; margin: 4px 2px 0; font-size: 11px; line-height: 1.4; color: var(--err); }
.panel.error .msg { display: block; }
.panel.stalled:not(.error) .msg { display: block; color: var(--ink-3); }
.sw { all: unset; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px; border-radius: 8px; cursor: pointer; color: var(--ink-3); transition: color .2s; }
.sw:hover { background: var(--hover); }
.sw svg.i { width: 12px; height: 12px; stroke-width: 1.7; }
.sw .tr { position: relative; width: 22px; height: 13px; border-radius: 7px; background: var(--track); transition: background .2s; }
.sw .kn { position: absolute; top: 2px; left: 2px; width: 9px; height: 9px; border-radius: 5px; background: var(--thumb);
  box-shadow: 0 .5px 1.5px rgba(0,0,0,.3); transition: transform .32s var(--spring); }
.sw[aria-checked="true"] { color: var(--ink); }
.sw[aria-checked="true"] .tr { background: var(--accent); }
.sw[aria-checked="true"] .kn { transform: translateX(9px); }
.sw + .sw { margin-left: -2px; }

.graph .ln { fill: none; stroke-width: 1; }
.graph .ln.pushed { stroke: var(--ink-4); }
.graph .ln.ahead { stroke: var(--accent); }
.graph .ln.work { stroke: var(--ink-3); stroke-dasharray: 1.5 2.5; }
.graph .ln.tail { stroke: var(--ink-4); stroke-dasharray: 1.5 2.5; }
.graph .hl { fill: var(--hover); opacity: 0; transition: opacity .15s; }
.graph .row:hover .hl { opacity: 1; }
.graph .wk { fill: none; stroke: var(--ink); stroke-width: 1.2; }
.graph .row.empty .wk { stroke: var(--ink-3); }
.graph .ping { fill: none; stroke: var(--ink); stroke-width: 1; opacity: 0; transform-box: fill-box; transform-origin: center; }
.graph .dot { fill: var(--dot); transition: fill .2s; }
.graph .row.ahead .dot { fill: var(--accent); }
.graph text { font: 500 11px/1 var(--mono); font-variant-numeric: tabular-nums; }
.graph .lab { fill: var(--ink); }
.graph .row.pv .lab { fill: var(--ink-2); }
.graph .ago { fill: var(--ink-3); text-anchor: end; }
.graph .origin line { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 1 2.5; }
.graph .origin .cl { color: var(--ink-3); }
.graph.sending .origin line { stroke: var(--accent); }
.graph.sending .origin .cl { color: var(--accent); }
.graph.err .origin line { stroke: var(--err); }
.graph.err .origin .cl { color: var(--err); }
@keyframes spin { to { transform: rotate(360deg); } }
`;

// ---------------------------------------------------------------- graph

const W = 220;
const X = 10;
const TOP = 11;
const ROW = 24;
const MAX = 6;

function createGraph(svg, store, isOpen) {
  setHTML(svg, `
    <g class="lines"><path class="ln pushed"/><path class="ln ahead"/><path class="ln work"/><path class="ln tail"/></g>
    <g class="rows"></g>
    <g class="origin"><line x1="${X - 6}" x2="${W}" y1="0" y2="0"/></g>`);
  const q = (s) => svg.querySelector(s);
  const ln = { pushed: q('.ln.pushed'), ahead: q('.ln.ahead'), work: q('.ln.work'), tail: q('.ln.tail') };
  const rowsG = q('.rows');
  const originG = q('.origin');
  const rows = new Map();
  const height = new Spring(40, { stiffness: 420, damping: 40 });
  const originY = new Spring(0, { stiffness: 260, damping: 32 });
  const originO = new Spring(0, { stiffness: 400, damping: 40 });
  let hasTail = false;
  let top0 = TOP;

  // Same order as the chat: oldest at the top, newest at the bottom, uncommitted last.
  const list = () => {
    const st = store.state;
    if (!st.tracked) return [];
    const cs = st.commits
      .slice(0, MAX)
      .reverse()
      .map((c) => ({ id: c.id, type: 'commit', c }));
    return [...cs, { id: 'work', type: 'work' }];
  };

  function make(r, y0, snap) {
    const g = mk('g', { class: `row ${r.type}` }, rowsG);
    mk('rect', { class: 'hl', x: -6, y: -ROW / 2 + 1, width: W + 4, height: ROW - 2, rx: 6 }, g);
    const n = {
      id: r.id,
      r,
      g,
      y: new Spring(y0, { stiffness: 380, damping: 38 }),
      o: new Spring(snap ? 1 : 0, { stiffness: 400, damping: 40 }),
      dead: false,
    };
    if (r.type === 'work') {
      n.ping = mk('circle', { class: 'ping', cx: X, r: 4.5 }, g);
      mk('circle', { class: 'wk', cx: X, r: 4.5 }, g);
    } else {
      n.dot = mk('circle', { class: 'dot', cx: X, r: 3.2 }, g);
      n.ago = mk('text', { class: 'ago', x: W, y: 4 }, g);
      n.pv = r.c.pushed && snap;
      g.classList.toggle('ahead', !n.pv);
      g.classList.toggle('pv', n.pv);
    }
    n.lab = mk('text', { class: 'lab', x: X + 14, y: 4 }, g);
    o(n);
    n.o.set(1);
    return n;
  }
  const o = (n) => n.g.setAttribute('opacity', clamp(n.o.value, 0, 1).toFixed(3));

  function labels(n) {
    const st = store.state;
    if (n.r.type === 'work') {
      const k = st.staged.length;
      rollText(n.lab, k ? `+${k}` : '');
      n.g.classList.toggle('empty', !k);
    } else {
      n.lab.textContent = `+${n.r.c.n}`;
      n.ago.textContent = fmtAgo(n.r.c.t);
    }
  }

  function sync(spawnY = null, snap = false) {
    const rs = list();
    const keep = new Set();
    hasTail = store.state.commits.length > MAX;
    top0 = TOP + (hasTail ? 14 : 0); // room for the "older commits" tail above
    rs.forEach((r, i) => {
      const y = top0 + i * ROW;
      let n = rows.get(r.id);
      if (!n) {
        n = make(r, spawnY ?? y, snap);
        rows.set(r.id, n);
      }
      n.r = r;
      n.dead = false;
      n.y.set(y);
      if (snap) {
        n.y.snap(y);
        n.o.snap(1);
      }
      keep.add(r.id);
      labels(n);
    });
    for (const n of rows.values()) {
      if (!keep.has(n.id) && !n.dead) {
        n.dead = true;
        n.o.set(0);
      }
    }
    const st = store.state;
    // origin: everything above the line is on GitHub; pushing moves it down
    const firstAhead = rs.findIndex((r) => r.type === 'commit' && !r.c.pushed);
    const oy = top0 + ((firstAhead === -1 ? rs.length - 1 : firstAhead) - 0.5) * ROW;
    originY.set(oy);
    originO.set(st.tracked && st.commits.some((c) => c.pushed) ? 1 : 0);
    const h = rs.length ? top0 + (rs.length - 1) * ROW + 12 : 30;
    height.set(h);
    if (snap) {
      originY.snap(oy);
      originO.snap(originO.target);
      height.snap(h);
    }
  }

  function frame(dt) {
    if (!isOpen()) return;
    height.step(dt);
    svg.setAttribute('height', height.value.toFixed(1));
    svg.setAttribute('viewBox', `-6 0 ${W + 8} ${height.value.toFixed(1)}`);
    originY.step(dt);
    originO.step(dt);
    const oY = originY.value;
    originG.setAttribute('transform', `translate(0 ${oY.toFixed(2)})`);
    originG.setAttribute('opacity', clamp(originO.value, 0, 1).toFixed(3));

    const commits = [];
    for (const [id, n] of rows) {
      n.y.step(dt);
      n.o.step(dt);
      if (n.dead && n.o.value < 0.02) {
        n.g.remove();
        rows.delete(id);
        continue;
      }
      n.g.setAttribute('transform', `translate(0 ${n.y.value.toFixed(2)})`);
      o(n);
      if (n.r.type === 'commit' && !n.dead) {
        const pv = n.r.c.pushed && oY > n.y.value;
        if (pv !== n.pv) {
          n.pv = pv;
          n.g.classList.toggle('ahead', !pv);
          n.g.classList.toggle('pv', pv);
        }
        commits.push(n);
      }
    }
    commits.sort((a, b) => a.y.value - b.y.value);
    const work = rows.get('work');
    if (commits.length) {
      const fy = commits[0].y.value;
      const ly = commits[commits.length - 1].y.value;
      ln.work.setAttribute('d', work && !work.dead ? `M${X} ${(ly + 3.5).toFixed(1)}V${(work.y.value - 5).toFixed(1)}` : '');
      const pEnd = Math.min(oY, ly);
      ln.pushed.setAttribute('d', pEnd > fy ? `M${X} ${fy.toFixed(1)}V${pEnd.toFixed(1)}` : '');
      const aStart = Math.max(oY, fy);
      ln.ahead.setAttribute('d', ly > aStart ? `M${X} ${aStart.toFixed(1)}V${ly.toFixed(1)}` : '');
      ln.tail.setAttribute('d', hasTail ? `M${X} ${(fy - 18).toFixed(1)}V${(fy - 6).toFixed(1)}` : '');
    } else {
      for (const k in ln) ln[k].setAttribute('d', '');
    }
  }

  // what the graph shows; a plain status update only redraws when this changed
  const shownState = () => {
    const st = store.state;
    return `${st.staged.length}|${st.commits.map((c) => `${c.id}:${c.pushed ? 1 : 0}`).join(',')}`;
  };
  let lastShown = '';

  function onEvent(type, d) {
    if (!isOpen()) return;
    const shown = shownState();
    const changed = shown !== lastShown;
    lastShown = shown;
    if (type === 'status') {
      // authoritative state, e.g. staged work that went back to clean without a commit
      if (changed) sync();
    } else if (type === 'staged') {
      const w = rows.get('work');
      if (w) {
        labels(w);
        w.ping.animate(
          [
            { transform: 'scale(1)', opacity: 0.5 },
            { transform: 'scale(2.6)', opacity: 0 },
          ],
          { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' },
        );
      }
    } else if (type === 'committed') {
      const w = rows.get('work');
      sync(w ? w.y.value : TOP);
    } else if (type === 'pushStart') {
      svg.classList.add('sending');
      svg.classList.remove('err');
    } else if (type === 'pushed') {
      svg.classList.remove('sending');
      sync();
    } else if (type === 'pushEnd') {
      // every push ends with this, also one where nothing was sent (all commits superseded)
      svg.classList.remove('sending');
      if (d?.ok) sync();
    } else if (type === 'error') {
      svg.classList.remove('sending');
      svg.classList.add('err');
    } else if (type === 'captured' || type === 'reset') {
      svg.classList.remove('sending', 'err');
      sync(null, true);
    }
  }

  return {
    frame,
    onEvent,
    refresh() {
      svg.classList.toggle('sending', store.state.phase === 'pushing');
      svg.classList.toggle('err', store.state.phase === 'error');
      lastShown = shownState();
      sync(null, true);
    },
  };
}

// ---------------------------------------------------------------- panel

export function createPanel(root, store, { onRequestClose, openSettings, label = (k) => k } = {}) {
  const el = document.createElement('div');
  el.className = 'panel lg';
  setHTML(el, `
    <div class="lg-b"></div><div class="lg-h"></div>
    <div class="content">
      <svg class="graph" width="${W}" height="40"></svg>
      <div class="msg" role="status"></div>
      <div class="bar">
        <button class="ib commit" aria-label="Commit" title="Commit">${icon.commit}</button>
        <button class="ib push" aria-label="Push" title="Push">${icon.push}<svg class="spin" viewBox="-10 -10 20 20"><circle r="8" pathLength="1"/></svg></button>
        <button class="ib link" aria-label="Copy link" title="Copy link">${icon.link}</button>
        <button class="ib gear" aria-label="Settings" title="Settings">${icon.gear}</button>
        <span class="sp"></span>
        <button class="sw" data-k="autoCommit" role="switch" aria-checked="false" aria-label="Auto commit" title="Auto commit">${icon.commit}<span class="tr"><span class="kn"></span></span></button>
        <button class="sw" data-k="autoPush" role="switch" aria-checked="false" aria-label="Auto push" title="Auto push">${icon.push}<span class="tr"><span class="kn"></span></span></button>
      </div>
    </div>`);
  root.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const content = $('.content');
  const glassB = el.querySelector(':scope > .lg-b');
  const btnCommit = $('.ib.commit');
  const btnPush = $('.ib.push');
  const switches = [...el.querySelectorAll('.sw')];
  let open = false;
  let lensKey = '';
  let placement = null;

  const graph = createGraph($('.graph'), store, () => open);

  function ui() {
    const st = store.state;
    el.classList.toggle('untracked', !st.tracked);
    el.classList.toggle('capturing', st.phase === 'capturing');
    el.classList.toggle('pushing', st.phase === 'pushing');
    el.classList.toggle('error', st.phase === 'error');
    // a turn without progress for a long time: not finished, so nothing was saved yet
    el.classList.toggle('stalled', !!st.stalled && st.phase !== 'error');
    el.classList.toggle('auto-commit', !!st.settings.autoCommit);
    el.classList.toggle('auto-push', !!st.settings.autoPush);
    $('.msg').textContent = st.phase === 'error' ? st.error || '' : st.stalled ? label('aiStalled') : '';
    btnCommit.classList.toggle('dim', !st.staged.length);
    // push also commits staged work first, so it is useful whenever anything is pending
    btnPush.classList.toggle('dim', !st.staged.length && !store.ahead && st.phase !== 'error');
  }

  function setSwitch(k, delay = 0) {
    const sw = switches.find((s) => s.dataset.k === k);
    const go = () => sw.setAttribute('aria-checked', String(store.state.settings[k]));
    if (delay) setTimeout(go, delay);
    else go();
  }

  function nudge(btn) {
    btn.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 240, easing: 'ease-out' },
    );
  }

  btnCommit.addEventListener('click', () => store.commit());
  btnPush.addEventListener('click', () => store.push());
  switches.forEach((sw) => sw.addEventListener('click', () => store.setAuto(sw.dataset.k, !store.state.settings[sw.dataset.k])));
  $('.gear').addEventListener('click', () => {
    onRequestClose?.();
    openSettings?.();
  });
  if (!openSettings) $('.gear').hidden = true;
  // localized labels when the host passes them (the playground does not)
  for (const [sel, key] of [['.ib.commit', 'commit'], ['.ib.push', 'push'], ['.link', 'copyLink'], ['.gear', 'openSettings'], ['.sw[data-k=autoCommit]', 'autoCommit'], ['.sw[data-k=autoPush]', 'autoPush']]) {
    const b = $(sel);
    const text = label(key);
    if (b && text !== key) {
      b.setAttribute('aria-label', text);
      b.title = text;
    }
  }
  $('.link').addEventListener('click', async () => {
    const b = $('.link');
    try {
      await navigator.clipboard.writeText(store.state.webUrl || store.state.path || '');
    } catch {}
    setHTML(b, icon.check);
    b.classList.add('done');
    setTimeout(() => {
      setHTML(b, icon.link);
      b.classList.remove('done');
    }, 1200);
  });

  const unsub = store.subscribe((type, d) => {
    ui();
    graph.onEvent(type, d);
    if (type === 'settings') {
      setSwitch(d.key);
      // the dependent switch follows a beat later so the link is visible
      if (d.linked) setSwitch(d.linked, 160);
    } else if (type === 'nope') {
      nudge(d.action === 'commit' ? btnCommit : btnPush);
    } else if (type === 'captureStart') {
      // init is shown on the widget only; never animate it in two places at once
      onRequestClose?.();
    } else if (type === 'captured') {
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
  });

  const stopFrame = onFrame((dt) => {
    if (!open) return;
    graph.frame(dt);
    const r = el.getBoundingClientRect();
    if (pointer.active) setLight(el, pointer.x - (r.left + r.width / 2), pointer.y - (r.top + r.height / 2));
    if (placement) {
      const top = parseFloat(el.style.top) || 0;
      const maxTop = innerHeight - r.height - 12;
      if (top > maxTop) el.style.top = `${Math.max(12, maxTop)}px`;
    }
    refreshLens(r.width, r.height);
  });

  function refreshLens(w, h) {
    const key = `${Math.round(w)}x${Math.round(h / 8)}`;
    if (key === lensKey || w < 50) return;
    lensKey = key;
    applyLens(root, glassB, { w: el.offsetWidth, h: el.offsetHeight, r: 16, bezel: 14, scale: 26, blur: 16, sat: 1.3, bright: 1.04 });
  }

  function place(p) {
    placement = p;
    el.style.right = `${p.right}px`;
    const h = el.offsetHeight;
    el.style.top = `${clamp(p.centerY - h / 2, 12, Math.max(12, innerHeight - h - 12))}px`;
  }

  const onKey = (e) => {
    if (open && e.key === 'Escape') onRequestClose?.();
  };
  const onDown = (e) => {
    if (open && !e.composedPath().includes(root.host)) onRequestClose?.();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown, true);

  ui();
  switches.forEach((sw) => setSwitch(sw.dataset.k));

  return {
    el,
    get isOpen() {
      return open;
    },
    /** @param {{focus?: boolean}} [opts] focus: opened from the keyboard, move focus into the panel */
    open(origin, p, opts = {}) {
      if (open) return;
      open = true;
      el.getAnimations().forEach((a) => a.cancel());
      el.classList.add('open');
      ui();
      switches.forEach((sw) => setSwitch(sw.dataset.k));
      graph.refresh();
      graph.frame(0);
      place(p);
      lensKey = '';
      refreshLens(el.offsetWidth, el.offsetHeight);
      const r = el.getBoundingClientRect();
      const sx = origin.width / r.width;
      const sy = origin.height / r.height;
      const dx = origin.left + origin.width / 2 - (r.left + r.width / 2);
      const dy = origin.top + origin.height / 2 - (r.top + r.height / 2);
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '50%' },
          { transform: 'none', borderRadius: '16px' },
        ],
        { duration: OPEN.duration, easing: OPEN.easing },
      );
      content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 80, easing: 'linear', fill: 'backwards' });
      if (opts.focus) requestAnimationFrame(() => [...el.querySelectorAll('button')].find((b) => !b.hidden && b.offsetParent)?.focus());
    },
    close(target) {
      if (!open) return Promise.resolve();
      const r = el.getBoundingClientRect();
      const sx = target.width / r.width;
      const sy = target.height / r.height;
      const dx = target.left + target.width / 2 - (r.left + r.width / 2);
      const dy = target.top + target.height / 2 - (r.top + r.height / 2);
      content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: 'forwards' });
      const a = el.animate(
        [
          { transform: 'none', borderRadius: '16px' },
          { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '50%' },
        ],
        { duration: Math.min(CLOSE.duration, 320), easing: CLOSE.easing, fill: 'forwards' },
      );
      const done = () => {
        open = false;
        el.classList.remove('open');
        el.getAnimations().forEach((x) => x.cancel());
        content.getAnimations().forEach((x) => x.cancel());
      };
      // a cancelled animation rejects `finished`; the panel must still end up closed
      return a.finished.then(done, done);
    },
    destroy() {
      unsub();
      stopFrame();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      el.remove();
    },
  };
}
