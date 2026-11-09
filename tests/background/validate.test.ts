import { describe, expect, it } from 'vitest';
import { senderService } from '../../src/background/validate';

const sender = (over: Record<string, unknown> = {}) =>
  ({ origin: 'https://chatgpt.com', frameId: 0, ...over }) as chrome.runtime.MessageSender;

describe('senderService', () => {
  it('accepts the top document by frame type, including after a prerender is activated', () => {
    expect(senderService(sender({ frameId: 7, frameType: 'outermost_frame', documentLifecycle: 'active' }))).toBe('chatgpt');
    expect(senderService(sender({ frameId: 7, frameType: 'outermost_frame', documentLifecycle: 'prerender' }))).toBeNull();
  });

  it('falls back to frameId 0 when the frame type is absent, and still rejects a sub-frame', () => {
    expect(senderService(sender({ frameId: 0 }))).toBe('chatgpt');
    expect(senderService(sender({ frameId: 3 }))).toBeNull();
    expect(senderService(sender({ frameId: 0, frameType: 'sub_frame' }))).toBeNull();
  });
});
