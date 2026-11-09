import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { Engine, type StoredInit } from '../../src/background/engine';
import { GitHub } from '../../src/background/github/client';
import { gitBlobSha } from '../../src/background/hash';
import { renderChat } from '../../src/background/render';
import { openDb } from '../../src/background/store/db';
import { GitchatError } from '../../src/shared/protocol';
import { DEFAULT_SETTINGS } from '../../src/shared/settings';
import type { CapturedMessage, ChatKey, ChatSnapshot, ChatStatus, Settings } from '../../src/shared/types';
import { FakeGitHub } from './fake-github';

let dbCount = 0;
const KEY: ChatKey = 'claude:c1';

const user = (id: string, text = `question ${id}`): CapturedMessage => ({ id, role: 'user', markdown: text });
const bot = (id: string, text = `answer ${id}`): CapturedMessage => ({ id, role: 'assistant', markdown: text });

function snap(messages: CapturedMessage[], opts: Partial<ChatSnapshot> = {}): ChatSnapshot {
  return { service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'T', messages, capturedAt: '2026-11-09T10:00:00.000Z', complete: false, ...opts };
}

async function setup(over: Partial<Settings> = {}) {
  const fake = new FakeGitHub();
  const repo = fake.addRepo('chats');
  let settings: Settings = { ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' }, ...over };
  const statuses: ChatStatus[] = [];
  let signedIn = true;
  const engine = new Engine({
    db: await openDb(`engine-${++dbCount}`),
    settings: {
      get: async () => settings,
      save: async (s) => {
        settings = s;
      },
    },
    github: async () => {
      if (!signedIn) throw new GitchatError('Connect GitHub first.', 'no-auth');
      return new GitHub('tok', { fetch: fake.fetch, sleep: async () => undefined });
    },
    emit: { status: (s) => statuses.push(s), broadcast: () => undefined, shownKeys: () => [KEY] },
    pushDelayMs: 0,
  });
  return {
    fake,
    repo,
    engine,
    statuses,
    setSettings: (p: Partial<Settings>) => (settings = { ...settings, ...p }),
    signOut: () => (signedIn = false),
  };
}

type T = Awaited<ReturnType<typeof setup>>;

/** Runs an init of chat c1 the way a tab does: start, then a complete capture. */
async function track(t: T, messages: CapturedMessage[], opts: Partial<ChatSnapshot> = {}) {
  const { initId } = await t.engine.initStart(KEY);
  return t.engine.initDone(snap(messages, { complete: true, ...opts }), initId);
}

/** A chat file another device wrote. */
function remoteFile(path: string, messages: CapturedMessage[], capturedAt: string, chatId = 'c1') {
  return renderChat({ service: 'claude', chatId, url: 'u', title: 'T', createdAt: '2026-11-09T10:00:00.000Z', capturedAt, messages }, path)[0]!.content;
}

/** Tracks chat c1 with two messages and pushes it once. Returns the file path. */
async function trackAndPush(t: T, capturedAt = '2026-11-09T10:00:00.000Z') {
  await track(t, [user('u1'), bot('a1')], { capturedAt });
  await t.engine.commit(KEY);
  await t.engine.push();
  return (await t.engine.status(KEY)).path!;
}

describe('engine: commit and push', () => {
  it('tracks a chat on init, commits it, and pushes into an empty repository', async () => {
    const t = await setup();
    let s = await track(t, [user('u1'), bot('a1')]);
    expect(s.tracked).toBe(true);
    expect(s.staged.map((x) => x.id)).toEqual(['u1', 'a1']);
    expect(s.path).toMatch(/^claude\/\d{4}-\d{2}-\d{2}-t--c1\.md$/);

    s = await t.engine.commit(KEY);
    expect(s.staged).toEqual([]);
    expect(s.commits).toMatchObject([{ n: 2, pushed: false }]);
    expect(s.aheadTotal).toBe(1);

    await t.engine.push();
    s = await t.engine.status(KEY);
    expect(s.commits[0]).toMatchObject({ pushed: true, sha: expect.any(String) });
    expect(s.aheadTotal).toBe(0);
    expect(s.webUrl).toBe(`https://github.com/octo/chats/blob/main/${s.path}`);
    expect(t.fake.paths(t.repo)).toEqual(['README.md', s.path]);
    expect(t.fake.fileAt(t.repo, 'README.md')).toContain('<!-- gitchat -->');
    expect(t.fake.fileAt(t.repo, s.path!)).toContain('## Assistant\n<!-- gitchat:message id="a1" length="9" -->\n\nanswer a1');
  });

  it('pushes later commits fast-forward', async () => {
    const t = await setup();
    const path = await trackAndPush(t);
    const before = t.fake.commitCount(t.repo);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')]), 'answered');
    expect((await t.engine.status(KEY)).staged.map((x) => x.id)).toEqual(['u2', 'a2']);
    await t.engine.push(KEY);
    expect(t.fake.commitCount(t.repo)).toBe(before + 1);
    expect(t.fake.fileAt(t.repo, path)).toContain('answer a2');
    expect(t.fake.fileAt(t.repo, path)).toContain('answer a1');
  });

  it('rebases onto a commit another device pushed meanwhile', async () => {
    const t = await setup();
    const path = await trackAndPush(t);
    await t.engine.snapshot(snap([bot('a1', 'edited answer')]), 'answered');
    await t.engine.commit(KEY);
    t.fake.beforeRefUpdate = async (r) => {
      await t.fake.commitFiles(r, { 'gemini/2026-11-09-other--g1.md': 'other device' });
    };
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, 'gemini/2026-11-09-other--g1.md')).toBe('other device');
    expect(t.fake.fileAt(t.repo, path)).toContain('edited answer');
    expect((await t.engine.status(KEY)).aheadTotal).toBe(0);
  });

  it('skips our commit when the repository copy already has everything in it', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    const theirs = remoteFile(path, [user('u1'), bot('a1'), user('u2'), bot('a2'), user('u9'), bot('a9')], '2026-11-09T12:00:00.000Z');
    await t.fake.commitFiles(t.repo, { [path]: theirs });
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T11:00:00.000Z' }), 'answered');
    await t.engine.commit(KEY);
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, path)).toBe(theirs);
    const s = await t.engine.status(KEY);
    expect(s).toMatchObject({ aheadTotal: 0, phase: 'idle', staged: [] });
    expect(s.commits.every((c) => c.pushed)).toBe(true);
  });

  it('combines both copies when another device pushed a newer capture meanwhile', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1'), user('u9'), bot('a9')], '2026-11-09T12:00:00.000Z') });
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T11:00:00.000Z' }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    for (const text of ['answer a1', 'answer a9', 'answer a2']) expect(file).toContain(text);
  });

  it('never loses the other device\'s messages on later pushes after losing a conflict', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1'), user('u9'), bot('a9')], '2026-11-09T12:00:00.000Z') });
    await t.engine.snapshot(snap([bot('a1')], { capturedAt: '2026-11-09T11:00:00.000Z', atEnd: true }), 'manual');
    await t.engine.push(KEY); // nothing new here: superseded, the chat is rebased on the remote copy
    expect((await t.engine.status(KEY)).staged).toEqual([]);
    // this page never saw u9/a9 and goes on with another turn, at the end of the page
    await t.engine.snapshot(snap([bot('a1'), user('u3'), bot('a3')], { capturedAt: '2026-11-09T13:00:00.000Z', atEnd: true }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    for (const text of ['answer a9', 'answer a3']) expect(file).toContain(text);
  });

  it('overwrites an older capture pushed by another device', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1', 'old answer')], '2026-11-09T10:30:00.000Z') });
    await t.engine.snapshot(snap([bot('a1', 'new answer'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T11:00:00.000Z' }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    expect(file).toContain('answer a2');
    expect(file).toContain('new answer');
    expect(file).not.toContain('old answer');
  });

  it('writes to the file another device already created for the chat', async () => {
    const t = await setup();
    await t.fake.commitFiles(t.repo, { 'README.md': '<!-- gitchat -->', 'claude/2026-01-01-old-title--c1.md': '---\ngitchat: 1\nservice: claude\nid: "c1"\ncaptured: 2026-01-01T00:00:00.000Z\nmessages: 1\n---\n' });
    await track(t, [user('u1'), bot('a1')], { title: 'New title' });
    await t.engine.push(KEY);
    const paths = t.fake.paths(t.repo);
    expect(paths).toEqual(['README.md', 'claude/2026-01-01-old-title--c1.md']);
    expect(t.fake.fileAt(t.repo, 'claude/2026-01-01-old-title--c1.md')).toContain('# New title');
  });

  it('confirms the path at push time when the repository was unreachable at init', async () => {
    const t = await setup({ repo: null });
    await track(t, [user('u1')], { title: 'Offline' });
    t.setSettings({ repo: { owner: 'octo', name: 'chats', branch: 'main' } });
    await t.fake.commitFiles(t.repo, { 'claude/2026-02-02-from-laptop--c1.md': '---\ngitchat: 1\nservice: claude\nid: "c1"\ncaptured: 2026-01-01T00:00:00.000Z\nmessages: 1\n---\n' });
    await t.engine.push(KEY);
    expect(t.fake.paths(t.repo)).toEqual(['claude/2026-02-02-from-laptop--c1.md']);
    expect((await t.engine.status(KEY)).path).toBe('claude/2026-02-02-from-laptop--c1.md');
  });

  it('continues a chat that another device saved, staging only what is new', async () => {
    const t = await setup();
    const path = 'claude/2026-11-01-shared--c1.md';
    const file = remoteFile(path, [user('u1'), bot('a1')], '2026-11-01T00:00:00.000Z');
    await t.fake.commitFiles(t.repo, { [path]: file });
    const first = await t.engine.open({ service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'Shared' });
    expect(first.tracked).toBe(false);
    await vi.waitFor(async () => expect((await t.engine.status(KEY)).tracked).toBe(true));
    expect((await t.engine.status(KEY)).staged).toEqual([]);
    await t.engine.snapshot(snap([user('u1'), bot('a1'), user('u2')], { title: 'Shared' }), 'sent');
    const s = await t.engine.status(KEY);
    expect(s.staged.map((x) => x.id)).toEqual(['u2']);
    expect(s.path).toBe(path);
  });
});

describe('engine: automation', () => {
  it('auto-commits only once the AI has answered, then auto-pushes', async () => {
    const t = await setup({ autoCommit: true, autoPush: true });
    await track(t, [user('u1'), bot('a1')]);
    await vi.waitFor(() => expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(true));
    const path = (await t.engine.status(KEY)).path!;

    let s = await t.engine.snapshot(snap([bot('a1'), user('u2')]), 'sent');
    expect(s.staged.map((x) => x.id)).toEqual(['u2']);
    expect(s.commits.filter((c) => !c.pushed)).toEqual([]);

    s = await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')]), 'answered');
    expect(s.staged).toEqual([]);
    await vi.waitFor(() => expect(t.fake.fileAt(t.repo, path)).toContain('answer a2'));
  });

  it('commits staged work before pushing', async () => {
    const t = await setup();
    await track(t, [user('u1')]);
    const s = await t.engine.push(KEY);
    expect(s?.staged).toEqual([]);
    expect(s?.commits).toMatchObject([{ pushed: true }]);
  });

  it('turning auto-commit on commits what is already staged, but never a question without its answer', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.snapshot(snap([user('u1'), bot('a1'), user('u2')]), 'sent');
    const prev = { ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' } };
    t.setSettings({ autoCommit: true });
    await t.engine.settingsChanged(prev, { ...prev, autoCommit: true });
    expect((await t.engine.status(KEY)).commits).toHaveLength(0);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')]), 'answered');
    expect((await t.engine.status(KEY)).commits).toHaveLength(1);
  });

  it('shows why a push failed on chats with unpushed commits', async () => {
    const t = await setup();
    await track(t, [user('u1')]);
    await t.engine.commit(KEY);
    t.signOut();
    await expect(t.engine.push()).rejects.toMatchObject({ code: 'no-auth' });
    const s = await t.engine.status(KEY);
    expect(s.phase).toBe('error');
    expect(s.error).toMatch(/Connect GitHub/);
    expect((await t.engine.syncStatus()).lastError).toMatch(/Connect GitHub/);

    t.setSettings({ repo: null });
    await expect(t.engine.push()).rejects.toMatchObject({ code: 'no-repo' });
  });

  it('does not stage untracked chats and reports init progress', async () => {
    const t = await setup();
    expect((await t.engine.snapshot(snap([user('u1')]))).staged).toEqual([]);
    const { initId } = await t.engine.initStart(KEY);
    await t.engine.initProgress(KEY, initId, 0.4);
    const s = await t.engine.status(KEY);
    expect(s).toMatchObject({ phase: 'capturing', progress: 0.4, tracked: false });
    expect((await t.engine.initCancel(KEY, initId)).phase).toBe('idle');
  });
});

describe('engine: repositories', () => {
  const A = { owner: 'octo', name: 'chats', branch: 'main' };
  const B = { owner: 'octo', name: 'public', branch: 'main' };

  it('never sends commits queued for one repository to another, and stages chats again for the new one', async () => {
    const t = await setup();
    const repoB = t.fake.addRepo('public', { private: false });
    await trackAndPush(t);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')]), 'answered');
    await t.engine.commit(KEY); // queued for A
    const prev = { ...DEFAULT_SETTINGS, repo: A };
    t.setSettings({ repo: B });
    await t.engine.settingsChanged(prev, { ...prev, repo: B });
    let s = await t.engine.status(KEY);
    expect(s).toMatchObject({ aheadTotal: 0, commits: [] });
    expect(s.webUrl).toBeUndefined();
    expect(s.staged.map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(t.fake.paths(repoB)).toEqual([]);
    await t.engine.push(KEY);
    s = await t.engine.status(KEY);
    expect(t.fake.fileAt(repoB, s.path!)).toContain('answer a2');
    expect(s.webUrl).toContain('/octo/public/');
  });

  it('lets a push finish against the repository it started with before switching', async () => {
    const t = await setup();
    const repoB = t.fake.addRepo('public');
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.commit(KEY);
    let switching: Promise<void> | undefined;
    t.fake.beforeRefUpdate = async () => {
      t.setSettings({ repo: B });
      switching = t.engine.settingsChanged({ ...DEFAULT_SETTINGS, repo: A }, { ...DEFAULT_SETTINGS, repo: B });
    };
    await t.engine.push();
    await switching;
    expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(true);
    expect(t.fake.paths(repoB)).toEqual([]);
    const s = await t.engine.status(KEY);
    expect(s.staged.map((x) => x.id)).toEqual(['u1', 'a1']);
    expect(s.aheadTotal).toBe(0);
  });

  it('starts tracking from the copy another device saved when that copy is newer', async () => {
    const t = await setup();
    const path = 'claude/2026-11-01-shared--c1.md';
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1'), user('u9'), bot('a9')], '2026-11-09T12:00:00.000Z') });
    const s = await track(t, [user('u1'), bot('a1')], { capturedAt: '2026-11-09T11:00:00.000Z' });
    expect(s.path).toBe(path);
    expect(s.staged).toEqual([]);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T13:00:00.000Z' }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    for (const text of ['answer a9', 'answer a2']) expect(file).toContain(text);
  });

  it('does not take over another chat whose id starts the same way', async () => {
    const t = await setup();
    const other = 'claude/2026-11-09-t--deadbeef.md';
    const otherText = remoteFile(other, [user('x1')], '2026-11-09T09:00:00.000Z', 'deadbeef-0000');
    await t.fake.commitFiles(t.repo, { [other]: otherText });
    const key: ChatKey = 'claude:deadbeef-1111';
    const { initId } = await t.engine.initStart(key);
    const s = await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true, chatId: 'deadbeef-1111' }), initId);
    await t.engine.push(key);
    expect(t.fake.fileAt(t.repo, other)).toBe(otherText);
    const path = (await t.engine.status(key)).path!;
    expect(path).not.toBe(other);
    expect(path).toMatch(/--deadbeef-1111\.md$/);
    expect(s.tracked).toBe(true);
  });

  it('replays when GitHub reports a concurrent ref update (409)', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.commit(KEY);
    await t.engine.push();
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')]), 'answered');
    t.fake.inject((r) => r.method === 'PATCH' && r.url.pathname.includes('/git/refs/'), () => new Response(JSON.stringify({ message: 'Reference update failed' }), { status: 409 }));
    await t.engine.push(KEY);
    expect(t.fake.fileAt(t.repo, (await t.engine.status(KEY)).path!)).toContain('answer a2');
  });

  it('carries on when another device initialized the empty repository first', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.commit(KEY);
    await t.fake.commitFiles(t.repo, { 'README.md': '<!-- gitchat --> other device' });
    t.fake.inject((r) => r.method === 'GET' && r.url.pathname.endsWith('/git/ref/heads/main'), () => new Response(JSON.stringify({ message: 'Git Repository is empty.' }), { status: 409 }));
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, 'README.md')).toBe('<!-- gitchat --> other device');
    expect((await t.engine.status(KEY)).aheadTotal).toBe(0);
  });
});

