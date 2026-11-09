// @vitest-environment happy-dom
// The widgets stay on screen all day: the shared ticker must stop or slow down when nothing moves.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Spring = typeof import('../../src/content/ui/core/spring.js');

async function load(): Promise<Spring> {
  vi.resetModules();
  return import('../../src/content/ui/core/spring.js');
}

/** Frames delivered while `ms` of (fake) time pass. */
function count(ms: number, frames: { n: number }): number {
  const before = frames.n;
  vi.advanceTimersByTime(ms);
  return frames.n - before;
}

describe('frame governor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  });
  afterEach(() => vi.useRealTimers());

  it('stops when every subscriber is settled', async () => {
    const { onFrame } = await load();
    const frames = { n: 0 };
    const stop = onFrame(() => {
      frames.n++;
      return 0;
    });
    count(1000, frames); // the short wake window after subscribing
    expect(count(3000, frames)).toBe(0);
    stop();
  });

  it('runs at the slow rate a subscriber asks for', async () => {
    const { onFrame } = await load();
    const frames = { n: 0 };
    const stop = onFrame(() => {
      frames.n++;
      return 24;
    });
    count(1000, frames);
    const n = count(2000, frames);
    expect(n).toBeGreaterThan(36);
    expect(n).toBeLessThan(52);
    stop();
  });

  it('goes back to full rate on wake() and while a subscriber animates', async () => {
    const { onFrame, wake, FULL } = await load();
    const frames = { n: 0 };
    let animating = false;
    const stop = onFrame(() => {
      frames.n++;
      return animating ? FULL : 0;
    });
    count(1000, frames);
    expect(count(1000, frames)).toBe(0);
    wake(500);
    expect(count(500, frames)).toBeGreaterThan(25);
    animating = true;
    wake(1);
    expect(count(1000, frames)).toBeGreaterThan(55);
    animating = false;
    count(100, frames);
    expect(count(1000, frames)).toBe(0);
    stop();
  });

  it('reports moving springs', async () => {
    const { Spring, moving } = await load();
    const s = new Spring(0, { stiffness: 300, damping: 30 });
    expect(moving([s])).toBe(false);
    s.set(1);
    expect(moving([s])).toBe(true);
    for (let i = 0; i < 240; i++) s.step(1 / 60);
    expect(moving([s])).toBe(false);
  });
});

describe('widgets at rest', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    vi.resetModules();
    // happy-dom has no 2D canvas; the glass lens only needs pixel buffers and a data URL
    const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
  });
  afterEach(() => vi.useRealTimers());

  async function frameRate(variant: 'creature' | 'dot' | 'line'): Promise<number> {
    const { createStore } = await import('../../src/content/ui/demo-store.js');
    const mod = await import(`../../src/content/ui/variants/${variant}.js`);
    const mount = mod[`mount${variant[0]!.toUpperCase()}${variant.slice(1)}`];
    const host = document.createElement('div');
    document.body.append(host);
    const raf = globalThis.requestAnimationFrame;
    let n = 0;
    globalThis.requestAnimationFrame = (cb) => {
      n++;
      return raf(cb);
    };
    const inst = mount(host, createStore(), {});
    vi.advanceTimersByTime(4000); // settle after mounting
    const before = n;
    vi.advanceTimersByTime(2000);
    const rate = (n - before) / 2;
    globalThis.requestAnimationFrame = raf;
    inst.destroy();
    host.remove();
    return rate;
  }

  it('the creature breathes at a low frame rate', async () => {
    // idle acts are random; pin them to the quiet ones (a glance), a hop would legitimately go full rate
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const rate = await frameRate('creature');
    expect(rate).toBeGreaterThan(5);
    expect(rate).toBeLessThanOrEqual(26);
  });

  it('the dot and the line stop drawing', async () => {
    expect(await frameRate('dot')).toBe(0);
    expect(await frameRate('line')).toBe(0);
  });
});
