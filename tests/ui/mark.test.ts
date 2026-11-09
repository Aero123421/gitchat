// @vitest-environment happy-dom
// The settings page's creature: it must keep blinking and looking around after the shared ticker
// has gone to sleep, and must not keep the ticker running while still.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('settings page mark', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    vi.resetModules();
    // blinks come every 2.6–6.4 s at random: fix them (first at 2.2 s, then every 4.5 s)
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('blinks and follows the pointer after the ticker slept, then sleeps again', async () => {
    const { createMark } = await import('../../src/options/kit/mark');
    const spring = await import('../../src/content/ui/core/spring.js');
    let frames = 0;
    const count = spring.onFrame(() => {
      frames++;
      return 0;
    });
    const svg = createMark(80);
    document.body.appendChild(svg);
    const eye = () => Number(svg.querySelector('.cr-eye')!.getAttribute('height'));
    const face = () => svg.querySelector('.cr-face')!.getAttribute('transform');
    vi.advanceTimersByTime(1500);
    // asleep: no frames
    frames = 0;
    vi.advanceTimersByTime(300);
    expect(frames).toBe(0);
    // a blink wakes it: the eye closes, then opens again
    const open = eye();
    let closed = open;
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(20);
      closed = Math.min(closed, eye());
    }
    vi.advanceTimersByTime(7000);
    expect(closed).toBeLessThan(open / 2);
    expect(eye()).toBeCloseTo(open, 1);
    // the pointer wakes it too: the eyes move toward it
    const before = face();
    dispatchEvent(new PointerEvent('pointermove', { clientX: 900, clientY: 500 }));
    vi.advanceTimersByTime(600);
    expect(face()).not.toBe(before);
    count();
  });
});
