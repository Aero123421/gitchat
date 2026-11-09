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

const subs = new Set();
let raf = 0;
let last = 0;

function loop(now) {
  const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
  last = now;
  const t = now / 1000;
  for (const fn of [...subs]) fn(dt, t);
  raf = subs.size ? requestAnimationFrame(loop) : 0;
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

export function onFrame(fn) {
  subs.add(fn);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
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
