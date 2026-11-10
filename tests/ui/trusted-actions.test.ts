// @vitest-environment happy-dom
// Host pages share the DOM with the content script and can reach into the open shadow
// root. Git actions must ignore those synthetic events and run only for event.isTrusted.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../src/content/ui/demo-store.js';
import { pointer } from '../../src/content/ui/core/pointer.js';
import { advance } from '../../src/content/ui/core/spring.js';
import { mountCreature } from '../../src/content/ui/variants/creature.js';
import { mountDot } from '../../src/content/ui/variants/dot.js';
import { mountLine } from '../../src/content/ui/variants/line.js';

const BW = 150;

function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, 'isTrusted', { configurable: true, value: true });
  return event;
}

function click(el: HTMLElement, user: boolean) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(user ? trusted(event) : event);
  if (!user) el.click();
}

function pointerAt(type: string, x: number, y: number, user: boolean) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
  return user ? trusted(event) : event;
}

function arm(store: ReturnType<typeof createStore>) {
  return {
    init: vi.spyOn(store, 'init').mockImplementation(() => {}),
    cancelInit: vi.spyOn(store, 'cancelInit').mockImplementation(() => {}),
    commit: vi.spyOn(store, 'commit').mockImplementation(() => {}),
    push: vi.spyOn(store, 'push').mockImplementation(() => {}),
    setAuto: vi.spyOn(store, 'setAuto').mockImplementation(() => {}),
    copyMarkdown: vi.spyOn(store, 'copyMarkdown').mockResolvedValue(true),
  };
}

