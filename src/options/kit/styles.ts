// Design tokens and components shared by the popup and the settings page.
// Same language as the on-page widgets: monochrome liquid glass, one blue accent, hairlines,
// monospaced numbers, near-critically damped springs.
//
// Injected at runtime (one <style>), so both pages share one source without a CSS build step.

import { springEasing } from '../../content/ui/core/spring.js';

const SPRING = springEasing({ stiffness: 420, damping: 38 });

const LIGHT = `
  --ink: #111113; --ink-2: rgba(17,17,19,.58); --ink-3: rgba(17,17,19,.32); --ink-4: rgba(17,17,19,.12);
  --line: rgba(0,0,0,.08); --hover: rgba(0,0,0,.045); --press: rgba(0,0,0,.085);
  --bg: #f3f3f5; --grid: rgba(17,17,19,.075);
  --tint: rgba(255,255,255,.5); --tint-strong: rgba(250,250,252,.82);
  --rim: rgba(255,255,255,.92); --hi: rgba(255,255,255,.96); --lo: rgba(255,255,255,.42); --edge: rgba(0,0,0,.09);
  --shadow: rgba(16,16,20,.12); --glare: rgba(255,255,255,.3);
  --accent: #0a84ff; --accent-soft: rgba(10,132,255,.12); --err: #e5484d; --err-soft: rgba(229,72,77,.1);
  --dot: #bcbcc1; --track: rgba(120,120,128,.22); --thumb: #fff; --field: rgba(255,255,255,.62);
  --solid: #111113; --on-solid: #fff;
`;

const DARK = `
  --ink: #ececee; --ink-2: rgba(236,236,238,.6); --ink-3: rgba(236,236,238,.32); --ink-4: rgba(236,236,238,.13);
  --line: rgba(255,255,255,.09); --hover: rgba(255,255,255,.06); --press: rgba(255,255,255,.1);
  --bg: #0f0f11; --grid: rgba(236,236,238,.065);
  --tint: rgba(255,255,255,.045); --tint-strong: rgba(30,30,33,.8);
  --rim: rgba(255,255,255,.3); --hi: rgba(255,255,255,.42); --lo: rgba(255,255,255,.1); --edge: rgba(0,0,0,.55);
  --shadow: rgba(0,0,0,.5); --glare: rgba(255,255,255,.06);
  --accent: #0a84ff; --accent-soft: rgba(10,132,255,.2); --err: #ff6369; --err-soft: rgba(229,72,77,.16);
  --dot: #5c5c62; --track: rgba(120,120,128,.38); --thumb: #f2f2f4; --field: rgba(255,255,255,.045);
  --solid: #ececee; --on-solid: #111113;
`;

