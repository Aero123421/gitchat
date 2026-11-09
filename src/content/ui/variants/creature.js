// Variant C: Creature (refined).
// A frosted-glass blob in the same monochrome language as the line and the panel.
//   droplets orbiting it = uncommitted messages; they merge into it on commit
//   blue dots in its belly = unpushed commits; they rise out of it on push
// Expression is limited to the eyes and posture. No mouth, no blush, no big bounces.
// Hover reveals commit / push buttons under it, like the line.
//
// Repertoire
//   idle (every few seconds): glance around, double blink, watch one of its droplets, sigh,
//     stretch, shift its weight, small hop. Drowsy after 20s of no input, asleep after 45s.
//   page: lags behind when the chat scrolls and looks the way it moves; watches the text as you
//     type and perks up on Enter; follows incoming droplets with its eyes.
//   cursor: startles at a fast approach, goes content when stroked, peeks open when asleep,
//     gets dizzy when shaken while dragged, settles with a squash when dropped.
//   AI: while the chat's AI thinks, it looks up and to the side, tilts its head, and the gloss
//     circles its body; while the answer streams it reads along and a droplet grows on its edge,
//     which pinches off into orbit when the answer is done.
//   git: gulps on commit, watches its dots leave on push, shivers then eyes the button on
//     error, shakes its head when there is nothing to do, nods when a setting changes.

import { Spring, onFrame, clamp, smooth, lerp } from '../core/spring.js';
import { pointer } from '../core/pointer.js';
import { glassCSS } from '../core/glass.js';
import { createPanel, panelCSS } from '../core/panel.js';
import { createActions, actionsCSS, BTN, BTN_GAP } from '../core/actions.js';
import { setHTML } from '../core/html.js';

const BOX = 240;
const HX = BOX - 50;
const HY = 112;
const R0 = 23;
const MAX_SATS = 6;
const MAX_PEARLS = 6;
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

const css = `
.box { position: fixed; right: 0; top: 0; width: ${BOX}px; height: ${BOX}px; pointer-events: none;
  --body: #f3f3f6; --body-sleep: #dedee3; --edge-c: rgba(0,0,0,.17); --rim-c: rgba(255,255,255,.9); --shadow-c: rgba(0,0,0,.13); }
:host([data-theme="dark"]) .box { --body: #3d3d43; --body-sleep: #2d2d32; --edge-c: rgba(0,0,0,.55); --rim-c: rgba(255,255,255,.28); --shadow-c: rgba(0,0,0,.5); }
.frost { position: absolute; left: 0; top: 0; border-radius: 50%; pointer-events: none;
  -webkit-backdrop-filter: blur(8px) saturate(1.3); backdrop-filter: blur(8px) saturate(1.3); }
.sl { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.body, .reach, .sat, .dropc { fill: var(--body); transition: fill .6s; }
.sleep .body, .sleep .reach { fill: var(--body-sleep); }
.shf { flood-color: var(--shadow-c); }
.edf { flood-color: var(--edge-c); transition: flood-color .3s; }
.rmf { flood-color: var(--rim-c); }
.err .edf { flood-color: var(--err); }
.hit { fill: transparent; pointer-events: all; cursor: pointer; }
.box.drag .hit { cursor: grabbing; }
.eye { fill: var(--ink); }
.lid { fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-linecap: round; }
.pearl, .rise { fill: var(--accent); }
.flyd { fill: var(--body); stroke: var(--edge-c); stroke-width: .7; }
.prog-t { fill: none; stroke: var(--ink-4); stroke-width: 1; }
.prog { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-linecap: round; }
.count { position: absolute; left: 0; top: 0; font: 500 10.5px/1 var(--mono); color: var(--ink-2); font-variant-numeric: tabular-nums;
  white-space: nowrap; pointer-events: none; opacity: 0; transform: translateX(-50%); }
`;

