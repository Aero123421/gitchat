// Wires the background together: storage, GitHub, the engine, the router and the event ports.
// index.ts registers the Chrome listeners; tests call createBackground() with fakes.

import { EVENTS_PORT, GitchatError, isEnvelope, type Reply } from '../shared/protocol';
import { applySettingsPatch, loadSettings, saveSettings } from '../shared/settings';
import { chatKey, type RepoRef, type Settings } from '../shared/types';
import { Engine } from './engine';
import { Events } from './events';
import { DEFAULT_CLIENT_ID, DeviceFlow, clearAuth, identify, loadAuth, saveAuth } from './github/auth';
import { GitHub, defaultSleep } from './github/client';
import { createRepo, listRepos, useRepo } from './github/repo';
import { keepAlive } from './keepalive';
import { dispatch, type Handlers } from './router';
import { openDb } from './store/db';

export const RETRY_ALARM = 'gitchat:push-retry';

export interface BackgroundOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  dbName?: string;
  pushDelayMs?: number;
  now?: () => number;
}

export function createBackground(opts: BackgroundOptions = {}) {
  const fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? defaultSleep;
  const clientOpts = { fetch: fetchImpl, sleep };
  const isExtensionPage = (sender: chrome.runtime.MessageSender | undefined) => !!sender?.url?.startsWith(chrome.runtime.getURL(''));
  const events = new Events(isExtensionPage);
  const deviceFlow = new DeviceFlow(fetchImpl, sleep, opts.now);
  const settingsStore = { get: loadSettings, save: saveSettings };
  let lastSettings: Settings | null = null;

  const github = async () => {
    const auth = await loadAuth();
    if (!auth) throw new GitchatError('Connect GitHub in the gitchat settings first.', 'no-auth');
    return new GitHub(auth.token, clientOpts);
  };

  let enginePromise: Promise<Engine> | null = null;
  const engine = () =>
    (enginePromise ??= openDb(opts.dbName).then(
      (db) =>
        new Engine({
          db,
          settings: settingsStore,
          github,
          emit: events,
          now: opts.now,
          pushDelayMs: opts.pushDelayMs,
          keepAlive,
          scheduleRetry: (ms) => void chrome.alarms.create(RETRY_ALARM, { when: Date.now() + Math.max(30_000, ms) }),
        }),
    ));

  /** Runs the engine hooks and tells every open page, for local and synced (other device) changes. */
  async function settingsUpdated(next: Settings): Promise<void> {
    const prev = lastSettings;
    lastSettings = next;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    if (prev) await (await engine()).settingsChanged(prev, next);
    events.broadcast({ type: 'settings', settings: next });
  }

  async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
    const prev = await loadSettings();
    lastSettings ??= prev;
    // Turning auto-commit off also turns auto-push off; apply it to the patch itself so the
    // normalization (auto-push implies auto-commit) cannot switch auto-commit back on.
    const next = applySettingsPatch(prev, patch.autoCommit === false ? { ...patch, autoPush: false } : patch);
    await saveSettings(next);
    await settingsUpdated(next);
    return next;
  }

  async function signedIn(): Promise<void> {
    const e = await engine();
    await e.clearError();
    await e.resume();
  }

  const setRepo = (repo: RepoRef) => patchSettings({ repo });

  const handlers: Handlers = {
    'chat/open': async (p, ctx) => {
      if (ctx.tabId !== undefined && !ctx.fromExtensionPage) events.setTabChat(ctx.tabId, chatKey(p.service, p.chatId));
      return (await engine()).open(p);
    },
    'chat/snapshot': async (p) => (await engine()).snapshot(p.snapshot, p.reason),
    'chat/status': async (p) => (await engine()).status(p.key),
    'chat/init/start': async (p) => (await engine()).initStart(p.key),
    'chat/init/progress': async (p) => (await engine()).initProgress(p.key, p.progress),
    'chat/init/done': async (p) => (await engine()).initDone(p.snapshot),
    'chat/init/cancel': async (p) => (await engine()).initCancel(p.key),
    'chat/commit': async (p) => (await engine()).commit(p.key),
    'chat/push': async (p) => (await engine()).push(p.key),
    'chat/untrack': async (p) => (await engine()).untrack(p.key),

    'settings/get': () => loadSettings(),
    'settings/set': (p) => patchSettings(p.patch ?? {}),

    'auth/get': async () => {
      const a = await loadAuth();
      return a && { login: a.login, method: a.method, scopes: a.scopes };
    },
    'auth/device/start': async () => {
      const s = await loadSettings();
      return deviceFlow.start(s.githubClientId || DEFAULT_CLIENT_ID);
    },
    'auth/device/wait': async () => {
      const token = await keepAlive(() => deviceFlow.wait());
      const who = await identify(token, clientOpts);
      await saveAuth({ token, method: 'device', login: who.login, scopes: who.scopes, savedAt: Date.now() });
      await signedIn();
      return { login: who.login };
    },
    'auth/pat': async (p) => {
      const token = p.token.trim();
      const who = await identify(token, clientOpts);
      await saveAuth({ token, method: 'pat', login: who.login, scopes: who.scopes, savedAt: Date.now() });
      await signedIn();
      return { login: who.login };
    },
    'auth/signout': async () => {
      await clearAuth();
      return null;
    },

    'repo/list': async () => listRepos(await github()),
    'repo/create': async (p) => {
      const ref = await createRepo(await github(), p.name, p.private);
      await setRepo(ref);
      return ref;
    },
    'repo/use': async (p) => {
      const ref = await useRepo(await github(), p.owner, p.name, p.branch);
      await setRepo(ref);
      return ref;
    },
    'sync/status': async () => (await engine()).syncStatus(),
    'app/open-settings': async () => {
      await chrome.runtime.openOptionsPage();
      return null;
    },
  };

  return {
    handlers,
    events,
    engine,

    onMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: Reply<unknown>) => void): boolean {
      if (!isEnvelope(msg) || sender.id !== chrome.runtime.id) return false;
      const ctx = sender.tab?.id === undefined ? { fromExtensionPage: isExtensionPage(sender) } : { fromExtensionPage: isExtensionPage(sender), tabId: sender.tab.id };
      void dispatch(handlers, msg, ctx).then(sendResponse);
      return true;
    },

    onConnect(port: chrome.runtime.Port): void {
      if (port.name !== EVENTS_PORT || port.sender?.id !== chrome.runtime.id) return;
      events.attach(port);
      void loadSettings().then((settings) => events.post(port, { type: 'settings', settings }));
    },

    onAlarm(alarm: chrome.alarms.Alarm): void {
      if (alarm.name === RETRY_ALARM) void engine().then((e) => e.retry());
    },

    onStartup(): void {
      void engine().then((e) => e.resume());
    },

    onInstalled(details: chrome.runtime.InstalledDetails): void {
      if (details.reason === 'install') void chrome.runtime.openOptionsPage();
      void engine().then((e) => e.resume());
    },

    /** chrome.storage changes (this device or synced from another one). */
    onSettingsStored(settings: Settings): void {
      void settingsUpdated(settings);
    },
  };
}
