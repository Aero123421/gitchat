// @vitest-environment happy-dom
// Saving an untracked chat failed: its widget must be able to show why (review 2-2).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('untracked widget after a failed init', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    vi.resetModules();
    // happy-dom has no 2D canvas; the glass lens only needs pixel buffers and a data URL
    const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
  });
  afterEach(() => vi.useRealTimers());

  for (const [variant, handle, key] of [
    ['creature', '.kb', 'click'],
    ['dot', '.orb', 'Enter'],
    ['line', '.cap', 'Enter'],
  ] as const) {
    it(`${variant}: opens the panel with the reason instead of only pointing at the start button`, async () => {
      const { createStore } = await import('../../src/content/ui/demo-store.js');
      const mod = await import(`../../src/content/ui/variants/${variant}.js`);
      const mount = mod[`mount${variant[0]!.toUpperCase()}${variant.slice(1)}`];
      const host = document.createElement('div');
      document.body.append(host);
      const store = createStore();
      store.untrack();
      const inst = mount(host, store, {});
      vi.advanceTimersByTime(500);
      Object.assign(store.state, { tracked: false, phase: 'error', error: 'The history could not be read.' });
      const el = host.shadowRoot!.querySelector<HTMLElement>(handle)!;
      if (key === 'click') el.click();
      else el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      vi.advanceTimersByTime(300);
      const panel = host.shadowRoot!.querySelector('.panel')!;
      expect(panel.classList.contains('open')).toBe(true);
      expect(panel.querySelector('.msg')?.textContent).toBe('The history could not be read.');
      inst.destroy();
      host.remove();
    });
  }
});
