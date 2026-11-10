import { describe, expect, it } from 'vitest';
import { materializeAssets } from '../../src/background/assets';
import { diffStaged, hashesOf, keepArtifacts, keepChangesSince, mergeSnapshot, messageHash, recordReads, refsOf, threeWayMerge, unionMessages } from '../../src/background/stage';
import type { PageRead } from '../../src/background/model';
import type { CapturedMessage, ChatSnapshot } from '../../src/shared/types';

const msg = (id: string, text = id, role: CapturedMessage['role'] = 'user', kinds?: string[]): CapturedMessage => ({ id, role, markdown: text, ...(kinds ? { kinds } : {}) });
const u = (id: string, text = id) => msg(id, text, 'user');
const a = (id: string, text = id) => msg(id, text, 'assistant');
const snap = (messages: CapturedMessage[], complete = false, atEnd?: boolean): ChatSnapshot => ({
  service: 'claude',
  chatId: 'c1',
  url: 'https://claude.ai/chat/c1',
  title: 'T',
  messages,
  capturedAt: '2026-11-09T10:00:00.000Z',
  complete,
  ...(atEnd === undefined ? {} : { atEnd }),
});
const ids = (r: ReturnType<typeof mergeSnapshot>) => (r.ok ? r.messages.map((m) => m.id) : r.code);
/** Page reads: every message read at `at` (epoch ms) by `view`, as it is now. */
const readsOf = (messages: CapturedMessage[], at = 0, view?: string) =>
  new Map<string, PageRead>(messages.map((m) => [m.id, { h: messageHash(m), at, ...(view ? { v: [view] } : {}) }]));

