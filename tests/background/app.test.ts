import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground } from '../../src/background/app';
import { Engine } from '../../src/background/engine';
import { EVENTS_PORT, type Envelope, type ReqOf, type Reply, type RequestType } from '../../src/shared/protocol';
import type { Settings } from '../../src/shared/types';
import { CONTENT_SCRIPT, EXTENSION_PAGE, installChrome } from './chrome-stub';
import { FakeGitHub } from './fake-github';

let dbCount = 0;

function setup() {
  const chrome = installChrome();
  const fake = new FakeGitHub();
  const sleep = vi.fn(async (_ms: number) => undefined);
  const dbName = `app-${++dbCount}`;
  const app = createBackground({ fetch: fake.fetch, sleep, dbName, pushDelayMs: 0 });
  const call = <T extends RequestType>(type: T, payload: ReqOf<T>, sender = EXTENSION_PAGE) =>
    new Promise<Reply<unknown>>((resolve) => {
      const handled = app.onMessage({ gitchat: 1, type, payload } satisfies Envelope<T>, sender, resolve);
      if (!handled) resolve({ ok: false, error: 'not handled' });
    });
  const signIn = () => call('auth/pat', { token: 'tok' });
  /** A fresh worker on the same storage (as after the service worker was stopped). */
  const restart = () => createBackground({ fetch: fake.fetch, sleep, dbName, pushDelayMs: 0 });
  return { chrome, fake, sleep, app, call, signIn, restart };
}

function port(sender: chrome.runtime.MessageSender) {
  return { name: EVENTS_PORT, sender, postMessage: vi.fn(), disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } } as unknown as chrome.runtime.Port & {
    postMessage: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onDisconnect: { addListener: ReturnType<typeof vi.fn> };
  };
}

const snapshot = (over: Record<string, unknown> = {}) => ({
  service: 'claude',
  chatId: 'abc',
  url: 'https://claude.ai/chat/abc',
  title: 'A',
  messages: [{ id: 'u1', role: 'user', markdown: 'hi' }],
  capturedAt: '2026-11-09T10:00:00.000Z',
  complete: false,
  ...over,
});

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

