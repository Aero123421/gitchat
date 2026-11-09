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
    expect(claude.chatId(new URL('https://claude.ai/new'))).toBeNull();
  });
});