describe('mergeSnapshot', () => {
  it('upserts a live capture: updates known ids, appends new ones, keeps the rest', () => {
    const known = [msg('a'), msg('b'), msg('c')];
    const r = mergeSnapshot(known, snap([msg('b', 'B2'), msg('c'), msg('d'), msg('e')]));
    expect(r.ok && r.messages.map((m) => `${m.id}:${m.markdown}`)).toEqual(['a:a', 'b:B2', 'c:c', 'd:d', 'e:e']);
  });

  it('keeps old messages when the site has unloaded them (virtualized lists)', () => {
    const known = [msg('a'), msg('b'), msg('c'), msg('d')];
    expect(ids(mergeSnapshot(known, snap([msg('d'), msg('e')])))).toEqual(['a', 'b', 'c', 'd', 'e']);
    // the window at the end of a long chat, with a new turn: nothing above it is lost
    expect(ids(mergeSnapshot(known, snap([msg('c'), msg('d'), msg('e')], false, true)))).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lets a complete capture replace the list from its first message on, removing messages', () => {
    expect(ids(mergeSnapshot([u('a'), a('b'), u('c')], snap([u('a'), a('x')], true)))).toEqual(['a', 'x']);
  });

  it('keeps saved messages before a complete capture whose start is not confirmed (older history may not have loaded)', () => {
    const chat = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')];
    // only the last two turns loaded: nothing before them is removed, the rest is replaced
    expect(ids(mergeSnapshot(chat, snap([u('u2'), a('a2b'), u('u4'), a('a4')], true)))).toEqual(['u1', 'a1', 'u2', 'a2b', 'u4', 'a4']);
    // nothing in common, and the start is not confirmed: keep the saved chat, do not concatenate
    expect(ids(mergeSnapshot(chat, snap([u('x1'), a('x2')], true)))).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
    // a long reread that reached the start replaces the old branch, it does not append it
    const long = Array.from({ length: 12 }, (_, i) => (i % 2 ? a(`a${i}`) : u(`u${i}`)));
    const branch = [u('x1'), a('x2'), u('x3'), a('x4'), u('x5'), a('x6'), u('x7'), a('x8'), u('x9'), a('x10')];
    expect(ids(mergeSnapshot(long, { ...snap(branch, true), startConfirmed: true }))).toEqual(branch.map((m) => m.id));
    expect(ids(mergeSnapshot(long, snap(branch, true)))).toEqual(long.map((m) => m.id));
    // the start is confirmed (e.g. the whole chat was on screen): a full replacement
    expect(ids(mergeSnapshot(chat, { ...snap([u('x1'), a('x2')], true), startConfirmed: true }))).toEqual(['x1', 'x2']);
    expect(ids(mergeSnapshot(chat, { ...snap([u('u2'), a('a2')], true), startConfirmed: true }))).toEqual(['u2', 'a2']);
  });

  it('refuses an empty complete capture, or one with questions but no answers', () => {
    expect(mergeSnapshot([msg('a')], snap([], true))).toMatchObject({ ok: false, code: 'empty' });
    expect(mergeSnapshot([], snap([u('u1'), u('u2')], true))).toMatchObject({ ok: false, code: 'invalid' });
    expect(ids(mergeSnapshot([], snap([u('u1')], true)))).toEqual(['u1']);
    expect(ids(mergeSnapshot([msg('a')], snap([])))).toEqual(['a']);
  });

  it('gives repeated ids in one capture stable suffixes', () => {
    const r = mergeSnapshot([], snap([msg('a', '1'), msg('a', '2')]));
    expect(ids(r)).toEqual(['a', 'a#2']);
    const again = mergeSnapshot(r.ok ? r.messages : [], snap([msg('a', '1'), msg('a', '2')]));
    expect(again.ok && again.messages.length).toBe(2);
  });

  describe('branches', () => {
    const chat = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')];

    it('drops the old branch when turn 2 was edited', () => {
      const r = mergeSnapshot(chat, snap([u('u1'), a('a1'), u('u2b'), a('a2b')], false, true));
      expect(ids(r)).toEqual(['u1', 'a1', 'u2b', 'a2b']);
      const staged = diffStaged(r.ok ? r.messages : [], refsOf(chat));
      expect(staged.filter((s) => s.kind === 'removed').map((s) => s.id)).toEqual(['u2', 'a2', 'u3', 'a3']);
    });

    it('replaces a regenerated last answer', () => {
      expect(ids(mergeSnapshot(chat, snap([u('u3'), a('a3b')], false, true)))).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3b']);
    });

    it('drops nothing for a window in the middle; a shorter end needs a complete read', () => {
      expect(ids(mergeSnapshot(chat, snap([a('a1'), u('u2'), a('a2')], false, false)))).toEqual(ids({ ok: true, messages: chat }));
      // the end got shorter: a branch switch back, or a page still loading. Only a complete read can tell.
      expect(ids(mergeSnapshot(chat, snap([u('u1'), a('a1'), u('u2')], false, true)))).toBe('ambiguous');
      // ...unless what follows was never read on this page (another device's copy)
      expect(ids(mergeSnapshot(chat, snap([u('u1'), a('a1'), u('u2')], false, true), readsOf(chat.slice(0, 3))))).toEqual(chat.map((m) => m.id));
    });

    it('asks for a complete read when an edit of the first question leaves nothing in common', () => {
      expect(ids(mergeSnapshot(chat, snap([u('u1b'), a('a1b')], false, true)))).toBe('ambiguous');
      expect(ids(mergeSnapshot(chat, snap([u('u1b')], false, false)))).toBe('ambiguous');
      // a new chat (nothing saved yet) takes it as it is; an empty capture changes nothing
      expect(ids(mergeSnapshot([], snap([u('u1'), a('a1')], false, true)))).toEqual(['u1', 'a1']);
      expect(ids(mergeSnapshot(chat, snap([], false, true)))).toEqual(chat.map((m) => m.id));
    });

    it('refuses a branch seen away from the end, and still appends a new turn', () => {
      // new ids before the last known one: not placed yet
      expect(ids(mergeSnapshot(chat, snap([u('x1'), a('x2'), a('a2')], false, false)))).toEqual(chat.map((m) => m.id));
      // an unknown id after a known one, where the saved chat continues with a different message
      expect(ids(mergeSnapshot(chat, snap([u('u1'), a('a1'), u('u2b'), a('a2b')], false, false)))).toBe('ambiguous');
      const short = [u('u1'), a('a1'), u('u2'), a('a2')];
      expect(ids(mergeSnapshot(short, snap([a('a1'), u('u2b'), a('a2b')], false, false)))).toBe('ambiguous');
      // a new turn after the last saved message is an append, and a window of known ids changes nothing
      expect(ids(mergeSnapshot(short, snap([a('a2'), u('u3'), a('a3')], false, false)))).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
      expect(ids(mergeSnapshot(chat, snap([a('a1'), u('u2'), a('a2')], false, false)))).toEqual(chat.map((m) => m.id));
      // at the end, the same branch still replaces the suffix
      expect(ids(mergeSnapshot(chat, snap([u('u1'), a('a1'), u('u2b'), a('a2b')], false, true)))).toEqual(['u1', 'a1', 'u2b', 'a2b']);
      // a successor this view never saw (another device) does not turn a new turn into a branch
      const remote = [u('u1'), a('a1'), u('u9'), a('a9')];
      expect(ids(mergeSnapshot(remote, snap([a('a1'), u('u2'), a('a2')], false, false), readsOf(remote.slice(0, 2))))).toEqual(['u1', 'a1', 'u9', 'a9', 'u2', 'a2']);
    });

    it('never prunes messages this device did not see on the page (they came from another device)', () => {
      const merged = [u('u1'), a('a1'), u('u2'), a('a2'), u('u9'), a('a9')];
      const seen = readsOf(merged.slice(0, 2)); // u2..a9 arrived with another device's copy
      expect(ids(mergeSnapshot(merged, snap([a('a1'), u('u3'), a('a3')], false, true), seen))).toEqual(['u1', 'a1', 'u2', 'a2', 'u9', 'a9', 'u3', 'a3']);
      // seen ones the page no longer shows are still a branch change
      const seen2 = readsOf(merged.slice(0, 4));
      expect(ids(mergeSnapshot(merged, snap([a('a1'), u('u3'), a('a3')], false, true), seen2))).toEqual(['u1', 'a1', 'u9', 'a9', 'u3', 'a3']);
    });

    it('lets a page view prune only what it could have shown', () => {
      const merged = [u('u1'), a('a1'), u('u2'), a('a2'), u('u9'), a('a9')];
      // u1..a2 were read before view T1 started; u9, a9 only later, by another tab T2
      const reads = new Map([...readsOf(merged.slice(0, 4), 100), ...readsOf(merged.slice(4), 500, 'T2')]);
      const stale = (view: { id: string; since: number }) => ({ ...snap([a('a1'), u('u3'), a('a3')], false, true), view });
      expect(ids(mergeSnapshot(merged, stale({ id: 'T1', since: 200 }), reads))).toEqual(['u1', 'a1', 'u9', 'a9', 'u3', 'a3']);
      // a view started after they were read (e.g. the page was reloaded) could have shown them
      expect(ids(mergeSnapshot(merged, stale({ id: 'T3', since: 600 }), reads))).toEqual(['u1', 'a1', 'u3', 'a3']);
      // and so could the view that read them
      expect(ids(mergeSnapshot(merged, stale({ id: 'T2', since: 400 }), reads))).toEqual(['u1', 'a1', 'u3', 'a3']);
    });
  });

  describe('readings that did not change', () => {
    it("lets a stale tab re-read its old text without undoing an edit another tab read since (per-view readings)", () => {
      const original = [u('u1'), a('a1', 'ORIGINAL')];
      const A = { id: 'A', since: 1 };
      const B = { id: 'B', since: 50 };
      // tab A reads ORIGINAL
      let reads = new Map(Object.entries(recordReads(new Map(), original, original, A, 10)));
      // another device's edit is merged in
      let chat = [u('u1'), a('a1', 'REMOTE EDIT')];
      // a new tab B reads the edited text
      const readB = { ...snap([u('u1'), a('a1', 'REMOTE EDIT')], false, true), view: B };
      let r = mergeSnapshot(chat, readB, reads);
      chat = r.ok ? r.messages : chat;
      reads = new Map(Object.entries(recordReads(reads, readB.messages, chat, B, 60)));
      expect(reads.get('a1')?.h).toBe(messageHash(a('a1', 'REMOTE EDIT')));
      // the stale tab A reads its unchanged page again: still the edit
      r = mergeSnapshot(chat, { ...snap(original, false, true), view: A }, reads);
      expect(r.ok && r.messages[1]!.markdown).toBe('REMOTE EDIT');
      // ...but a tab that never read it goes by the device's last reading: ORIGINAL is a change there
      r = mergeSnapshot(chat, { ...snap(original, false, true), view: { id: 'C', since: 70 } }, reads);
      expect(r.ok && r.messages[1]!.markdown).toBe('ORIGINAL');
    });

    it('keeps a merged edit from another device while the page still shows what it showed', () => {
      const pageVersion = [u('u1'), a('a1', 'ORIGINAL')];
      const reads = readsOf(pageVersion);
      const merged = [u('u1'), a('a1', 'EDITED ON B')];
      const r = mergeSnapshot(merged, snap([u('u1'), a('a1', 'ORIGINAL'), u('u2'), a('a2')], false, true), reads);
      expect(r.ok && r.messages.map((m) => m.markdown)).toEqual(['u1', 'EDITED ON B', 'u2', 'a2']);
      // a complete read too
      const full = mergeSnapshot(merged, snap(pageVersion, true), reads);
      expect(full.ok && full.messages[1]!.markdown).toBe('EDITED ON B');
      // a reading that did change on the page wins
      const changed = mergeSnapshot(merged, snap([u('u1'), a('a1', 'CHANGED HERE')], false, true), reads);
      expect(changed.ok && changed.messages[1]!.markdown).toBe('CHANGED HERE');
    });

    it('records each reading, keeping when a message was first read and by which views', () => {
      const before = new Map<string, PageRead>([['u1', { h: 'x', at: 5, v: ['T1'] }]]);
      const out = recordReads(before, [u('u1'), a('a1')], [u('u1'), a('a1')], { id: 'T2' }, 9);
      expect(out).toEqual({
        u1: { h: messageHash(u('u1')), at: 5, v: ['T2', 'T1'], hv: { T2: messageHash(u('u1')) } },
        a1: { h: messageHash(a('a1')), at: 9, v: ['T2'], hv: { T2: messageHash(a('a1')) } },
      });
      // messages the chat no longer has are forgotten
      expect(Object.keys(recordReads(before, [a('a1')], [a('a1')], undefined, 9))).toEqual(['a1']);
    });

    it('keeps an open tab from rewinding a message after four newer views have read it', () => {
      const original = [u('u1', 'ORIGINAL')];
      const remote = [u('u1', 'REMOTE')];
      let reads = new Map(Object.entries(recordReads(new Map(), original, original, { id: 'A' }, 1)));
      for (const id of ['B', 'C', 'D', 'E']) {
        reads = new Map(Object.entries(recordReads(reads, remote, remote, { id }, 2)));
      }
      expect(reads.get('u1')?.v).toEqual(['E', 'D', 'C', 'B']);
      expect(reads.get('u1')?.hv?.A).toBe(messageHash(original[0]!));
      const r = mergeSnapshot(remote, { ...snap(original, false, true), view: { id: 'A', since: 0 } }, reads);
      expect(r.ok && r.messages[0]!.markdown).toBe('REMOTE');
    });
  });
});

