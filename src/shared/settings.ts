import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  widget: 'creature',
  autoCommit: false,
  autoPush: false,
  repo: null,
  services: { chatgpt: true, claude: true, gemini: true },
  saveVisualizations: true,
  saveImages: false,
  githubClientId: '',
};

const KEY = 'settings';

/** Merge stored settings over the defaults, so new fields get sensible values after an update. */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const out: Settings = {
    ...DEFAULT_SETTINGS,
    ...s,
    services: { ...DEFAULT_SETTINGS.services, ...(s.services ?? {}) },
  };
  if (!['creature', 'line', 'dot'].includes(out.widget)) out.widget = DEFAULT_SETTINGS.widget;
  // Auto-push needs auto-commit: a push can only send commits that exist.
  if (out.autoPush) out.autoCommit = true;
  return out;
}

/**
 * Apply a patch with the auto-commit/auto-push rule:
 * turning auto-push on turns auto-commit on; turning auto-commit off turns auto-push off.
 */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const merged: Settings = { ...current, ...patch, services: { ...current.services, ...(patch.services ?? {}) } };
  // apply the rule before normalizing, which would otherwise turn auto-commit back on
  if (patch.autoCommit === false) merged.autoPush = false;
  if (patch.autoPush === true) merged.autoCommit = true;
  return normalizeSettings(merged);
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.sync.get(KEY);
  return normalizeSettings(got[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: settings });
}

export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[KEY]) fn(normalizeSettings(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
