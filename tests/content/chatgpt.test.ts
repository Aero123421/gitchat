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

  it('reads the late-2026-11 markup: code boxes, inline-code spans, citations and mention links', () => {
    load('blocks.html');
    const [user, ai] = captureVisible(chatgpt, document);
    // fallback-turn-N keys are window-relative and never used as ids: the message uuids are
    expect(user?.id).toBe('52f32c4e-2434-48c6-9865-7704a5701306');
    expect(ai?.id).toBe('259dd900-3196-50af-867d-1a2470d4252c');
    const md = ai!.markdown;
    expect(md).toMatch(/^# 1\. 最優先：保存内容の信頼性$/m);
    expect(md).toContain('対象は、確認時点の **v0.1.1／mainの `406d1eb`** です。`mergeSnapshot()` を参照。[対象コミット](https://github.com/Aero123421/gitchat/commit/406d1ebd2a369a8cb0b1f350a2cfd894b884fb1b)');
    // a plain-text block is a fenced block (no language: the label is localized), not inline code
    expect(md).toContain('```\nリモート編集をマージした後       REMOTE EDIT\n新しいタブBで読み取った後       REMOTE EDIT\n古いタブAが再読み取りした後     ORIGINAL\n```');
    expect(md).toContain("````typescript\nconst view = { id: 'a', since: 0 };\n// ``` stays inside\n````");
    // the citation's favicon is decoration
    expect(md).toContain('[developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)');
    expect(md).not.toContain('![');
    expect(md).toContain('- **古いタブの再読み取りによって、取り込んだ新しい編集を巻き戻すケースがある。**');
    expect(md).toContain('| 既存テスト | **18ファイル・245テスト成功** |');
    expect(md).toMatch(/^---$/m);
    expect(md).not.toMatch(/行の折り返し|コードをコピー|プレーンテキスト/);
    expect(ai?.kinds).toContain('code');
  });

  it('never takes a window-relative fallback turn key as an id', () => {
    load('blocks.html');
    document.querySelectorAll('[data-chatgpt-search-message-ids]').forEach((e) => e.removeAttribute('data-chatgpt-search-message-ids'));
    document.querySelectorAll('[data-chatgpt-selection-message-id]').forEach((e) => e.removeAttribute('data-chatgpt-selection-message-id'));
    expect(chatgpt.messages(document).map((m) => m.id)).toEqual([null, null]);
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
    expect(chatgpt.chatId(new URL('https://chatgpt.com/c/6AF198F2-F520-83EC-9D97-4FE1747BE806'))).toBe('6af198f2-f520-83ec-9d97-4fe1747be806');
  });

  it('keeps the path of a saved link and drops the query', () => {
    const url = new URL('https://chatgpt.com/g/g-p-abc/c/6af198f2-f520-83ec-9d97-4fe1747be806?model=x');
    expect(chatgpt.canonicalUrl!(url)).toBe('https://chatgpt.com/g/g-p-abc/c/6af198f2-f520-83ec-9d97-4fe1747be806');
  });

  it('reads the conversation id the page reports, not a hidden pane', () => {
    load('basic.html');
    expect(chatgpt.pageChatId!(document)).toBe('conversation_uuid');
    const pane = document.createElement('div');
    pane.className = 'thread-scroll-container';
    pane.innerHTML = '<div data-chatgpt-conversation-selection-target="local-chatgpt:OTHER"></div>';
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.appendChild(pane);
    expect(chatgpt.pageChatId!(document)).toBeNull();
  });
});
