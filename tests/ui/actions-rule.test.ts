import { describe, expect, it } from 'vitest';
import { availableActions } from '../../src/shared/actions.js';

const auto = (autoCommit: boolean, autoPush: boolean) => ({ autoCommit, autoPush });

describe('available actions (widget and popup)', () => {
  it('offers start when untracked and cancel while capturing', () => {
    expect(availableActions({ tracked: false, phase: 'idle' }, auto(false, false))).toEqual(['start']);
    expect(availableActions({ tracked: true, phase: 'capturing' }, auto(false, false))).toEqual(['cancel']);
  });

  it('hides a button whose action is automatic', () => {
    expect(availableActions({ tracked: true, phase: 'idle' }, auto(false, false))).toEqual(['commit', 'push']);
    expect(availableActions({ tracked: true, phase: 'idle' }, auto(true, false))).toEqual(['push']);
    expect(availableActions({ tracked: true, phase: 'idle' }, auto(true, true))).toEqual([]);
  });

  it('brings Push back after a failure, even with auto-push on', () => {
    expect(availableActions({ tracked: true, phase: 'error' }, auto(true, true))).toEqual(['push']);
  });
});
