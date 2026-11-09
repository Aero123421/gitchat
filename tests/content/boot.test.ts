// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../src/content/controller', () => ({
  Controller: class {
    start = start;
  },
}));
vi.mock('../../src/content/adapters/registry', () => ({
  adapterFor: () => ({ service: 'chatgpt' }),
}));

async function load(): Promise<void> {
  vi.resetModules();
  await import('../../src/content/index');
}

describe('boot', () => {
  afterEach(() => {
    start.mockClear();
    delete (document as Document & { prerendering?: boolean }).prerendering;
  });

  it('starts at once when the document is not prerendering', async () => {
    await load();
    expect(start).toHaveBeenCalledOnce();
  });

  it('starts only after prerenderingchange', async () => {
    Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
    await load();
    expect(start).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(start).toHaveBeenCalledOnce();
  });
});