describe('widget git actions require trusted user input', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    window.innerWidth = 1280;
    window.innerHeight = 800;
    document.documentElement.dispatchEvent(new Event('pointerleave'));
    const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  for (const [variant, mount] of [
    ['creature', mountCreature],
    ['dot', mountDot],
    ['line', mountLine],
  ] as const) {
    it(`${variant}: a synthetic click does not call commit, push, init, or setAuto; a trusted click does`, () => {
      const host = document.createElement('gitchat-ui');
      document.body.append(host);
      const store = createStore();
      const spies = arm(store);
      const inst = mount(host, store, {});
      try {
        const root = host.shadowRoot;
        expect(root?.mode).toBe('open');
        const q = (sel: string) => {
          const el = root?.querySelector<HTMLElement>(sel);
          if (!el) throw new Error(`${variant}: missing ${sel}`);
          return el;
        };

        for (const sel of ['.ab.commit', '.ab.push', '.ab.start', '.ab.cancel', '.ib.commit', '.ib.push', '.ib.md', '.sw[data-k="autoCommit"]', '.sw[data-k="autoPush"]']) {
          click(q(sel), false);
        }
        expect(spies.commit).not.toHaveBeenCalled();
        expect(spies.push).not.toHaveBeenCalled();
        expect(spies.init).not.toHaveBeenCalled();
        expect(spies.cancelInit).not.toHaveBeenCalled();
        expect(spies.setAuto).not.toHaveBeenCalled();
        expect(spies.copyMarkdown).not.toHaveBeenCalled();

        click(q('.ab.commit'), true);
        click(q('.ab.push'), true);
        click(q('.ab.start'), true);
        click(q('.ab.cancel'), true);
        click(q('.ib.commit'), true);
        click(q('.ib.push'), true);
        click(q('.sw[data-k="autoCommit"]'), true);
        click(q('.sw[data-k="autoPush"]'), true);
        click(q('.ib.md'), true);

        expect(spies.commit).toHaveBeenCalledTimes(2);
        expect(spies.push).toHaveBeenCalledTimes(2);
        expect(spies.init).toHaveBeenCalledTimes(1);
        expect(spies.cancelInit).toHaveBeenCalledTimes(1);
        expect(spies.setAuto).toHaveBeenCalledTimes(2);
        expect(spies.setAuto).toHaveBeenNthCalledWith(1, 'autoCommit', true);
        expect(spies.setAuto).toHaveBeenNthCalledWith(2, 'autoPush', true);
        expect(spies.copyMarkdown).toHaveBeenCalledTimes(1);
      } finally {
        inst.destroy();
        host.remove();
      }
    });
  }

  it('panel: rewriting data-k does not retarget a trusted auto switch', () => {
    const host = document.createElement('gitchat-ui');
    document.body.append(host);
    const store = createStore();
    const spies = arm(store);
    const inst = mountDot(host, store, {});
    try {
      const sw = host.shadowRoot?.querySelector<HTMLElement>('.sw[data-k="autoCommit"]');
      if (!sw) throw new Error('missing autoCommit switch');
      sw.dataset.k = 'autoPush';
      click(sw, false);
      expect(spies.setAuto).not.toHaveBeenCalled();
      click(sw, true);
      expect(spies.setAuto).toHaveBeenCalledTimes(1);
      expect(spies.setAuto).toHaveBeenCalledWith('autoCommit', true);
    } finally {
      inst.destroy();
      host.remove();
    }
  });

  it('line: a synthetic pointerup does not commit or push; a trusted pointerup does', () => {
    const host = document.createElement('gitchat-ui');
    document.body.append(host);
    const store = createStore();
    expect(store.state.staged.length).toBeGreaterThan(0);
    expect(store.ahead).toBeGreaterThan(0);
    const spies = arm(store);
    const inst = mountLine(host, store, {});
    try {
      const root = host.shadowRoot;
      if (!root) throw new Error('line has no shadow root');
      const cap = root.querySelector<HTMLElement>('.cap');
      if (!cap) throw new Error('line has no capsule');
      advance(1);

      const screen = (localX: number, localY: number) => ({
        x: window.innerWidth - BW + localX,
        y: parseFloat((root.querySelector('.box') as HTMLElement).style.top) + localY,
      });
      const hover = (local: () => { x: number; y: number }) => {
        let point = { x: 0, y: 0 };
        for (let i = 0; i < 45; i++) {
          point = screen(local().x, local().y);
          window.dispatchEvent(pointerAt('pointermove', point.x, point.y, false));
          advance(1 / 60);
        }
        return point;
      };
      const gesture = (point: { x: number; y: number }, userDown: boolean, userUp: boolean) => {
        cap.dispatchEvent(pointerAt('pointerdown', point.x, point.y, userDown));
        cap.dispatchEvent(pointerAt('pointerup', point.x, point.y, userUp));
      };

      const work = hover(() => {
        const bead = root.querySelector('.bd.work');
        const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(bead?.getAttribute('transform') ?? '');
        if (!m?.[1] || !m[2]) throw new Error('work bead has no position');
        return { x: Number(m[1]), y: Number(m[2]) };
      });
      expect(pointer.active).toBe(true);

      gesture(work, false, false);
      gesture(work, false, true);
      gesture(work, true, false);
      expect(spies.commit).not.toHaveBeenCalled();
      expect(spies.push).not.toHaveBeenCalled();
      gesture(work, true, true);
      expect(spies.commit).toHaveBeenCalledTimes(1);
      expect(spies.push).not.toHaveBeenCalled();

      const origin = hover(() => {
        const line = root.querySelector('.origin');
        const y = Number(line?.getAttribute('y1'));
        const x1 = Number(line?.getAttribute('x1'));
        const x2 = Number(line?.getAttribute('x2'));
        if (!Number.isFinite(y) || !Number.isFinite(x1) || !Number.isFinite(x2)) throw new Error('origin line has no position');
        return { x: (x1 + x2) / 2, y };
      });
      gesture(origin, false, true);
      gesture(origin, true, false);
      expect(spies.push).not.toHaveBeenCalled();
      gesture(origin, true, true);
      expect(spies.push).toHaveBeenCalledTimes(1);
      expect(spies.commit).toHaveBeenCalledTimes(1);
    } finally {
      inst.destroy();
      host.remove();
    }
  });
});
