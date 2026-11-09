import { describe, expect, it } from 'vitest';
import type { ChatDoc } from '../../src/background/model';
import { parseChatFile, parseFrontMatter, renderChat } from '../../src/background/render';

const doc = (over: Partial<ChatDoc> = {}): ChatDoc => ({
  service: 'claude',
  chatId: 'abc-123',
  url: 'https://claude.ai/chat/abc-123',
  title: 'State "design": v2',
  createdAt: '2026-11-09T09:00:00.000Z',
  capturedAt: '2026-11-09T10:00:00.000Z',
  messages: [
    { id: 'm1', role: 'user', markdown: 'How should I design state?' },
    { id: 'm2', role: 'assistant', markdown: 'Use $E=mc^2$.\n\n```ts\nconst a = 1;\n```\n' },
  ],
  ...over,
});

describe('renderChat', () => {
  it('writes front matter, a title and one section per message', () => {
    const [file] = renderChat(doc(), 'claude/2026-11-09-state-design--abc-123.md');
    expect(file?.content).toBe(
      [
        '---',
        'gitchat: 1',
        'service: claude',
        'id: "abc-123"',
        'url: "https://claude.ai/chat/abc-123"',
        'title: "State \\"design\\": v2"',
        'created: 2026-11-09T09:00:00.000Z',
        'captured: 2026-11-09T10:00:00.000Z',
        'messages: 2',
        '---',
        '',
        '# State "design": v2',
        '',
        '## User',
        '<!-- gitchat:message id="m1" -->',
        '',
        'How should I design state?',
        '',
        '## Assistant',
        '<!-- gitchat:message id="m2" -->',
        '',
        'Use $E=mc^2$.',
        '',
        '```ts',
        'const a = 1;',
        '```',
        '',
      ].join('\n'),
    );
    expect(file?.kind).toBe('chat');
  });

  it('round-trips front matter and messages', () => {
    const [file] = renderChat(doc(), 'claude/x--abc-123.md');
    const fm = parseFrontMatter(file!.content);
    expect(fm.title).toBe('State "design": v2');
    expect(fm.messages).toBe('2');
    expect(fm.captured).toBe('2026-11-09T10:00:00.000Z');
    const parsed = parseChatFile(file!.content);
    expect(parsed.messages.map((m) => [m.id, m.role])).toEqual([
      ['m1', 'user'],
      ['m2', 'assistant'],
    ]);
    expect(parsed.messages[1]?.markdown).toBe('Use $E=mc^2$.\n\n```ts\nconst a = 1;\n```');
  });

  it('writes assets next to the chat and rewrites gitchat-asset: links', () => {
    const files = renderChat(
      doc({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            markdown: 'See [Chart](gitchat-asset:chart.html) and [Missing](gitchat-asset:nope.html).',
            assets: [{ name: 'chart.html', mime: 'text/html', data: '<b>hi</b>', encoding: 'utf8' }],
          },
          {
            id: 'm2',
            role: 'assistant',
            markdown: '![img](gitchat-asset:chart.html)',
            assets: [{ name: 'chart.html', mime: 'image/png', data: 'iVBORw0KGgo=', encoding: 'base64' }],
          },
        ],
      }),
      'claude/2026-11-09-a (b)--abc.md',
    );
    const md = files[0]!.content;
    expect(md).toContain('[Chart](2026-11-09-a%20%28b%29--abc.assets/chart.html)');
    expect(md).toContain('[Missing](nope.html)');
    // A different asset with the same name gets a unique file name.
    expect(md).toContain('![img](2026-11-09-a%20%28b%29--abc.assets/chart-2.html)');
    expect(files.slice(1).map((f) => [f.path, f.encoding, f.kind])).toEqual([
      ['claude/2026-11-09-a (b)--abc.assets/chart.html', 'utf8', 'asset'],
      ['claude/2026-11-09-a (b)--abc.assets/chart-2.html', 'base64', 'asset'],
    ]);
  });

  it('uses a placeholder title and keeps ids from breaking the comment', () => {
    const [file] = renderChat(doc({ title: '  \n ', messages: [{ id: 'a-->b', role: 'user', markdown: 'x' }] }), 'claude/x.md');
    expect(file?.content).toContain('# Untitled chat');
    expect(file?.content).toContain('<!-- gitchat:message id="a-b" -->');
  });
});
