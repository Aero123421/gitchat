// The gitchat mark: the creature as a dark glass bead. Its eyes follow the pointer a little and
// blink now and then — quiet signs of life, nothing more.

import { Spring, onFrame, clamp } from '../../content/ui/core/spring.js';
import { s } from './dom';

export function createMark(size = 56, live = true): SVGSVGElement {
  const eyeL = s('rect', { x: -9.5, y: -6.5, width: 5, height: 13, rx: 2.5, fill: '#f5f5f7' });
  const eyeR = s('rect', { x: 4.5, y: -6.5, width: 5, height: 13, rx: 2.5, fill: '#f5f5f7' });
  const face = s('g', {}, eyeL, eyeR);
  const svg = s(
    'svg',
    { class: 'mark', viewBox: '-32 -32 64 64', width: size, height: size, 'aria-hidden': 'true' },
    s('defs', {}, s('radialGradient', { id: 'mk-g', cx: '.32', cy: '.22', r: '.9' },
      s('stop', { offset: '0', 'stop-color': '#3a3a40' }),
      s('stop', { offset: '.55', 'stop-color': '#1b1b1f' }),
      s('stop', { offset: '1', 'stop-color': '#121214' }))),
    s('circle', { r: 29, fill: 'url(#mk-g)' }),
    s('circle', { r: 28.6, fill: 'none', stroke: 'rgba(255,255,255,.22)', 'stroke-width': 0.8 }),
    s('path', { d: 'M-17 -19a24 24 0 0 1 22 -6', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }),
    face,
    s('circle', { cx: 15.5, cy: 16, r: 3.4, fill: '#0a84ff' }),
  );
  if (!live) return svg;

  const lx = new Spring(0, { stiffness: 260, damping: 26 });
  const ly = new Spring(0, { stiffness: 260, damping: 26 });
  const lid = new Spring(1, { stiffness: 1100, damping: 48 });
  let px = 0;
  let py = 0;
  let has = false;
  let nextBlink = performance.now() + 2200;
  const onMove = (e: PointerEvent) => {
    px = e.clientX;
    py = e.clientY;
    has = true;
  };
  addEventListener('pointermove', onMove, { passive: true });
  const stop = onFrame((dt: number) => {
    if (!svg.isConnected) {
      stop();
      removeEventListener('pointermove', onMove);
      return;
    }
    if (has) {
      const r = svg.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2);
      const dy = py - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 160);
      lx.set((dx / d) * k * 3.2);
      ly.set((dy / d) * k * 2.6);
    }
    const now = performance.now();
    if (now > nextBlink) {
      lid.set(0.08);
      setTimeout(() => lid.set(1), 95);
      nextBlink = now + 2600 + Math.random() * 3800;
    }
    lx.step(dt);
    ly.step(dt);
    lid.step(dt);
    const hgt = 13 * clamp(lid.value, 0.06, 1);
    for (const e of [eyeL, eyeR]) {
      e.setAttribute('height', hgt.toFixed(2));
      e.setAttribute('y', (-hgt / 2).toFixed(2));
    }
    face.setAttribute('transform', `translate(${lx.value.toFixed(2)} ${ly.value.toFixed(2)})`);
  });
  return svg;
}
