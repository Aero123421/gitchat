// Liquid glass: theme tokens, layered highlights, and an SVG displacement "lens" for backdrop refraction.
// backdrop-filter: url(#svg-filter) only works in Chromium, which is fine for a Chrome extension.

import { springEasing } from './spring.js';

// Near-critical spring: settles fast, no visible bounce.
const SPRING = springEasing({ stiffness: 420, damping: 38 });

export const glassCSS = `
:host {
  all: initial;
  position: fixed; top: 0; left: 0; width: 0; height: 0;
  z-index: 2147483000;
  --ink: #111113; --ink-2: rgba(17,17,19,.56); --ink-3: rgba(17,17,19,.26); --ink-4: rgba(17,17,19,.12);
  --line: rgba(0,0,0,.07); --hover: rgba(0,0,0,.045);
  --tint: rgba(255,255,255,.2); --tint-strong: rgba(247,247,249,.72);
  --rim: rgba(255,255,255,.85); --hi: rgba(255,255,255,.95); --lo: rgba(255,255,255,.35); --edge: rgba(0,0,0,.11);
  --shadow: rgba(0,0,0,.14); --glare: rgba(255,255,255,.16);
  --accent: #0a84ff; --err: #e5484d;
  --dot: #bcbcc1; --track: rgba(120,120,128,.2); --thumb: #fff;
  --spring: ${SPRING.easing};
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
:host([data-theme="dark"]) {
  --ink: #ececee; --ink-2: rgba(236,236,238,.58); --ink-3: rgba(236,236,238,.28); --ink-4: rgba(236,236,238,.13);
  --line: rgba(255,255,255,.08); --hover: rgba(255,255,255,.06);
  --tint: rgba(255,255,255,.04); --tint-strong: rgba(34,34,37,.72);
  --rim: rgba(255,255,255,.32); --hi: rgba(255,255,255,.45); --lo: rgba(255,255,255,.12); --edge: rgba(0,0,0,.5);
  --shadow: rgba(0,0,0,.5); --glare: rgba(255,255,255,.06);
  --dot: #5c5c62; --track: rgba(120,120,128,.36); --thumb: #f2f2f4;
}
* { box-sizing: border-box; }
button { font: inherit; }
.lg { position: relative; border-radius: var(--r, 999px); }
.lg > .lg-b {
  position: absolute; inset: 0; border-radius: inherit;
  background: var(--tint);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  backdrop-filter: blur(12px) saturate(1.4);
}
.lg > .lg-h {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow:
    inset 0 0 0 .5px var(--edge),
    inset 1px 1px 0 -.25px var(--hi),
    inset -1px -1px 0 -.5px var(--lo),
    0 8px 24px -10px var(--shadow),
    0 1px 2px var(--shadow);
  background: radial-gradient(80% 50% at var(--lx, 30%) var(--ly, 0%), var(--glare), transparent 70%);
}
.lg > .lg-h::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: conic-gradient(from var(--la, 315deg),
    var(--rim), transparent 14%, transparent 36%,
    color-mix(in srgb, var(--rim) 35%, transparent) 50%,
    transparent 64%, transparent 86%, var(--rim));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}
`;

const NS = 'http://www.w3.org/2000/svg';
const maps = new Map();

function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// Displacement map: pixels near the rim sample from further inside, like a thick convex lens.
export function lensMap(w, h, r, bezel) {
  const key = `${w}x${h}r${r}b${bezel}`;
  if (maps.has(key)) return maps.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hw = w / 2;
  const hh = h / 2;
  r = Math.min(r, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const sd = sdRoundRect(px, py, hw, hh, r);
      let dx = 0;
      let dy = 0;
      if (sd < 0 && -sd < bezel) {
        const t = 1 + sd / bezel;
        const s = t * t;
        const gx = sdRoundRect(px + 0.5, py, hw, hh, r) - sdRoundRect(px - 0.5, py, hw, hh, r);
        const gy = sdRoundRect(px, py + 0.5, hw, hh, r) - sdRoundRect(px, py - 0.5, hw, hh, r);
        const gl = Math.hypot(gx, gy) || 1;
        dx = -(gx / gl) * s;
        dy = -(gy / gl) * s;
      }
      const i = (y * w + x) * 4;
      d[i] = Math.round(128 + dx * 127);
      d[i + 1] = Math.round(128 + dy * 127);
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  maps.set(key, url);
  return url;
}

let fid = 0;

export function applyLens(root, target, { w, h, r, bezel = 16, scale = 34, blur = 0.8, sat = 1.8, bright = 1.04 }) {
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  let defs = root.querySelector('svg.lg-defs');
  if (!defs) {
    defs = document.createElementNS(NS, 'svg');
    defs.setAttribute('class', 'lg-defs');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    root.appendChild(defs);
  }
  if (!target.dataset.lens) target.dataset.lens = `lens-${++fid}`;
  const id = target.dataset.lens;
  let f = defs.querySelector(`#${id}`);
  if (!f) {
    f = document.createElementNS(NS, 'filter');
    f.id = id;
    f.setAttribute('x', '0');
    f.setAttribute('y', '0');
    f.setAttribute('width', '100%');
    f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    const im = document.createElementNS(NS, 'feImage');
    im.setAttribute('result', 'map');
    im.setAttribute('x', '0');
    im.setAttribute('y', '0');
    im.setAttribute('preserveAspectRatio', 'none');
    const dm = document.createElementNS(NS, 'feDisplacementMap');
    dm.setAttribute('in', 'SourceGraphic');
    dm.setAttribute('in2', 'map');
    dm.setAttribute('xChannelSelector', 'R');
    dm.setAttribute('yChannelSelector', 'G');
    f.append(im, dm);
    defs.appendChild(f);
  }
  const im = f.querySelector('feImage');
  im.setAttribute('href', lensMap(w, h, r, bezel));
  im.setAttribute('width', w);
  im.setAttribute('height', h);
  f.querySelector('feDisplacementMap').setAttribute('scale', scale);
  const v = `url(#${id}) blur(${blur}px) saturate(${sat}) brightness(${bright})`;
  target.style.backdropFilter = v;
  target.style.webkitBackdropFilter = v;
}

// Point the specular highlight toward a light direction (unit-ish vector).
export function setLight(el, lx, ly) {
  const len = Math.hypot(lx, ly) || 1;
  const ux = lx / len;
  const uy = ly / len;
  el.style.setProperty('--lx', `${(50 + ux * 36).toFixed(1)}%`);
  el.style.setProperty('--ly', `${(50 + uy * 40).toFixed(1)}%`);
  el.style.setProperty('--la', `${((Math.atan2(uy, ux) * 180) / Math.PI + 90).toFixed(1)}deg`);
}
