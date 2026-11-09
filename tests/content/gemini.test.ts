// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gemini } from '../../src/content/adapters/gemini';
import { captureVisible } from '../../src/content/capture/snapshot';

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
