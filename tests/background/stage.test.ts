import { describe, expect, it } from 'vitest';
import { diffStaged, mergeSnapshot, messageHash, refsOf } from '../../src/background/stage';
import type { CapturedMessage, ChatSnapshot } from '../../src/shared/types';

const msg = (id: string, text = id, role: CapturedMessage['role'] = 'user', kinds?: string[]): CapturedMessage => ({ id, role, markdown: text, ...(kinds ? { kinds } : {}) });
const snap = (messages: CapturedMessage[], complete = false): ChatSnapshot => ({
  service: 'claude',
  chatId: 'c1',
  url: 'https://claude.ai/chat/c1',
  title: 'T',
  messages,
  capturedAt: '2026-11-09T10:00:00.000Z',
  complete,
});

describe('mergeSnapshot', () => {
  it('upserts a live capture: updates known ids, appends new ones, keeps the rest', () => {
    const known = [msg('a'), msg('b'), msg('c')];
    const r = mergeSnapshot(known, snap([msg('b', 'B2'), msg('c'), msg('d'), msg('e')]));
    expect(r.ok && r.messages.map((m) => `${m.id}:${m.markdown}`)).toEqual(['a:a', 'b:B2', 'c:c', 'd:d', 'e:e']);
  });

  it('keeps old messages when the site has unloaded them (virtualized lists)', () => {
    const known = [msg('a'), msg('b'), msg('c'), msg('d')];
    const r = mergeSnapshot(known, snap([msg('d'), msg('e')]));
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lets a complete capture replace the list, removing messages', () => {
    const r = mergeSnapshot([msg('a'), msg('b'), msg('c')], snap([msg('a'), msg('x')], true));
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['a', 'x']);
  });

  it('refuses an empty complete capture but ignores an empty live one', () => {
    expect(mergeSnapshot([msg('a')], snap([], true)).ok).toBe(false);
    const r = mergeSnapshot([msg('a')], snap([]));
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['a']);
  });

  it('gives repeated ids in one capture stable suffixes', () => {
    const r = mergeSnapshot([], snap([msg('a', '1'), msg('a', '2')]));
    expect(r.ok && r.messages.map((m) => m.id)).toEqual(['a', 'a#2']);
    const again = mergeSnapshot(r.ok ? r.messages : [], snap([msg('a', '1'), msg('a', '2')]));
    expect(again.ok && again.messages.length).toBe(2);
  });
});

describe('diffStaged', () => {
  it('lists new, changed and removed messages with their most notable kind', () => {
    const committed = refsOf([msg('a'), msg('b'), msg('gone')]);
    const current = [msg('a'), msg('b', 'changed', 'assistant', ['code', 'math']), msg('c', 'new', 'assistant', ['viz'])];
    expect(diffStaged(current, committed)).toEqual([
      { id: 'b', role: 'assistant', kind: 'math' },
      { id: 'c', role: 'assistant', kind: 'viz' },
      { id: 'gone', role: 'user', kind: 'removed' },
    ]);
    expect(diffStaged(current, refsOf(current))).toEqual([]);
  });

  it('ignores whitespace at the edges', () => {
    expect(messageHash(msg('a', 'text  \n'))).toBe(messageHash(msg('a', '\ntext')));
  });
});
