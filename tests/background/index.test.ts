// Worker listeners register immediately, but no app work runs before storage is trusted-only.
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { AuthState } from '../../src/shared/types';
import { EXTENSION_PAGE, installChrome } from './chrome-stub';

const app = vi.hoisted(() => ({
  start: vi.fn(),
  onMessage: vi.fn(),
  onConnect: vi.fn(),
  onAlarm: vi.fn(),
  onStartup: vi.fn(),
  onInstalled: vi.fn(),
  onSettingsStored: vi.fn(),
}));
vi.mock('../../src/background/app', () => ({ createBackground: () => app }));

const auth: AuthState = { token: 'secret', method: 'pat', login: 'octo', scopes: ['repo'], savedAt: 1 };
const LISTENERS = ['message', 'connect', 'alarm', 'startup', 'installed', 'storage'] as const;

function installWorkerChrome() {
  vi.resetModules();
  vi.clearAllMocks();
  const added: string[] = [];
  const handlers: Record<string, (...args: any[]) => any> = {};
  const stub = installChrome();
  const listen = (name: string) => ({ addListener: (fn: (...args: any[]) => any) => {
    added.push(name);
    handlers[name] = fn;
  } });
  Object.assign(stub.runtime, {
    onMessage: listen('message'),
    onConnect: listen('connect'),
    onStartup: listen('startup'),
    onInstalled: listen('installed'),
  });
  Object.assign(stub.alarms, { onAlarm: listen('alarm') });
  const onChanged = stub.storage.onChanged.addListener.bind(stub.storage.onChanged);
  stub.storage.onChanged.addListener = (listener) => {
    listen('storage').addListener(listener);
    return onChanged(listener);
  };
  return { added, handlers };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

afterEach(() => vi.restoreAllMocks());

describe('service worker startup', () => {
  it('bundles the complete worker graph without top-level await', async () => {
    await expect(build({
      entryPoints: ['src/background/index.ts'],
      bundle: true,
      format: 'esm',
      target: 'chrome120',
      supported: { 'top-level-await': false },
      write: false,
      logLevel: 'silent',
    })).resolves.toMatchObject({ errors: [] });
  });

  it('registers synchronously and queues every handler until both restrictions succeed', async () => {
    const { added, handlers } = installWorkerChrome();
    const local = gate();
    const sync = gate();
    chrome.storage.local.setAccessLevel = () => local.promise;
    chrome.storage.sync.setAccessLevel = () => sync.promise;
    // Import must finish even with both restrictions pending.
    await import('../../src/background/index');
    expect(added).toEqual(LISTENERS);
    const message = { gitchat: 1, type: 'auth/get', payload: {} };
    const reply = vi.fn();
    const port = { disconnect: vi.fn() };
    const alarm = { name: 'gitchat:push-retry' };
    const details = { reason: 'install' };
    expect(handlers.message!(message, EXTENSION_PAGE, reply)).toBe(true);
    expect(handlers.message!({}, EXTENSION_PAGE, reply)).toBe(false);
    expect(handlers.message!(message, { id: 'other' }, reply)).toBe(false);
    handlers.connect!(port);
    handlers.alarm!(alarm);
    handlers.startup!();
    handlers.installed!(details);
    handlers.storage!({ settings: { oldValue: DEFAULT_SETTINGS } }, 'sync');
    for (const fn of Object.values(app)) expect(fn).not.toHaveBeenCalled();
    local.release();
    await Promise.resolve();
    for (const fn of Object.values(app)) expect(fn).not.toHaveBeenCalled();
    app.onMessage.mockImplementationOnce((_msg, _sender, respond) => {
      respond({ ok: true, data: null });
      return true;
    });
    sync.release();
    await vi.waitFor(() => expect(app.start).toHaveBeenCalledOnce());
    expect(app.onMessage).toHaveBeenCalledExactlyOnceWith(message, EXTENSION_PAGE, reply);
    expect(reply).toHaveBeenCalledWith({ ok: true, data: null });
    expect(app.onConnect).toHaveBeenCalledExactlyOnceWith(port);
    expect(app.onAlarm).toHaveBeenCalledExactlyOnceWith(alarm);
    expect(app.onStartup).toHaveBeenCalledOnce();
    expect(app.onInstalled).toHaveBeenCalledExactlyOnceWith(details);
    expect(app.onSettingsStored).toHaveBeenCalledExactlyOnceWith(DEFAULT_SETTINGS);
    expect(port.disconnect).not.toHaveBeenCalled();
  });

  it.each(['local', 'sync'] as const)('keeps listeners but refuses work when %s restriction fails', async (area) => {
    const { added, handlers } = installWorkerChrome();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await chrome.storage.local.set({ auth });
    const restriction = gate();
    chrome.storage[area].setAccessLevel = async () => {
      await restriction.promise;
      throw new Error(`${area} blocked`);
    };
    await import('../../src/background/index');
    expect(added).toEqual(LISTENERS);
    const reply = vi.fn();
    const port = { disconnect: vi.fn() };
    expect(handlers.message!({ gitchat: 1, type: 'auth/get', payload: {} }, EXTENSION_PAGE, reply)).toBe(true);
    handlers.connect!(port);
    handlers.alarm!({ name: 'gitchat:push-retry' });
    handlers.startup!();
    handlers.installed!({ reason: 'install' });
    handlers.storage!({ settings: { oldValue: DEFAULT_SETTINGS } }, 'sync');
    restriction.release();
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, error: `${area} blocked` }));
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalled();
    for (const fn of Object.values(app)) expect(fn).not.toHaveBeenCalled();
    if (area === 'local') expect(await chrome.storage.local.get('auth')).toEqual({});
    else expect((await chrome.storage.local.get('auth')).auth).toEqual(auth);
  });
});
