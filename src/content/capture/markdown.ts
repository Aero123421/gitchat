// Rendered chat HTML → Markdown.
//
// Chat apps render Markdown to HTML; we turn it back into Markdown that an AI agent or a human can
// read: math becomes TeX again ($…$ / $$…$$), code blocks keep their language, tables become GFM
// tables, thinking blocks become <details>. Site-specific quirks come in through `MarkdownHooks`.

export interface MarkdownHooks {
  /** Elements to drop entirely (copy buttons, toolbars, avatars …). */
  ignore?: string[];
  /**
   * Custom rendering for special elements (e.g. an artifact card, a site's own bold span). Runs
   * before `ignore`. `children` renders the element's content with the normal rules.
   */
  render?: (el: Element, children: (el: Element) => string) => string | null;
  /** Markdown heading level for an h1–h6 element when the site shifts levels. */
  headingLevel?: (el: Element) => number;
  /** Label for a link (e.g. drop a "+3" source counter). Return null for the default. */
  linkLabel?: (a: HTMLAnchorElement) => string | null;
  /** Language of a code block when it is not in a `language-*` class (e.g. a header label). */
  codeLanguage?: (pre: Element) => string | null;
  /** Override for math: return TeX and whether it is display math, or null to use the defaults. */
  math?: (el: Element) => MathResult | null;
  /** Called for <iframe>s (interactive visualizations). Return Markdown to insert, or null. */
  iframe?: (el: HTMLIFrameElement) => string | null;
  /** Called for images. Return Markdown to insert, or null for the default `![alt](src)`. */
  image?: (el: HTMLImageElement) => string | null;
}

export interface MathResult {
  tex: string;
  display: boolean;
}

export interface MarkdownResult {
  markdown: string;
  /** Rich content found: "code", "math", "table", "image", "viz", "thinking", "link". */
  kinds: string[];
}

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'SUMMARY', 'TABLE', 'UL',
]);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'svg', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'VIDEO', 'AUDIO']);
const DEFAULT_IGNORE = ['.sr-only', '[hidden]'];

interface Ctx {
  hooks: MarkdownHooks;
  ignore: string;
  kinds: Set<string>;
  /** Inside <pre> or inline code: keep whitespace verbatim. */
  pre: boolean;
  listDepth: number;
}

export function toMarkdown(root: Element, hooks: MarkdownHooks = {}): MarkdownResult {
  const ctx: Ctx = {
    hooks,
    ignore: [...DEFAULT_IGNORE, ...(hooks.ignore ?? [])].join(','),
    kinds: new Set(),
    pre: false,
    listDepth: 0,
  };
  const md = normalize(renderChildren(root, ctx));
  return { markdown: md, kinds: [...ctx.kinds] };
}

// ---------------------------------------------------------------- core walk

function renderChildren(el: Node, ctx: Ctx): string {
  let out = '';
  for (const child of Array.from(el.childNodes)) out += render(child, ctx);
  return out;
}

function render(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) return text(node.textContent ?? '', ctx);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  if (SKIP.has(el.tagName)) return '';
  const special = ctx.hooks.render?.(el, (x) => renderChildren(x, ctx));
  if (special != null) return special;
  if (ctx.ignore && safeMatches(el, ctx.ignore)) return '';

  const math = mathOf(el, ctx);
  if (math) {
    ctx.kinds.add('math');
    return math.display ? block(`$$\n${math.tex}\n$$`) : `$${math.tex}$`;
  }

  switch (el.tagName) {
    case 'BR':
      return ctx.pre ? '\n' : '  \n';
    case 'P':
      return block(inline(el, ctx));
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6':
    {
      const level = Math.min(6, Math.max(1, ctx.hooks.headingLevel?.(el) ?? Number(el.tagName[1])));
      return block(`${'#'.repeat(level)} ${inline(el, ctx).replace(/\n+/g, ' ')}`);
    }
    case 'STRONG':
    case 'B':
      return wrap(renderChildren(el, ctx), '**');
    case 'EM':
    case 'I':
      return wrap(renderChildren(el, ctx), '*');
    case 'DEL':
    case 'S':
      return wrap(renderChildren(el, ctx), '~~');
    case 'CODE':
      return inlineCode(el.textContent ?? '');
    case 'PRE':
      return codeBlock(el, ctx);
    case 'BLOCKQUOTE':
      return block(
        normalize(renderChildren(el, ctx))
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n'),
      );
    case 'UL':
    case 'OL':
      return list(el, ctx);
    case 'HR':
      return block('---');
    case 'A':
      return link(el as HTMLAnchorElement, ctx);
    case 'IMG':
      return image(el as HTMLImageElement, ctx);
    case 'IFRAME':
      return iframe(el as HTMLIFrameElement, ctx);
    case 'TABLE':
      return table(el as HTMLTableElement, ctx);
    case 'DETAILS':
      return details(el, ctx);
    case 'SUP':
      return `<sup>${inline(el, ctx)}</sup>`;
    case 'SUB':
      return `<sub>${inline(el, ctx)}</sub>`;
    default:
      return BLOCK.has(el.tagName) ? block(renderChildren(el, ctx)) : renderChildren(el, ctx);
  }
}

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

