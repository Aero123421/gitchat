// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claude } from '../../src/content/adapters/claude';
import { captureVisible } from '../../src/content/capture/snapshot';

const load = (name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures/claude', name), 'utf8');
};

describe('claude adapter (live-site fixtures)', () => {
  it('finds user and assistant messages in order', () => {
    load('basic.html');
    const msgs = claude.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('converts the rich answer back to Markdown', () => {
    load('basic.html');
    const [user, answer] = captureVisible(claude, document);
    expect(user?.role).toBe('user');
    expect(user?.markdown).toContain('[gitchat research] Reply with:');
    const md = answer?.markdown ?? '';
    // "##" renders as <h3> on claude.ai — mapped back
    expect(md).toMatch(/^## /m);
    expect(md).toContain('```python');
    expect(md).toContain('```typescript');
    expect(md).toContain('$e^{i\\pi}+1=0$');
    expect(md).toMatch(/\$\$\n\\int_0\^1 x\^2\\,dx = \\tfrac\{1\}\{3\}\n\$\$/);
    expect(md).toMatch(/\| :---: \|/);
    expect(md).toMatch(/^> /m);
    expect(md).not.toMatch(/Claude の応答|コピー/);
  });

  it('reports the loaded total and the start of the conversation', () => {
    load('long-top.html');
    expect(claude.loadedCount(document)).toBeGreaterThan(0);
    expect(claude.isAtStart(document)).toBe(true);
  });

  it('extracts the chat id from the URL', () => {
    expect(claude.chatId(new URL('https://claude.ai/chat/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b?artifact=x'))).toBe('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
    expect(claude.chatId(new URL('https://claude.ai/chat/0F1E2D3C-4B5A-6978-8A9B-0C1D2E3F4A5B'))).toBe('0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
    expect(claude.chatId(new URL('https://claude.ai/new'))).toBeNull();
    expect(claude.canonicalUrl!(new URL('https://claude.ai/chat/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b?artifact=x'))).toBe(
      'https://claude.ai/chat/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
    );
  });

  it('treats incognito as a temporary chat', () => {
    const id = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
    expect(claude.chatId(new URL('https://claude.ai/new?incognito='))).toBeNull();
    expect(claude.chatId(new URL('https://claude.ai/new?incognito'))).toBeNull();
    expect(claude.chatId(new URL(`https://claude.ai/chat/${id}?incognito=`))).toBeNull();
    expect(claude.chatId(new URL(`https://claude.ai/chat/${id}?incognito=true`))).toBeNull();
    expect(claude.chatId(new URL(`https://claude.ai/chat/${id.toUpperCase()}?foo=1&incognito=`))).toBeNull();
    expect(claude.chatId(new URL(`https://claude.ai/chat/${id}?artifact=incognito`))).toBe(id);
  });
});

describe('claude assistant selectors', () => {
  it('reads an assistant row that only has div[data-is-streaming]', () => {
    load('assistant-streaming-div.html');
    const msgs = claude.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1]?.id).toBe('stream-div-hub-reply');
    expect(claude.aiPhase(document)).toBe('streaming');
    expect(claude.activeTurnId!(document)).toBe('stream-div-hub-reply');
    expect(claude.isGenerating(document)).toBe(true);
    expect(captureVisible(claude, document)[1]?.markdown).toContain('Answer from streaming div');
  });

  it('reads an assistant row that only has .font-claude-response', () => {
    load('assistant-font.html');
    const msgs = claude.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1]?.id).toBe('font-hub-reply');
    expect(claude.aiPhase(document)).toBe('idle');
    expect(claude.activeTurnId!(document)).toBeNull();
    expect(captureVisible(claude, document)[1]?.markdown).toContain('Answer from font class');
  });

  it('still reads [data-testid=assistant-message] when the 2026 selectors are absent', () => {
    load('assistant-testid.html');
    const msgs = claude.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1]?.id).toBe('testid-hub-reply');
    expect(document.querySelector('div[data-is-streaming]')).toBeNull();
    expect(document.querySelector('.font-claude-response')).toBeNull();
    expect(claude.aiPhase(document)).toBe('idle');
    expect(captureVisible(claude, document)[1]?.markdown).toContain('Answer from testid');
  });

  it('captures mixed assistant markup in order without duplicate or nested messages', () => {
    load('assistant-testid.html');
    document.body.insertAdjacentHTML('beforeend', readFileSync(path.resolve('tests/fixtures/claude/assistant-font.html'), 'utf8'));
    document.body.insertAdjacentHTML('beforeend', readFileSync(path.resolve('tests/fixtures/claude/assistant-streaming-div.html'), 'utf8'));
    const first = document.querySelector('[data-testid="assistant-message"]')!;
    first.innerHTML += '<div class="font-claude-response" data-is-streaming="false"><p>Another segment</p></div>';
    const last = document.querySelector('[data-turn-key="stream-div-hub-reply"]')!;
    last.classList.add('font-claude-response');
    last.setAttribute('data-testid', 'assistant-message');

    const messages = captureVisible(claude, document);
    expect(messages.map((m) => m.id)).toEqual([
      'testid', 'testid-hub-reply', 'font', 'font-hub-reply', 'stream-div', 'stream-div-hub-reply',
    ]);
    expect(messages[1]?.markdown).toContain('Answer from testid');
    expect(messages[3]?.markdown).toContain('Answer from font class');
    expect(messages[5]?.markdown).toContain('Answer from streaming div');
    expect(claude.messages(document)[1]?.el).toBe(first);
  });

  it('does not treat data-is-streaming="false" as streaming', () => {
    load('basic.html');
    expect(claude.aiPhase(document)).toBe('idle');
    expect(claude.activeTurnId!(document)).toBeNull();
    expect(claude.isGenerating(document)).toBe(false);
  });
});

describe('claude row positions', () => {
  it('reports the position of every row, also rows that are not messages', () => {
    load('long-top.html');
    const positions = claude.rowPositions!(document);
    expect(positions.length).toBeGreaterThan(0);
    const msgs = claude.messages(document);
    expect(msgs.every((m) => claude.positionOf!(m) !== null)).toBe(true);
    expect(positions).toEqual(expect.arrayContaining(msgs.map((m) => claude.positionOf!(m)!)));
  });
});
