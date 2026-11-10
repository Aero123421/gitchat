// Wires the background together: storage, GitHub, the engine, the router and the event ports.
// index.ts registers the Chrome listeners; tests call createBackground() with fakes.

import { EVENTS_PORT, GitchatError, isEnvelope, type Reply } from '../shared/protocol';
import { applySettingsPatch, loadSettings, saveSettings } from '../shared/settings';
import { chatKey, type RepoRef, type Settings } from '../shared/types';
import { Engine, type InitOwner, type StoredInit } from './engine';
import { Events } from './events';
import { DEFAULT_CLIENT_ID, DeviceFlow, clearAuth, identify, loadAuth, saveAuth } from './github/auth';
import { GitHub, defaultSleep } from './github/client';
import { createRepo, listRepos, repoInfo, useRepo } from './github/repo';
import { keepAlive } from './keepalive';
import { dispatch, type Handlers, type RequestContext } from './router';
import { openDb } from './store/db';
import { senderService } from './validate';

export const RETRY_ALARM = 'gitchat:push-retry';
const INITS_KEY = 'inits';

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
  const events = new Events(isExtensionPage, (tabId) => void engine().then((e) => e.ownerGone(tabId)));
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
    (enginePromise ??= openDb(opts.dbName).then((db) => {
      const e = new Engine({
        db,
        settings: settingsStore,
        github,
        emit: events,
        now: opts.now,
        pushDelayMs: opts.pushDelayMs,
        keepAlive,
        scheduleRetry: (ms) => void chrome.alarms.create(RETRY_ALARM, { when: Date.now() + Math.max(30_000, ms) }),
        clearRetry: () => void chrome.alarms.clear(RETRY_ALARM),
        // Session storage: survives a worker restart, cleared when the browser closes.
        initStore: {
          load: async () => ((await chrome.storage.session.get(INITS_KEY))[INITS_KEY] as StoredInit[] | undefined) ?? [],
          save: (inits) => chrome.storage.session.set({ [INITS_KEY]: inits }),
        },
      });
      // Every time the worker starts: pending automatic pushes timers did not survive are resumed.
      void e.resume().catch(() => undefined);
      return e;
    }));

  // Settings changes run one at a time, each against the latest stored value, together with the
  // engine hooks they trigger (a patch never undoes another one made at the same moment).
  let settingsQueue: Promise<unknown> = Promise.resolve();
  const serialSettings = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = settingsQueue.then(fn, fn);
    settingsQueue = run.catch(() => undefined);
    return run;
  };

  /** Runs the engine hooks and tells every open page, for local and synced (other device) changes. */
  async function settingsUpdated(next: Settings): Promise<void> {
    const prev = lastSettings;
    lastSettings = next;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
    if (prev) await (await engine()).settingsChanged(prev, next);
    events.broadcast({ type: 'settings', settings: next });
  }

  const patchSettings = (patch: Partial<Settings>): Promise<Settings> =>
    serialSettings(async () => {
      const prev = await loadSettings();
      lastSettings ??= prev;
      // Turning auto-commit off also turns auto-push off; apply it to the patch itself so the
      // normalization (auto-push implies auto-commit) cannot switch auto-commit back on.
      const next = applySettingsPatch(prev, patch.autoCommit === false ? { ...patch, autoPush: false } : patch);
      await saveSettings(next);
      await settingsUpdated(next);
      return next;
    });

  // Sign-in results are saved one at a time, and only while nothing newer happened: a sign-out,
  // a cancel or another sign-in started since makes an older result void.
  let authGeneration = 0;
  let authQueue: Promise<unknown> = Promise.resolve();
  const serialAuth = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = authQueue.then(fn, fn);
    authQueue = run.catch(() => undefined);
    return run;
  };
  const cancelledSignIn = () => new GitchatError('The sign-in was cancelled.', 'cancelled');

  async function signedIn(): Promise<void> {
    const e = await engine();
    await e.clearError();
    await e.resume();
  }

  const setRepo = (repo: RepoRef) => patchSettings({ repo });
  const ownerOf = (ctx: RequestContext): InitOwner | undefined => {
    if (ctx.tabId === undefined) return undefined;
    return ctx.documentId ? { tabId: ctx.tabId, documentId: ctx.documentId } : { tabId: ctx.tabId };
  };

  const handlers: Handlers = {
    'chat/open': async (p, ctx) => {
      if (ctx.tabId !== undefined && !ctx.fromExtensionPage) events.setTabChat(ctx.tabId, chatKey(p.service, p.chatId));
      return (await engine()).open(p);
    },
    'chat/snapshot': async (p) => (await engine()).snapshot(p.snapshot, p.reason),
    'chat/status': async (p) => (await engine()).status(p.key),
    'chat/init/start': async (p, ctx) => (await engine()).initStart(p.key, ownerOf(ctx)),
    'chat/init/progress': async (p, ctx) => (await engine()).initProgress(p.key, p.initId, p.progress, ownerOf(ctx)),
    'chat/init/done': async (p, ctx) => (await engine()).initDone(p.snapshot, p.initId, ownerOf(ctx)),
    'chat/init/cancel': async (p) => (await engine()).initCancel(p.key, p.initId),
    'chat/commit': async (p) => (await engine()).commit(p.key),
    'chat/push': async (p) => (await engine()).push(p.key),
    'chat/markdown': async (p) => ({ markdown: await (await engine()).copyMarkdown(p.key) }),
    'chat/untrack': async (p) => (await engine()).untrack(p.key),

    'settings/get': () => loadSettings(),
    'settings/set': (p) => patchSettings(p.patch ?? {}),

    'auth/get': async () => {
      const a = await loadAuth();
      return a && { login: a.login, method: a.method, scopes: a.scopes };
    },
    'auth/device/start': async () => {
      authGeneration++;
      const s = await loadSettings();
      return deviceFlow.start(s.githubClientId || DEFAULT_CLIENT_ID);
    },
    'auth/device/wait': async () => {
      const generation = authGeneration;
      const { token, flowId } = await keepAlive(() => deviceFlow.wait());
      const who = await identify(token, clientOpts);
      // Cancelled, signed out or replaced while waiting: this approval no longer counts.
      await serialAuth(async () => {
        if (generation !== authGeneration || !(await deviceFlow.claim(flowId))) throw cancelledSignIn();
        await saveAuth({ token, method: 'device', login: who.login, scopes: who.scopes, savedAt: Date.now() });
      });
      await signedIn();
      return { login: who.login };
    },
    'auth/device/cancel': () =>
      serialAuth(async () => {
        authGeneration++;
        await deviceFlow.cancel();
        return null;
      }),
    'auth/pat': async (p) => {
      const generation = ++authGeneration;
      await deviceFlow.cancel();
      const token = p.token.trim();
      const who = await identify(token, clientOpts);
      await serialAuth(async () => {
        if (generation !== authGeneration) throw cancelledSignIn();
        await saveAuth({ token, method: 'pat', login: who.login, scopes: who.scopes, savedAt: Date.now() });
      });
      await signedIn();
      return { login: who.login };
    },
    'auth/signout': () =>
      serialAuth(async () => {
        authGeneration++;
        await deviceFlow.cancel();
        await clearAuth();
        return null;
      }),

    'repo/list': async () => listRepos(await github()),
    'repo/info': async (p) => repoInfo(await github(), p.owner, p.name),
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

  function contextOf(sender: chrome.runtime.MessageSender): RequestContext {
    const ctx: RequestContext = { fromExtensionPage: isExtensionPage(sender) };
    if (ctx.fromExtensionPage) return ctx;
    const service = senderService(sender);
    if (service) ctx.service = service;
    if (sender.tab?.id !== undefined) ctx.tabId = sender.tab.id;
    if (sender.documentId) ctx.documentId = sender.documentId;
    return ctx;
  }

  return {
    handlers,
    events,
    engine,

    /** Called once when the worker starts. */
    start(): void {
      void engine();
    },

    onMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (reply: Reply<unknown>) => void): boolean {
      if (!isEnvelope(msg) || sender.id !== chrome.runtime.id) return false;
      void dispatch(handlers, msg, contextOf(sender)).then(sendResponse);
      return true;
    },

    onConnect(port: chrome.runtime.Port): void {
      if (port.name !== EVENTS_PORT || port.sender?.id !== chrome.runtime.id) return;
      if (!events.attach(port)) return;
      void loadSettings().then((settings) => events.post(port, { type: 'settings', settings }));
    },

    onAlarm(alarm: chrome.alarms.Alarm): void {
      if (alarm.name === RETRY_ALARM) void engine().then((e) => e.retry());
    },

    onStartup(): void {
      void engine();
    },

    onInstalled(details: chrome.runtime.InstalledDetails): void {
      if (details.reason === 'install') void chrome.runtime.openOptionsPage();
      void engine();
    },

    /**
     * chrome.storage changes (this device or synced from another one). `previous` is the value before
     * the change: after a worker restart it is the baseline the engine hooks compare against.
     */
    onSettingsStored(previous?: Settings): void {
      void serialSettings(async () => {
        if (previous) lastSettings ??= previous;
        await settingsUpdated(await loadSettings());
      });
    },
  };
}
