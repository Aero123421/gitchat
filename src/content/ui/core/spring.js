// Damped spring + shared animation ticker.

export class Spring {
  constructor(value = 0, { stiffness = 170, damping = 20, mass = 1 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.k = stiffness;
    this.c = damping;
    this.m = mass;
  }
  set(target) {
    this.target = target;
    return this;
  }
  snap(v = this.target) {
    this.value = this.target = v;
    this.velocity = 0;
    return this;
  }
  kick(v) {
    this.velocity += v;
    return this;
  }
  config(stiffness, damping) {
    this.k = stiffness;
    this.c = damping;
    return this;
  }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.value - this.target) - this.c * this.velocity) / this.m;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
}

// ---- shared ticker with a frame governor
//
// The widgets stay on screen for hours, so frames are not free. Each subscriber returns how many
// frames per second it wants next: FULL while something moves, a low rate for slow ambient motion
// (breathing), 0 when it is settled. The ticker runs at the highest rate asked for, and stops when
// nobody needs frames. Input near a widget, store events and acts call wake() for full rate.

export const FULL = 60;

const subs = new Set();
let raf = 0;
let timer = 0;
let last = 0;
let wakeUntil = 0;

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
/** User preference: no ambient motion, no decorative movement. */
export const motion = {
  get reduced() {
    return !!reducedQuery?.matches;
  },
};

function loop(now) {
  raf = 0;
  // frames can be far apart in the low-rate modes; springs sub-step, so a larger dt is safe
  const dt = Math.min(0.12, Math.max(0, (now - last) / 1000));
  last = now;
  const t = now / 1000;
  let want = now < wakeUntil ? FULL : 0;
  for (const fn of [...subs]) {
    const r = fn(dt, t);
    want = Math.max(want, r === true ? FULL : typeof r === 'number' ? r : 0);
  }
  if (subs.size && want > 0) schedule(want);
}

function schedule(fps) {
  if (raf) return;
  if (fps >= 45) {
    clearTimeout(timer);
    timer = 0;
    raf = requestAnimationFrame(loop);
  } else if (!timer) {
    timer = setTimeout(() => {
      timer = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    }, 1000 / fps);
  }
}

/** Full frame rate for at least `ms` (input, state changes). */
export function wake(ms = 1200) {
  wakeUntil = Math.max(wakeUntil, performance.now() + ms);
  if (!subs.size) return;
  if (!raf && !timer) last = performance.now();
  schedule(FULL);
}

/** True while any of the springs is still moving or away from its target. */
export function moving(springs, eps = 0.004) {
  for (const s of springs) if (Math.abs(s.velocity) > eps || Math.abs(s.value - s.target) > eps) return true;
  return false;
}

// Debug: run frames by hand (rAF pauses while the page is hidden).
export function advance(seconds, fps = 60) {
  const n = Math.round(seconds * fps);
  let t = performance.now() / 1000;
  for (let i = 0; i < n; i++) {
    t += 1 / fps;
    for (const fn of [...subs]) fn(1 / fps, t);
  }
}

/**
 * Subscribe to frames. `fn(dt, t)` returns the frame rate it wants next: FULL (or true) while
 * animating, a small number for slow ambient motion, 0/nothing when settled.
 */
export function onFrame(fn) {
  subs.add(fn);
  wake(300);
  return () => subs.delete(fn);
}

// CSS linear() easing that follows a spring curve.
export function springEasing({ stiffness = 200, damping = 20, mass = 1 } = {}) {
  let x = 0;
  let v = 0;
  let t = 0;
  const dt = 1 / 600;
  const vals = [0];
  while (t < 4) {
    for (let i = 0; i < 10; i++) {
      const a = (-stiffness * (x - 1) - damping * v) / mass;
      v += a * dt;
      x += v * dt;
      t += dt;
    }
    vals.push(x);
    if (t > 0.1 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
  }
  vals[vals.length - 1] = 1;
  const step = Math.max(1, Math.ceil(vals.length / 90));
  const pts = [];
  for (let i = 0; i < vals.length; i += step) pts.push(+vals[i].toFixed(4));
  if (pts[pts.length - 1] !== 1) pts.push(1);
  return { easing: `linear(${pts.join(',')})`, duration: Math.round(t * 1000) };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