export const kitCSS = `
:root {
  color-scheme: light dark;
  ${LIGHT}
  --spring: ${SPRING.easing};
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { background: var(--bg); }
body {
  margin: 0; color: var(--ink); font: 13px/1.5 var(--sans); -webkit-font-smoothing: antialiased;
  background-color: var(--bg);
  background-image: radial-gradient(circle at 1px 1px, var(--grid) 1px, transparent 1.4px);
  background-size: 18px 18px;
}
a { color: inherit; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
h1, h2, h3, p { margin: 0; }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.muted { color: var(--ink-2); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
svg.i { width: 16px; height: 16px; flex: none; }

/* liquid glass (same layers as the widgets) */
.lg { position: relative; }
.lg > .lg-b {
  position: absolute; inset: 0; border-radius: inherit; z-index: 0; pointer-events: none;
  background: var(--tint);
  -webkit-backdrop-filter: blur(14px) saturate(1.35);
  backdrop-filter: blur(14px) saturate(1.35);
}
.lg > .lg-h {
  position: absolute; inset: 0; border-radius: inherit; z-index: 0; pointer-events: none;
  box-shadow:
    inset 0 0 0 .5px var(--edge),
    inset 1px 1px 0 -.25px var(--hi),
    inset -1px -1px 0 -.5px var(--lo),
    0 10px 30px -14px var(--shadow),
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
.lg > :not(.lg-b):not(.lg-h) { position: relative; z-index: 1; }

/* buttons */
.btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 34px; padding: 0 14px; border: 0; border-radius: 10px; cursor: pointer; white-space: nowrap;
  background: var(--hover); color: var(--ink); font-weight: 500; text-decoration: none;
  transition: background .15s, opacity .2s, transform .3s var(--spring);
}
.btn:hover { background: var(--press); }
.btn:active { transform: scale(.97); }
.btn.solid { background: var(--solid); color: var(--on-solid); }
.btn.solid:hover { opacity: .88; }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: var(--hover); }
.btn.small { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 8px; }
.btn.danger { color: var(--err); }
.btn.confirm { background: var(--err-soft); color: var(--err); }
.btn[disabled], .btn[aria-disabled="true"] { opacity: .4; cursor: default; transform: none; }
.btn svg.i { width: 15px; height: 15px; stroke-width: 1.8; }
.ib {
  position: relative; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: var(--ink); cursor: pointer;
  transition: background .15s, opacity .2s, color .2s;
}
.ib:hover { background: var(--hover); }
.ib.dim { opacity: .32; }
.ib.done { color: var(--accent); }
.ib svg.i { width: 16px; height: 16px; stroke-width: 1.6; }
.spin { width: 16px; height: 16px; overflow: visible; }
.spin circle { fill: none; stroke: var(--accent); stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: .25 .75;
  transform-box: fill-box; transform-origin: center; animation: kit-spin .8s linear infinite; }
@keyframes kit-spin { to { transform: rotate(360deg); } }

/* fields */
.field {
  width: 100%; height: 36px; padding: 0 12px; border: 0; border-radius: 10px; outline: none;
  background: var(--field); box-shadow: inset 0 0 0 .5px var(--edge), inset 0 1px 2px var(--line);
  transition: box-shadow .15s;
}
.field:focus { box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft); }
.field.mono { font-family: var(--mono); font-size: 12px; }
.field::placeholder { color: var(--ink-3); }
label.lbl { display: block; font-size: 12px; color: var(--ink-2); margin: 0 0 6px; }

/* switch */
.sw { all: unset; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex: none; }
.sw .tr { position: relative; width: 34px; height: 20px; border-radius: 10px; background: var(--track); transition: background .2s, box-shadow .3s; }
.sw .kn {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 8px; background: var(--thumb);
  box-shadow: 0 1px 2px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04); transition: transform .36s var(--spring), width .2s var(--spring);
}
.sw[aria-checked="true"] .tr { background: var(--accent); }
.sw[aria-checked="true"] .kn { transform: translateX(14px); }
.sw:active .kn { width: 20px; }
.sw[aria-checked="true"]:active .kn { transform: translateX(10px); }
.sw:focus-visible { outline: none; }
.sw:focus-visible .tr { outline: 2px solid var(--accent); outline-offset: 2px; }
.sw.flash .tr { box-shadow: 0 0 0 4px var(--accent-soft); }
.sw[aria-disabled="true"] { opacity: .45; cursor: default; }

/* chips, tags, notes */
.chip {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 7px;
  background: var(--hover); font: 500 11px/1 var(--mono); color: var(--ink-2); white-space: nowrap; text-decoration: none;
}
.chip .d { width: 6px; height: 6px; border-radius: 3px; background: var(--dot); flex: none; }
.chip.accent .d { background: var(--accent); }
.chip.ok .d { background: var(--ink); }
.chip.err { color: var(--err); }
.chip.err .d { background: var(--err); }
.tag { display: inline-block; font: 500 10px/1 var(--mono); padding: 3px 5px; border-radius: 4px; background: var(--hover); color: var(--ink-2); }
.tag.accent { color: var(--accent); background: var(--accent-soft); }
.tag.warn { color: var(--err); background: var(--err-soft); }
.note { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--hover); font-size: 12px; line-height: 1.45; }
.note svg.i { width: 15px; height: 15px; margin-top: 1px; stroke-width: 1.8; }
.note.err { background: var(--err-soft); color: var(--err); }
.note.ok svg.i { color: var(--accent); }
.note:empty { display: none; }

/* motion */
.enter { animation: kit-enter .5s var(--spring) both; }
@keyframes kit-enter { from { opacity: 0; transform: translateY(8px); } }
.fade { animation: kit-fade .25s ease-out both; }
@keyframes kit-fade { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;

let injected = false;
export function injectKitStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'gitchat-kit';
  style.textContent = kitCSS;
  document.head.prepend(style);
}
