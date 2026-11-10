import { SERVICES, type RepoRef, type Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  widget: 'creature',
  theme: 'auto',
  autoCommit: false,
  autoPush: false,
  repo: null,
  services: { chatgpt: true, claude: true, gemini: true, grok: true },
  saveVisualizations: true,
  githubClientId: '',
};

const KEY = 'settings';

function knownRepo(value: unknown): RepoRef | null {
  if (!value || typeof value !== 'object') return null;
  const repo = value as Partial<RepoRef>;
  if (typeof repo.owner !== 'string' || typeof repo.name !== 'string' || typeof repo.branch !== 'string') return null;
  return { owner: repo.owner, name: repo.name, branch: repo.branch };
}

function knownServices(value: unknown): Settings['services'] {
  const raw = value && typeof value === 'object' ? (value as Partial<Record<keyof Settings['services'], unknown>>) : {};
  const services = { ...DEFAULT_SETTINGS.services };
  for (const id of SERVICES) {
    const flag = raw[id];
    if (typeof flag === 'boolean') services[id] = flag;
  }
  return services;
}

/** Merge stored settings over the defaults, copying only known fields. */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const out: Settings = {
    widget: s.widget === 'creature' || s.widget === 'line' || s.widget === 'dot' ? s.widget : DEFAULT_SETTINGS.widget,
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'auto' ? s.theme : 'auto',
    autoCommit: typeof s.autoCommit === 'boolean' ? s.autoCommit : DEFAULT_SETTINGS.autoCommit,
    autoPush: typeof s.autoPush === 'boolean' ? s.autoPush : DEFAULT_SETTINGS.autoPush,
    repo: knownRepo(s.repo),
    services: knownServices(s.services),
    saveVisualizations: typeof s.saveVisualizations === 'boolean' ? s.saveVisualizations : DEFAULT_SETTINGS.saveVisualizations,
    githubClientId: typeof s.githubClientId === 'string' ? s.githubClientId : DEFAULT_SETTINGS.githubClientId,
  };
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

/** Content scripts can read and write sync storage until this succeeds. */
export async function restrictSettingsStorage(): Promise<void> {
  await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function loadSettings(): Promise<Settings> {
  await restrictSettingsStorage();
  const got = await chrome.storage.sync.get(KEY);
  return normalizeSettings(got[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await restrictSettingsStorage();
  await chrome.storage.sync.set({ [KEY]: normalizeSettings(settings) });
}

export function onSettingsChanged(fn: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[KEY]) fn(normalizeSettings(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
