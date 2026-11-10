import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applySettingsPatch, DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';
import { installChrome } from '../background/chrome-stub';

describe('normalizeSettings theme', () => {
  it('defaults to auto when older stored settings have no theme', () => {
    const { theme: _theme, ...legacy } = DEFAULT_SETTINGS;
    expect(normalizeSettings(undefined).theme).toBe('auto');
    expect(normalizeSettings(null).theme).toBe('auto');
    expect(normalizeSettings({}).theme).toBe('auto');
    expect(normalizeSettings(legacy)).toMatchObject({ widget: 'creature', theme: 'auto', autoCommit: false });
    expect(normalizeSettings({ widget: 'dot', autoCommit: true }).theme).toBe('auto');
  });

  it('keeps auto, light and dark, and turns anything else into auto', () => {
    expect(normalizeSettings({ theme: 'auto' }).theme).toBe('auto');
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(normalizeSettings({ theme: 'dark', widget: 'nope' })).toMatchObject({ theme: 'dark', widget: 'creature' });
    for (const bad of ['system', '', 'LIGHT', 1, null, true, {}, []]) {
      expect(normalizeSettings({ theme: bad, widget: 'line' })).toMatchObject({ theme: 'auto', widget: 'line' });
    }
  });
});

describe('applySettingsPatch theme', () => {
  it('applies a theme and drops an invalid one back to auto', () => {
    const dark = applySettingsPatch(DEFAULT_SETTINGS, { theme: 'dark' });
    expect(dark).toMatchObject({ theme: 'dark', widget: 'creature', autoCommit: false });
    expect(applySettingsPatch(dark, { theme: 'light' }).theme).toBe('light');
    expect(applySettingsPatch(dark, { theme: 'nope' } as unknown as Partial<Settings>).theme).toBe('auto');
    expect(applySettingsPatch(dark, { autoPush: true })).toMatchObject({ theme: 'dark', autoPush: true, autoCommit: true });
    expect(applySettingsPatch(DEFAULT_SETTINGS, { theme: 'light', autoCommit: false }).theme).toBe('light');
  });
});

describe('normalizeSettings known fields', () => {
  it('drops unknown fields, including a token planted on settings, services, or the repo', () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      token: 'secret',
      extra: true,
      widget: 'dot',
      services: { chatgpt: false, claude: true, gemini: true, token: 'secret' },
      repo: { owner: 'o', name: 'n', branch: 'main', token: 'secret' },
    };
    expect(normalizeSettings(raw)).toEqual({
      ...DEFAULT_SETTINGS,
      widget: 'dot',
      // settings saved before Grok existed turn it on, like the other sites by default
      services: { chatgpt: false, claude: true, gemini: true, grok: true },
      repo: { owner: 'o', name: 'n', branch: 'main' },
    });
    expect(applySettingsPatch(DEFAULT_SETTINGS, { widget: 'line', token: 'secret' } as Partial<Settings>)).toEqual({
      ...DEFAULT_SETTINGS,
      widget: 'line',
    });
  });

  it('replaces a repo or service flag that is not a known value', () => {
    expect(normalizeSettings({ repo: { owner: 'o' }, services: { chatgpt: 'no' } }).repo).toBeNull();
    expect(normalizeSettings({ services: { chatgpt: 'no' } }).services).toEqual(DEFAULT_SETTINGS.services);
    expect(normalizeSettings({ githubClientId: 12, saveVisualizations: 'yes', autoCommit: 1 })).toMatchObject({
      githubClientId: '',
      saveVisualizations: true,
      autoCommit: false,
    });
  });
});

describe('sync storage access', () => {
  beforeEach(() => {
    installChrome();
  });

  it('restricts sync storage to trusted contexts before saving, and persists only known fields', async () => {
    const order: string[] = [];
    const level: unknown[] = [];
    chrome.storage.sync.setAccessLevel = (access) => {
      order.push('restrict');
      level.push(access);
      return Promise.resolve();
    };
    const set = chrome.storage.sync.set.bind(chrome.storage.sync);
    chrome.storage.sync.set = async (items) => {
      order.push('set');
      return set(items);
    };
    await saveSettings({ ...DEFAULT_SETTINGS, token: 'secret' } as Settings);
    expect(order).toEqual(['restrict', 'set']);
    expect(level).toEqual([{ accessLevel: 'TRUSTED_CONTEXTS' }]);
    expect((await chrome.storage.sync.get('settings')).settings).toEqual(DEFAULT_SETTINGS);
  });

  it('does not write settings when sync storage cannot be restricted', async () => {
    const set = vi.spyOn(chrome.storage.sync, 'set');
    chrome.storage.sync.setAccessLevel = () => Promise.reject(new Error('sync blocked'));
    await expect(saveSettings(DEFAULT_SETTINGS)).rejects.toThrow('sync blocked');
    expect(set).not.toHaveBeenCalled();
  });

  it('does not read settings when sync storage cannot be restricted', async () => {
    await chrome.storage.sync.set({
      settings: { ...DEFAULT_SETTINGS, repo: { owner: 'evil', name: 'x', branch: 'main' }, token: 'secret' },
    });
    const get = vi.spyOn(chrome.storage.sync, 'get');
    chrome.storage.sync.setAccessLevel = () => Promise.reject(new Error('sync blocked'));
    await expect(loadSettings()).rejects.toThrow('sync blocked');
    expect(get).not.toHaveBeenCalled();
  });

  it('returns only known fields after restricting sync storage', async () => {
    const level: unknown[] = [];
    chrome.storage.sync.setAccessLevel = (access) => {
      level.push(access);
      return Promise.resolve();
    };
    await chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, token: 'secret', widget: 'dot' } });
    await expect(loadSettings()).resolves.toEqual({ ...DEFAULT_SETTINGS, widget: 'dot' });
    expect(level).toEqual([{ accessLevel: 'TRUSTED_CONTEXTS' }]);
  });
});
