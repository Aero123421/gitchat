// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/content/capture/frames', async (orig) => ({
  ...(await orig<typeof import('../../src/content/capture/frames')>()),
  serializeFrames: async (reqs: Array<{ key: string; messageId: string | null; title: string }>) =>
    reqs.map((r) => ({ key: r.key, messageId: r.messageId, title: r.title, html: `<html>${r.key}</html>` })),
}));

const { gemini } = await import('../../src/content/adapters/gemini');
const { captureVisible } = await import('../../src/content/capture/snapshot');

const load = (name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures/gemini', name), 'utf8');
};

describe('gemini adapter (live-site fixtures)', () => {
  it('finds turns with stable per-turn ids', () => {
    load('basic.html');
    const msgs = gemini.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0]?.id).toMatch(/:u$/);
    expect(msgs[1]?.id).toMatch(/:a$/);
  });

  it('reads the full user prompt, not the truncated screen-reader label', () => {
    load('basic.html');
    const [user] = captureVisible(gemini, document);
    expect(user?.markdown).toContain('[gitchat research]');
    expect(user?.markdown).not.toContain('あなたのプロンプト');
  });

  it('keeps code with a normalized language', () => {
    load('code.html');
    const answer = captureVisible(gemini, document).find((m) => m.role === 'assistant');
    expect(answer?.markdown).toMatch(/```(python|typescript)\n/);
    expect(answer?.markdown).not.toMatch(/コードをコピー/);
  });

  it('recovers TeX from data-math', () => {
    load('math.html');
    const answer = captureVisible(gemini, document).find((m) => m.role === 'assistant');
    expect(answer?.markdown).toMatch(/\$[^$]+\$/);
    expect(answer?.markdown).toMatch(/\$\$\n[\s\S]+\n\$\$/);
  });

  it('renders tables', () => {
    load('table.html');
    const answer = captureVisible(gemini, document).find((m) => m.role === 'assistant');
    expect(answer?.markdown).toMatch(/^\| .+ \|$/m);
    expect(answer?.markdown).toMatch(/^\| --- \|/m);
  });

  it('marks Canvas previews as artifacts', () => {
    load('artifact.html');
    const answer = captureVisible(gemini, document).find((m) => m.role === 'assistant');
    expect(answer?.markdown).toMatch(/^> \*\*Artifact:\*\* Canvas$/m);
    expect(answer?.kinds ?? []).toContain('viz');
  });

  it('keeps an expanded thinking panel out of the answer', () => {
    load('thoughts.html');
    const answers = captureVisible(gemini, document).filter((m) => m.role === 'assistant');
    const text = (needle: string) => answers.find((m) => m.markdown.includes(needle))?.markdown ?? '';

    const expanded = text('Visible answer');
    expect(expanded).toContain('Visible answer.');
    expect(expanded).not.toContain('THOUGHT LEAK');
    expect(expanded).not.toContain('CONTAINER LEAK');
    expect(expanded).not.toContain('CONTENT LEAK');
    expect(expanded).not.toContain('nested model thought');
    expect(expanded).not.toContain('nested container');
    expect(expanded).not.toContain('nested content');

    const fallback = text('fallback prose');
    expect(fallback).toContain('fallback prose');
    expect(fallback).not.toContain('thought only panel');

    const plain = text('plain content');
    expect(plain).toContain('plain content');
    expect(plain).not.toContain('thought before plain');

    const collapsed = text('Collapsed answer stays');
    expect(collapsed).toContain('Collapsed answer stays.');
    expect(collapsed).not.toContain('thinking header');

    expect(answers.some((m) => m.markdown.includes('only the thought'))).toBe(false);
  });

  it('keeps legacy Canvas labels even when chips have titles', async () => {
    load('canvas-title.html');
    const answer = captureVisible(gemini, document).find((m) => m.role === 'assistant');
    expect(answer?.markdown).toMatch(/^> \*\*Artifact:\*\* Canvas$/m);
    expect(answer?.markdown).toMatch(/^> \*\*Artifact:\*\* Canvas 2$/m);
    expect(answer?.markdown).toMatch(/^> \*\*Artifact:\*\* Canvas 3$/m);
    expect(answer?.markdown).toMatch(/^> \*\*Artifact:\*\* Canvas 4$/m);

    for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'))) {
      Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => window });
    }
    const arts = await gemini.artifacts!(document);
    expect(arts.map((a) => a.title)).toEqual(['Canvas', 'Canvas 2', 'Canvas 3', 'Canvas 4']);
  });

  it('reads every turn of a long chat even when they are off-screen', () => {
    load('long-top.html');
    const msgs = captureVisible(gemini, document);
    expect(msgs.length).toBeGreaterThanOrEqual(40);
    expect(msgs.every((m) => m.markdown.length > 0)).toBe(true);
  });

  it('extracts the chat id', () => {
    expect(gemini.chatId(new URL('https://gemini.google.com/app/bb4c0123456789ab'))).toBe('bb4c0123456789ab');
    expect(gemini.chatId(new URL('https://gemini.google.com/app'))).toBeNull();
  });

  it('extracts the chat id when another Google account is selected', () => {
    expect(gemini.chatId(new URL('https://gemini.google.com/u/1/app/bb4c0123456789ab'))).toBe('bb4c0123456789ab');
    expect(gemini.chatId(new URL('https://gemini.google.com/u/2/gem/coding-partner/bb4c0123456789ab'))).toBe('bb4c0123456789ab');
    expect(gemini.chatId(new URL('https://gemini.google.com/u/1/app'))).toBeNull();
    expect(gemini.chatId(new URL('https://gemini.google.com/x/1/app/bb4c0123456789ab'))).toBeNull();
    expect(gemini.chatId(new URL('https://gemini.google.com/app/BB4C0123456789AB'))).toBe('bb4c0123456789ab');
  });

  it('stores a chat link without the account slot or the query', () => {
    const gem = new URL('https://gemini.google.com/u/1/gem/coding-partner/bb4c0123456789ab?authuser=1&hl=ja#x');
    expect(gemini.canonicalUrl!(gem)).toBe('https://gemini.google.com/gem/coding-partner/bb4c0123456789ab');
    const app = new URL('https://gemini.google.com/app/bb4c0123456789ab');
    expect(gemini.canonicalUrl!(app)).toBe('https://gemini.google.com/app/bb4c0123456789ab');
  });
});
