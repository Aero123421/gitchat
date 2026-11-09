// Page state for the settings page: settings, auth and sync status, with tiny topic subscriptions.

import { request, type SyncStatus } from '../shared/protocol';
import { applySettingsPatch, DEFAULT_SETTINGS, onSettingsChanged } from '../shared/settings';
import type { AuthState, Settings } from '../shared/types';

export type AuthInfo = Pick<AuthState, 'login' | 'method' | 'scopes'>;
export type Topic = 'settings' | 'auth' | 'sync';

export const app: { settings: Settings; auth: AuthInfo | null; sync: SyncStatus | null } = {
  settings: { ...DEFAULT_SETTINGS },
  auth: null,
  sync: null,
};

const subs = new Map<Topic, Set<() => void>>();

export function on(topic: Topic, fn: () => void): () => void {
  let set = subs.get(topic);
  if (!set) subs.set(topic, (set = new Set()));
  set.add(fn);
  return () => set?.delete(fn);
}

export function emit(topic: Topic): void {
  for (const fn of [...(subs.get(topic) ?? [])]) fn();
}

/** Load everything the page needs. Failures leave defaults and are returned for display. */
export async function loadAll(): Promise<unknown[]> {
  const [s, a, y] = await Promise.allSettled([request('settings/get', {}), request('auth/get', {}), request('sync/status', {})]);
  const errors: unknown[] = [];
  if (s.status === 'fulfilled') setConfirmed(s.value);
  else errors.push(s.reason);
  if (a.status === 'fulfilled') app.auth = a.value;
  else errors.push(a.reason);
  if (y.status === 'fulfilled') app.sync = y.value;
  try {
    onSettingsChanged((next) => {
      setConfirmed(next);
      emit('settings');
    });
  } catch {
    // storage events are unavailable in the standalone preview
  }
  return errors;
}

export async function refreshAuth(): Promise<void> {
  app.auth = await request('auth/get', {});
  emit('auth');
}

export async function refreshSettings(): Promise<void> {
  setConfirmed(await request('settings/get', {}));
  emit('settings');
}

export async function refreshSync(): Promise<void> {
  try {
    app.sync = await request('sync/status', {});
    emit('sync');
  } catch {
    // keep the last known status
  }
}

// Settings as last saved (or synced from elsewhere), and the changes still being saved. What the page
// shows is always the saved settings with the pending changes on top, so a failed save can never
// leave another change's value on screen.
let confirmed: Settings = app.settings;
const pending: Partial<Settings>[] = [];

function setConfirmed(next: Settings): void {
  confirmed = next;
  app.settings = pending.reduce(applySettingsPatch, confirmed);
}

/** Apply a settings patch optimistically, then reconcile with what the background saved. */
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  pending.push(patch);
  setConfirmed(confirmed);
  emit('settings');
  try {
    const saved = await request('settings/set', { patch });
    pending.splice(pending.indexOf(patch), 1);
    setConfirmed(saved);
    return saved;
  } catch (e) {
    pending.splice(pending.indexOf(patch), 1);
    setConfirmed(confirmed);
    throw e;
  } finally {
    emit('settings');
  }
}
