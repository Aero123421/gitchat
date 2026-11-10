// Grok (grok.com). Verified on the live site (2026-11, ja-JP UI, dark); see DESIGN.md.
//
// - Every message is its own row: `#response-<uuid>` holding `[data-testid=user-message]` or
//   `[data-testid=assistant-message]`. There is no turn wrapper. A just-sent prompt and answer carry
//   temporary ids for about half a second, then the server's.
// - The transcript (`[data-testid=chat-transcript-scroller]`) is virtualized: about 15 rows are
//   mounted, and rows out of view are removed. Older history loads behind a
//   `[data-plane-row="chat:earlier-turns"]` row; the start is `transcript:top-inset` without it.
// - The prompt is rendered as Markdown too (inline code is a `!font-mono` span, `$…$` becomes
//   KaTeX), so the user body is turned back into the typed text before it is read.
// - The reasoning text is never in the page; `.thinking-container` only holds step summaries.
// - Private chats keep the URL at `/`, so they never have a chat id.
import type { MessageNode } from './types';
import { defineAdapter, idFromPath } from './define';
import { fencedCode, inlineCode } from '../capture/markdown';

const ROW = '[id^="response-"]';
const GATEWAY = '[data-plane-row^="gateway:"]';
const INLINE_CODE = 'span[class~="!font-mono"]';
// The stop button has no test id and a localized label; its icon is the stable part.
const STOP = 'form button:has(g[id="name=player-stop"])';
const CODE_CARD = '[data-code-card]';

/** The row's server id (`response-<uuid>`). */
const rowId = (el: Element): string | null => el.closest(ROW)?.id.slice('response-'.length) || null;

const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * False for a row whose id may still be temporary. `?rid=` names the leaf of the branch shown, and
 * it moves on together with the server ids: rows after the leaf are new (just sent). When the leaf
 * is gone while an answer is being made (an edit or a regenerate replaced it), the newest prompt
 * and what follows are new. Without `rid` (the first moment after opening a chat from the
 * sidebar) or with the leaf merely scrolled out, nothing is known to be new: keep every row.
 */
function stableMessage(el: Element): boolean {
  const doc = el.ownerDocument;
  const rid = new URL(doc.location.href).searchParams.get('rid');
  const row = el.closest(ROW);
  if (!rid || !row) return true;
  const leaf = doc.getElementById(`response-${rid}`);
  if (leaf) return !after(leaf, row);
  if (phase(doc) === 'idle') return true;
  const prompts = doc.querySelectorAll('[data-testid="user-message"]');
  const newest = prompts[prompts.length - 1]?.closest(ROW);
  return !newest || (newest !== row && !after(newest, row));
}

