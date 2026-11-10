// @vitest-environment happy-dom
// A fast scroll sends a scroll event every frame. The creature lags behind the page, but the lag
// must not add up and carry it off screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/content/ui/demo-store.js';
import { advance } from '../../src/content/ui/core/spring.js';
import { mountCreature } from '../../src/content/ui/variants/creature.js';

const HY = 112; // the body's resting centre in its box (creature.js)

describe('creature while the page scrolls fast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    window.innerWidth = 1280;
    window.innerHeight = 800;
    const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('stays near its place however many scroll events arrive', () => {
    const host = document.createElement('gitchat-ui');
    document.body.append(host);
    const page = document.createElement('div');
    document.body.append(page);
    let top = 0;
    Object.defineProperty(page, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    const inst = mountCreature(host, createStore(), {});
    try {
      const body = host.shadowRoot!.querySelector('.body')!;
      let furthest = 0;
      for (let i = 0; i < 90; i++) {
        top += i < 45 ? 600 : -600; // flick down, then up
        page.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(16);
        advance(1 / 60);
        furthest = Math.max(furthest, Math.abs(Number(body.getAttribute('cy')) - HY));
      }
      expect(furthest).toBeGreaterThan(2); // it does react
      expect(furthest).toBeLessThan(24); // the lag plus the squash, nowhere near off screen
      advance(2);
      expect(Math.abs(Number(body.getAttribute('cy')) - HY)).toBeLessThan(3);
    } finally {
      inst.destroy();
      host.remove();
    }
  });
});
