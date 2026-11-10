// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { grok } from '../../src/content/adapters/grok';
import { adapterFor } from '../../src/content/adapters/registry';
import { captureFullHistory } from '../../src/content/capture/init';
import { captureVisible } from '../../src/content/capture/snapshot';

const load = (name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures/grok', name), 'utf8');
  const id = document.querySelector('.last-response')?.closest('[id^="response-"]')?.id.slice('response-'.length);
  history.replaceState(null, '', `/c/${UUID}${id ? `?rid=${id}` : ''}`);
};
const answer = () => captureVisible(grok, document).find((m) => m.role === 'assistant')?.markdown ?? '';
const UUID = '642fa97b-ec01-460e-9daa-7108297f77cb';

afterEach(() => {
  vi.useRealTimers();
  history.replaceState(null, '', '/');
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

  it('captures the newest pair only after server ids and rid settle, keeping older rows', () => {
    load('basic.html');
    const older = document.querySelector('[data-testid="chat-transcript-scroller"]')!.innerHTML;
    load('streaming.html');
    document.querySelector('[data-testid="chat-transcript-scroller"]')!.insertAdjacentHTML('afterbegin', older.replace('last-response', ''));
    const ids = () => captureVisible(grok, document).map((m) => m.id);
    history.replaceState(null, '', `/c/${UUID}?rid=RESP_ID_2`);
    expect(ids()).toEqual(['RESP_ID_1', 'RESP_ID_2']);
    document.getElementById('response-RESP_ID_7')!.id = 'response-server-user';
    document.getElementById('response-RESP_ID_8')!.id = 'response-server-answer';
    expect(ids()).toEqual(['RESP_ID_1', 'RESP_ID_2']); // rid has not caught up yet
    history.replaceState(null, '', `/c/${UUID}?rid=server-answer`);
    expect(ids()).toEqual(['RESP_ID_1', 'RESP_ID_2', 'server-user', 'server-answer']);
    expect(document.querySelector('[data-plane-row="gateway:RESP_ID_8"]')).not.toBeNull();
  });

  it('keeps every row while the URL has no rid yet (a chat just opened from the sidebar)', () => {
    load('basic.html');
    history.replaceState(null, '', `/c/${UUID}`);
    expect(captureVisible(grok, document).map((m) => m.id)).toEqual(['RESP_ID_1', 'RESP_ID_2']);
  });

  it('leaves out the newest prompt and answer while an edit or a regenerate replaces the leaf', () => {
    load('basic.html');
    const older = document.querySelector('[data-testid="chat-transcript-scroller"]')!.innerHTML;
    load('streaming.html'); // answer RESP_ID_8 is being made
    document.querySelector('[data-testid="chat-transcript-scroller"]')!.insertAdjacentHTML('afterbegin', older.replace('last-response', ''));
    const ids = () => captureVisible(grok, document).map((m) => m.id);
    history.replaceState(null, '', `/c/${UUID}?rid=the-replaced-leaf`); // no longer in the page
    expect(ids()).toEqual(['RESP_ID_1', 'RESP_ID_2']);
    // finished: nothing is provisional any more, even before rid catches up
    for (const el of Array.from(document.querySelectorAll('[data-sd-animate]'))) el.removeAttribute('data-sd-animate');
    document.querySelector('form')?.remove();
    document.querySelector('.action-buttons.last-response')!.append(document.createElement('button'));
    for (const el of Array.from(document.querySelectorAll('[data-testid="canvas-working-indicator"]'))) el.setAttribute('data-settled', 'true');
    expect(ids()).toEqual(['RESP_ID_1', 'RESP_ID_2', 'RESP_ID_7', 'RESP_ID_8']);
  });

  it('keeps older virtualized windows when the leaf answer is unmounted', () => {
    load('long-top.html');
    history.replaceState(null, '', `/c/${UUID}?rid=unmounted-leaf`);
    expect(captureVisible(grok, document)).toHaveLength(14);
  });

  it('does not return temporary ids twice when a prompt is sent during init', async () => {
    vi.useFakeTimers();
    load('basic.html');
    const scroller = document.querySelector<HTMLElement>('[data-testid="chat-transcript-scroller"]')!;
    Object.defineProperty(scroller, 'clientHeight', { value: 500 });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    let sent = false;
    let busy = false;
    const result = captureFullHistory({ ...grok, topQuietMs: 100 }, document, {
      signal: new AbortController().signal,
      onProgress: () => {},
      busy: () => busy,
      artifacts: async () => {
        if (!sent) {
          sent = busy = true;
          document.querySelector('.last-response')!.classList.remove('last-response');
          for (const role of ['user', 'assistant']) {
            scroller.insertAdjacentHTML('beforeend', `<div data-plane-row="gateway:temp-${role}"><div id="response-temp-${role}">
              <div data-testid="${role}-message"><div class="response-content-markdown"><p>new ${role}</p></div></div>
              <div class="action-buttons ${role === 'assistant' ? 'last-response' : ''}"></div></div></div>`);
          }
          setTimeout(() => {
            for (const role of ['user', 'assistant']) document.getElementById(`response-temp-${role}`)!.id = `response-server-${role}`;
            history.replaceState(null, '', `/c/${UUID}?rid=server-assistant`);
            busy = false;
          }, 1500);
        }
        return [];
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).messages.map((m) => m.id)).toEqual(['RESP_ID_1', 'RESP_ID_2', 'server-user', 'server-assistant']);
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
  it('detects the stop button directly through isGenerating', () => {
    document.body.innerHTML = '<form><button><svg><g id="name=player-stop"></g></svg></button></form>';
    const button = document.querySelector('button')!;
    button.getBoundingClientRect = () => ({ width: 40, height: 40 }) as DOMRect;
    expect(grok.isGenerating(document)).toBe(true);
    button.hidden = true;
    expect(grok.isGenerating(document)).toBe(false);
    button.remove();
    expect(grok.isGenerating(document)).toBe(false);
  });

  it('is idle when the newest answer has its toolbar', () => {
    load('basic.html');
    expect(grok.aiPhase(document)).toBe('idle');
    expect(grok.activeTurnId?.(document)).toBeNull();
  });

  it('is streaming while words animate in, and remembers the busy row', () => {
    load('streaming.html');
    expect(grok.aiPhase(document)).toBe('streaming');
    const id = grok.activeTurnId?.(document);
    expect(id).toBe('gateway:RESP_ID_8');
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
