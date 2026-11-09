import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshPage } from '../../src/popup/refresh';

let reply: () => unknown;

describe('popup refresh before Commit/Push (b-code H4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { chrome: unknown }).chrome = { tabs: { sendMessage: () => reply() } };
  });
  afterEach(() => vi.useRealTimers());

  it('goes ahead only on an explicit ok from the tab', async () => {
    reply = async () => ({ ok: true });
    expect(await refreshPage(1)).toEqual({ ok: true });
  });

  it('passes the tab’s own reason on', async () => {
    reply = async () => ({ ok: false, error: 'Asset too large' });
    expect(await refreshPage(1)).toEqual({ ok: false, error: 'Asset too large' });
  });

  it('stops when the tab has no gitchat script, rejects, or answers nonsense', async () => {
    reply = async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    expect(await refreshPage(1)).toEqual({ ok: false });
    reply = () => {
      throw new Error('sync failure');
    };
    expect(await refreshPage(1)).toEqual({ ok: false });
    reply = async () => undefined;
    expect(await refreshPage(1)).toEqual({ ok: false });
    reply = async () => ({ staged: 3 });
    expect(await refreshPage(1)).toEqual({ ok: false });
  });

  it('stops when the tab does not answer in time', async () => {
    reply = () => new Promise(() => {});
    const result = refreshPage(1, 4000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toEqual({ ok: false });
  });
});
