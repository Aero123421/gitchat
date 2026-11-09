import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackground } from '../../src/background/app';
import { EVENTS_PORT, type Envelope, type ReqOf, type Reply, type RequestType } from '../../src/shared/protocol';
import { CONTENT_SCRIPT, EXTENSION_PAGE, installChrome } from './chrome-stub';
import { FakeGitHub } from './fake-github';

let dbCount = 0;

function setup() {
  const chrome = installChrome();
  const fake = new FakeGitHub();
  const sleep = vi.fn(async (_ms: number) => undefined);
  const app = createBackground({ fetch: fake.fetch, sleep, dbName: `app-${++dbCount}`, pushDelayMs: 0 });
  const call = <T extends RequestType>(type: T, payload: ReqOf<T>, sender = EXTENSION_PAGE) =>
    new Promise<Reply<unknown>>((resolve) => {
      const handled = app.onMessage({ gitchat: 1, type, payload } satisfies Envelope<T>, sender, resolve);
      if (!handled) resolve({ ok: false, error: 'not handled' });
    });
  const signIn = () => call('auth/pat', { token: 'tok' });
  return { chrome, fake, sleep, app, call, signIn };
}

function port(sender: chrome.runtime.MessageSender) {
  return { name: EVENTS_PORT, sender, postMessage: vi.fn(), onDisconnect: { addListener: vi.fn() } } as unknown as chrome.runtime.Port & { postMessage: ReturnType<typeof vi.fn> };
}

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
    await t.call('chat/init/start', { key: 'claude:abc' }, CONTENT_SCRIPT);
    const statuses = (p: typeof tab7) => p.postMessage.mock.calls.map((c) => c[0] as { type: string }).filter((e) => e.type === 'status');
    expect(statuses(tab7).length).toBeGreaterThan(0);
    expect(statuses(tab8)).toEqual([]);
    expect(statuses(page).length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(tab8.postMessage.mock.calls.some((c) => (c[0] as { type: string }).type === 'settings')).toBe(true));
  });
});