const block = (s: string) => (s.trim() ? `\n\n${s.trim()}\n\n` : '');

function text(s: string, ctx: Ctx): string {
  if (ctx.pre) return s;
  return s.replace(/[ \t\r\n\f]+/g, ' ');
}

function inline(el: Element, ctx: Ctx): string {
  return renderChildren(el, ctx)
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function wrap(s: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m || !m[2]) return s;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

function inlineCode(code: string): string {
  const runs = code.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${code}${pad}${fence}`;
}

// ---------------------------------------------------------------- math

function mathOf(el: Element, ctx: Ctx): MathResult | null {
  const custom = ctx.hooks.math?.(el);
  if (custom) return custom;

  // KaTeX: <span class="katex-display"><span class="katex">…<annotation encoding="application/x-tex">
  if (el.classList.contains('katex-display') || (el.classList.contains('katex') && !el.closest('.katex-display'))) {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann?.textContent) return { tex: ann.textContent.trim(), display: el.classList.contains('katex-display') };
  }
  // MathJax v3: <mjx-container display="true"> with assistive MathML or a data attribute
  if (el.tagName === 'MJX-CONTAINER') {
    const tex = el.getAttribute('data-latex') ?? el.querySelector('math')?.getAttribute('alttext');
    if (tex) return { tex: tex.trim(), display: el.getAttribute('display') === 'true' };
  }
  // Generic data attributes some apps use (e.g. data-math on Gemini)
  for (const attr of ['data-math', 'data-latex', 'data-tex']) {
    const tex = el.getAttribute(attr);
    if (tex) {
      const display = /display|block/i.test(el.className) || el.tagName === 'DIV';
      return { tex: tex.trim(), display };
    }
  }
  // Bare MathML with TeX alt text
  if (el.tagName.toLowerCase() === 'math') {
    const tex = el.getAttribute('alttext');
    if (tex) return { tex: tex.trim(), display: el.getAttribute('display') === 'block' };
  }
  return null;
}

// ---------------------------------------------------------------- code

function codeBlock(pre: Element, ctx: Ctx): string {
  ctx.kinds.add('code');
  const code = pre.querySelector('code') ?? pre;
  const lang =
    ctx.hooks.codeLanguage?.(pre) ??
    languageFromClass(code) ??
    languageFromClass(pre) ??
    pre.getAttribute('data-language') ??
    '';
  const body = (code.textContent ?? '').replace(/\n$/, '');
  const runs = body.match(/^`{3,}/gm) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return block(`${fence}${lang.toLowerCase()}\n${body}\n${fence}`);
}

