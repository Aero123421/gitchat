// Ask gitchat's frame script inside a (cross-origin) visualization iframe for its rendered HTML.
// The saved copy must not run scripts when opened as a file or served as a page, so the reply is
// sanitized here (where the frame origin is known) and again when the background writes the file.

export interface FrameHtml {
  html: string;
  title: string;
}

export function requestFrameHtml(target: Window, timeoutMs = 1500): Promise<FrameHtml | null> {
  return new Promise((resolve) => {
    const origin = frameTargetOrigin(target);
    // A concrete targetOrigin stops the request from being delivered to whatever document later
    // occupies this window. `*` would. If the origin cannot be known, do not ask.
    if (!origin) {
      resolve(null);
      return;
    }
    const nonce = crypto.randomUUID();
    let settled = false;
    let timer = 0;
    const finish = (v: FrameHtml | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(v);
    };
    function onMessage(e: MessageEvent) {
      if (settled || e.origin !== origin || e.source !== target) return;
      const d = e.data as { gitchat?: unknown; type?: unknown; nonce?: unknown; html?: unknown; title?: unknown } | null;
      if (!d || d.gitchat !== 1 || d.type !== 'frame/html' || d.nonce !== nonce) return;
      const base = origin === 'null' ? undefined : origin;
      finish(typeof d.html === 'string' ? { html: sanitizeVisualizationHtml(d.html, base), title: typeof d.title === 'string' ? d.title : '' } : null);
    }
    timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    target.postMessage({ gitchat: 1, type: 'frame/serialize', nonce }, origin);
  });
}

/**
 * Origin the frame document will accept a message for. Cross-origin `location` throws, so the
 * iframe's `src` (or `"null"` for a sandboxed opaque frame) is the fallback. Never `"*"`.
 */
function frameTargetOrigin(target: Window): string | null {
  try {
    const origin = target.location.origin;
    if (origin === 'null') return 'null';
    if (isHttpOrigin(origin)) return origin;
  } catch {
    // cross-origin: location is not readable
  }
  const el = findIframe(target, document);
  if (!el) return null;
  if (isOpaqueFrame(el)) return 'null';
  const src = el.getAttribute('src')?.trim() ?? '';
  if (!src) return null;
  try {
    const url = new URL(src, document.baseURI);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === origin;
  } catch {
    return false;
  }
}

function isOpaqueFrame(el: HTMLIFrameElement): boolean {
  const sandbox = el.getAttribute('sandbox');
  return sandbox !== null && !sandbox.split(/\s+/).includes('allow-same-origin');
}

function findIframe(target: Window, doc: Document): HTMLIFrameElement | null {
  for (const f of Array.from(doc.querySelectorAll('iframe'))) {
    if (f.contentWindow === target) return f;
    try {
      if (f.contentDocument) {
        const inner = findIframe(target, f.contentDocument);
        if (inner) return inner;
      }
    } catch {
      // cross-origin child document
    }
  }
  return null;
}

/** One frame to serialize, with what the capture needs to know about it. */
export interface FrameRequest {
  key: string;
  messageId: string | null;
  title: string;
  win: Window;
}

/**
 * Asks several frames at once (each answers or times out on its own), so one slow or blank frame
 * never holds up the others.
 */
export async function serializeFrames(requests: FrameRequest[], timeoutMs = 1500): Promise<Array<{ key: string; messageId: string | null; title: string; html: string }>> {
  const got = await Promise.all(requests.map((r) => requestFrameHtml(r.win, timeoutMs)));
  const out = [];
  for (const [i, r] of requests.entries()) {
    const html = got[i];
    if (html) out.push({ key: r.key, messageId: r.messageId, title: r.title || html.title || 'Visualization', html: html.html });
  }
  return out;
}

/** A short, file-name-safe slug. */
export function assetSlug(title: string): string {
  return (
    title
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'visualization'
  );
}

/**
 * Makes captured visualization HTML safe to open as a file or to host as a page: strips script
 * elements, inline event handlers and `javascript:` URLs, and adds a CSP meta that disallows
 * scripts. Relative URLs that climb out of the asset folder (`..`, site-root paths) are rewritten
 * to an absolute URL on `frameOrigin` when that origin is known, otherwise to an inert `#`.
 * Markup and styles stay so the snapshot is still readable.
 *
 * Already-safe fragments (no document shell and nothing to neutralize) are returned unchanged, so
 * a placeholder such as `<b>chart</b>` keeps its bytes.
 */
