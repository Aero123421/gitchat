// The gitchat mark: the creature as a frosted-glass bead, the same as the on-page widget and the
// extension icon, in the page's light or dark theme. Its eyes follow the pointer a little and blink
// now and then — quiet signs of life, nothing more. Frames run only while the eyes move.

import { Spring, onFrame, clamp, wake, moving, motion, FULL } from '../../content/ui/core/spring.js';
import { CREATURE_VARS, creatureSVG } from '../../shared/creature-art.js';

export function createMark(size = 56, live = true): SVGSVGElement {
  const markup = creatureSVG({ colors: CREATURE_VARS, detail: size <= 32 ? 'small' : 'full', size, className: 'mark' });
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  if (!live) return svg;

  const face = svg.querySelector<SVGGElement>('.cr-face');
  const eyes = Array.from(svg.querySelectorAll<SVGRectElement>('.cr-eye'));
  if (!face || !eyes.length) return svg;
  const eyeH = Number(eyes[0]!.getAttribute('height'));
  const [fx, fy] = (face.getAttribute('transform')?.match(/-?[\d.]+/g) ?? ['32', '27']).map(Number) as [number, number];

  // reduced motion: a still picture
  if (motion.reduced) return svg;

  const lx = new Spring(0, { stiffness: 260, damping: 26 });
  const ly = new Spring(0, { stiffness: 260, damping: 26 });
  const lid = new Spring(1, { stiffness: 1100, damping: 48 });
  let px = 0;
  let py = 0;
  let has = false;
  let blinkTimer = 0;
  const onMove = (e: PointerEvent) => {
    px = e.clientX;
    py = e.clientY;
    has = true;
    wake(500);
  };
  const cleanup = () => {
    clearTimeout(blinkTimer);
    removeEventListener('pointermove', onMove);
    stop();
  };
  // blinks are timed outside the frame loop, which sleeps while nothing moves
  const blink = () => {
    if (!svg.isConnected) return cleanup();
    lid.set(0.08);
    wake(400);
    setTimeout(() => lid.set(1), 95);
    blinkTimer = window.setTimeout(blink, 2600 + Math.random() * 3800);
  };
  blinkTimer = window.setTimeout(blink, 2200);
  addEventListener('pointermove', onMove, { passive: true });
  const stop = onFrame((dt: number) => {
    if (!svg.isConnected) {
      cleanup();
      return 0;
    }
    if (has) {
      const r = svg.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2);
      const dy = py - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 160);
      lx.set((dx / d) * k * 2.4);
      ly.set((dy / d) * k * 2);
    }
    lx.step(dt);
    ly.step(dt);
    lid.step(dt);
    const hgt = eyeH * clamp(lid.value, 0.06, 1);
    for (const e of eyes) {
      e.setAttribute('height', hgt.toFixed(2));
      e.setAttribute('y', (-hgt / 2).toFixed(2));
    }
    face.setAttribute('transform', `translate(${(fx + lx.value).toFixed(2)} ${(fy + ly.value).toFixed(2)})`);
    // frames only while the eyes move; input and blinks wake the ticker again
    return moving([lx, ly, lid]) ? FULL : 0;
  });
  return svg;
}