describe('engine: captures and init', () => {
  it('ignores a capture read before one it already applied', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')], { capturedAt: '2026-11-09T10:00:00.000Z' });
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2', 'the full answer')], { capturedAt: '2026-11-09T10:05:00.000Z' }), 'answered');
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2', 'the fu')], { capturedAt: '2026-11-09T10:04:00.000Z' }), 'sent');
    const s = await t.engine.status(KEY);
    await t.engine.commit(KEY);
    expect(s.staged.map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, (await t.engine.status(KEY)).path!)).toContain('the full answer');
  });

  it('lets only the tab that started an init finish it', async () => {
    const t = await setup();
    const first = await t.engine.initStart(KEY, { tabId: 1 });
    await expect(t.engine.initStart(KEY, { tabId: 2 })).rejects.toMatchObject({ code: 'busy' });
    await expect(t.engine.initProgress(KEY, 'someone-else', 0.5)).rejects.toMatchObject({ code: 'stale-init' });
    await t.engine.initCancel(KEY, first.initId);
    await expect(t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), first.initId)).rejects.toMatchObject({ code: 'stale-init' });
    expect((await t.engine.status(KEY)).tracked).toBe(false);
  });

  it('releases an init when its tab goes away or stops reporting', async () => {
    let now = Date.parse('2026-11-09T10:00:00.000Z');
    const t = await setup();
    const engine = new Engine({ ...(t.engine as unknown as { deps: ConstructorParameters<typeof Engine>[0] }).deps, now: () => now });
    await engine.initStart(KEY, { tabId: 1 });
    await engine.ownerGone(1);
    expect((await engine.status(KEY)).phase).toBe('idle');
    await engine.initStart(KEY, { tabId: 2 });
    now += 3 * 60_000;
    expect((await engine.status(KEY)).phase).toBe('idle');
    await expect(engine.initStart(KEY, { tabId: 3 })).resolves.toMatchObject({ initId: expect.any(String) });
  });

  it('keeps messages another tab added while the init was reading', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    const { initId } = await t.engine.initStart(KEY);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T10:01:00.000Z' }), 'answered');
    const s = await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true, capturedAt: '2026-11-09T10:00:30.000Z' }), initId);
    expect(s.staged.map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('auto-commits only settled captures, even when the last message is a (partial) answer', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2', 'half an ans')], { capturedAt: '2026-11-09T10:01:00.000Z' }), 'sent');
    const prev = { ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' } };
    t.setSettings({ autoCommit: true });
    await t.engine.settingsChanged(prev, { ...prev, autoCommit: true });
    expect((await t.engine.status(KEY)).commits).toEqual([]);
    await t.engine.snapshot(snap([bot('a2', 'half an answer, finished')], { capturedAt: '2026-11-09T10:02:00.000Z' }), 'answered');
    expect((await t.engine.status(KEY)).commits).toHaveLength(1);
  });

  it('lets two tabs race for an init: exactly one gets it', async () => {
    const t = await setup();
    const results = await Promise.allSettled([t.engine.initStart(KEY, { tabId: 1 }), t.engine.initStart(KEY, { tabId: 2 })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'busy' } });
  });

  it('refuses a completion cancelled while it waited, or for an init that never started', async () => {
    const t = await setup();
    const { initId } = await t.engine.initStart(KEY, { tabId: 1 });
    const done = t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId, { tabId: 1 });
    void t.engine.initCancel(KEY, initId);
    await expect(done).rejects.toMatchObject({ code: 'stale-init' });
    expect((await t.engine.status(KEY)).tracked).toBe(false);
    await expect(t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), 'made-up')).rejects.toMatchObject({ code: 'stale-init' });
    expect((await t.engine.status(KEY)).tracked).toBe(false);
  });

  it('refuses a completion from another tab than the one that started the init', async () => {
    const t = await setup();
    const { initId } = await t.engine.initStart(KEY, { tabId: 1 });
    await expect(t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId, { tabId: 2 })).rejects.toMatchObject({ code: 'stale-init' });
  });

  it('keeps an init running across a worker restart', async () => {
    const t = await setup();
    let stored: StoredInit[] = [];
    const initStore = { load: async () => stored, save: async (list: StoredInit[]) => void (stored = list) };
    const deps = (t.engine as unknown as { deps: ConstructorParameters<typeof Engine>[0] }).deps;
    const before = new Engine({ ...deps, initStore });
    const { initId } = await before.initStart(KEY, { tabId: 1 });
    await vi.waitFor(() => expect(stored).toHaveLength(1));
    const after = new Engine({ ...deps, initStore });
    expect((await after.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId, { tabId: 1 })).tracked).toBe(true);
  });

  it('rescans a tracked chat, keeping edits applied while it ran', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1'), user('u2'), bot('a2')], { capturedAt: '2026-11-09T10:00:00.000Z' });
    await t.engine.commit(KEY);
    const { initId } = await t.engine.initStart(KEY);
    await t.engine.snapshot(snap([bot('a1', 'edited at 10:02')], { capturedAt: '2026-11-09T10:02:00.000Z' }), 'manual');
    // the page was read at 10:01, before that edit; the branch no longer has u2/a2
    const s = await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true, capturedAt: '2026-11-09T10:01:00.000Z' }), initId);
    expect(s.staged).toEqual([
      { id: 'a1', role: 'assistant', kind: 'text' },
      { id: 'u2', role: 'user', kind: 'removed' },
      { id: 'a2', role: 'assistant', kind: 'removed' },
    ]);
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, s.path!)!;
    expect(file).toContain('edited at 10:02');
    expect(file).not.toContain('answer a2');
  });
});