export function sanitizeVisualizationHtml(html: string, frameOrigin?: string, depth = 0): string {
  if (!html || depth > 4) return depth > 4 ? '' : html;
  if (!shouldSanitize(html)) return html;
  return ensureCsp(rewriteHtml(html.includes('\0') ? html.replace(/\0/g, '') : html, frameOrigin, depth));
}

const CSP_CONTENT =
  "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; connect-src 'none'; style-src 'unsafe-inline' https: data: 'self'; img-src https: data: blob: 'self'; font-src https: data: 'self'; media-src https: data: 'self'";

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`;

const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'longdesc',
  'profile',
  'ping',
  'manifest',
  'archive',
  'codebase',
  'classid',
  'icon',
  'srcset',
  'imagesrcset',
  'xlink:href',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  colon: ':',
  tab: '\t',
  newline: '\n',
};

interface Attr {
  name: string;
  /** Inner value as written, or null when the attribute has no `=`. */
  rawValue: string | null;
  /** Exact slice from the whitespace before the name through the value. */
  source: string;
}

interface Tag {
  name: string;
  end: number;
  source: string;
  attrs: Attr[];
  selfClosing: boolean;
}

function shouldSanitize(html: string): boolean {
  if (hasDanger(html)) return true;
  return isFullDocument(html) && !html.includes(CSP_META);
}

function isFullDocument(html: string): boolean {
  return /<!doctype\b/i.test(html) || /<html[\s>]/i.test(html);
}

function hasDanger(html: string): boolean {
  return (
    /<script[\s>/]/i.test(html) ||
    /<\/script/i.test(html) ||
    /[/\s]on[a-z][\w:-]*\s*=/i.test(html) ||
    /(?:javascript|vbscript)/i.test(html) ||
    /\.\.|%2e%2e|%2e\.|\.%2e/i.test(html) ||
    /<base[\s>/]/i.test(html) ||
    /<(?:iframe|object|embed|link)\b/i.test(html) ||
    /url\s*\(/i.test(html) ||
    /(?:href|src|action|formaction|poster|cite)\s*=\s*(["'])?\s*(?:[/\\])/i.test(html) ||
    /&#(?:x0*3a|0*58);/i.test(html) ||
    /&colon/i.test(html)
  );
}

function ensureCsp(html: string): string {
  if (html.includes(CSP_META)) return html;
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + CSP_META + html.slice(head.index + head[0].length);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + `<head>${CSP_META}</head>` + html.slice(root.index + root[0].length);
  return CSP_META + html;
}

function rewriteHtml(html: string, origin: string | undefined, depth: number): string {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const to = end < 0 ? html.length : end + 3;
      out += html.slice(lt, to);
      i = to;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      const to = end < 0 ? html.length : end + 1;
      out += html.slice(lt, to);
      i = to;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt + 2);
      const to = end < 0 ? html.length : end + 1;
      out += html.slice(lt, to);
      i = to;
      continue;
    }
    const tag = parseStartTag(html, lt);
    if (!tag) {
      out += '<';
      i = lt + 1;
      continue;
    }
    const name = tag.name.toLowerCase();
    if (name === 'script' || name === 'base') {
      i = name === 'script' ? skipEndTag(html, tag.end, 'script') : tag.end;
      continue;
    }
    if (isDroppedElement(tag)) {
      i = tag.end;
      continue;
    }
    out += renderStartTag(tag, origin, depth);
    if (name === 'style') {
      const close = findEndTag(html, tag.end, 'style');
      const css = html.slice(tag.end, close.start);
      const next = rewriteCss(css, origin);
      out += next === css ? css : next;
      out += html.slice(close.start, close.end);
      i = close.end;
      continue;
    }
    i = tag.end;
  }
  return out;
}

function skipEndTag(html: string, from: number, name: string): number {
  return findEndTag(html, from, name).end;
}

function findEndTag(html: string, from: number, name: string): { start: number; end: number } {
  const re = new RegExp(`</${name}\\b[^>]*>`, 'i');
  const m = re.exec(html.slice(from));
  if (!m) return { start: html.length, end: html.length };
  return { start: from + m.index, end: from + m.index + m[0].length };
}

function isDroppedElement(tag: Tag): boolean {
  const name = tag.name.toLowerCase();
  if (name === 'meta') {
    const equiv = decodeHtmlEntities(attrRaw(tag, 'http-equiv') ?? '').trim().toLowerCase();
    return equiv === 'content-security-policy' || equiv === 'content-security-policy-report-only' || equiv === 'refresh';
  }
  if (name === 'link') {
    const rel = decodeHtmlEntities(attrRaw(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const as = decodeHtmlEntities(attrRaw(tag, 'as') ?? '').trim().toLowerCase();
    if (rel.includes('modulepreload') || rel.includes('import')) return true;
    return as === 'script' || as === 'worker' || as === 'serviceworker' || as === 'audioworklet' || as === 'paintworklet' || as === 'xslt';
  }
  return false;
}

function attrRaw(tag: Tag, name: string): string | null {
  const n = name.toLowerCase();
  return tag.attrs.find((a) => normAttr(a.name) === n)?.rawValue ?? null;
}

function renderStartTag(tag: Tag, origin: string | undefined, depth: number): string {
  const lname = tag.name.toLowerCase();
  const parts = [`<${tag.name}`];
  let changed = false;
  for (const attr of tag.attrs) {
    if (blockedAttr(lname, attr, tag.attrs)) {
      changed = true;
      continue;
    }
    const next = rewriteAttr(lname, attr, origin, depth);
    if (next === 'keep') parts.push(attr.source);
    else {
      changed = true;
      parts.push(next);
    }
  }
  if (!changed) return tag.source;
  parts.push(tag.selfClosing ? ' />' : '>');
  return parts.join('');
}

function blockedAttr(tag: string, attr: Attr, attrs: Attr[]): boolean {
  const n = normAttr(attr.name);
  if (!n || n.startsWith('on')) return true;
  if (tag !== 'set' && !tag.startsWith('animate')) return false;
  const target = decodeHtmlEntities(attrs.find((a) => normAttr(a.name) === 'attributename')?.rawValue ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, '');
  return /^on/i.test(target) && (n === 'attributename' || n === 'to' || n === 'from' || n === 'by' || n === 'values');
}

function rewriteAttr(tag: string, attr: Attr, origin: string | undefined, depth: number): 'keep' | string {
  if (attr.rawValue === null) return 'keep';
  const n = normAttr(attr.name);
  if (n === 'style') {
    const decoded = decodeHtmlEntities(attr.rawValue);
    const next = rewriteCss(decoded, origin);
    return next === decoded ? 'keep' : ` ${attr.name}="${escapeAttr(next)}"`;
  }
  if (n === 'srcdoc') {
    const decoded = decodeHtmlEntities(attr.rawValue);
    const next = sanitizeVisualizationHtml(decoded, origin, depth + 1);
    return next === decoded ? 'keep' : ` ${attr.name}="${escapeAttr(next)}"`;
  }
  if (!isUrlAttr(tag, n)) return 'keep';
  const next = rewriteUrlAttr(n, attr.rawValue, origin);
  return next === null ? 'keep' : ` ${attr.name}="${escapeAttr(next)}"`;
}

function isUrlAttr(tag: string, name: string): boolean {
  if (name === 'data') return tag === 'object';
  return URL_ATTRS.has(name);
}

function normAttr(name: string): string {
  return name.replace(/^\/+/, '').replace(/\0/g, '').toLowerCase();
}

function rewriteUrlAttr(name: string, raw: string, origin: string | undefined): string | null {
  const next = name === 'srcset' || name === 'imagesrcset' ? rewriteSrcset(raw, origin) : name === 'ping' ? rewriteList(raw, origin) : rewriteOneUrl(raw, origin);
  return next === raw ? null : next;
}

function rewriteSrcset(raw: string, origin: string | undefined): string {
  return raw
    .split(',')
    .map((part) => {
      const m = /^(\s*)(\S+)([\s\S]*)$/.exec(part);
      if (!m) return part;
      return `${m[1] ?? ''}${rewriteOneUrl(m[2] ?? '', origin)}${m[3] ?? ''}`;
    })
    .join(',');
}

function rewriteList(raw: string, origin: string | undefined): string {
  return raw
    .split(/\s+/)
    .map((part) => rewriteOneUrl(part, origin))
    .join(' ');
}

/** Returns `raw` when the URL may stay; otherwise an absolute URL or `#`. */
function rewriteOneUrl(raw: string, origin: string | undefined): string {
  const normalized = normalizeUrl(raw);
  if (!normalized || normalized.startsWith('#')) return raw;
  const compact = normalized.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (/^(?:javascript|vbscript):/i.test(compact)) return '#';
  if (/^file:/i.test(compact)) return '#';
  if (/^data:/i.test(compact)) {
    if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)[;,]/i.test(compact)) return raw;
    return '#';
  }
  // Absolute URLs (https:, mailto:, …) do not resolve against the asset folder.
  if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) return raw;
  if (normalized.startsWith('//')) {
    if (!pathEscapes(normalized.slice(2))) return raw;
    try {
      const abs = new URL(`https:${normalized}`);
      if (abs.protocol === 'https:') return abs.href;
    } catch {
      return '#';
    }
    return '#';
  }
  if (!pathEscapes(normalized) && !isRootPath(normalized)) return raw;
  const abs = origin ? absolutize(normalized, origin) : null;
  return abs ?? '#';
}