function languageFromClass(el: Element): string | null {
  for (const c of Array.from(el.classList)) {
    const m = /^(?:language|lang)-(.+)$/.exec(c);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- lists

function list(el: Element, ctx: Ctx): string {
  const ordered = el.tagName === 'OL';
  let n = Number(el.getAttribute('start') ?? '1') || 1;
  const items: string[] = [];
  ctx.listDepth++;
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    const marker = ordered ? `${n++}.` : '-';
    const content = normalize(renderChildren(li, ctx));
    const indent = ' '.repeat(marker.length + 1);
    const lines = content.split('\n');
    items.push(`${marker} ${lines[0] ?? ''}${lines.slice(1).map((l) => (l ? `\n${indent}${l}` : '\n')).join('')}`);
  }
  ctx.listDepth--;
  // Loose lists (items containing blocks) keep a blank line between items.
  const loose = items.some((i) => i.includes('\n\n'));
  return block(items.join(loose ? '\n\n' : '\n'));
}

// ---------------------------------------------------------------- links, images, iframes

function link(a: HTMLAnchorElement, ctx: Ctx): string {
  const label = ctx.hooks.linkLabel?.(a) ?? inline(a, ctx);
  const href = a.getAttribute('href') ?? '';
  if (!href || href.startsWith('javascript:')) return label;
  ctx.kinds.add('link');
  const abs = absolute(href, a.ownerDocument);
  if (!label) return `<${abs}>`;
  if (label === abs) return `<${abs}>`;
  return `[${label.replace(/[[\]]/g, '\\$&')}](${abs.replace(/[()\s]/g, encodeURIComponent)})`;
}

function absolute(href: string, doc: Document): string {
  try {
    return new URL(href, doc.baseURI).href;
  } catch {
    return href;
  }
}

function image(img: HTMLImageElement, ctx: Ctx): string {
  const custom = ctx.hooks.image?.(img);
  if (custom != null) {
    ctx.kinds.add('image');
    return custom;
  }
  const src = img.getAttribute('src') ?? '';
  const alt = (img.getAttribute('alt') ?? '').replace(/[[\]]/g, '');
  if (!src) return '';
  ctx.kinds.add('image');
  if (src.startsWith('data:') && src.length > 2048) return `![${alt || 'image'}](image)`;
  // blob: URLs only live as long as the tab; keep a placeholder instead of a dead link
  if (src.startsWith('blob:')) return `![${alt || 'image'}](image)`;
  return `![${alt}](${absolute(src, img.ownerDocument)})`;
}

function iframe(el: HTMLIFrameElement, ctx: Ctx): string {
  ctx.kinds.add('viz');
  const custom = ctx.hooks.iframe?.(el);
  if (custom != null) return block(custom);
  const title = el.getAttribute('title') || 'interactive content';
  return block(`<!-- gitchat: ${title} (iframe) -->`);
}

// ---------------------------------------------------------------- tables

function table(t: HTMLTableElement, ctx: Ctx): string {
  ctx.kinds.add('table');
  const rows = Array.from(t.rows);
  if (!rows.length) return '';
  const cells = rows.map((r) => Array.from(r.cells).map((c) => cell(c, ctx)));
  const width = Math.max(...cells.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const header = pad(cells[0] ?? []);
  const align = Array.from(rows[0]?.cells ?? []).map((c) => {
    const a = (c.getAttribute('align') ?? c.getAttribute('data-d-align') ?? (c as HTMLElement).style?.textAlign ?? '').toLowerCase();
    return a === 'center' ? ':---:' : a === 'right' || a === 'end' ? '---:' : '---';
  });
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${pad(align).map((a) => a || '---').join(' | ')} |`,
    ...cells.slice(1).map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return block(lines.join('\n'));
}

function cell(c: Element, ctx: Ctx): string {
  return inline(c, ctx).replace(/\n+/g, '<br>').replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------- details (thinking)

function details(el: Element, ctx: Ctx): string {
  ctx.kinds.add('thinking');
  const summaryEl = el.querySelector(':scope > summary');
  const summary = summaryEl ? inline(summaryEl, ctx) : 'Details';
  const clone = el.cloneNode(true) as Element;
  clone.querySelector(':scope > summary')?.remove();
  const body = normalize(renderChildren(clone, ctx));
  return block(`<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`);
}

// ---------------------------------------------------------------- output

export function normalize(s: string): string {
  // Collapse blank lines and trailing spaces, but never inside fenced code blocks.
  const parts = s.split(/(^`{3,}[^\n]*\n[\s\S]*?^`{3,}[ \t]*$)/m);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/[ \t]+\n/g, (m) => (m === '  \n' ? m : '\n'))
            .replace(/\n{3,}/g, '\n\n'),
    )
    .join('')
    .trim();
}
