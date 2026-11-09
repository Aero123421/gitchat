import { describe, expect, it } from 'vitest';
import { OrderedMessages } from '../../src/content/capture/init';
import type { CapturedMessage } from '../../src/shared/types';

const m = (id: string, markdown = id): CapturedMessage => ({ id, role: id.startsWith('u') ? 'user' : 'assistant', markdown });

describe('OrderedMessages (harvest while scrolling a virtualized list)', () => {
  it('merges overlapping windows top to bottom without duplicates', () => {
    const acc = new OrderedMessages();
    acc.add([m('u1'), m('a1'), m('u2')]);
    acc.add([m('a1'), m('u2'), m('a2'), m('u3')]);
    acc.add([m('u3'), m('a3')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  });

  it('inserts rows that appear between known ones in the right place', () => {
    const acc = new OrderedMessages();
    acc.add([m('u1'), m('a2')]);
    acc.add([m('u1'), m('a1'), m('u2'), m('a2')]);
    expect(acc.list().map((x) => x.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('keeps the most complete rendering of a row', () => {
    const acc = new OrderedMessages();
    acc.add([m('a1', 'partial')]);
    acc.add([m('a1', 'partial and complete')]);
    expect(acc.list()[0]?.markdown).toBe('partial and complete');
  });
});
