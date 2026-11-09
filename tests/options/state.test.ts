// Settings on the settings page: what is shown is always the saved settings plus the changes still
// being saved, so failed saves never leave another change's value on screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';

type Pending = { patch: Partial<Settings>; resolve: (s: Settings) => void; reject: (e: Error) => void };

async function setup() {
  vi.resetModules();
  const calls: Pending[] = [];
  let saved: Settings = { ...DEFAULT_SETTINGS };
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (env: { type: string; payload: { patch?: Partial<Settings> } }) => {
        if (env.type === 'settings/get') return Promise.resolve({ ok: true, data: saved });
        if (env.type === 'settings/set')
          return new Promise((res) => {
            calls.push({
              patch: env.payload.patch ?? {},
              resolve: (s) => res({ ok: true, data: s }),
              reject: (e) => res({ ok: false, error: e.message }),
            });
          });
        return Promise.resolve({ ok: true, data: null });
      },
    },
  };
  const state = await import('../../src/options/state');
  await state.refreshSettings();
  return { state, calls, save: (s: Settings) => (saved = s) };
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('settings page state', () => {
  it('shows the saved value again when overlapping saves both fail', async () => {
    const { state, calls } = await setup();
    const first = state.patchSettings({ widget: 'dot' }).catch(() => undefined);
    const second = state.patchSettings({ autoPush: true }).catch(() => undefined);
    expect(state.app.settings).toMatchObject({ widget: 'dot', autoPush: true, autoCommit: true });
    calls[0]!.reject(new Error('quota'));
    await first;
    // the failed widget change is gone; the other change is still on its way
    expect(state.app.settings).toMatchObject({ widget: 'creature', autoPush: true });
    calls[1]!.reject(new Error('quota'));
    await second;
    expect(state.app.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a change still being saved when an earlier one succeeds', async () => {
    const { state, calls } = await setup();
    const first = state.patchSettings({ widget: 'line' });
    const second = state.patchSettings({ autoCommit: true });
    calls[0]!.resolve({ ...DEFAULT_SETTINGS, widget: 'line' });
    await first;
    expect(state.app.settings).toMatchObject({ widget: 'line', autoCommit: true });
    calls[1]!.resolve({ ...DEFAULT_SETTINGS, widget: 'line', autoCommit: true });
    await second;
    expect(state.app.settings).toMatchObject({ widget: 'line', autoCommit: true });
  });
});