export function mountCreature(host, store, options = {}) {
  const root = host.attachShadow({ mode: 'open' });
  setHTML(root, `<style>${glassCSS}${panelCSS}${actionsCSS}${css}</style>
  <div class="box">
    <div class="frost"></div>
    <svg class="sl" viewBox="0 0 ${BOX} ${BOX}">
      <defs>
        <filter id="c-goo" x="0" y="0" width="${BOX}" height="${BOX}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.2" result="b"/>
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -8.5" result="g"/>
          <feGaussianBlur in="g" stdDeviation="3" result="sh0"/>
          <feOffset in="sh0" dy="3" result="sh1"/>
          <feFlood class="shf"/>
          <feComposite in2="sh1" operator="in" result="shadow"/>
          <feComponentTransfer in="g" result="bodyA"><feFuncA type="linear" slope="0.76"/></feComponentTransfer>
          <feMorphology in="g" operator="dilate" radius="0.7" result="dil"/>
          <feComposite in="dil" in2="g" operator="out" result="edge"/>
          <feFlood class="edf"/>
          <feComposite in2="edge" operator="in" result="edgeC"/>
          <feMorphology in="g" operator="erode" radius="1.1" result="er"/>
          <feComposite in="g" in2="er" operator="out" result="rim"/>
          <feFlood class="rmf"/>
          <feComposite in2="rim" operator="in" result="rimC"/>
          <feGaussianBlur in="g" stdDeviation="2.4" result="gb"/>
          <feSpecularLighting in="gb" surfaceScale="3.5" specularConstant=".85" specularExponent="32" lighting-color="#ffffff" result="sp">
            <fePointLight class="light" x="180" y="40" z="140"/>
          </feSpecularLighting>
          <feComposite in="sp" in2="g" operator="in" result="spIn"/>
          <feMerge>
            <feMergeNode in="shadow"/><feMergeNode in="bodyA"/><feMergeNode in="edgeC"/><feMergeNode in="rimC"/><feMergeNode in="spIn"/>
          </feMerge>
        </filter>
      </defs>
      <g class="ringg"><circle class="prog-t"/><circle class="prog" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></g>
      <g class="goo" filter="url(#c-goo)">
        <ellipse class="body"/>
        <circle class="reach" r="0"/>
        <g class="sats"></g>
      </g>
      <g class="pearls"></g>
      <g class="face">
        <g class="eyeL"><rect class="eye" x="-1.6" y="-3.8" width="3.2" height="7.6" rx="1.6"/><path class="lid" d="M-2.6 0H2.6"/></g>
        <g class="eyeR"><rect class="eye" x="-1.6" y="-3.8" width="3.2" height="7.6" rx="1.6"/><path class="lid" d="M-2.6 0H2.6"/></g>
      </g>
      <g class="fx"></g>
      <ellipse class="hit"/>
    </svg>
    <div class="count" aria-live="polite"></div>
  </div>`);

  const $ = (s) => root.querySelector(s);
  const box = $('.box');
  const svg = $('.sl');
  const frost = $('.frost');
  const body = $('.body');
  const reachC = $('.reach');
  const satsG = $('.sats');
  const pearlsG = $('.pearls');
  const face = $('.face');
  const eyeL = $('.eyeL');
  const eyeR = $('.eyeR');
  const eyes = [...root.querySelectorAll('.eye')];
  const lids = [...root.querySelectorAll('.lid')];
  const light = $('.light');
  const hit = $('.hit');
  const ringT = $('.prog-t');
  const ring = $('.prog');
  const fx = $('.fx');
  const countEl = $('.count');
  const actions = createActions(root, box, store, options.label);


  let frac = 0.56;
  const anchor = new Spring(frac * innerHeight, { stiffness: 300, damping: 32 });
  const bx = new Spring(HX, { stiffness: 160, damping: 16 });
  const by = new Spring(HY, { stiffness: 160, damping: 16 });
  const sqx = new Spring(1, { stiffness: 300, damping: 18 });
  const sqy = new Spring(1, { stiffness: 300, damping: 18 });
  const reach = new Spring(0, { stiffness: 170, damping: 18 });
  const reachR = new Spring(0, { stiffness: 170, damping: 18 });
  const lookX = new Spring(0, { stiffness: 420, damping: 32 }); // stiff: eyes move in quick saccades
  const lookY = new Spring(0, { stiffness: 420, damping: 32 });
  const lid = new Spring(1, { stiffness: 1200, damping: 50 }); // blink: 1 open, 0 closed
  const lidCap = new Spring(1, { stiffness: 50, damping: 12 }); // drowsiness cap on how open the eyes are
  const widen = new Spring(1, { stiffness: 320, damping: 18 }); // eye size
  const tilt = new Spring(0, { stiffness: 220, damping: 12 }); // head tilt, degrees
  const lxS = new Spring(-0.5, { stiffness: 80, damping: 16 });
  const lyS = new Spring(-0.9, { stiffness: 80, damping: 16 });
  const ringO = new Spring(0, { stiffness: 300, damping: 30 });
  const reveal = new Spring(0, { stiffness: 380, damping: 36 });

  let mood = 'idle';
  let moodUntil = 0;
  let nextBlink = performance.now() + 2500;
  let nextIdle = performance.now() + 4000;
  let pressed = null;
  let dragging = false;
  let panelOpen = false;
  let shown = store.state.staged.length;
  let shiverUntil = 0;
  let lastActive = performance.now();
  let wakeGuard = 0;
  let dozeLevel = 0; // 0 awake, 1 drowsy, 2 asleep
  let breathPh = 0;
  let breathK = 1;
  let scrollImpulse = 0;
  let petDist = 0;
  let petCool = 0;
  let startleCool = 0;
  let peekCool = 0;
  let lastPx = null;
  let lastPy = null;
  let shakeFlips = 0;
  let shakeSign = 0;
  let shakeT = 0;
  let dizzyPending = false;
  let incoming = null; // newest droplet in flight; the eyes follow it
  let geo = { cx: HX, cy: HY, R: R0, btnY: HY + R0 + 10 };
  let pinUntil = 0; // keep the buttons out for a moment after a click (touch / untracked)
  // what the chat's AI is doing: idle | thinking | streaming
  let aiPhase = store.state.ai || 'idle';
  let aiT0 = performance.now();
  let aiStreamMs = 2800;
  let forming = null; // the AI's answer condensing into a droplet on the body's edge
  let nextPulse = 0;
  let lastInputRect = null;
  const poseX = new Spring(1, { stiffness: 120, damping: 14 });
  const poseY = new Spring(1, { stiffness: 120, damping: 14 });
  const orbitL = new Spring(0, { stiffness: 60, damping: 14 }); // 1 = the gloss circles the body
  const gaze = { x: 0, y: 0, until: 0, fn: null };
  const sats = [];
  const pearls = [];
  const parts = [];
  const timers = new Set();
  const later = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const panel = createPanel(root, store, { onRequestClose: () => closePanel(), openSettings: options.openSettings, label: options.label });

  const setMood = (m, ms) => {
    mood = m;
    moodUntil = performance.now() + ms;
  };
  function baseMood() {
    const st = store.state;
    if (st.phase === 'capturing') return 'focus';
    if (!st.tracked) return 'sleep';
    if (st.phase === 'error') return 'error';
    return 'idle';
  }
  // look in a direction (unit-ish vector) for a while
  const look = (x, y, ms) => {
    gaze.fn = null;
    gaze.x = x;
    gaze.y = y;
    gaze.until = performance.now() + ms;
  };
  // keep looking at a moving point (box coordinates) for a while
  const follow = (fn, ms) => {
    gaze.fn = fn;
    gaze.until = performance.now() + ms;
  };
  const blink = () => {
    lid.set(0);
    later(90, () => lid.set(1));
  };
  const pick = (pool) => {
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [name, w] of pool) if ((r -= w) <= 0) return name;
    return pool[0][0];
  };

  // ---- repertoire
  const acts = {
    // look around: at the chat, up, down at its buttons, toward the edge
    glance() {
      const pts = [[-1, -0.1], [-0.7, -0.7], [0.15, -1], [0, 0.95], [0.8, -0.5], [-0.9, 0.6]];
      const a = pts[Math.floor(Math.random() * pts.length)];
      look(a[0], a[1], 800 + Math.random() * 700);
      if (Math.random() < 0.45) {
        later(1000, () => {
          const b = pts[Math.floor(Math.random() * pts.length)];
          look(b[0], b[1], 700);
        });
      }
    },
    blink2() {
      blink();
      later(230, blink);
    },
    stretch() {
      setMood('closed', 950);
      sqx.set(0.9);
      sqy.set(1.15);
      later(720, () => {
        sqx.set(1);
        sqy.set(1);
        sqy.kick(-1.5);
        sqx.kick(1.1);
      });
    },
    sigh() {
      sqx.set(1.06);
      sqy.set(0.95);
      lidCap.set(0.55);
      later(1000, () => {
        sqx.set(1);
        sqy.set(1);
        if (!dozeLevel) lidCap.set(1);
      });
    },
    shift() {
      const s = Math.random() > 0.5 ? 1 : -1;
      bx.kick(110 * s);
      tilt.kick(-70 * s);
    },
    nod() {
      look(lookX.value * 0.5, 1, 170);
      sqy.kick(-0.8);
      later(180, () => look(lookX.value * 0.5, -0.25, 300));
    },
    shake() {
      [0, 130, 260, 390].forEach((ms, i) =>
        later(ms, () => {
          tilt.kick((i % 2 ? -1 : 1) * 230 * (1 - i * 0.2));
          look(i % 2 ? 0.8 : -0.8, 0.1, 150);
        }),
      );
    },
    shiver() {
      shiverUntil = performance.now() + 480;
      widen.set(0.85);
      later(520, () => widen.set(1));
    },
    hop() {
      sqy.set(0.88);
      sqx.set(1.07);
      later(150, () => {
        sqy.set(1);
        sqx.set(1);
        by.kick(-260);
        sqy.kick(1.8);
      });
    },
    // keep an eye on one of its own droplets as it orbits
    watchDroplet() {
      const s = sats.find((x) => !x.dying);
      if (!s) return acts.glance();
      follow(() => ({ x: +s.el.getAttribute('cx'), y: +s.el.getAttribute('cy') }), 2300);
    },
    doze() {
      dozeLevel = 1;
      wakeGuard = performance.now() + 1800;
      lidCap.set(0.28);
      breathK = 0.6;
    },
    wake() {
      dozeLevel = 0;
      lidCap.set(1);
      breathK = 1;
      by.kick(-100);
      widen.kick(2.5);
      acts.blink2();
    },
    startle(sign = Math.random() > 0.5 ? 1 : -1) {
      bx.kick(230 * sign);
      sqx.kick(-1.6);
      widen.set(1.3);
      blink();
      later(480, () => widen.set(1));
    },
    dizzy() {
      setMood('closed', 1100);
      [0, 160, 320, 480, 640].forEach((ms, i) => later(ms, () => tilt.kick((i % 2 ? -1 : 1) * 170 * (1 - i * 0.15))));
      later(1150, acts.blink2);
    },
    pet() {
      setMood('content', 1200);
      [0, 150, 300].forEach((ms, i) =>
        later(ms, () => {
          sqx.kick(i % 2 ? -0.9 : 0.9);
          sqy.kick(i % 2 ? 0.9 : -0.9);
        }),
      );
    },
    perk() {
      widen.set(1.25);
      sqy.kick(1.3);
      later(750, () => widen.set(1));
    },
    peek() {
      setMood('peek', 900);
    },
  };

  // ---- droplets (uncommitted)
  function addSat(angle, rad) {
    const s = {
      el: mk('circle', { class: 'sat', r: 6.4 }, satsG),
      a: angle,
      w: (0.35 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1),
      ph: Math.random() * 6,
      rad: new Spring(rad, { stiffness: 110, damping: 13 }).set(R0 + 15),
      dying: false,
    };
    sats.push(s);
  }
  function syncSats() {
    const want = Math.min(shown, MAX_SATS);
    const alive = sats.filter((s) => !s.dying);
    while (alive.length < want) {
      addSat(Math.random() * Math.PI * 2, 0);
      alive.push(sats[sats.length - 1]);
    }
    while (alive.length > want) {
      const s = alive.pop();
      s.dying = true;
      s.rad.set(0);
    }
  }
  function absorbAll() {
    sats.forEach((s, i) => {
      s.dying = true;
      later(i * 40, () => s.rad.config(170, 22).set(0));
    });
  }

  // ---- pearls (unpushed)
  function syncPearls() {
    const want = store.state.phase === 'pushing' ? pearls.length : Math.min(store.ahead, MAX_PEARLS);
    while (pearls.length < want) {
      pearls.push({ el: mk('circle', { class: 'pearl', r: 2.1 }, pearlsG), s: new Spring(0, { stiffness: 380, damping: 32 }).set(1), x: 0, y: 0 });
    }
    while (pearls.length > want) pearls.pop().el.remove();
  }
  function releasePearls() {
    pearls.splice(0).forEach((p, i) => {
      p.el.remove();
      const el = mk('circle', { class: 'rise', r: 2.1, cx: p.x, cy: p.y }, fx);
      parts.push({ el, rise: true, x: p.x, y: p.y, vy: -40, ay: -300, life: -i * 0.05, max: 0.8 });
    });
  }

  // start: where the message came from, in box coordinates (e.g. the chat input). Droplets from
  // far away fly on a plain layer so they are not clipped by the goo filter's region.
  function flyIn(delay, start = null) {
    later(delay, () => {
      const far = !!start;
      const el = far ? mk('circle', { class: 'flyd', r: 5.5 }, fx) : mk('circle', { class: 'dropc', r: 6.4 }, $('.goo'));
      const sx = start ? start.x : HX - 150 - Math.random() * 30;
      const sy = start ? start.y : HY - 90 - Math.random() * 30;
      const c = start ? { x: (sx + HX) / 2, y: Math.min(sy, HY) - 90 } : { x: HX - 60, y: HY - 130 };
      parts.push({ el, bez: { x0: sx, y0: sy, cx: c.x, cy: c.y, t: 0, dur: far ? 0.8 : 0.6 } });
    });
  }
  function landed(angle) {
    shown = Math.min(shown + 1, store.state.staged.length);
    addSat(angle, R0 + 2);
    sqx.kick(0.8);
    sqy.kick(-0.8);
  }
  const inputStart = () =>
    lastInputRect && {
      x: lastInputRect.left + Math.min(lastInputRect.width / 2, 80) - (innerWidth - BOX),
      y: lastInputRect.top + lastInputRect.height / 2 - (anchor.value - HY),
    };

  // ---- the AI's answer: a droplet grows on the body's edge while it streams, then pinches off
  function startForming() {
    if (forming) return;
    forming = { el: mk('circle', { class: 'dropc', r: 0 }, $('.goo')), r: new Spring(0, { stiffness: 60, damping: 9 }), a: Math.PI * 1.08 };
  }
  function detachForming() {
    const f = forming;
    forming = null;
    const full = sats.filter((s) => !s.dying).length >= MAX_SATS;
    f.el.setAttribute('class', 'sat');
    f.el.setAttribute('r', '6.4');
    sats.push({
      el: f.el,
      a: f.a,
      w: 0.45 * (Math.random() > 0.5 ? 1 : -1),
      ph: Math.random() * 6,
      rad: new Spring(R0 + 2 + f.r.value * 0.7, { stiffness: 90, damping: 11 }).set(full ? 0 : R0 + 15),
      dying: full,
    });
    shown = Math.min(shown + 1, store.state.staged.length);
    sqx.kick(-0.9);
    sqy.kick(0.9);
  }
  function dissolveForming() {
    const f = forming;
    forming = null;
    sats.push({ el: f.el, a: f.a, w: 0, ph: 0, rad: new Spring(R0, { stiffness: 120, damping: 16 }).set(0), dying: true });
  }
  function onAi(phase, d) {
    lastActive = performance.now(); // waiting for an answer is not idling
    if (!store.state.tracked) {
      aiPhase = 'idle';
      return;
    }
    aiT0 = performance.now();
    if (phase === 'thinking') {
      aiPhase = 'thinking';
      blink();
    } else if (phase === 'streaming') {
      aiPhase = 'streaming';
      aiStreamMs = d.ms || 2800;
      startForming();
    } else {
      aiPhase = 'idle';
      if (forming) dissolveForming();
      later(150, () => {
        blink();
        setMood('content', 600);
      });
    }
  }

  function renderButtons() {
    const st = store.state;
    box.classList.toggle('sending', st.phase === 'pushing');
    box.classList.toggle('err', st.phase === 'error');
  }

  // ---- reactions to git events
  const unsub = store.subscribe((type, d) => {
    if (type === 'staged') {
      d.items.forEach((_, i) => {
        if (d.from === 'stream' && forming) detachForming();
        else if (d.from === 'input' && lastInputRect) flyIn(i * 200, inputStart());
        else flyIn(i * 200);
      });
    } else if (type === 'ai') onAi(d.phase, d);
    else if (type === 'committed') {
      // gulp: contract, swallow the droplets, then expand
      shown = 0;
      absorbAll();
      blink();
      sqx.set(0.93);
      sqy.set(0.93);
      later(320, () => {
        sqx.set(1);
        sqy.set(1);
        sqx.kick(1.3);
        sqy.kick(1.3);
        syncPearls();
        setMood('content', 700);
      });
    } else if (type === 'pushStart') {
      sqx.set(1.05);
      sqy.set(0.93);
      look(0.6, 0.85, 1500); // looks at its blue dots while it waits
    } else if (type === 'pushed') {
      sqx.set(1);
      sqy.set(1);
      sqy.kick(1.6);
      by.kick(-140);
      releasePearls();
      // watch the dots leave
      follow(() => {
        const r = parts.find((p) => p.rise && p.life >= 0);
        return r ? { x: r.x, y: r.y } : { x: geo.cx, y: geo.cy - 80 };
      }, 900);
      later(800, () => setMood('content', 900));
    } else if (type === 'error') {
      sqx.set(1);
      sqy.set(1);
      acts.shiver();
      // then glance at the push button
      later(600, () => follow(() => ({ x: geo.cx + BTN / 2 + BTN_GAP / 2, y: geo.btnY + BTN / 2 }), 900));
    } else if (type === 'nope') {
      acts.shake();
    } else if (type === 'settings') {
      acts.nod();
    } else if (type === 'captureStart') {
      acts.perk();
    } else if (type === 'captured') {
      shown = 0;
      d.items.slice(0, MAX_SATS + 2).forEach((_, i) => flyIn(120 + i * 110));
      later(120 + (MAX_SATS + 2) * 110 + 700, () => (shown = store.state.staged.length));
      setMood('content', 900);
    } else if (type === 'reset') {
      shown = store.state.staged.length;
      aiPhase = store.state.ai;
      if (forming) {
        forming.el.remove();
        forming = null;
      }
      sats.splice(0).forEach((s) => s.el.remove());
      pearls.splice(0).forEach((p) => p.el.remove());
    }
    if (type !== 'committed') syncPearls();
    syncSats();
    renderButtons();
  });

  // ---- reactions to the page
  const onActivity = () => {
    lastActive = performance.now();
    if (dozeLevel && performance.now() > wakeGuard) acts.wake();
  };
  addEventListener('pointermove', onActivity, { capture: true, passive: true });

  // scrolling: the body lags behind like it has weight, and it looks the way the chat moves
  const lastScroll = new WeakMap();
  const onScroll = (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== 'number') return;
    const prev = lastScroll.has(el) ? lastScroll.get(el) : el.scrollTop;
    const dy = el.scrollTop - prev;
    lastScroll.set(el, el.scrollTop);
    if (!dy) return;
    onActivity();
    scrollImpulse += -dy * 3.5;
    look(-0.7, dy < 0 ? -0.85 : 0.75, 450);
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // typing in the chat box: it watches the text grow; on Enter it perks up and waits for the reply
  const onKey = (e) => {
    const el = e.composedPath()[0];
    if (!(el instanceof Element) || !el.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    onActivity();
    const r = el.getBoundingClientRect();
    lastInputRect = r;
    follow(() => {
      const len = (el.value ?? el.textContent ?? '').length;
      return { x: r.left + Math.min(r.width - 20, 30 + len * 8) - (innerWidth - BOX), y: r.top + r.height / 2 - (anchor.value - HY) };
    }, 1500);
    if (e.key === 'Enter' && !e.shiftKey) {
      acts.perk();
      later(450, () => look(-1, -0.3, 1600));
    }
  };
  document.addEventListener('keydown', onKey, true);

  // ---- input on the creature itself
  hit.addEventListener('pointerdown', (e) => {
    const top = anchor.value - HY;
    pressed = { x: e.clientX, y: e.clientY, gx: e.clientX - (innerWidth - BOX + bx.value), gy: e.clientY - (top + by.value) };
    hit.setPointerCapture(e.pointerId);
    sqx.set(1.05);
    sqy.set(0.93);
  });
  hit.addEventListener('pointermove', (e) => {
    if (!pressed || panelOpen) return;
    if (!dragging && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > 5) {
      dragging = true;
      box.classList.add('drag');
      bx.config(600, 40);
      by.config(600, 40);
      sqx.set(1);
      sqy.set(1);
      shakeFlips = 0;
    }
  });
  const release = () => {
    if (!pressed) return;
    pressed = null;
    sqx.set(1);
    sqy.set(1);
    if (dragging) {
      dragging = false;
      box.classList.remove('drag');
      bx.config(160, 16);
      by.config(160, 16);
      const screenY = anchor.value - HY + by.value;
      const next = clamp(screenY, 60, innerHeight - 60);
      frac = next / innerHeight;
      anchor.snap(next);
      by.value = screenY - (next - HY);
      sqy.kick(-1.4); // settles with a little squash
      if (dizzyPending) later(120, acts.dizzy);
      dizzyPending = false;
      return;
    }
    if (panelOpen) closePanel();
    else if (!store.state.tracked || store.state.phase === 'capturing') {
      // nothing to show in a panel yet: reveal the start (or cancel) button instead
      pinUntil = performance.now() + 3000;
      acts.nod();
    } else openPanel();
  };
  hit.addEventListener('pointerup', release);
  hit.addEventListener('pointercancel', release);

  const bodyRect = () => ({ left: innerWidth - BOX + bx.value - R0, top: anchor.value - HY + by.value - R0, width: R0 * 2, height: R0 * 2 });
  function openPanel() {
    panelOpen = true;
    panel.open(bodyRect(), { right: BOX - HX + R0 + 14, centerY: anchor.value });
  }
  function closePanel() {
    if (!panel.isOpen) return;
    panel.close(bodyRect()).then(() => (panelOpen = false));
  }

  // ---- frame
  const stop = onFrame((dt, t) => {
    const st = store.state;
    const now = performance.now();
    anchor.set(clamp(frac * innerHeight, 60, Math.max(60, innerHeight - 60)));
    if (innerHeight > 0 && anchor.value <= 1) anchor.snap();
    anchor.step(dt);
    const top = anchor.value - HY;
    box.style.top = `${top.toFixed(1)}px`;
    const px = pointer.x - (innerWidth - BOX);
    const py = pointer.y - top;
    const dx = px - bx.value;
    const dy = py - by.value;
    const d = Math.hypot(dx, dy);
    const sleeping = !st.tracked && st.phase !== 'capturing';

    if (dragging && pressed) {
      bx.set(px - pressed.gx);
      by.set(py - pressed.gy);
      // shaking it back and forth makes it dizzy
      const v = bx.velocity;
      const sg = Math.sign(v);
      if (Math.abs(v) > 350 && sg !== shakeSign) {
        shakeSign = sg;
        if (now - shakeT > 900) shakeFlips = 0;
        shakeFlips++;
        shakeT = now;
        if (shakeFlips >= 5) dizzyPending = true;
      }
    } else if (!panelOpen && pointer.active && !sleeping && dozeLevel < 2) {
      const f = smooth(170, 36, d);
      bx.set(HX + clamp(dx * 0.05 * f, -6, 3));
      by.set(HY + clamp(dy * 0.05 * f, -6, 6));
    } else {
      bx.set(HX);
      by.set(HY);
    }
    if (scrollImpulse) {
      by.kick(clamp(scrollImpulse, -220, 220));
      scrollImpulse = 0;
    }
    bx.step(dt);
    by.step(dt);
    sqx.step(dt);
    sqy.step(dt);
    // AI thinking: a little taller, head slowly tilting side to side
    const thinking = aiPhase === 'thinking' && !sleeping;
    const streaming = aiPhase === 'streaming' && !sleeping;
    tilt.set(thinking ? Math.sin(t * 0.5) * 5 : 0);
    poseX.set(thinking ? 0.97 : 1);
    poseY.set(thinking ? 1.04 : 1);
    poseX.step(dt);
    poseY.step(dt);
    tilt.step(dt);
    widen.step(dt);
    lidCap.step(dt);

    // body
    breathPh += dt * (sleeping ? 1.1 : 1.8) * breathK;
    const breath = Math.sin(breathPh) * (sleeping || dozeLevel ? 0.022 : 0.012);
    const vx = bx.velocity;
    const vy = by.velocity;
    const stretch = Math.min(0.16, Math.hypot(vx, vy) * 0.0005);
    const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
    const R = R0 * (sleeping ? 0.94 : 1);
    const rx = R * sqx.value * poseX.value * (1 + breath) * (1 + stretch);
    const ry = R * sqy.value * poseY.value * (1 - breath) * (1 - stretch * 0.6);
    const jitter = now < shiverUntil ? Math.sin(now / 13) * 1.4 : 0;
    const cx = bx.value + jitter;
    const cy = by.value + (1 - sqy.value) * R * 0.5;
    body.setAttribute('cx', cx.toFixed(2));
    body.setAttribute('cy', cy.toFixed(2));
    body.setAttribute('rx', Math.max(4, rx).toFixed(2));
    body.setAttribute('ry', Math.max(4, ry).toFixed(2));
    body.setAttribute('transform', `rotate(${(ang + tilt.value * 0.5).toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    hit.setAttribute('cx', cx.toFixed(1));
    hit.setAttribute('cy', cy.toFixed(1));
    hit.setAttribute('rx', (R + 4).toFixed(1));
    hit.setAttribute('ry', (R + 4).toFixed(1));
    frost.style.width = `${(rx * 2).toFixed(1)}px`;
    frost.style.height = `${(ry * 2).toFixed(1)}px`;
    frost.style.transform = `translate(${(cx - rx).toFixed(1)}px, ${(cy - ry).toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;

    // hover: reveal the buttons; the area under the body counts while they are out
    const btnY = cy + R + 10;
    geo = { cx, cy, R, btnY };
    const onBody = d < R + 6;
    const onBtns = reveal.value > 0.2 && actions.covers(px, py);
    const hovered = pointer.active && !panelOpen && !dragging && (onBody || onBtns);
    reveal.set(hovered || now < pinUntil || st.phase === 'capturing' ? 1 : 0);
    reveal.step(dt);
    actions.frame(dt, { reveal: reveal.value, x: cx, y: btnY, dir: 'row' });

    // init on a long chat takes a while: a quiet counter under the body
    if (st.phase === 'capturing') {
      const txt = st.captureStage === 'reading' ? `${Math.round(((st.progress - 0.25) / 0.75) * 100)}%` : `↑ ${st.captureCount ?? 0}`;
      if (countEl.textContent !== txt) countEl.textContent = txt;
      countEl.style.opacity = '1';
      countEl.style.transform = `translate(${cx.toFixed(1)}px, ${(btnY + BTN + 8).toFixed(1)}px) translateX(-50%)`;
    } else if (countEl.style.opacity !== '0') countEl.style.opacity = '0';

    // pointer-driven reactions: startle on a fast approach, content when stroked, peek when asleep
    if (lastPx !== null && dt > 0 && pointer.active) {
      const mv = Math.hypot(px - lastPx, py - lastPy);
      const speed = mv / dt;
      if (!sleeping && !panelOpen && !dragging && !pressed && speed > 2200 && d < 120 && d > R && now > startleCool) {
        acts.startle(dx > 0 ? -1 : 1);
        startleCool = now + 3000;
      }
      if (onBody && !pressed && !dragging) petDist += mv;
    }
    lastPx = px;
    lastPy = py;
    petDist *= Math.exp(-dt * 1.6);
    if (petDist > 170 && now > petCool && !sleeping) {
      acts.pet();
      petCool = now + 2500;
      petDist = 0;
    }
    if (sleeping && onBody && pointer.active && now > peekCool) {
      acts.peek();
      peekCool = now + 4000;
    }

    // a short reach toward the cursor
    const prox = pointer.active && !panelOpen && !dragging && !sleeping && !dozeLevel && d > R ? smooth(160, R + 10, d) : 0;
    reach.set(prox * clamp(d - R * 0.4, 0, 24));
    reachR.set(prox * 8);
    reach.step(dt);
    reachR.step(dt);
    const ux = dx / (d || 1);
    const uy = dy / (d || 1);
    reachC.setAttribute('cx', (cx + ux * (R * 0.4 + reach.value)).toFixed(2));
    reachC.setAttribute('cy', (cy + uy * (R * 0.4 + reach.value)).toFixed(2));
    reachC.setAttribute('r', Math.max(0, reachR.value).toFixed(2));

    // light follows the cursor
    const near = pointer.active && d < 480;
    lxS.set(near ? ux : -0.5);
    lyS.set(near ? uy : -0.9);
    lxS.step(dt);
    lyS.step(dt);
    // while the AI thinks, the gloss circles the body like a loading shimmer
    orbitL.set(thinking ? 1 : 0);
    orbitL.step(dt);
    const ok = clamp(orbitL.value, 0, 1);
    const la = t * 2.4;
    light.setAttribute('x', lerp(cx + lxS.value * 60, cx + Math.cos(la) * 44, ok).toFixed(1));
    light.setAttribute('y', lerp(cy + lyS.value * 60 - 24, cy + Math.sin(la) * 44, ok).toFixed(1));
    light.setAttribute('z', lerp(140, 64, ok).toFixed(1));

    // droplets
    for (let i = sats.length - 1; i >= 0; i--) {
      const s = sats[i];
      s.rad.step(dt);
      if (s.dying && s.rad.value < 3) {
        s.el.remove();
        sats.splice(i, 1);
        continue;
      }
      s.a += dt * s.w;
      const r = Math.max(0, s.rad.value + Math.sin(t * 1.9 + s.ph) * 3.5);
      s.el.setAttribute('cx', (cx + Math.cos(s.a) * r).toFixed(2));
      s.el.setAttribute('cy', (cy + Math.sin(s.a) * r * 0.9).toFixed(2));
    }

    // the answer condensing on the edge facing the chat, pulsing as text arrives
    if (forming) {
      if (streaming) {
        const el = now - aiT0;
        forming.r.set(2 + 5.6 * (1 - Math.exp(-el / (aiStreamMs * 0.45))));
        if (now > nextPulse) {
          forming.r.kick(5);
          sqx.kick(0.22);
          nextPulse = now + 360 + Math.random() * 280;
        }
      }
      forming.r.step(dt);
      const a = forming.a + Math.sin(t * 2.3) * 0.05;
      const dist = R + 2 + forming.r.value * 0.7;
      forming.el.setAttribute('cx', (cx + Math.cos(a) * dist).toFixed(2));
      forming.el.setAttribute('cy', (cy + Math.sin(a) * dist * 0.95).toFixed(2));
      forming.el.setAttribute('r', Math.max(0, forming.r.value).toFixed(2));
    }

    // pearls: a short arc of ticks along the lower-right inner edge, like a gauge
    pearls.forEach((p, i) => {
      p.s.step(dt);
      const a = ((66 - i * 17) * Math.PI) / 180;
      const rr = R * 0.7 + Math.sin(t * 1.4 + i * 0.8) * 0.3;
      p.x = cx + Math.cos(a) * rr * (rx / R);
      p.y = cy + Math.sin(a) * rr * (ry / R);
      const k = clamp(p.s.value, 0, 1);
      p.el.setAttribute('cx', p.x.toFixed(2));
      p.el.setAttribute('cy', p.y.toFixed(2));
      p.el.setAttribute('r', (1.85 * (0.6 + 0.4 * k)).toFixed(2));
      p.el.setAttribute('opacity', k.toFixed(3));
    });

    // capture progress
    ringO.set(st.phase === 'capturing' ? 1 : 0);
    ringO.step(dt);
    for (const c of [ringT, ring]) {
      c.setAttribute('cx', cx.toFixed(1));
      c.setAttribute('cy', cy.toFixed(1));
      c.setAttribute('r', (R + 12).toFixed(1));
    }
    ring.setAttribute('stroke-dashoffset', String(1 - st.progress));
    ring.setAttribute('transform', `rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})`);
    $('.ringg').setAttribute('opacity', clamp(ringO.value, 0, 1).toFixed(3));

    // drowsiness: no input for a while → eyes half close → asleep
    const idleFor = now - lastActive;
    if (st.tracked && !panelOpen && !dragging && st.phase === 'idle' && aiPhase === 'idle') {
      if (dozeLevel === 0 && idleFor > 20000) acts.doze();
      else if (dozeLevel === 1 && idleFor > 45000) {
        dozeLevel = 2;
        lidCap.set(0);
        breathK = 0.5;
      }
    }

    // idle repertoire: every few seconds, if nothing else is going on, do something small
    if (moodUntil && now > moodUntil) moodUntil = 0;
    if (now > nextIdle) {
      const calm = !panelOpen && !dragging && !pressed && !moodUntil && !incoming && aiPhase === 'idle' && gaze.until < now && (!pointer.active || d > 220);
      if (calm && st.tracked && st.phase === 'idle' && !dozeLevel) {
        acts[pick([['glance', 34], ['blink2', 14], ['sigh', 10], ['shift', 10], ['stretch', 7], ['watchDroplet', sats.length ? 16 : 0], ['hop', 3]])]();
      } else if (calm && sleeping && Math.random() < 0.5) acts.sigh();
      nextIdle = now + 3500 + Math.random() * 5000;
    }

    // eyes: where to look
    const m = pressed && !dragging ? 'content' : moodUntil ? mood : baseMood();
    svg.classList.toggle('sleep', sleeping);
    svg.classList.toggle('err', st.phase === 'error');
    const toward = (x, y) => {
      const ddx = x - cx;
      const ddy = y - cy;
      const dd = Math.hypot(ddx, ddy) || 1;
      const k = Math.min(1, dd / 90);
      return [(ddx / dd) * k, (ddy / dd) * k];
    };
    let lxT = 0;
    let lyT = 0;
    if (m === 'focus') {
      // scroll to the top first, then read line by line on the way down
      const p = st.progress;
      if (p < 0.25) {
        lxT = -0.3;
        lyT = -1;
      } else {
        const ph = (now % 760) / 760;
        lxT = ph < 0.8 ? -0.95 + ph * 0.9 : -0.95;
        lyT = -0.4 + ((p - 0.25) / 0.75) * 1.2;
      }
    } else if (incoming) [lxT, lyT] = toward(incoming.x, incoming.y);
    else if (gaze.until > now) {
      if (gaze.fn) [lxT, lyT] = toward(gaze.fn().x, gaze.fn().y);
      else {
        lxT = gaze.x;
        lyT = gaze.y;
      }
    } else if (thinking) {
      // gaze drifts up and to the side, as if working something out
      lxT = 0.45 + Math.sin(t * 0.6) * 0.35;
      lyT = -0.8 + Math.sin(t * 1.1) * 0.12;
    } else if (streaming) {
      // reads the answer as it appears: left-to-right sweeps, slowly moving down
      const ph = (now % 700) / 700;
      lxT = ph < 0.8 ? -0.95 + ph * 0.75 : -0.95;
      lyT = -0.3 + (((now - aiT0) % 2600) / 2600) * 0.7;
    } else if (!sleeping && dozeLevel < 2 && pointer.active && (panelOpen || d < 640)) {
      const k = Math.min(1, d / 110);
      lxT = ux * k;
      lyT = uy * k;
    }
    lookX.set(lxT);
    lookY.set(lyT);
    lookX.step(dt);
    lookY.step(dt);

    if (now > nextBlink && !sleeping && m === 'idle' && dozeLevel < 2) {
      blink();
      if (Math.random() < 0.2) later(260, blink);
      nextBlink = now + 2800 + Math.random() * 3600;
    }
    lid.step(dt);

    // eye shape: open pill, narrowed when content, dot on error, closed when asleep
    let h = 1;
    if (m === 'content') h = 0.3;
    else if (m === 'error') h = 0.45;
    else if (m === 'focus') h = 1.1;
    else if (m === 'peek') h = 0.35;
    else if (m === 'sleep' || m === 'closed') h = 0;
    if (m === 'idle' || m === 'content') h *= clamp(lidCap.value, 0, 1);
    if (thinking && now - aiT0 > 5000 && m === 'idle') h *= 0.6; // long think: narrows its eyes to concentrate
    const open = clamp(lid.value, 0, 1) * h;
    const wv = clamp(widen.value, 0.6, 1.5);
    const ex = 7.5;
    face.setAttribute('transform', `translate(${(cx + lookX.value * 4.5).toFixed(2)} ${(cy - 5 + lookY.value * 3.5).toFixed(2)}) rotate(${tilt.value.toFixed(2)})`);
    eyeL.setAttribute('transform', `translate(${-ex} 0)`);
    eyeR.setAttribute('transform', `translate(${ex} 0)`);
    eyes.forEach((el) => {
      const hh = Math.max(0.01, 7.6 * open * wv);
      const ww = 3.2 * wv;
      el.setAttribute('height', hh.toFixed(2));
      el.setAttribute('y', (-hh / 2).toFixed(2));
      el.setAttribute('width', ww.toFixed(2));
      el.setAttribute('x', (-ww / 2).toFixed(2));
      el.setAttribute('rx', Math.min(ww / 2, hh / 2).toFixed(2));
      el.style.display = open < 0.08 ? 'none' : '';
    });
    lids.forEach((el) => (el.style.display = open < 0.08 ? '' : 'none'));

    // particles
    let nextIncoming = null;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.bez) {
        const z = p.bez;
        z.t = Math.min(1, z.t + dt / z.dur);
        const u = 1 - (1 - z.t) * (1 - z.t);
        const a2 = Math.atan2(z.y0 - cy, z.x0 - cx);
        const ex2 = cx + Math.cos(a2) * (R + 6);
        const ey2 = cy + Math.sin(a2) * (R + 6);
        const x = (1 - u) * (1 - u) * z.x0 + 2 * (1 - u) * u * z.cx + u * u * ex2;
        const y = (1 - u) * (1 - u) * z.y0 + 2 * (1 - u) * u * z.cy + u * u * ey2;
        if (z.t >= 1) {
          p.el.remove();
          parts.splice(i, 1);
          if (sats.filter((s) => !s.dying).length < MAX_SATS) landed(a2);
          else shown = Math.min(shown + 1, store.state.staged.length);
          continue;
        }
        if (!nextIncoming) nextIncoming = { x, y };
        p.el.setAttribute('cx', x.toFixed(1));
        p.el.setAttribute('cy', y.toFixed(1));
        continue;
      }
      p.life += dt;
      if (p.life < 0) continue;
      p.vy += p.ay * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.el.remove();
        parts.splice(i, 1);
        continue;
      }
      p.el.setAttribute('cy', p.y.toFixed(1));
      p.el.setAttribute('opacity', (1 - k).toFixed(3));
    }
    incoming = nextIncoming;
  });

  syncSats();
  syncPearls();
  renderButtons();

  return {
    // play one behavior by name (used by the demo menu)
    act(name) {
      if (name === 'doze') lastActive = performance.now() - 21000;
      acts[name]?.();
    },
    destroy() {
      stop();
      unsub();
      actions.destroy();
      panel.destroy();
      timers.forEach((id) => clearTimeout(id));
      removeEventListener('pointermove', onActivity, { capture: true });
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('keydown', onKey, true);
    },
  };
}
