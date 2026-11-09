import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/background/engine';
import { GitHub } from '../../src/background/github/client';
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

/** Tracks chat c1 with two messages and pushes it once. Returns the file path. */
async function trackAndPush(t: Awaited<ReturnType<typeof setup>>, capturedAt = '2026-11-09T10:00:00.000Z') {
  await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true, capturedAt }));
  await t.engine.commit(KEY);
  await t.engine.push();
  return (await t.engine.status(KEY)).path!;
}

describe('engine: commit and push', () => {
  it('tracks a chat on init, commits it, and pushes into an empty repository', async () => {
    const t = await setup();
    let s = await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }));
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
    expect(t.fake.fileAt(t.repo, s.path!)).toContain('## Assistant\n<!-- gitchat:message id="a1" -->\n\nanswer a1');
  });

  it('pushes later commits fast-forward', async () => {
    const t = await setup();
    const path = await trackAndPush(t);
    const before = t.fake.commitCount(t.repo);
    await t.engine.snapshot(snap([user('u2'), bot('a2')]), 'answered');
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

  it('skips our commit when another device pushed a newer capture of the same chat', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    const theirs = renderChat({ service: 'claude', chatId: 'c1', url: 'u', title: 'T', createdAt: '2026-11-09T10:00:00.000Z', capturedAt: '2026-11-09T12:00:00.000Z', messages: [user('u1'), bot('a1'), user('u9'), bot('a9')] }, path)[0]!.content;
    await t.fake.commitFiles(t.repo, { [path]: theirs });
    await t.engine.snapshot(snap([user('u2')], { capturedAt: '2026-11-09T11:00:00.000Z' }), 'answered');
    await t.engine.commit(KEY);
    await t.engine.push();
    expect(t.fake.fileAt(t.repo, path)).toBe(theirs);
    const s = await t.engine.status(KEY);
    expect(s.aheadTotal).toBe(0);
    expect(s.commits.every((c) => c.pushed)).toBe(true);
  });

  it('overwrites an older capture pushed by another device', async () => {
    const t = await setup();
    const path = await trackAndPush(t, '2026-11-09T10:00:00.000Z');
    const theirs = renderChat({ service: 'claude', chatId: 'c1', url: 'u', title: 'T', createdAt: '2026-11-09T10:00:00.000Z', capturedAt: '2026-11-09T10:30:00.000Z', messages: [user('u1')] }, path)[0]!.content;
    await t.fake.commitFiles(t.repo, { [path]: theirs });
    await t.engine.snapshot(snap([user('u2'), bot('a2')], { capturedAt: '2026-11-09T11:00:00.000Z' }), 'answered');
    await t.engine.push(KEY);
    expect(t.fake.fileAt(t.repo, path)).toContain('answer a2');
  });

  it('writes to the file another device already created for the chat', async () => {
    const t = await setup();
    await t.fake.commitFiles(t.repo, { 'README.md': '<!-- gitchat -->', 'claude/2026-01-01-old-title--c1.md': '---\ngitchat: 1\ncaptured: 2026-01-01T00:00:00.000Z\nmessages: 1\n---\n' });
    await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true, title: 'New title' }));
    await t.engine.push(KEY);
    const paths = t.fake.paths(t.repo);
    expect(paths).toEqual(['README.md', 'claude/2026-01-01-old-title--c1.md']);
    expect(t.fake.fileAt(t.repo, 'claude/2026-01-01-old-title--c1.md')).toContain('# New title');
  });

  it('confirms the path at push time when the repository was unreachable at init', async () => {
    const t = await setup({ repo: null });
    await t.engine.initDone(snap([user('u1')], { complete: true, title: 'Offline' }));
    t.setSettings({ repo: { owner: 'octo', name: 'chats', branch: 'main' } });
    await t.fake.commitFiles(t.repo, { 'claude/2026-02-02-from-laptop--c1.md': '---\ngitchat: 1\ncaptured: 2026-01-01T00:00:00.000Z\nmessages: 1\n---\n' });
    await t.engine.push(KEY);
    expect(t.fake.paths(t.repo)).toEqual(['claude/2026-02-02-from-laptop--c1.md']);
    expect((await t.engine.status(KEY)).path).toBe('claude/2026-02-02-from-laptop--c1.md');
  });

  it('continues a chat that another device saved, staging only what is new', async () => {
    const t = await setup();
    const path = 'claude/2026-11-01-shared--c1.md';
    const file = renderChat({ service: 'claude', chatId: 'c1', url: 'u', title: 'Shared', createdAt: '2026-11-01T00:00:00.000Z', capturedAt: '2026-11-01T00:00:00.000Z', messages: [user('u1'), bot('a1')] }, path)[0]!.content;
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
    await t.engine.initDone(snap([user('u1'), bot('a1')], { complete: true }));
    await vi.waitFor(() => expect(t.fake.paths(t.repo).some((p) => p.startsWith('claude/'))).toBe(true));
    const path = (await t.engine.status(KEY)).path!;

    let s = await t.engine.snapshot(snap([user('u2')]), 'sent');
    expect(s.staged.map((x) => x.id)).toEqual(['u2']);
    expect(s.commits.filter((c) => !c.pushed)).toEqual([]);

    s = await t.engine.snapshot(snap([user('u2'), bot('a2')]), 'answered');
    expect(s.staged).toEqual([]);
    await vi.waitFor(() => expect(t.fake.fileAt(t.repo, path)).toContain('answer a2'));
  });

  it('commits staged work before pushing', async () => {
    const t = await setup();
    await t.engine.initDone(snap([user('u1')], { complete: true }));
    const s = await t.engine.push(KEY);
    expect(s?.staged).toEqual([]);
    expect(s?.commits).toMatchObject([{ pushed: true }]);
  });

  it('turning auto-commit on commits what is already staged', async () => {
    const t = await setup();
    await t.engine.initDone(snap([user('u1')], { complete: true }));
    const prev = { ...DEFAULT_SETTINGS, repo: { owner: 'octo', name: 'chats', branch: 'main' } };
    await t.engine.settingsChanged(prev, { ...prev, autoCommit: true });
    expect((await t.engine.status(KEY)).commits).toHaveLength(1);
  });

  it('shows why a push failed on chats with unpushed commits', async () => {
    const t = await setup();
    await t.engine.initDone(snap([user('u1')], { complete: true }));
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
    await t.engine.initStart(KEY);
    await t.engine.initProgress(KEY, 0.4);
    const s = await t.engine.status(KEY);
    expect(s).toMatchObject({ phase: 'capturing', progress: 0.4, tracked: false });
    expect((await t.engine.initCancel(KEY)).phase).toBe('idle');
  });
});
