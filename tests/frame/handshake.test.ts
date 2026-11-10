// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ALLOWED_PARENTS } from '../../src/frame/index';

describe('frame script handshake', () => {
  it('answers only an allowed window.top and posts the snapshot back to that origin', () => {
    expect([...ALLOWED_PARENTS].sort()).toEqual(['https://chatgpt.com', 'https://claude.ai', 'https://gemini.google.com']);
    const top = window.top ?? window;
    const calls: Array<{ data: { nonce?: string; type?: string; html?: string }; origin: unknown }> = [];
    const spy = vi.spyOn(top, 'postMessage').mockImplementation((data, origin) => {
      calls.push({ data: data as { nonce?: string; type?: string; html?: string }, origin });
    });
    const send = (origin: string, source: MessageEventSource | null, nonce: string) => {
      window.dispatchEvent(new MessageEvent('message', { data: { gitchat: 1, type: 'frame/serialize', nonce }, origin, source }));
    };
    send('https://evil.example', top, 'nope');
    send('https://claude.ai', null, 'nope');
    send('https://claude.ai', top, 'once');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.origin).toBe('https://claude.ai');
    expect(calls[0]?.origin).not.toBe('*');
    expect(calls[0]?.data.type).toBe('frame/html');
    expect(calls[0]?.data.nonce).toBe('once');
    expect(calls[0]?.data.html?.startsWith('<!doctype html>')).toBe(true);
    spy.mockRestore();
  });
});