describe('visualizations', () => {
  const asset = (name: string, data: string) => ({ name, mime: 'text/html', data, encoding: 'utf8' as const });
  const saved: CapturedMessage = { ...a('a1', 'Here.\n\n> **Artifact:** [Chart](gitchat-asset:chart.html)'), assets: [asset('chart.html', '<b>1</b>')], kinds: ['viz'] };

  it('keeps a saved visualization when its frame is gone', () => {
    const later = keepArtifacts(saved, a('a1', 'Here.\n\n> **Artifact:** Chart'));
    expect(later.markdown).toBe(saved.markdown);
    expect(later.assets).toEqual(saved.assets);
    expect(later.kinds).toContain('viz');
    const merged = mergeSnapshot([u('u1'), saved], snap([u('u1'), a('a1', 'Here.\n\n> **Artifact:** Chart')]));
    expect(merged.ok && merged.messages[1]).toEqual({ ...saved, kinds: ['viz'] });
  });

  it('updates a visualization in place, under the name it had', () => {
    const fromRepo = a('a1', 'Here.\n\n> **Artifact:** [Chart](x--c1.assets/chart-2.html)');
    const fresh = { ...a('a1', 'Here.\n\n> **Artifact:** [Chart](gitchat-asset:chart.html)'), assets: [asset('chart.html', '<b>2</b>')] };
    const kept = keepArtifacts(fromRepo, fresh);
    expect(kept.markdown).toContain('(gitchat-asset:chart-2.html)');
    expect(kept.assets?.map((x) => x.name)).toEqual(['chart-2.html']);
  });

  it('stages a change of the visualization alone', () => {
    const changed = { ...saved, assets: [asset('chart.html', '<b>2</b>')] };
    expect(diffStaged([changed], refsOf([saved])).map((s) => s.id)).toEqual(['a1']);
  });

  it('keeps File cards and titles with brackets, matching whole cards only', () => {
    const file = { ...a('a1', '> **File:** [report \\[v2\\].html](gitchat-asset:report.html)'), assets: [asset('report.html', 'r')] };
    const kept = keepArtifacts(file, a('a1', '> **File:** report [v2].html'));
    expect(kept.markdown).toBe(file.markdown);
    expect(kept.assets?.map((x) => x.name)).toEqual(['report.html']);
    // "Chart 2" is another card: nothing carried over, nothing rewritten
    const other = a('a1', 'Here.\n\n> **Artifact:** Chart 2');
    expect(keepArtifacts(saved, other)).toEqual(other);
  });

  it('turns repository links into live assets, or drops links whose file is gone', async () => {
    const fromRepo = a('a1', 'Here.\n\n> **Artifact:** [Chart](2026-11-09-x--c1.assets/chart.html)\n\nand [data](2026-11-09-x--c1.assets/gone.csv)');
    const live = await materializeAssets(fromRepo, async (name) => (name === 'chart.html' ? { data: 'PGI+MTwvYj4=', sha: 'abc' } : null));
    expect(live.markdown).toBe('Here.\n\n> **Artifact:** [Chart](gitchat-asset:chart.html)\n\nand data');
    expect(live.assets).toEqual([{ name: 'chart.html', mime: 'text/html', data: 'PGI+MTwvYj4=', encoding: 'base64', sha: 'abc' }]);
    expect(messageHash(live)).toBe(messageHash({ ...saved, assets: [{ ...asset('chart.html', '<b>1</b>'), sha: 'abc' }], markdown: 'Here.\n\n> **Artifact:** [Chart](gitchat-asset:chart.html)\n\nand data' }));
    const lost = await materializeAssets(a('a1', '> **Artifact:** [Chart](x--c1.assets/chart.html)'), async () => null);
    expect(lost.markdown).toBe('> **Artifact:** Chart');
  });

  it('fails instead of dropping a link when the download fails', async () => {
    const fromRepo = a('a1', '> **Artifact:** [Chart](x--c1.assets/chart.html)');
    await expect(materializeAssets(fromRepo, async () => Promise.reject(new Error('HTTP 503')))).rejects.toThrow('HTTP 503');
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

  it('ignores blank lines around a message and CRLF, but not meaningful whitespace', () => {
    expect(messageHash(msg('a', 'text\n\n'))).toBe(messageHash(msg('a', '\n \ntext')));
    expect(messageHash(msg('a', 'a\r\nb'))).toBe(messageHash(msg('a', 'a\nb')));
    // a Markdown hard break (two trailing spaces) and indentation are content
    expect(messageHash(msg('a', 'line  \nnext'))).not.toBe(messageHash(msg('a', 'line\nnext')));
    expect(messageHash(msg('a', '    code'))).not.toBe(messageHash(msg('a', 'code')));
  });
});

describe('combining copies', () => {
  it('keeps every message of both lists, in order', () => {
    const ours = [u('u1'), a('a1'), u('u2')];
    const theirs = [u('u1'), a('a1', 'their a1'), u('u9'), a('a9')];
    expect(unionMessages(ours, theirs).map((m) => `${m.id}:${m.markdown}`)).toEqual(['u1:u1', 'a1:a1', 'u9:u9', 'a9:a9', 'u2:u2']);
    expect(unionMessages(theirs, ours).map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'u9', 'a9']);
  });

  it('merges three ways: one-sided changes win, both-sided ones go to the newer capture', () => {
    const base = hashesOf(refsOf([u('u1'), a('a1'), u('u2'), a('a2'), u('u3')]));
    const ours = [u('u1'), a('a1'), u('u2', 'ours edited'), a('a2', 'both: ours'), u('u4')]; // u3 deleted here, u4 added
    const theirs = [u('u1'), a('a1', 'theirs edited'), u('u2'), a('a2', 'both: theirs'), u('u3'), a('a9')];
    const merged = (oursNewer: boolean) => threeWayMerge(base, ours, theirs, oursNewer).map((m) => `${m.id}:${m.markdown}`);
    expect(merged(false)).toEqual(['u1:u1', 'a1:theirs edited', 'u2:ours edited', 'a2:both: theirs', 'u4:u4', 'a9:a9']);
    expect(merged(true)).toContain('a2:both: ours');
    // deleted on one side but edited on the other: the edit stays
    expect(threeWayMerge(base, [u('u1')], [u('u1'), a('a1', 'edited')], true).map((m) => m.id)).toEqual(['u1', 'a1']);
    // without a known base nothing is deleted
    expect(threeWayMerge(null, [u('u1')], [u('u1'), a('a1')], true).map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('keeps changes made after a complete capture started over its older reading', () => {
    const before = [u('u1'), a('a1'), u('u2'), a('a2')];
    const base = hashesOf(refsOf(before));
    const current = [u('u1'), a('a1', 'edited meanwhile'), u('u2'), u('u3')]; // a2 deleted, u3 added meanwhile
    const captured = [u('u1'), a('a1'), u('u2'), a('a2')];
    expect(keepChangesSince(captured, current, base).map((m) => `${m.id}:${m.markdown}`)).toEqual(['u1:u1', 'a1:edited meanwhile', 'u2:u2', 'u3:u3']);
  });
});