describe('engine: automatic pushes', () => {
  it('does not push after auto-push was turned off during the wait', async () => {
    const fakeTimers = vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const t = await setup({ autoCommit: true, autoPush: true });
      const engine = new Engine({ ...(t.engine as unknown as { deps: ConstructorParameters<typeof Engine>[0] }).deps, pushDelayMs: 3000 });
      const { initId } = await engine.initStart(KEY);
      await engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId);
      const prev = { ...DEFAULT_SETTINGS, autoCommit: true, autoPush: true, repo: { owner: 'octo', name: 'chats', branch: 'main' } };
      t.setSettings({ autoPush: false });
      await engine.settingsChanged(prev, { ...prev, autoPush: false });
      await fakeTimers.advanceTimersByTimeAsync(5000);
      expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes waiting pushes when the worker starts again', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1')]);
    await t.engine.commit(KEY);
    t.setSettings({ autoCommit: true, autoPush: true });
    await t.engine.resume();
    await vi.waitFor(() => expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(true));
  });
});

describe('engine: conflicts and pushes in flight', () => {
  const at = (h: number, m = 0) => `2026-11-09T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
  const holdRef = (t: T) => t.fake.pause((r) => r.method === 'GET' && r.url.pathname.endsWith('/git/ref/heads/main'));

  it('keeps a commit made while an older, conflicting push was running', async () => {
    const t = await setup();
    const path = await trackAndPush(t, at(10));
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1', 'REMOTE-12')], at(12)) });
    await t.engine.snapshot(snap([bot('a1', 'v1')], { capturedAt: at(11) }), 'manual');
    await t.engine.commit(KEY);
    const hold = holdRef(t);
    const pushing = t.engine.push();
    await hold.reached;
    await t.engine.snapshot(snap([bot('a1', 'LOCAL-13')], { capturedAt: at(13) }), 'manual');
    await t.engine.commit(KEY);
    hold.release();
    await pushing;
    let s = await t.engine.status(KEY);
    expect(s.staged).toEqual([]);
    expect(s.aheadTotal).toBe(1);
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, path)).toContain('LOCAL-13');
    // an unrelated capture later must not bring an older version back
    await t.engine.snapshot(snap([bot('a1', 'LOCAL-13'), user('u2'), bot('a2')], { capturedAt: at(14) }), 'answered');
    await t.engine.push(KEY);
    s = await t.engine.status(KEY);
    expect(t.fake.fileAt(t.repo, path)).toContain('LOCAL-13');
    expect(t.fake.fileAt(t.repo, path)).toContain('answer a2');
  });

  it('takes another device\'s edit of a message this device did not change (three-way merge)', async () => {
    const t = await setup();
    const path = await trackAndPush(t, at(10));
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1', 'edited on B')], at(12)) });
    // a later capture here only covers the end of the chat: it says nothing new about a1
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: at(13) }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    expect(file).toContain('edited on B');
    expect(file).toContain('answer a2');
    expect(file).not.toContain('answer a1');
    expect((await t.engine.status(KEY)).staged).toEqual([]);
  });

  it('does not run a queued automatic push after auto-push was turned off', async () => {
    const t = await setup({ autoCommit: true });
    await track(t, [user('u1'), bot('a1')]);
    const hold = holdRef(t);
    const pushing = t.engine.push(); // a manual push is running...
    await hold.reached;
    t.setSettings({ autoPush: true });
    await t.engine.snapshot(snap([bot('a1'), user('u3'), bot('a3')], { capturedAt: at(12) }), 'answered'); // ...a new commit is made...
    const queued = t.engine.retry(); // ...and an automatic push asks to run after it
    const prev = { ...DEFAULT_SETTINGS, autoCommit: true, autoPush: true, repo: { owner: 'octo', name: 'chats', branch: 'main' } };
    t.setSettings({ autoPush: false });
    await t.engine.settingsChanged(prev, { ...prev, autoPush: false });
    hold.release();
    await pushing;
    await queued;
    expect((await t.engine.status(KEY)).aheadTotal).toBe(1);
    expect(t.fake.fileAt(t.repo, (await t.engine.status(KEY)).path!)).not.toContain('answer a3');
  });

  it('does not adopt a chat from a repository that was switched away from during the lookup', async () => {
    const t = await setup();
    t.fake.addRepo('other');
    const path = 'claude/2026-11-01-shared--c1.md';
    // unique content: blob texts are cached by SHA, and the pause below waits for a blob download
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1', `question ${crypto.randomUUID()}`), bot('a1')], at(9)) });
    const hold = t.fake.pause((r) => r.method === 'GET' && r.url.pathname.includes('/git/blobs/'));
    await t.engine.open({ service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'Shared' });
    await hold.reached;
    const B = { owner: 'octo', name: 'other', branch: 'main' };
    t.setSettings({ repo: B });
    await t.engine.settingsChanged({ ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' } }, { ...DEFAULT_SETTINGS, repo: B });
    hold.release();
    await new Promise((r) => setTimeout(r, 50));
    expect((await t.engine.status(KEY)).tracked).toBe(false);
  });

  it('carries visualization files of an adopted chat into a newly chosen repository', async () => {
    const t = await setup();
    const repoB = t.fake.addRepo('other');
    const path = 'claude/2026-11-01-shared--c1.md';
    const files = renderChat(
      {
        service: 'claude',
        chatId: 'c1',
        url: 'u',
        title: 'T',
        createdAt: at(9),
        capturedAt: at(9),
        messages: [user('u1'), { ...bot('a1', '> **Artifact:** [Chart](gitchat-asset:chart.html)'), assets: [{ name: 'chart.html', mime: 'text/html', data: '<b>chart</b>', encoding: 'utf8' }] }],
      },
      path,
    );
    await t.fake.commitFiles(t.repo, Object.fromEntries(files.map((f) => [f.path, f.content])));
    await t.engine.open({ service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'T' });
    await vi.waitFor(async () => expect((await t.engine.status(KEY)).tracked).toBe(true));
    expect((await t.engine.status(KEY)).staged).toEqual([]);
    const B = { owner: 'octo', name: 'other', branch: 'main' };
    t.setSettings({ repo: B });
    await t.engine.settingsChanged({ ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' } }, { ...DEFAULT_SETTINGS, repo: B });
    await t.engine.push(KEY);
    const inB = t.fake.paths(repoB);
    expect(inB).toContain('claude/2026-11-01-shared--c1.assets/chart.html');
    expect(t.fake.fileAt(repoB, 'claude/2026-11-01-shared--c1.assets/chart.html')).toBe('<b>chart</b>');
    expect(t.fake.fileAt(repoB, path)).toContain('(2026-11-01-shared--c1.assets/chart.html)');
  });
});

describe('engine: round-3 cases', () => {
  const at = (h: number) => `2026-11-09T${String(h).padStart(2, '0')}:00:00.000Z`;
  const chart = { name: 'chart.html', mime: 'text/html', data: '<b>chart</b>', encoding: 'utf8' as const };
  const withChart = (id: string) => ({ ...bot(id, '> **Artifact:** [Chart](gitchat-asset:chart.html)'), assets: [chart] });
  const chatFiles = (path: string, messages: CapturedMessage[], capturedAt: string) =>
    Object.fromEntries(renderChat({ service: 'claude', chatId: 'c1', url: 'u', title: 'T', createdAt: at(9), capturedAt, messages }, path).map((f) => [f.path, f.content]));
  const failChartDownloads = async (t: T, times = 3) => {
    const sha = await gitBlobSha(chart.data);
    t.fake.inject((r) => r.method === 'GET' && r.url.pathname.endsWith(`/git/blobs/${sha}`), () => new Response('unavailable', { status: 503 }), times);
  };

  it("keeps another device's merged edit when this page is read again unchanged", async () => {
    const t = await setup();
    const path = await trackAndPush(t, at(10));
    await t.fake.commitFiles(t.repo, { [path]: remoteFile(path, [user('u1'), bot('a1', 'EDITED ON B')], at(12)) });
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: at(13), atEnd: true }), 'answered');
    await t.engine.push(KEY);
    expect(t.fake.fileAt(t.repo, path)).toContain('EDITED ON B');
    // the page still shows a1 as it was read here: that is no edit
    await t.engine.snapshot(snap([user('u1'), bot('a1'), user('u2'), bot('a2'), user('u3'), bot('a3')], { capturedAt: at(14), atEnd: true }), 'answered');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    expect(file).toContain('EDITED ON B');
    expect(file).toContain('answer a3');
    expect(file).not.toContain('answer a1');
  });

  it('asks for a complete read when the first question was edited, and changes nothing until then', async () => {
    const t = await setup();
    await trackAndPush(t, at(10));
    const s = await t.engine.snapshot(snap([user('u1b'), bot('a1b')], { capturedAt: at(11), atEnd: true }), 'answered');
    expect(s.fullRead).toBe(true);
    expect(s.staged).toEqual([]);
    // a capture taken mid-turn is just not applied
    expect((await t.engine.snapshot(snap([user('u1b')], { capturedAt: at(11) }), 'sent')).fullRead).toBeUndefined();
    // the complete read of the (short, fully visible) chat settles it
    const full = await track(t, [user('u1b'), bot('a1b')], { capturedAt: at(12), startConfirmed: true });
    expect(full.staged.map((x) => `${x.id}:${x.kind}`)).toEqual(['u1b:text', 'a1b:text', 'u1:removed', 'a1:removed']);
  });

  it('asks for a complete read when a branch is captured away from the end, and still appends a new turn', async () => {
    const t = await setup();
    await track(t, [user('u1'), bot('a1'), user('u2'), bot('a2')], { capturedAt: at(10) });
    await t.engine.commit(KEY);
    const branch = await t.engine.snapshot(snap([bot('a1'), user('u2b'), bot('a2b')], { capturedAt: at(11), atEnd: false }), 'answered');
    expect(branch.fullRead).toBe(true);
    expect(branch.staged).toEqual([]);
    const appended = await t.engine.snapshot(snap([bot('a2'), user('u3'), bot('a3')], { capturedAt: at(12), atEnd: false }), 'answered');
    expect(appended.fullRead).toBeUndefined();
    expect(appended.staged.map((x) => x.id)).toEqual(['u3', 'a3']);
  });

  it('keeps older saved messages when a rescan could not confirm it reached the start of the chat', async () => {
    const t = await setup();
    const many = Array.from({ length: 48 }, (_, i) => [user(`u${i}`), bot(`a${i}`)]).flat();
    await track(t, many, { capturedAt: at(10) });
    await t.engine.commit(KEY);
    // the site only loaded the last 16 turns before the rescan stopped waiting
    const s = await track(t, many.slice(-32), { capturedAt: at(11) });
    expect(s.staged).toEqual([]);
    // with the start confirmed, a shorter history does replace
    const r = await track(t, many.slice(-4), { capturedAt: at(12), startConfirmed: true });
    expect(r.staged.filter((x) => x.kind === 'removed')).toHaveLength(92);
  });

  it('lets a cancel that arrives during the repository lookup win: nothing is tracked or committed', async () => {
    const t = await setup({ autoCommit: true });
    const { initId } = await t.engine.initStart(KEY);
    const hold = t.fake.pause((r) => r.method === 'GET' && r.url.pathname.endsWith('/git/ref/heads/main'));
    const done = t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId);
    await hold.reached;
    const cancelled = await t.engine.initCancel(KEY, initId);
    expect(cancelled).toMatchObject({ tracked: false, phase: 'idle' });
    hold.release();
    await expect(done).rejects.toMatchObject({ code: 'stale-init' });
    expect(await t.engine.status(KEY)).toMatchObject({ tracked: false, aheadTotal: 0 });
  });

  it('does not adopt a chat while a visualization file cannot be downloaded, and does once it can', async () => {
    const t = await setup();
    const path = 'claude/2026-11-01-shared--c1.md';
    await t.fake.commitFiles(t.repo, chatFiles(path, [user('u1'), withChart('a1')], at(9)));
    await failChartDownloads(t);
    await t.engine.open({ service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'T' });
    await new Promise((r) => setTimeout(r, 50));
    expect((await t.engine.status(KEY)).tracked).toBe(false);
    await t.engine.open({ service: 'claude', chatId: 'c1', url: 'https://claude.ai/chat/c1', title: 'T' });
    await vi.waitFor(async () => expect((await t.engine.status(KEY)).tracked).toBe(true));
    expect((await t.engine.status(KEY)).staged).toEqual([]);
  });

  it('fails a push instead of dropping a link whose file could not be downloaded', async () => {
    const t = await setup();
    const path = await trackAndPush(t, at(10));
    await t.fake.commitFiles(t.repo, chatFiles(path, [user('u1'), withChart('a1')], at(12)));
    await t.engine.snapshot(snap([bot('a1'), user('u2'), bot('a2')], { capturedAt: at(13), atEnd: true }), 'answered');
    await failChartDownloads(t);
    await expect(t.engine.push(KEY)).rejects.toBeTruthy();
    expect(t.fake.fileAt(t.repo, path)).toContain('.assets/chart.html)');
    await t.engine.push(KEY);
    const file = t.fake.fileAt(t.repo, path)!;
    expect(file).toContain('.assets/chart.html)');
    expect(file).toContain('answer a2');
  });

  it("keeps the repository copy's saved visualization when a newer init only sees a closed card", async () => {
    const t = await setup();
    const path = 'claude/2026-11-01-shared--c1.md';
    await t.fake.commitFiles(t.repo, chatFiles(path, [user('u1'), withChart('a1')], at(9)));
    const s = await track(t, [user('u1'), bot('a1', '> **Artifact:** Chart')], { capturedAt: at(12) });
    expect(s.staged).toEqual([]);
    await t.engine.push(KEY);
    expect(t.fake.fileAt(t.repo, path)).toContain('(2026-11-01-shared--c1.assets/chart.html)');
  });
});

describe('engine: waiting, recovery and status', () => {
  const at = (h: number) => `2026-11-09T${String(h).padStart(2, '0')}:00:00.000Z`;
  const depsOf = (t: T) => (t.engine as unknown as { deps: ConstructorParameters<typeof Engine>[0] }).deps;
  const rateLimitOnce = (t: T) =>
    t.fake.inject(
      (r) => r.method === 'GET' && r.url.pathname.endsWith('/git/ref/heads/main'),
      () => new Response(JSON.stringify({ message: 'rate limited' }), { status: 429, headers: { 'retry-after': '600', 'content-type': 'application/json' } }),
      2, // the init's repository lookup, then the automatic push
    );
  /** An automatic push hit a 10-minute rate limit; returns the clock and the engine that saw it. */
  async function rateLimited(t: T) {
    const clock = { now: Date.parse(at(10)) };
    const alarms: number[] = [];
    const engine = new Engine({ ...depsOf(t), now: () => clock.now, scheduleRetry: (ms) => alarms.push(ms), clearRetry: () => undefined });
    rateLimitOnce(t);
    const { initId } = await engine.initStart(KEY);
    await engine.initDone(snap([user('u1'), bot('a1')], { complete: true, capturedAt: at(10) }), initId);
    await vi.waitFor(() => expect(alarms).toContain(600_000));
    return clock;
  }

  it('keeps waiting out a rate limit after the worker restarts', async () => {
    const t = await setup({ autoCommit: true, autoPush: true });
    const clock = await rateLimited(t);
    const before = t.fake.commitCount(t.repo);
    // the worker is restarted a minute later
    clock.now += 60_000;
    const alarms: number[] = [];
    const restarted = new Engine({ ...depsOf(t), now: () => clock.now, scheduleRetry: (ms) => alarms.push(ms), clearRetry: () => undefined });
    await restarted.resume();
    expect(alarms).toEqual([540_000]);
    await restarted.retry(); // an early wake-up does not push either
    expect(t.fake.commitCount(t.repo)).toBe(before);
    // once the wait is over, the automatic push goes
    clock.now += 540_000;
    await restarted.retry();
    expect(t.fake.commitCount(t.repo)).toBeGreaterThan(before);
    expect((await restarted.syncStatus()).pending).toBe(0);
  });

  it('still pushes right away when asked to, during the wait', async () => {
    const t = await setup({ autoCommit: true, autoPush: true });
    const clock = await rateLimited(t);
    clock.now += 60_000;
    const restarted = new Engine({ ...depsOf(t), now: () => clock.now, scheduleRetry: () => undefined, clearRetry: () => undefined });
    await restarted.push(KEY);
    expect((await restarted.syncStatus()).pending).toBe(0);
    // and the wait is over: the next automatic push needn't wait
    const meta = await depsOf(t).db.getMeta<{ nextAllowedAt?: number }>('sync');
    expect(meta?.nextAllowedAt).toBeUndefined();
  });

  it('recovers from "choose a repository first" once one is chosen', async () => {
    const t = await setup({ autoCommit: true, autoPush: true, repo: null });
    const { initId } = await t.engine.initStart(KEY);
    await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }), initId);
    await vi.waitFor(async () => expect((await t.engine.syncStatus()).lastError).toBeTruthy());
    const prev = { ...DEFAULT_SETTINGS, autoCommit: true, autoPush: true, repo: null };
    const repo = { owner: 'octo', name: 'chats', branch: 'main' };
    t.setSettings({ repo });
    await t.engine.settingsChanged(prev, { ...prev, repo });
    await vi.waitFor(async () => expect((await t.engine.syncStatus()).pending).toBe(0));
    expect((await t.engine.syncStatus()).lastError).toBeUndefined();
    expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(true);
  });

  it('reports what is staged after every change, even several in the same millisecond', async () => {
    const t = await setup();
    const engine = new Engine({ ...depsOf(t), now: () => Date.parse(at(10)) });
    const { initId } = await engine.initStart(KEY);
    await engine.initDone(snap([user('u1'), bot('a1')], { complete: true, capturedAt: at(10) }), initId);
    expect((await engine.status(KEY)).staged.map((x) => x.id)).toEqual(['u1', 'a1']);
    await engine.commit(KEY);
    expect((await engine.status(KEY)).staged).toEqual([]);
    await engine.snapshot(snap([user('u1'), bot('a1', 'changed')], { capturedAt: at(10) }), 'manual');
    expect((await engine.status(KEY)).staged.map((x) => x.id)).toEqual(['a1']);
    expect((await engine.status(KEY)).staged.map((x) => x.id)).toEqual(['a1']);
  });
});