/** Language id from the code card's display label ("TypeScript" → "typescript"). */
function codeLanguage(pre: Element): string | null {
  const label = pre.closest(CODE_CARD)?.querySelector(':scope > div:first-child span')?.textContent?.trim() ?? '';
  if (!label || !/^[A-Za-z0-9+#.\-]{1,20}$/.test(label)) return null;
  const map: Record<string, string> = { 'c++': 'cpp', 'c#': 'csharp', 'objective-c': 'objectivec', shell: 'bash', plaintext: '', text: '' };
  const id = label.toLowerCase();
  return id in map ? map[id] || null : id;
}

/** TeX of a KaTeX element, from its annotation. */
function tex(katex: Element): string | null {
  return katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || null;
}

/**
 * The prompt as typed. Grok renders it as Markdown, so the rendered parts are put back: inline
 * code gets its backticks, math its dollars, a code card its fence. Works on a copy.
 */
function typedPrompt(body: Element): Element {
  const copy = body.cloneNode(true) as Element;
  const doc = copy.ownerDocument;
  const swap = (el: Element, text: string) => el.replaceWith(doc.createTextNode(text));
  for (const card of Array.from(copy.querySelectorAll('[data-testid="code-block"]'))) {
    const pre = card.querySelector('pre');
    if (!pre) continue;
    const fence = fencedCode((pre.textContent ?? '').replace(/\n$/, ''), codeLanguage(pre) ?? '');
    const p = doc.createElement('p');
    p.textContent = fence;
    card.replaceWith(p);
  }
  for (const el of Array.from(copy.querySelectorAll('.katex-display'))) {
    const t = tex(el);
    if (t) swap(el, `$$${t}$$`);
  }
  for (const el of Array.from(copy.querySelectorAll('.katex'))) {
    const t = tex(el);
    if (t) swap(el, `$${t}$`);
  }
  for (const el of Array.from(copy.querySelectorAll(INLINE_CODE))) swap(el, inlineCode(el.textContent ?? ''));
  return copy;
}

/** The newest answer's toolbar group: empty until that answer is finished. */
function lastToolbarEmpty(doc: Document): boolean {
  const bar = doc.querySelector('.action-buttons.last-response');
  return !!bar && !bar.querySelector('button') && !!bar.closest(ROW)?.querySelector('[data-testid="assistant-message"]');
}

function phase(doc: Document): 'idle' | 'thinking' | 'streaming' {
  if (doc.querySelector('[data-testid="assistant-message"] [data-sd-animate]')) return 'streaming';
  const working = doc.querySelector('[data-testid="canvas-working-indicator"]:not([data-settled])');
  const pending = doc.querySelector('[data-testid="assistant-message"] .grok-bot');
  if (working || pending || doc.querySelector(STOP) || lastToolbarEmpty(doc)) return 'thinking';
  return 'idle';
}

export const grok = defineAdapter({
  service: 'grok',
  siteNames: ['Grok'],
  // `?rid=` picks the branch shown; the conversation is the path uuid
  chatId: (url) => idFromPath(url, /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i),
  sameChatUrl(a, b) {
    const withoutBranch = (url: URL) => {
      const copy = new URL(url.href);
      copy.searchParams.delete('rid');
      return copy.href;
    };
    return withoutBranch(a) === withoutBranch(b);
  },
  virtualized: true,
  doneQuietMs: 1000,
  watchAttributes: ['data-sd-animate', 'data-settled'],
  selectors: {
    user: ['[data-testid="user-message"]'],
    assistant: ['[data-testid="assistant-message"]'],
    userBody: ['.response-content-markdown'],
    assistantBody: ['.response-content-markdown'],
    generating: [STOP, '[data-testid="assistant-message"] [data-sd-animate]', '[data-testid="canvas-working-indicator"]:not([data-settled])'],
    composer: ['[data-testid="chat-input"] .ProseMirror', '[data-testid="chat-input"] [contenteditable="true"]'],
    scroller: ['[data-testid="chat-transcript-scroller"]'],
    loadingOlder: ['[data-plane-row="chat:earlier-turns"]'],
    title: ['[data-testid="drop-ui"] h1.sr-only'],
    dark: ['html.dark'],
  },
  idOf: (el) => rowId(el),
  keep: stableMessage,
  bodyOf: (node: MessageNode) => {
    const body = node.el.querySelector('.response-content-markdown');
    if (!body) return null;
    return node.role === 'user' ? typedPrompt(body) : body;
  },
  // the top row is mounted and no older history is left to load below it
  atStart: (doc) => !!doc.querySelector('[data-plane-row="transcript:top-inset"]') && !doc.querySelector('[data-plane-row="chat:earlier-turns"]'),
  aiPhase: (doc) => phase(doc),
  // The gateway key survives server id assignment and virtualized remounts.
  activeTurnId(doc) {
    const bar = doc.querySelector('.action-buttons.last-response');
    if (!bar || bar.querySelector('button')) return null;
    return bar.closest(GATEWAY)?.getAttribute('data-plane-row') ?? null;
  },
  hasTurn: (doc, id) => Array.from(doc.querySelectorAll(GATEWAY)).some((el) => el.getAttribute('data-plane-row') === id),
  markdown: {
    ignore: [
      'button',
      '[role="button"]',
      '.thinking-container',
      '[data-no-copy]',
      '.sr-only',
      '.katex-html',
      `${CODE_CARD} > div:first-child`,
      'section.inline-media-container:empty',
      '.action-buttons',
      'span[hidden]',
    ],
    codeLanguage,
    render(el) {
      if (el.matches(INLINE_CODE) && !el.closest('pre')) return inlineCode(el.textContent ?? '');
      return null;
    },
  },
});
