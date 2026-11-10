// A token is stored or used only after chrome.storage.local is limited to trusted contexts.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceFlow, clearAuth, identify, loadAuth, saveAuth } from '../../src/background/github/auth';
import type { AuthState } from '../../src/shared/types';
import { installChrome } from './chrome-stub';

const auth: AuthState = { token: 'secret', method: 'pat', login: 'octo', scopes: ['repo'], savedAt: 1 };

beforeEach(() => {
  installChrome();
});

describe('manifest', () => {
  it('requires Chrome 140, the first stable release with local setAccessLevel', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../src/manifest.json', import.meta.url), 'utf8')) as { minimum_chrome_version: string };
    expect(manifest.minimum_chrome_version).toBe('140');
  });
});

describe('token storage', () => {
  it('does not store a token until local storage is restricted', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    chrome.storage.local.setAccessLevel = (access) => {
      order.push(`restrict:${access.accessLevel}`);
      return gate;
    };
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async (items) => {
      order.push('set');
      return set(items);
    };
    const pending = saveAuth(auth);
    await vi.waitFor(() => expect(order).toEqual(['restrict:TRUSTED_CONTEXTS']));
    expect(await chrome.storage.local.get('auth')).toEqual({});
    release();
    await pending;
    expect(order).toEqual(['restrict:TRUSTED_CONTEXTS', 'set']);
    expect((await chrome.storage.local.get('auth')).auth).toMatchObject({ token: 'secret' });
  });

  it('does not return a stored token until local storage is restricted', async () => {
    await chrome.storage.local.set({ auth });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let level: unknown;
    chrome.storage.local.setAccessLevel = (access) => {
      level = access;
      return gate;
    };
    let settled = false;
    const pending = loadAuth().then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(level).toEqual({ accessLevel: 'TRUSTED_CONTEXTS' }));
    expect(settled).toBe(false);
    release();
    await expect(pending).resolves.toMatchObject({ token: 'secret' });
  });

  it('removes a saved token and rejects when local storage cannot be restricted', async () => {
    await chrome.storage.local.set({ auth: { ...auth, token: 'old' } });
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    const set = vi.spyOn(chrome.storage.local, 'set');
    await expect(saveAuth(auth)).rejects.toThrow('local blocked');
    await expect(loadAuth()).rejects.toThrow('local blocked');
    expect(set).not.toHaveBeenCalled();
    expect(await chrome.storage.local.get('auth')).toEqual({});
  });

  it('reports both the restriction failure and a failed delete', async () => {
    await chrome.storage.local.set({ auth: { ...auth, token: 'old' } });
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    chrome.storage.local.remove = () => Promise.reject(new Error('remove blocked'));
    const set = vi.spyOn(chrome.storage.local, 'set');
    try {
      await saveAuth(auth);
      expect.fail('saveAuth should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const reasons = (error as AggregateError).errors.map((reason) => (reason instanceof Error ? reason.message : String(reason)));
      expect(reasons).toEqual(['local blocked', 'remove blocked']);
    }
    expect(set).not.toHaveBeenCalled();
    expect((await chrome.storage.local.get('auth')).auth).toMatchObject({ token: 'old' });
  });

  it('still deletes a saved token on sign-out when restriction would fail', async () => {
    await chrome.storage.local.set({ auth });
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    await clearAuth();
    expect(await chrome.storage.local.get('auth')).toEqual({});
  });

  it('does not send a token to GitHub when local storage cannot be restricted', async () => {
    const fetchImpl = vi.fn();
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    await expect(identify('tok', { fetch: fetchImpl })).rejects.toThrow('local blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty token before restricting storage', async () => {
    const level = vi.fn();
    chrome.storage.local.setAccessLevel = level;
    await expect(identify('  ')).rejects.toMatchObject({ code: 'invalid' });
    expect(level).not.toHaveBeenCalled();
  });

  it('does not begin device sign-in when local storage cannot be restricted', async () => {
    const fetchImpl = vi.fn();
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    const flow = new DeviceFlow(fetchImpl);
    await expect(flow.start('')).rejects.toMatchObject({ code: 'no-client-id' });
    await expect(flow.start('Iv1.test')).rejects.toThrow('local blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not exchange a pending device code when local storage cannot be restricted', async () => {
    const fetchImpl = vi.fn();
    await chrome.storage.session.set({
      deviceFlow: { id: '1', clientId: 'Iv1.test', deviceCode: 'dc', interval: 0, expiresAt: Date.now() + 60_000 },
    });
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    const flow = new DeviceFlow(fetchImpl, async () => undefined);
    await expect(flow.wait()).rejects.toThrow('local blocked');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
