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
   * before `ignore` and before built-in skipping (so a site's file card can be a <button>).
   * `children` renders the element's content with the normal rules; `kind` records rich content
   * found by the hook ("code", "viz" …).
   */
  render?: (el: Element, children: (el: Element) => string, kind: (k: string) => void) => string | null;
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
  const special = ctx.hooks.render?.(el, (x) => renderChildren(x, ctx), (k) => ctx.kinds.add(k));
  if (special != null) return special;
  if (SKIP.has(el.tagName)) return '';
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
      return block(escapeLineStarts(inline(el, ctx)));
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
      if (!BLOCK.has(el.tagName)) return renderChildren(el, ctx);
      // a block that only holds text and inline elements reads like a paragraph
      return block(hasBlockChild(el) ? renderChildren(el, ctx) : escapeLineStarts(renderChildren(el, ctx)));
  }
}

const BLOCK_SELECTOR = [...BLOCK].map((t) => t.toLowerCase()).join(',');

function hasBlockChild(el: Element): boolean {
  try {
    return el.querySelector(BLOCK_SELECTOR) !== null;
  } catch {
    return true;
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
  return escapeText(s.replace(/[ \t\r\n\f]+/g, ' '));
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/**
 * Escapes plain text so it stays plain text in Markdown, touching only characters that would
 * otherwise change the meaning (prose such as "a * b", snake_case or "[1]" is left alone).
 */
export function escapeText(s: string): string {
  const dollars = (s.match(/\$/g) ?? []).length;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const prev = s[i - 1];
    const next = s[i + 1];
    switch (c) {
      case '\\':
        out += next && /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : c;
        break;
      case '`':
        out += '\\`';
        break;
      case '<':
        out += next && /[A-Za-z/!?]/.test(next) ? '\\<' : c;
        break;
      case '&':
        out += /^&#?[A-Za-z0-9]+;/.test(s.slice(i)) ? '\\&' : c;
        break;
      case '*':
        // "a * b" is not emphasis; anything touching text could be
        out += isSpace(prev) && isSpace(next) && prev !== undefined && next !== undefined ? c : '\\*';
        break;
      case '_':
        // intraword underscores (snake_case) never make emphasis in GFM
        out += isWordChar(prev) && isWordChar(next) ? c : '\\_';
        break;
      case '~':
        out += next === '~' || prev === '~' ? '\\~' : c;
        break;
      case '[':
        out += next === '^' ? '\\[' : c;
        break;
      case ']':
        out += next === '(' || next === '[' ? '\\]' : c;
        break;
      case '$':
        // two dollar signs in one run of text could pair up as math on GitHub
        out += dollars >= 2 ? '\\$' : c;
        break;
      default:
        out += c;
    }
  }
  return out;
}

/** Escapes what would turn the start of a text line into a heading, quote, list or rule. */
export function escapeLineStarts(s: string): string {
  const lines = s.split('\n');
  return lines
    .map((line, i) => {
      if (/^> \*\*(?:Artifact|File):\*\* /.test(line)) return line; // our own markers
      let l = line.replace(/^(\s*)(#{1,6})(?=\s|$)/, '$1\\$2');
      l = l.replace(/^(\s*)>/, '$1\\>');
      l = l.replace(/^(\s*)([-+])(?=\s)/, '$1\\$2');
      l = l.replace(/^(\s*)(\d{1,9})([.)])(?=\s|$)/, '$1$2\\$3');
      if (/^\s*=+\s*$/.test(l) || (i > 0 && lines[i - 1]?.trim() && /^\s*-+\s*$/.test(l))) l = l.replace(/^(\s*)([=-])/, '$1\\$2');
      return l;
    })
    .join('\n');
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
  return block(fencedCode(body, lang.toLowerCase()));
}

/**
 * A code fence that nothing inside the code can close: longer than every backtick run in it (a
 * closing fence may be indented, so checking only line starts is not enough).
 */
export function codeFence(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** A complete fenced code block (no surrounding blank lines). */
export function fencedCode(code: string, lang = ''): string {
  const fence = codeFence(code);
  return `${fence}${lang}\n${code}\n${fence}`;
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
  const custom = ctx.hooks.linkLabel?.(a);
  const label = custom != null ? escapeText(custom) : inline(a, ctx);
  const href = a.getAttribute('href') ?? '';
  if (!href || href.startsWith('javascript:')) return label;
  ctx.kinds.add('link');
  const abs = absolute(href, a.ownerDocument);
  const plain = (custom ?? a.textContent ?? '').trim();
  if (!label || plain === abs || plain === href) return `<${destination(abs)}>`;
  return `[${label.replace(/(?<!\\)[[\]]/g, '\\$&')}](${destination(abs)})`;
}

/** A link destination that cannot end early: parentheses, spaces and angle brackets are encoded. */
function destination(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
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
  return `![${alt}](${destination(absolute(src, img.ownerDocument))})`;
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

/** A fence line, possibly indented (list items) or quoted (blockquotes): prefix, fence, rest. */
const FENCE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(`{3,}|~{3,})(.*)$/;

/**
 * Collapses runs of blank lines and strips trailing spaces (keeping two-space hard breaks), but
 * never inside fenced code: a fence closes only with the same character at least as long as the
 * one that opened it, and fences inside list items and quotes count too.
 */
export function normalize(s: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let blanks = 0;
  for (const line of s.split('\n')) {
    const m = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[2]![0] === fence.ch && m[2]!.length >= fence.len && !m[3]!.trim()) fence = null;
      continue;
    }
    if (m && !(m[2]![0] === '`' && m[3]!.includes('`'))) {
      fence = { ch: m[2]![0]!, len: m[2]!.length };
      blanks = 0;
      out.push(line.replace(/[ \t]+$/, ''));
      continue;
    }
    if (!line.trim()) {
      if (++blanks === 1) out.push('');
      continue;
    }
    blanks = 0;
    out.push(/\S {2}$/.test(line) ? line : line.replace(/[ \t]+$/, ''));
  }
  return out.join('\n').trim();
}
