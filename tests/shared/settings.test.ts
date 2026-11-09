import { describe, expect, it } from 'vitest';
import { applySettingsPatch, DEFAULT_SETTINGS, normalizeSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';

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
