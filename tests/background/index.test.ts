// Listeners stay unregistered until local and sync storage are limited to trusted contexts.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../src/shared/types';
import { installChrome } from './chrome-stub';

const auth: AuthState = { token: 'secret', method: 'pat', login: 'octo', scopes: ['repo'], savedAt: 1 };
const LISTENERS = ['message', 'connect', 'alarm', 'startup', 'installed', 'storage'];

function installWorkerChrome() {
  vi.resetModules();
  const added: string[] = [];
  const stub = installChrome();
  const listen = (name: string) => ({ addListener: () => added.push(name) });
  Object.assign(stub.runtime, {
    onMessage: listen('message'),
    onConnect: listen('connect'),
    onStartup: listen('startup'),
    onInstalled: listen('installed'),
  });
  Object.assign(stub.alarms, { onAlarm: listen('alarm') });
  const onChanged = stub.storage.onChanged.addListener.bind(stub.storage.onChanged);
  stub.storage.onChanged.addListener = (listener) => {
    added.push('storage');
    return onChanged(listener);
  };
  return { added };
}

describe('service worker startup', () => {
  it('registers listeners only after local and sync storage are restricted', async () => {
    const { added } = installWorkerChrome();
    let releaseLocal!: () => void;
    let releaseSync!: () => void;
    const localGate = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });
    const calls: string[] = [];
    chrome.storage.local.setAccessLevel = (access) => {
      calls.push(`local:${access.accessLevel}`);
      return localGate;
    };
    chrome.storage.sync.setAccessLevel = (access) => {
      calls.push(`sync:${access.accessLevel}`);
      return syncGate;
    };
    const starting = import('../../src/background/index');
    await vi.waitFor(() => expect(calls).toEqual(['local:TRUSTED_CONTEXTS', 'sync:TRUSTED_CONTEXTS']));
    expect(added).toEqual([]);
    releaseLocal();
    await Promise.resolve();
    expect(added).toEqual([]);
    releaseSync();
    await starting;
    expect(added).toEqual(LISTENERS);
  });

  it('does not register listeners and drops a saved token when local restriction fails', async () => {
    const { added } = installWorkerChrome();
    await chrome.storage.local.set({ auth });
    chrome.storage.local.setAccessLevel = () => Promise.reject(new Error('local blocked'));
    await expect(import('../../src/background/index')).rejects.toThrow('local blocked');
    expect(added).toEqual([]);
    expect(await chrome.storage.local.get('auth')).toEqual({});
  });

  it('does not register listeners when sync restriction fails', async () => {
    const { added } = installWorkerChrome();
    await chrome.storage.local.set({ auth });
    chrome.storage.sync.setAccessLevel = () => Promise.reject(new Error('sync blocked'));
    await expect(import('../../src/background/index')).rejects.toThrow('sync blocked');
    expect(added).toEqual([]);
    // Local restriction succeeded, so the token is no longer readable by content scripts.
    expect((await chrome.storage.local.get('auth')).auth).toMatchObject({ token: 'secret' });
  });
});