function isRootPath(url: string): boolean {
  const path = decodePath((url.split(/[?#]/)[0] ?? '').trim());
  return path.startsWith('/') || path.startsWith('\\');
}

function pathEscapes(url: string): boolean {
  let path = decodePath((url.split(/[?#]/)[0] ?? '').trim());
  path = path.replace(/\\/g, '/');
  if (path.startsWith('/')) return false;
  let depth = 0;
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (depth === 0) return true;
      depth--;
    } else depth++;
  }
  return false;
}

function absolutize(url: string, origin: string): string | null {
  try {
    const abs = new URL(url, origin.endsWith('/') ? origin : `${origin}/`);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    return abs.href;
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): string {
  let s = decodeHtmlEntities(raw).replace(/\0/g, '').trim();
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) s = s.slice(1, -1).trim();
  return s;
}

function decodePath(path: string): string {
  let cur = path.replace(/\\/g, '/');
  for (let n = 0; n < 2; n++) {
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next.replace(/\\/g, '/');
    } catch {
      break;
    }
  }
  return cur;
}

function rewriteCss(css: string, origin: string | undefined): string {
  let out = '';
  let i = 0;
  const lower = css.toLowerCase();
  while (i < css.length) {
    const urlAt = findCssFn(lower, 'url(', i);
    const impAt = findAtImport(lower, i);
    const at = urlAt < 0 ? impAt : impAt < 0 ? urlAt : Math.min(urlAt, impAt);
    if (at < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    if (at === urlAt) {
      const parsed = readCssUrl(css, at);
      if (!parsed) {
        out += css[at] ?? '';
        i = at + 1;
        continue;
      }
      const next = rewriteOneUrl(parsed.url, origin);
      out += next === parsed.url ? css.slice(at, parsed.end) : `url("${escapeCss(next)}")`;
      i = parsed.end;
    } else {
      const parsed = readImport(css, at, origin);
      if (!parsed) {
        out += css[at] ?? '';
        i = at + 1;
        continue;
      }
      out += parsed.emitted;
      i = parsed.end;
    }
  }
  return out.replace(/expression\s*\([^)]*\)/gi, 'none');
}

function findCssFn(lower: string, fn: string, from: number): number {
  let at = from;
  while (at < lower.length) {
    const i = lower.indexOf(fn, at);
    if (i < 0) return -1;
    const prev = i === 0 ? '' : (lower[i - 1] ?? '');
    if (!/[a-z0-9_-]/i.test(prev)) return i;
    at = i + fn.length;
  }
  return -1;
}

function findAtImport(lower: string, from: number): number {
  let at = from;
  while (at < lower.length) {
    const i = lower.indexOf('@import', at);
    if (i < 0) return -1;
    const prev = i === 0 ? '' : (lower[i - 1] ?? '');
    if (!/[a-z0-9_-]/i.test(prev)) return i;
    at = i + 7;
  }
  return -1;
}

function readCssUrl(css: string, at: number): { url: string; end: number } | null {
  let j = at + 4;
  while (j < css.length && isCssWs(css[j] ?? '')) j++;
  if (j >= css.length) return null;
  const quoted = css[j] === '"' || css[j] === "'";
  let url = '';
  if (quoted) {
    const q = css[j] ?? '';
    j++;
    const start = j;
    while (j < css.length && css[j] !== q) j = css[j] === '\\' ? j + 2 : j + 1;
    url = unescapeCss(css.slice(start, j));
    if (j < css.length && css[j] === q) j++;
  } else {
    const start = j;
    while (j < css.length && css[j] !== ')') j = css[j] === '\\' ? j + 2 : j + 1;
    url = unescapeCss(css.slice(start, j).replace(/\/\*[\s\S]*?\*\//g, '').trim());
  }
  while (j < css.length && isCssWs(css[j] ?? '')) j++;
  if (css[j] === ')') j++;
  return { url, end: j };
}

function readImport(css: string, at: number, origin: string | undefined): { emitted: string; end: number } | null {
  let j = at + '@import'.length;
  while (j < css.length && isCssWs(css[j] ?? '')) j++;
  if (css.slice(j, j + 4).toLowerCase() === 'url(') {
    const parsed = readCssUrl(css, j);
    if (!parsed) return null;
    let end = parsed.end;
    while (end < css.length && css[end] !== ';' && css[end] !== '\n') end++;
    if (css[end] === ';') end++;
    const next = rewriteOneUrl(parsed.url, origin);
    const emitted = next === parsed.url ? css.slice(at, end) : `@import url("${escapeCss(next)}");`;
    return { emitted, end };
  }
  const q = css[j] === '"' || css[j] === "'" ? css[j] : '';
  if (!q) return null;
  j++;
  const start = j;
  while (j < css.length && css[j] !== q) j = css[j] === '\\' ? j + 2 : j + 1;
  const url = unescapeCss(css.slice(start, j));
  if (css[j] === q) j++;
  while (j < css.length && css[j] !== ';' && css[j] !== '\n') j++;
  if (css[j] === ';') j++;
  const next = rewriteOneUrl(url, origin);
  const emitted = next === url ? css.slice(at, j) : `@import "${escapeCss(next)}";`;
  return { emitted, end: j };
}

function unescapeCss(s: string): string {
  return s.replace(/\\([0-9a-f]{1,6}\s?|.)/gi, (_m, seq: string) => {
    if (!/^[0-9a-f]/i.test(seq)) return seq;
    const cp = Number.parseInt(seq, 16);
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return '';
    return String.fromCodePoint(cp);
  });
}

function escapeCss(url: string): string {
  return url.replace(/["\\\n\r]/g, (c) => (c === '"' || c === '\\' ? `\\${c}` : ''));
}

function isCssWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function parseStartTag(html: string, lt: number): Tag | null {
  const n = html.length;
  let j = lt + 1;
  if (j >= n || !/[A-Za-z]/.test(html[j] ?? '')) return null;
  const nameStart = j;
  while (j < n && !isWs(html[j] ?? '') && html[j] !== '/' && html[j] !== '>') j++;
  const name = html.slice(nameStart, j);
  const attrs: Attr[] = [];
  let selfClosing = false;
  while (j < n) {
    const ws = j;
    while (j < n && isWs(html[j] ?? '')) j++;
    if (j >= n) return null;
    if (html[j] === '>') {
      j++;
      break;
    }
    if (html[j] === '/' && html[j + 1] === '>') {
      selfClosing = true;
      j += 2;
      break;
    }
    const attrNameStart = j;
    while (j < n && !isWs(html[j] ?? '') && html[j] !== '=' && html[j] !== '>' && html[j] !== '/') j++;
    if (j === attrNameStart) return null;
    const attrName = html.slice(attrNameStart, j);
    const afterName = j;
    while (j < n && isWs(html[j] ?? '')) j++;
    let rawValue: string | null = null;
    if (html[j] === '=') {
      j++;
      while (j < n && isWs(html[j] ?? '')) j++;
      if (html[j] === '"' || html[j] === "'") {
        const quote = html[j] ?? '';
        j++;
        const vStart = j;
        while (j < n && html[j] !== quote) j++;
        rawValue = html.slice(vStart, j);
        if (j < n && html[j] === quote) j++;
      } else {
        const vStart = j;
        while (j < n && !isWs(html[j] ?? '') && html[j] !== '>') j++;
        rawValue = html.slice(vStart, j);
      }
    } else {
      j = afterName;
    }
    attrs.push({ name: attrName, rawValue, source: html.slice(ws, j) });
  }
  if (html[j - 1] !== '>') return null;
  return { name, end: j, source: html.slice(lt, j), attrs, selfClosing };
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? m;
    const hex = body[1] === 'x' || body[1] === 'X';
    const cp = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return m;
    try {
      return String.fromCodePoint(cp);
    } catch {
      return m;
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
