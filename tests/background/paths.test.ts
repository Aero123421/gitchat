import { describe, expect, it } from 'vitest';
import { assetDir, chatFileCandidates, chatPath, encodePath, freePath, localDate, repoId, shortId, slugify } from '../../src/background/paths';

describe('slugify', () => {
  it('lower-cases and joins words with dashes', () => {
    expect(slugify('  React State: Design & Tips!  ')).toBe('react-state-design-tips');
  });

  it('keeps letters of any script', () => {
    expect(slugify('状態管理の設計 (React)')).toBe('状態管理の設計-react');
    expect(slugify('Ｆｕｌｌ　ｗｉｄｔｈ')).toBe('full-width');
  });

  it('falls back to "chat" when nothing is left', () => {
    expect(slugify('')).toBe('chat');
    expect(slugify('!!! ??? 🙂')).toBe('chat');
  });

  it('cuts to 48 characters without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(47)} bbb`);
    expect(Array.from(s).length).toBeLessThanOrEqual(48);
    expect(s.endsWith('-')).toBe(false);
    expect(Array.from(slugify('あ'.repeat(60))).length).toBe(48);
  });
});

describe('paths', () => {
  it('builds <service>/<date>-<slug>--<id8>.md', () => {
    const created = new Date(2026, 10, 9, 12).toISOString();
    expect(chatPath('claude', 'State design', '1f2e3d4c-aaaa-bbbb', created)).toBe('claude/2026-11-09-state-design--1f2e3d4c.md');
    expect(localDate(created)).toBe('2026-11-09');
  });

  it('makes short ids file-name safe', () => {
    expect(shortId('c_8f2a!9d/77e1')).toBe('c_8f2a9d');
    expect(shortId('???')).toMatch(/^[a-z0-9]{1,8}$/);
  });

  it('lists the files that may belong to a chat, by id suffix', () => {
    const paths = ['README.md', 'claude/2026-01-02-old-title--1f2e3d4c.md', 'claude/x--1f2e3d4c.assets/viz.html', 'gemini/2026-01-02-a--1f2e3d4c.md', 'claude/b--1f2e3d4c-aaaa.md', 'claude/c--1f2e3d4c-bbbb.md'];
    expect(chatFileCandidates(paths, 'claude', '1f2e3d4c-aaaa')).toEqual(['claude/b--1f2e3d4c-aaaa.md', 'claude/2026-01-02-old-title--1f2e3d4c.md']);
    expect(chatFileCandidates(paths, 'chatgpt', '1f2e3d4c-aaaa')).toEqual([]);
    expect(chatFileCandidates(['claude/a--c1.md'], 'claude', 'c1')).toEqual(['claude/a--c1.md']);
  });

  it('uses a longer id suffix when another chat has the name', () => {
    const created = new Date(2026, 10, 9, 12).toISOString();
    const taken = new Set(['claude/2026-11-09-t--deadbeef.md']);
    expect(freePath('claude', 'T', 'deadbeef-1111-2222', created, (p) => taken.has(p))).toBe('claude/2026-11-09-t--deadbeef-1111-22.md');
  });

  it('identifies a repository by owner, name and branch', () => {
    expect(repoId({ owner: 'Octo', name: 'Chats', branch: 'main' })).toBe('octo/chats@main');
    expect(repoId(null)).toBeNull();
  });

  it('derives the asset folder and encodes URL paths', () => {
    expect(assetDir('claude/a--b.md')).toBe('claude/a--b.assets');
    expect(encodePath('claude/状態 1.md')).toBe(`claude/${encodeURIComponent('状態 1.md')}`);
  });
});