describe('router', () => {
  it('ignores messages that are not gitchat envelopes or come from elsewhere', () => {
    expect(t.app.onMessage({ hello: 1 }, EXTENSION_PAGE, () => undefined)).toBe(false);
    expect(t.app.onMessage({ gitchat: 1, type: 'settings/get', payload: {} }, { id: 'other-ext' }, () => undefined)).toBe(false);
  });

  it('keeps the auto-commit / auto-push rule', async () => {
    let r = await t.call('settings/set', { patch: { autoPush: true } });
    expect(r).toMatchObject({ ok: true, data: { autoPush: true, autoCommit: true } });
    r = await t.call('settings/set', { patch: { autoCommit: false } });
    expect(r).toMatchObject({ ok: true, data: { autoPush: false, autoCommit: false } });
    const stored = (await t.chrome.storage.sync.get('settings')).settings as { autoCommit: boolean };
    expect(stored.autoCommit).toBe(false);
  });

  it('lets the on-page widget change only widget settings, never sign in or pick repositories', async () => {
    const r = await t.call('settings/set', { patch: { autoCommit: true, repo: { owner: 'evil', name: 'x', branch: 'main' }, githubClientId: 'x' } }, CONTENT_SCRIPT);
    expect(r).toMatchObject({ ok: true, data: { autoCommit: true, repo: null, githubClientId: '' } });
    for (const type of ['auth/pat', 'auth/get', 'repo/use', 'repo/list'] as const) {
      const denied = await t.call(type, { token: 'tok', owner: 'a', name: 'b' } as never, CONTENT_SCRIPT);
      expect(denied).toMatchObject({ ok: false, code: 'forbidden' });
    }
  });

  it('accepts chat requests only from the top frame of a chat site, for its own chats', async () => {
    const frame = { ...CONTENT_SCRIPT, frameId: 3, url: 'https://x.claudeusercontent.com/a', origin: 'https://x.claudeusercontent.com' } as chrome.runtime.MessageSender;
    expect(await t.call('chat/status', { key: 'claude:abc' }, frame)).toMatchObject({ ok: false, code: 'forbidden' });
    const elsewhere = { ...CONTENT_SCRIPT, url: 'https://evil.example/', origin: 'https://evil.example' } as chrome.runtime.MessageSender;
    expect(await t.call('settings/get', {}, elsewhere)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await t.call('chat/status', { key: 'chatgpt:abc' }, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await t.call('chat/snapshot', { snapshot: snapshot({ service: 'gemini' }) } as never, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await t.call('chat/status', { key: 'claude:abc' }, CONTENT_SCRIPT)).toMatchObject({ ok: true });
  });

  it('rejects malformed payloads', async () => {
    expect(await t.call('chat/status', { key: 'nonsense' } as never, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await t.call('chat/snapshot', { snapshot: snapshot({ messages: [{ id: 'u1', role: 'system', markdown: 'x' }] }) } as never, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await t.call('chat/snapshot', { snapshot: snapshot({ capturedAt: 'yesterday' }) } as never, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await t.call('chat/snapshot', { snapshot: snapshot() } as never, CONTENT_SCRIPT)).toMatchObject({ ok: true });
  });

  it('applies settings changes made at the same moment one after the other', async () => {
    await Promise.all([t.call('settings/set', { patch: { widget: 'dot' } }), t.call('settings/set', { patch: { saveVisualizations: false } })]);
    expect(await t.call('settings/get', {})).toMatchObject({ data: { widget: 'dot', saveVisualizations: false } });
  });

  it('opens the settings page for the widget', async () => {
    expect(await t.call('app/open-settings', {}, CONTENT_SCRIPT)).toEqual({ ok: true, data: null });
    expect(t.chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});

describe('sign-in', () => {
  it('checks a personal access token and stores it on this device only', async () => {
    expect(await t.call('auth/pat', { token: 'wrong' })).toMatchObject({ ok: false, code: 'auth' });
    expect(await t.signIn()).toEqual({ ok: true, data: { login: 'octo' } });
    expect(await t.call('auth/get', {})).toEqual({ ok: true, data: { login: 'octo', method: 'pat', scopes: ['repo'] } });
    expect((await t.chrome.storage.local.get('auth')).auth).toMatchObject({ token: 'tok' });
    expect(JSON.stringify(await t.chrome.storage.sync.get(null))).not.toContain('tok"');
    await t.call('auth/signout', {});
    expect(await t.call('auth/get', {})).toEqual({ ok: true, data: null });
  });

  it('signs in with the device flow, honoring slow_down', async () => {
    expect(await t.call('auth/device/start', {})).toMatchObject({ ok: false, code: 'no-client-id' });
    await t.call('settings/set', { patch: { githubClientId: 'Iv1.test' } });
    expect(await t.call('auth/device/start', {})).toMatchObject({ ok: true, data: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5 } });
    t.fake.tokenReplies = [{ error: 'authorization_pending' }, { error: 'slow_down', interval: 7 }, { access_token: 'tok', token_type: 'bearer', scope: 'repo' }];
    expect(await t.call('auth/device/wait', {})).toEqual({ ok: true, data: { login: 'octo' } });
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([5000, 5000, 7000]);
    expect(await t.call('auth/get', {})).toMatchObject({ ok: true, data: { method: 'device' } });
  });

  it('ignores a device sign-in approved after it was cancelled or signed out', async () => {
    await t.call('settings/set', { patch: { githubClientId: 'Iv1.test' } });
    await t.call('auth/device/start', {});
    t.fake.tokenReplies = [{ access_token: 'tok', token_type: 'bearer', scope: 'repo' }];
    const waiting = t.call('auth/device/wait', {});
    await t.call('auth/signout', {});
    expect(await waiting).toMatchObject({ ok: false, code: 'cancelled' });
    expect(await t.call('auth/get', {})).toEqual({ ok: true, data: null });

    await t.call('auth/device/start', {});
    expect(await t.call('auth/device/cancel', {})).toEqual({ ok: true, data: null });
    expect(await t.call('auth/device/wait', {})).toMatchObject({ ok: false });
    expect(await t.call('auth/get', {})).toEqual({ ok: true, data: null });
  });

  it('does not let a token check that finishes after sign-out sign the user back in', async () => {
    const hold = t.fake.pause((r) => r.url.pathname === '/user');
    const signing = t.call('auth/pat', { token: 'tok' });
    await hold.reached;
    await t.call('auth/signout', {});
    hold.release();
    expect(await signing).toMatchObject({ ok: false, code: 'cancelled' });
    expect(await t.call('auth/get', {})).toEqual({ ok: true, data: null });
  });

  it('reports a denied device sign-in', async () => {
    await t.call('settings/set', { patch: { githubClientId: 'Iv1.test' } });
    await t.call('auth/device/start', {});
    t.fake.tokenReplies = [{ error: 'access_denied' }];
    expect(await t.call('auth/device/wait', {})).toMatchObject({ ok: false, code: 'denied' });
  });
});

describe('repositories', () => {
  it('bootstraps an empty repository and refuses one with unrelated files', async () => {
    await t.signIn();
    const empty = t.fake.addRepo('empty');
    const busy = t.fake.addRepo('busy');
    await t.fake.commitFiles(busy, { 'src/index.js': 'x' });
    expect(await t.call('repo/use', { owner: 'octo', name: 'busy' })).toMatchObject({ ok: false, code: 'repo-not-empty' });
    expect(await t.call('repo/use', { owner: 'octo', name: 'empty' })).toEqual({ ok: true, data: { owner: 'octo', name: 'empty', branch: 'main' } });
    expect(t.fake.fileAt(empty, 'README.md')).toContain('<!-- gitchat -->');
    expect(empty.topics).toEqual(['gitchat']);
    expect(await t.call('settings/get', {})).toMatchObject({ data: { repo: { owner: 'octo', name: 'empty' } } });
    // Already managed by gitchat: accepted as is.
    expect(await t.call('repo/use', { owner: 'octo', name: 'empty' })).toMatchObject({ ok: true });
  });

  it('creates a private repository and lists repositories', async () => {
    await t.signIn();
    expect(await t.call('repo/create', { name: 'ai chats', private: true })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await t.call('repo/create', { name: 'ai-chats', private: true })).toEqual({ ok: true, data: { owner: 'octo', name: 'ai-chats', branch: 'main' } });
    const list = await t.call('repo/list', {});
    expect(list).toMatchObject({ ok: true, data: [{ owner: 'octo', name: 'ai-chats', private: true, managed: true, empty: false }] });
  });

  it('describes one repository by name', async () => {
    await t.signIn();
    t.fake.addRepo('open', { private: false });
    expect(await t.call('repo/info', { owner: 'octo', name: 'open' })).toEqual({
      ok: true,
      data: { owner: 'octo', name: 'open', private: false, defaultBranch: 'main', empty: true, managed: false },
    });
    expect(await t.call('repo/info', { owner: 'octo', name: 'nope' })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await t.call('repo/info', { owner: 'octo', name: 'open' }, CONTENT_SCRIPT)).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('lists more than one page of repositories', async () => {
    await t.signIn();
    for (let i = 0; i < 150; i++) t.fake.addRepo(`r${i}`);
    const list = (await t.call('repo/list', {})) as { ok: true; data: unknown[] };
    expect(list.data).toHaveLength(150);
  });

  it('asks to sign in first', async () => {
    expect(await t.call('repo/list', {})).toMatchObject({ ok: false, code: 'no-auth' });
  });
});

describe('events', () => {
  it('sends a chat status only to the tab showing that chat, and everything to extension pages', async () => {
    const tab7 = port(CONTENT_SCRIPT);
    const tab8 = port({ ...CONTENT_SCRIPT, tab: { id: 8 } as chrome.tabs.Tab });
    const page = port(EXTENSION_PAGE);
    for (const p of [tab7, tab8, page]) t.app.onConnect(p);
    await t.call('chat/open', { service: 'claude', chatId: 'abc', url: 'https://claude.ai/chat/abc', title: 'A' }, CONTENT_SCRIPT);
    expect(await t.call('chat/init/start', { key: 'claude:abc' }, CONTENT_SCRIPT)).toMatchObject({ ok: true, data: { initId: expect.any(String), status: { phase: 'capturing' } } });
    const statuses = (p: typeof tab7) => p.postMessage.mock.calls.map((c) => c[0] as { type: string }).filter((e) => e.type === 'status');
    expect(statuses(tab7).length).toBeGreaterThan(0);
    expect(statuses(tab8)).toEqual([]);
    expect(statuses(page).length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(tab8.postMessage.mock.calls.some((c) => (c[0] as { type: string }).type === 'settings')).toBe(true));
  });
});

describe('event ports', () => {
  it('refuses ports from frames inside the chat page', () => {
    const p = port({ ...CONTENT_SCRIPT, frameId: 2 } as chrome.runtime.MessageSender);
    t.app.onConnect(p);
    expect(p.disconnect).toHaveBeenCalled();
  });

  it('ends an init when the tab that runs it goes away', async () => {
    const p = port(CONTENT_SCRIPT);
    t.app.onConnect(p);
    await t.call('chat/open', { service: 'claude', chatId: 'abc', url: 'https://claude.ai/chat/abc', title: 'A' }, CONTENT_SCRIPT);
    await t.call('chat/init/start', { key: 'claude:abc' }, CONTENT_SCRIPT);
    const onGone = p.onDisconnect.addListener.mock.calls[0]![0] as () => void;
    onGone();
    await vi.waitFor(async () => expect(await t.call('chat/status', { key: 'claude:abc' })).toMatchObject({ data: { phase: 'idle' } }));
  });
});

describe('worker restarts', () => {
  const snap = (messages: { id: string; role: 'user' | 'assistant'; markdown: string }[]) => ({
    service: 'claude' as const,
    chatId: 'abc',
    url: 'https://claude.ai/chat/abc',
    title: 'A',
    messages,
    capturedAt: '2026-11-09T10:00:00.000Z',
    complete: true,
  });

  it('runs the engine hooks for the first synced settings change after a restart', async () => {
    await t.signIn();
    t.fake.addRepo('chats');
    await t.call('repo/use', { owner: 'octo', name: 'chats' });
    const start = (await t.call('chat/init/start', { key: 'claude:abc' }, CONTENT_SCRIPT)) as { ok: true; data: { initId: string } };
    await t.call('chat/init/done', { snapshot: snap([{ id: 'u1', role: 'user', markdown: 'q' }, { id: 'a1', role: 'assistant', markdown: 'a' }]), initId: start.data.initId }, CONTENT_SCRIPT);
    await t.call('chat/commit', { key: 'claude:abc' }, CONTENT_SCRIPT);

    const app2 = t.restart();
    const hook = vi.spyOn(Engine.prototype, 'settingsChanged');
    const before = (await t.chrome.storage.sync.get('settings')).settings as Settings;
    const after = { ...before, autoCommit: true, autoPush: true };
    await t.chrome.storage.sync.set({ settings: after }); // synced from another device
    app2.onSettingsStored(before);
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(before, after));
    await vi.waitFor(() => expect(t.fake.paths(t.fake.repos.get('octo/chats')!).some((p) => p.startsWith('claude/'))).toBe(true));
    hook.mockRestore();
  });

  it('only lets the tab that started an init finish it', async () => {
    const start = (await t.call('chat/init/start', { key: 'claude:abc' }, CONTENT_SCRIPT)) as { ok: true; data: { initId: string } };
    const otherTab = { ...CONTENT_SCRIPT, tab: { id: 8 } } as chrome.runtime.MessageSender;
    const msgs = [{ id: 'u1', role: 'user' as const, markdown: 'q' }, { id: 'a1', role: 'assistant' as const, markdown: 'a' }];
    expect(await t.call('chat/init/done', { snapshot: snap(msgs), initId: start.data.initId }, otherTab)).toMatchObject({ ok: false, code: 'stale-init' });
    expect(await t.call('chat/init/done', { snapshot: snap(msgs), initId: start.data.initId }, CONTENT_SCRIPT)).toMatchObject({ ok: true, data: { tracked: true } });
  });
});
