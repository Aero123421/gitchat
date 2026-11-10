import { describe, expect, it } from 'vitest';
import type { ChatDoc } from '../../src/background/model';
import { parseChatFile, parseFrontMatter, renderChat, renderCopy } from '../../src/background/render';

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
        '<!-- gitchat:message id="m1" length="26" -->',
        '',
        'How should I design state?',
        '',
        '## Assistant',
        `<!-- gitchat:message id="m2" length="${'Use $E=mc^2$.\n\n```ts\nconst a = 1;\n```'.length}" -->`,
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
    expect(file?.content).toContain('<!-- gitchat:message id="a-b" length="1" -->');
  });

  it('never gives a new file the name another message already uses in the repository', () => {
    const files = renderChat(
      doc({
        messages: [
          { id: 'm1', role: 'assistant', markdown: '> **Artifact:** [A](x--abc.assets/chart.html)' },
          {
            id: 'm2',
            role: 'assistant',
            markdown: '> **Artifact:** [B](gitchat-asset:chart.html)',
            assets: [{ name: 'chart.html', mime: 'text/html', data: '<b>B</b>', encoding: 'utf8' }],
          },
        ],
      }),
      'claude/x--abc.md',
    );
    expect(files.map((f) => f.path)).toEqual(['claude/x--abc.md', 'claude/x--abc.assets/chart-2.html']);
    expect(files[0]!.content).toContain('[A](x--abc.assets/chart.html)');
    expect(files[0]!.content).toContain('[B](x--abc.assets/chart-2.html)');
  });
});

describe('parseChatFile', () => {
  const roundTrip = (messages: ChatDoc['messages']) => parseChatFile(renderChat(doc({ messages }), 'claude/x.md')[0]!.content).messages;

  it('keeps a pasted gitchat file inside a message as one message', () => {
    const pasted = 'Look at this:\n\n## Assistant\n<!-- gitchat:message id="fake" -->\n\nnot a real message';
    const out = roundTrip([
      { id: 'u1', role: 'user', markdown: pasted },
      { id: 'a1', role: 'assistant', markdown: 'ok' },
    ]);
    expect(out.map((m) => [m.id, m.markdown])).toEqual([
      ['u1', pasted],
      ['a1', 'ok'],
    ]);
  });

  it('keeps hard breaks, indentation and empty messages', () => {
    const out = roundTrip([
      { id: 'u1', role: 'user', markdown: '    indented code\nline  \nbreak' },
      { id: 'a1', role: 'assistant', markdown: '' },
      { id: 'u2', role: 'user', markdown: 'last' },
    ]);
    expect(out.map((m) => m.markdown)).toEqual(['    indented code\nline  \nbreak', '', 'last']);
  });

  it('reads files without lengths, skipping headings inside code blocks', () => {
    const old = [
      '---',
      'gitchat: 1',
      '---',
      '',
      '# T',
      '',
      '## User',
      '<!-- gitchat:message id="u1" -->',
      '',
      '````md',
      '## Assistant',
      '<!-- gitchat:message id="fake" -->',
      '````',
      '',
      '## Assistant',
      '<!-- gitchat:message id="a1" -->',
      '',
      'answer',
      '',
    ].join('\n');
    expect(parseChatFile(old).messages.map((m) => [m.id, m.markdown])).toEqual([
      ['u1', '````md\n## Assistant\n<!-- gitchat:message id="fake" -->\n````'],
      ['a1', 'answer'],
    ]);
  });

  it('falls back to scanning when a length no longer fits (edited by hand)', () => {
    const file = renderChat(doc(), 'claude/x.md')[0]!.content.replace('How should I design state?', 'How should I design my state?');
    expect(parseChatFile(file).messages.map((m) => m.markdown)).toEqual(['How should I design my state?', 'Use $E=mc^2$.\n\n```ts\nconst a = 1;\n```']);
  });
});

describe('renderCopy', () => {
  const copy = (markdown: string) => renderCopy(doc({ messages: [{ id: 'a', role: 'assistant', markdown }] }));

  it('preserves ordinary links, images, inline code and plain cards exactly', () => {
    const markdown = [
      '[docs](https://example.com/a) [asset](gitchat-asset:a.html) [saved](chat.assets/a.html)',
      '![Diagram](gitchat-asset:diagram.html) ![](chat.assets/empty.png) ![web](https://example.com/a.png)',
      '\\[literal](gitchat-asset:a.html) `[Chart](gitchat-asset:chart.html)`',
      '``a ` [Chart](chat.assets/chart.html)``',
      '`across\n[Chart](gitchat-asset:chart.html)\nlines`',
      '> **Artifact:** Plain [v2] \\',
      '> **File:** report.html  ',
      '> **Artifact:** [Website](https://example.com/a)',
    ].join('\n');
    expect(copy(markdown)).toBe(`# State "design": v2\n\n## Assistant\n\n${markdown}\n`);
  });

  it.each(['', '> ', '> > ', '    ', '- ', '1. ', '  >   '])('preserves fenced code with prefix %j', (prefix) => {
    const markdown = [
      `${prefix}~~~md`,
      `${prefix}[Chart](gitchat-asset:chart.html)`,
      `${prefix}![Diagram](chat.assets/diagram.png)`,
      `${prefix}~~~`,
      '',
      `${prefix}\`\`\`md`,
      `${prefix}[Chart](chat.assets/chart.html)`,
      `${prefix}\`\`\``,
    ].join('\n');
    expect(copy(markdown)).toBe(`# State "design": v2\n\n## Assistant\n\n${markdown}\n`);
  });

  it('unescapes brackets and backslashes in asset labels', () => {
    expect(copy(String.raw`> **Artifact:** [Path \[v2\] \\](gitchat-asset:path.html)`))
      .toContain('> **Artifact:** Path [v2] \\\n');
    // Captured and saved cards have an unescaped trailing backslash.
    expect(copy('> **Artifact:** [Path \\](gitchat-asset:x)'))
      .toContain('> **Artifact:** Path \\\n');
    expect(copy('> **Artifact:** [Path \\](chat.assets/path.html)'))
      .toContain('> **Artifact:** Path \\\n');
  });

  it('writes the title and messages without front matter or message comments', () => {
    const md = renderCopy(doc());
    expect(md).toBe('# State "design": v2\n\n## User\n\nHow should I design state?\n\n## Assistant\n\nUse $E=mc^2$.\n\n```ts\nconst a = 1;\n```\n');
    expect(md).not.toContain('gitchat:message');
    expect(md).not.toMatch(/^---/);
  });

  it('turns asset links back into their card labels and keeps other links', () => {
    const md = renderCopy(
      doc({
        title: '',
        messages: [
          { id: 'a', role: 'assistant', markdown: '> **Artifact:** [Chart \\[v2\\]](gitchat-asset:chart.html)\n\nSee [docs](https://example.com/a).' },
          { id: 'b', role: 'assistant', markdown: '> **File:** [Plan](2026-11-09-plan--abc.assets/plan.html)' },
          { id: 'c', role: 'user', markdown: '' },
        ],
      }),
    );
    expect(md).toContain('> **Artifact:** Chart [v2]\n\nSee [docs](https://example.com/a).');
    expect(md).toContain('> **File:** Plan');
    expect(md).not.toContain('gitchat-asset:');
    expect(md).not.toContain('.assets/');
    expect(md.startsWith('# Untitled chat\n')).toBe(true);
    expect(md.endsWith('## User\n')).toBe(true);
  });
});
