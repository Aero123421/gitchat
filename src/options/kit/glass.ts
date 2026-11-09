// Liquid glass for page elements: adds the backdrop/highlight layers, the refraction lens (sized to
// the element and refreshed when it resizes), and a highlight that leans toward the pointer.

import { applyLens, setLight } from '../../content/ui/core/glass.js';

const tracked = new Set<HTMLElement>();
let lastX = -1e4;
let lastY = -1e4;
let raf = 0;

function updateLights(): void {
  raf = 0;
  for (const el of tracked) {
    if (!el.isConnected) {
      tracked.delete(el);
      continue;
    }
    const r = el.getBoundingClientRect();
    if (lastX < -1e3) setLight(el, -0.6, -0.8);
    else setLight(el, lastX - (r.left + r.width / 2), lastY - (r.top + r.height / 2));
  }
}

addEventListener(
  'pointermove',
  (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(updateLights);
  },
  { passive: true },
);

export interface GlassOptions {
  /** Corner radius in px, used for the refraction map. */
  radius: number;
  /** Strength of the edge refraction. */
  scale?: number;
  /** Width of the refracting rim in px. */
  bezel?: number;
  blur?: number;
}

/** Turn an element into a glass surface. Returns the element for chaining. */
export function glass<T extends HTMLElement>(el: T, opts: GlassOptions): T {
  el.classList.add('lg');
  el.style.borderRadius = `${opts.radius}px`;
  const b = document.createElement('div');
  b.className = 'lg-b';
  const hl = document.createElement('div');
  hl.className = 'lg-h';
  el.prepend(b, hl);
  tracked.add(el);
  let key = '';
  const refresh = () => {
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 8 || h < 8) return;
    // Regenerating the lens is not free; only do it when the size meaningfully changes.
    const k = `${Math.round(w / 6)}x${Math.round(h / 6)}`;
    if (k === key) return;
    key = k;
    applyLens(document.body, b, {
      w,
      h,
      r: Math.min(opts.radius, w / 2, h / 2),
      bezel: opts.bezel ?? 14,
      scale: opts.scale ?? 22,
      blur: opts.blur ?? 10,
      sat: 1.35,
      bright: 1.03,
    });
  };
  const ro = new ResizeObserver(() => refresh());
  ro.observe(el);
  requestAnimationFrame(() => {
    refresh();
    updateLights();
  });
  return el;
}
