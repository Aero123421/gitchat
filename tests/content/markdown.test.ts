// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toMarkdown } from '../../src/content/capture/markdown';

const md = (html: string, hooks = {}) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return toMarkdown(el, hooks);
};

describe('toMarkdown', () => {
  it('renders headings, emphasis, lists and links', () => {
    const r = md(`<h2>Plan</h2><p>Use <strong>two</strong> <em>stores</em> and <a href="https://example.com/a b">docs</a>.</p>
      <ul><li>server state</li><li>UI state<ul><li>local</li></ul></li></ul><ol start="3"><li>three</li><li>four</li></ol>`);
    expect(r.markdown).toContain('## Plan');
    expect(r.markdown).toContain('Use **two** *stores* and [docs](https://example.com/a%20b).');
    expect(r.markdown).toContain('- server state');
    expect(r.markdown).toMatch(/- UI state\n\s+- local/);
    expect(r.markdown).toContain('3. three\n4. four');
  });

  it('keeps code blocks verbatim with their language', () => {
    const r = md(`<pre><div class="hdr">python<button>Copy</button></div><code class="language-python">def f():\n\n\n    return 1  \n</code></pre>`);
    expect(r.markdown).toBe('```python\ndef f():\n\n\n    return 1  \n```');
    expect(r.kinds).toContain('code');
  });

  it('uses a longer fence when the code contains backticks', () => {
    const r = md('<pre><code>```\nnested\n```</code></pre>');
    expect(r.markdown.startsWith('````')).toBe(true);
  });

  it('recovers TeX from KaTeX (inline and display)', () => {
    const katex = (tex: string) =>
      `<span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x</span></span>`;
    const r = md(`<p>Euler: ${katex('e^{i\\pi}+1=0')}</p><span class="katex-display">${katex('\\int_0^1 x^2\\,dx')}</span>`);
    expect(r.markdown).toContain('Euler: $e^{i\\pi}+1=0$');
    expect(r.markdown).toContain('$$\n\\int_0^1 x^2\\,dx\n$$');
    expect(r.kinds).toContain('math');
  });

  it('recovers TeX from data-math attributes', () => {
    const r = md(`<p>inline <span class="math-inline" data-math="a^2"></span></p><div class="math-block" data-math="b^2"></div>`);
    expect(r.markdown).toContain('inline $a^2$');
    expect(r.markdown).toContain('$$\nb^2\n$$');
  });

  it('renders GFM tables with escaped pipes and alignment', () => {
    const r = md(`<table><thead><tr><th>a</th><th align="right">b</th></tr></thead><tbody><tr><td>x|y</td><td>2</td></tr></tbody></table>`);
    expect(r.markdown).toBe('| a | b |\n| --- | ---: |\n| x\\|y | 2 |');
  });

  it('turns details into a collapsible block and blockquotes into quotes', () => {
    const r = md(`<details><summary>Thinking</summary><p>step one</p></details><blockquote><p>quoted</p></blockquote>`);
    expect(r.markdown).toContain('<details>\n<summary>Thinking</summary>\n\nstep one\n\n</details>');
    expect(r.markdown).toContain('> quoted');
  });

  it('drops ignored chrome and lets hooks handle iframes', () => {
    const r = md(`<div class="toolbar">Copy</div><p>Hi</p><iframe title="Chart" src="https://x.example/viz"></iframe>`, {
      ignore: ['.toolbar'],
      iframe: () => '[Chart](chat.assets/viz-1.html)',
    });
    expect(r.markdown).toBe('Hi\n\n[Chart](chat.assets/viz-1.html)');
    expect(r.kinds).toContain('viz');
  });
});

describe('normalize keeps fenced code intact', () => {
  it('only closes a fence with one at least as long as the opener', () => {
    const r = md('<pre><code>```\nnested\n\n\n\nkeep these blank lines\n```</code></pre><p>after</p>');
    expect(r.markdown).toContain('nested\n\n\n\nkeep these blank lines');
    expect(r.markdown.endsWith('````\n\nafter')).toBe(true);
  });

  it('protects fences inside list items and quotes', () => {
    const r = md('<ul><li><p>step</p><pre><code class="language-sh">a\n\n\n\nb</code></pre></li></ul><blockquote><pre><code>x\n\n\n\ny</code></pre></blockquote>');
    expect(r.markdown).toMatch(/ {2}```sh\n {2}a\n\n\n\n {2}b\n {2}```/);
    expect(r.markdown).toMatch(/> ```\n> x\n>\n>\n>\n> y\n> ```/);
  });
});

describe('plain text stays plain', () => {
  it('escapes text that would turn into HTML or emphasis', () => {
    const r = md('<p>Use &lt;Widget&gt; and *literal* or __init__ here</p>');
    expect(r.markdown).toBe('Use \\<Widget> and \\*literal\\* or \\_\\_init\\_\\_ here');
  });

  it('leaves ordinary prose alone', () => {
    const r = md('<p>snake_case_name, a * b, array[0], see [1], costs $5, x &lt; y</p>');
    expect(r.markdown).toBe('snake_case_name, a * b, array[0], see [1], costs $5, x < y');
  });

  it('escapes paired dollars, backticks and link-like brackets', () => {
    const r = md('<p>from $5 to $10, `tick`, [text](not a link)</p>');
    expect(r.markdown).toBe('from \\$5 to \\$10, \\`tick\\`, [text\\](not a link)');
  });

  it('escapes line starts that would become a heading, list or quote', () => {
    expect(md('<p>1. not a list</p>').markdown).toBe('1\\. not a list');
    expect(md('<p># not a heading</p>').markdown).toBe('\\# not a heading');
    expect(md('<p>- not a bullet<br>&gt; not a quote</p>').markdown).toBe('\\- not a bullet  \n\\> not a quote');
  });

  it('encodes parentheses in link destinations', () => {
    const r = md('<p><a href="https://example.com/a)b(c">go</a></p>');
    expect(r.markdown).toBe('[go](https://example.com/a%29b%28c)');
  });

  it('lets a render hook report what it found', () => {
    const r = md('<div data-x="1">raw</div>', { render: (el: Element, _c: unknown, kind: (k: string) => void) => (el.hasAttribute('data-x') ? (kind('code'), '```\nraw\n```') : null) });
    expect(r.kinds).toContain('code');
  });
});

describe('code fences (N14 / R2-M8)', () => {
  it('chooses a fence longer than any backtick run, also indented ones', () => {
    const code = 'before\n   ````\n\n\n\nafter';
    const r = md(`<pre><code>${code}</code></pre>`);
    expect(r.markdown).toBe(`\`\`\`\`\`\n${code}\n\`\`\`\`\``);
  });

  it('does the same for ChatGPT code widgets', async () => {
    const { chatgpt } = await import('../../src/content/adapters/chatgpt');
    const el = document.createElement('div');
    el.innerHTML = '<div data-chatgpt-copy-code="x"></div>';
    el.firstElementChild!.setAttribute('data-chatgpt-copy-code', 'a\n  ```\n\n\n\nb');
    const r = toMarkdown(el, chatgpt.markdown);
    expect(r.markdown).toBe('````\na\n  ```\n\n\n\nb\n````');
  });
});
