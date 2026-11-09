// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatgpt } from '../../src/content/adapters/chatgpt';
import { captureVisible } from '../../src/content/capture/snapshot';

const load = (name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures/chatgpt', name), 'utf8');
};
import { toMarkdown } from '../../src/content/capture/markdown';

// Some fixtures hold a whole turn, others only the answer body ([data-dil-response]).
const answer = () => {
  const msgs = captureVisible(chatgpt, document).filter((m) => m.role === 'assistant');
  if (msgs.length) return msgs.map((m) => m.markdown).join('\n\n');
  const body = document.querySelector('[data-dil-response]');
  return body ? toMarkdown(body, chatgpt.markdown).markdown : '';
};

describe('chatgpt adapter (new app-shell UI fixtures)', () => {
  it('finds messages with their uuids', () => {
    load('basic.html');
    const msgs = chatgpt.messages(document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0]?.id).toBe('98726113-85fe-4de7-aa65-d4a86b38344f');
    expect(msgs[1]?.id).toBe('70b0aef7-c8c2-4b10-adcd-2a1b77bfda5d');
    const [user, ai] = captureVisible(chatgpt, document);
    expect(user?.markdown).toBe('[gitchat research] Reply with only the word ok');
    expect(ai?.markdown).toBe('ok');
  });

  it('reads code from the copy attribute with its language', () => {
    load('code.html');
    const md = answer();
    expect(md).toContain('```python\ndef greet(name: str) -> str:');
    expect(md).toContain('```typescript');
    expect(md).not.toMatch(/実行|コードを編集/);
  });

  it('keeps inline vs display math apart', () => {
    load('math.html');
    const md = answer();
    expect(md).toContain('Inline math: $e^{i\\pi}+1=0$');
    expect(md).toContain('$$\n\\int_0^1 x^2\\,dx = \\tfrac{1}{3}\n$$');
  });

  it('renders tables with alignment, rules, quotes and headings', () => {
    load('table.html');
    const md = answer();
    expect(md).toContain('| Left aligned | Center aligned | Right aligned |');
    expect(md).toContain('| --- | :---: | ---: |');
    expect(md).toMatch(/^## Markdown Table$/m);
    expect(md).toMatch(/^---$/m);
    expect(md).toMatch(/^> The best way/m);
  });

  it('leaves reasoning summaries out and marks inline visualizations', () => {
    load('thinking.html');
    const md = answer();
    expect(md).not.toContain('整理し設計を具体化した');
    expect(md).toContain('**Artifact:** Interactive HTML bar chart');
  });

  it('reads Work-mode answers', () => {
    load('work.html');
    const msgs = captureVisible(chatgpt, document);
    expect(msgs.some((m) => m.role === 'assistant' && m.markdown.length > 0)).toBe(true);
  });

  it('ignores transient and temporary chat urls', () => {
    expect(chatgpt.chatId(new URL('https://chatgpt.com/c/6af198f2-f520-83ec-9d97-4fe1747be806'))).toBe('6af198f2-f520-83ec-9d97-4fe1747be806');
    expect(chatgpt.chatId(new URL('https://chatgpt.com/c/local-chatgpt%3A6af198f2-f520-83ec-9d97-4fe1747be806'))).toBeNull();
    expect(chatgpt.chatId(new URL('https://chatgpt.com/c/6af198f2-f520-83ec-9d97-4fe1747be806?temporary-chat=true'))).toBeNull();
    expect(chatgpt.chatId(new URL('https://chatgpt.com/g/g-p-abc/c/6af198f2-f520-83ec-9d97-4fe1747be806'))).toBe('6af198f2-f520-83ec-9d97-4fe1747be806');
  });
});
