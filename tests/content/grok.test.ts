// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { grok } from '../../src/content/adapters/grok';
import { adapterFor } from '../../src/content/adapters/registry';
import { captureVisible } from '../../src/content/capture/snapshot';

const load = (name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures/grok', name), 'utf8');
};
const answer = () => captureVisible(grok, document).find((m) => m.role === 'assistant')?.markdown ?? '';
const UUID = '642fa97b-ec01-460e-9daa-7108297f77cb';

afterEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML = '';
});

describe('grok adapter: routing', () => {
  it('is the adapter for grok.com', () => {
    expect(adapterFor('grok.com')).toBe(grok);
    expect(grok.virtualized).toBe(true);
  });

  it('takes the conversation id from /c/<uuid> and ignores the branch query', () => {
    expect(grok.chatId(new URL(`https://grok.com/c/${UUID}?rid=11111111-2222-3333-4444-555555555555`))).toBe(UUID);
    expect(grok.chatId(new URL(`https://grok.com/c/${UUID.toUpperCase()}`))).toBe(UUID);
    expect(grok.canonicalUrl?.(new URL(`https://grok.com/c/${UUID}?rid=x#y`))).toBe(`https://grok.com/c/${UUID}`);
  });

  it('has no chat id on the home page, private chats and other pages', () => {
    for (const p of ['/', '/c', '/c#private', '/imagine', '/library', '/project', '/c/not-a-uuid']) {
      expect(grok.chatId(new URL(`https://grok.com${p}`))).toBeNull();
    }
  });
});

describe('grok adapter (live-site fixtures)', () => {
  it('finds one row per message with the server id', () => {
    load('basic.html');
    const msgs = grok.messages(document);
    expect(msgs.map((m) => [m.role, m.id])).toEqual([
      ['user', 'RESP_ID_1'],
      ['assistant', 'RESP_ID_2'],
    ]);
    expect(grok.title(document)).toBe('Markdown Sample with Formatting Elements');
  });

  it('reads the prompt as typed, although Grok renders it as Markdown', () => {
    load('basic.html');
    const [user] = captureVisible(grok, document);
    expect(user?.markdown).toContain('`inline code`');
    expect(user?.markdown).toContain('**bold**');
    expect(user?.markdown).not.toContain('あなた');
    load('math.html');
    expect(captureVisible(grok, document)[0]?.markdown).toContain('$a^2+b^2=c^2$');
  });

  it('converts the answer without headings for screen readers, toolbars or suggestions', () => {
    load('basic.html');
    const md = answer();
    expect(md).toMatch(/^## Markdown Sample$/m);
    expect(md).toContain('**bold text**');
    expect(md).toContain('`inline code`');
    expect(md).toContain('[link to example.com](https://example.com/)');
    expect(md).toMatch(/^> This is a blockquote/m);
    for (const noise of ['Grok\n', '回答をコピー', 'Show a markdown table example', '再生成']) expect(md).not.toContain(noise);
  });

  it('keeps code with its language and without the card header', () => {
    load('code.html');
    const md = answer();
    expect(md).toContain('```python\ndef greet(name: str) -> str:');
    expect(md).toContain('```typescript\n');
    expect(md).not.toMatch(/コピー|^Python$/m);
  });

  it('recovers TeX from KaTeX', () => {
    load('math.html');
    const md = answer();
    expect(md).toContain('$a^2 + b^2 = c^2$');
    expect(md).toMatch(/\$\$\n\\int_0\^1 x\^2\\,dx = \\frac\{1\}\{3\}\n\$\$/);
  });

  it('keeps table alignment', () => {
    load('table.html');
    expect(answer()).toContain('| Left | Center | Right |\n| --- | :---: | ---: |');
  });

  it('leaves out the thinking summary and citation pills', () => {
    load('thinking.html');
    const all = captureVisible(grok, document)
      .map((m) => m.markdown)
      .join('\n');
    expect(all).toContain('2^30 = 1,073,741,824 is larger');
    expect(all).not.toContain('作業しました');
    expect(all).not.toContain('Nodejs');
    expect(all).not.toContain('10 sources');
  });

  it('reads the branch that is shown', () => {
    load('branch.html');
    expect(captureVisible(grok, document).map((m) => m.markdown)).toEqual(['[gitchat research] edited: reply with only the word edited', 'edited']);
  });
});

describe('grok adapter: generation state', () => {
  it('is idle when the newest answer has its toolbar', () => {
    load('basic.html');
    expect(grok.aiPhase(document)).toBe('idle');
    expect(grok.activeTurnId?.(document)).toBeNull();
  });

  it('is streaming while words animate in, and remembers the busy row', () => {
    load('streaming.html');
    expect(grok.aiPhase(document)).toBe('streaming');
    const id = grok.activeTurnId?.(document);
    expect(id).toBe('response-RESP_ID_8');
    expect(grok.hasTurn?.(document, id!)).toBe(true);
    expect(grok.hasTurn?.(document, 'response-gone')).toBe(false);
  });

  it('is thinking while the stop button shows, the working indicator runs, or the toolbar is still empty', () => {
    load('streaming.html');
    for (const el of Array.from(document.querySelectorAll('[data-sd-animate]'))) el.removeAttribute('data-sd-animate');
    expect(grok.aiPhase(document)).toBe('thinking'); // stop button + empty toolbar
    document.querySelector('form')?.remove();
    expect(grok.aiPhase(document)).toBe('thinking'); // the toolbar is still empty
    document.querySelector('.action-buttons.last-response')?.append(document.createElement('button'));
    expect(grok.aiPhase(document)).toBe('idle');
    const indicator = document.createElement('div');
    indicator.setAttribute('data-testid', 'canvas-working-indicator');
    document.body.append(indicator);
    expect(grok.aiPhase(document)).toBe('thinking');
  });
});

describe('grok adapter: long chats', () => {
  it('is at the start only when the top row shows and no older history is left', () => {
    load('long-top.html');
    expect(grok.isAtStart(document)).toBe(true);
    load('long-loading.html');
    expect(grok.isAtStart(document)).toBe(false);
    load('streaming.html');
    expect(grok.isAtStart(document)).toBe(false);
  });

  it('follows the dark theme class', () => {
    load('long-top.html');
    document.documentElement.className = 'dark';
    expect(grok.theme(document)).toBe('dark');
  });
});
