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
