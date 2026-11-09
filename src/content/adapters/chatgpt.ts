// ChatGPT (chatgpt.com). Two DOM generations are supported; the first selector that matches wins.
//
// New app shell (verified live 2026-11, ja-JP, "Chat | Work" switch):
// - Each message is a "search unit": `[data-chatgpt-search-unit-key$=":user"|":assistant"]` (some
//   rows only carry `data-content-search-unit-key`) with the message uuid in
//   `data-chatgpt-search-message-ids` or a descendant's selection/DIL id. Every turn sits in
//   `[data-turn-key=<user message uuid>]`. `fallback-turn-N` keys are window-relative, so never use
//   them as identity.
// - Work-mode turns flicker complete → in progress → complete near the end (a 1.9 s gap was
//   observed), and the new composer's stop button has no structural hook (only a localized label),
//   so "done" waits 3 s of quiet and the busy turn is remembered across virtualization.
// - Generated files show as a card (a button holding `span[title=<file name>]`); opening it shows a
//   preview frame titled with the file name in `aside[data-app-shell-focus-area="right-panel"]`.
//   The panel is tied to the card the user clicked; a title alone proves nothing (the list is
//   virtualized, so the one card in the DOM may not be the one that was opened).
// - Work-mode turns hold commentary units in a work log (`[data-local-conversation-item-target-ids]`)
//   next to the answer, which sits inside `[data-local-conversation-final-assistant]`: commentary is
//   never a message, also before the final answer exists.
// - The answer is rendered with `data-d-component` blocks; bold/italic are spans, the horizontal rule
//   is a div, display math is marked by `data-d-block`, and code keeps its raw source in
//   `data-chatgpt-copy-code`.
// - Reasoning summaries share the answer's style attribute but carry `data-markdown-text-tone`.
// - The transcript is virtualized (~11 turns in the DOM) and older turns load 5 at a time; the app
//   re-anchors the scroll after each load and has no start marker.
// - A stale, hidden copy of the transcript (0×0) can stay in the DOM: always read the visible one,
//   and read nothing while panes exist but none is visible (e.g. right after navigating).
// Classic UI: `[data-message-author-role]`, `.markdown`, `#prompt-textarea`, stop-button test id.
import type { Role } from '../../shared/types';
import { defineAdapter, idFromPath } from './define';
import { isShown } from './dom';
import { serializeFrames, type FrameRequest } from '../capture/frames';
import { fencedCode, inlineCode } from '../capture/markdown';

/** The visible transcript pane (there may be a hidden duplicate). */
function visiblePane(doc: Document): HTMLElement | null {
  const panes = Array.from(doc.querySelectorAll<HTMLElement>('.thread-scroll-container'));
  return panes.find((p) => p.getBoundingClientRect().height > 0) ?? null;
}

/** `local-chatgpt:<uuid>` on the thread or a message, without the prefix. */
function conversationAttr(root: ParentNode): string | null {
  const el = root.querySelector('[data-chatgpt-conversation-selection-target], [data-chatgpt-selection-conversation-id]');
  if (!el) return null;
  return el.getAttribute('data-chatgpt-conversation-selection-target') ?? el.getAttribute('data-chatgpt-selection-conversation-id');
}

/**
 * Where the transcript is read: the visible pane. The new UI without a visible pane (navigating,
 * only a stale hidden copy left) has nothing to read — never fall back to the whole document there,
 * or the previous chat's hidden copy would be read as this one. The classic UI has no panes.
 */
function transcript(doc: Document): ParentNode {
  const pane = visiblePane(doc);
  if (pane) return pane;
  return doc.querySelector('.thread-scroll-container') ? doc.createDocumentFragment() : doc;
}

function anyShown(doc: Document, selector: string): boolean {
  return Array.from(doc.querySelectorAll(selector)).some(isShown);
}

const VIZ_FRAME = 'iframe[src*="web-sandbox.oaiusercontent.com"]';
const RIGHT_PANEL = 'aside[data-app-shell-focus-area="right-panel"]';
const IN_PROGRESS = '[data-talvt-turn-state="in_progress"]';
const DESCENDANT_ID = ['data-chatgpt-selection-message-id', 'data-dil-source-message-id', 'data-dil-message-id', 'data-message-id'];

/**
 * The service's id for a message: its own uuid when the row carries one (directly or on a
 * descendant); otherwise the turn's key — the user message's uuid — qualified for answers.
 */
function messageId(el: Element, role: Role): string | null {
  const own = el.getAttribute('data-chatgpt-search-message-ids')?.split(/[\s,]+/)[0] || el.getAttribute('data-message-id');
  if (own) return own;
  for (const attr of DESCENDANT_ID) {
    const v = el.querySelector(`[${attr}]`)?.getAttribute(attr);
    if (v) return v;
  }
  const turn = el.closest('[data-turn-key]')?.getAttribute('data-turn-key');
  // `fallback-turn-N` keys count from the top of the rendered window: they change as it scrolls
  if (!turn || turn.startsWith('fallback-turn-')) return null;
  if (role === 'user') return turn;
  const unit = /:(\d+):assistant$/.exec(el.getAttribute('data-chatgpt-search-unit-key') ?? el.getAttribute('data-content-search-unit-key') ?? '');
  return `${turn}:a${unit?.[1] ?? ''}`;
}

const FINAL = '[data-local-conversation-final-assistant]';
const WORK_LOG = '[data-local-conversation-item-target-ids]';

/**
 * Work turns: commentary units in the work log are never messages (also while the final answer
 * does not exist yet); in a turn that has a final answer, only that answer counts.
 */
function isMessage(el: Element, role: Role): boolean {
  if (role !== 'assistant') return true;
  if (el.closest(FINAL)) return true;
  if (el.closest(WORK_LOG)) return false;
  return !el.closest('[data-turn-key]')?.querySelector(FINAL);
}

/** File name of a generated-file card: a button holding exactly one `span[title=<file name>]`. */
function fileCardName(el: Element): string | null {
  if (el.tagName !== 'BUTTON') return null;
  const spans = el.querySelectorAll('span[title]');
  if (spans.length !== 1) return null;
  const name = spans[0]!.getAttribute('title')?.trim() ?? '';
  return /^[^\s/\\]{1,120}\.[A-Za-z0-9]{1,10}$/.test(name) ? name : null;
}

/** Language id from a code block's label ("TypeScript" → "typescript"); localized labels such as "plain text" give none. */
function codeLanguage(el: Element): string {
  const lang =
    el.querySelector('.cm-content[data-language]')?.getAttribute('data-language') ??
    el.querySelector('[data-markdown-copy="exclude"] .truncate, [data-markdown-copy="exclude"] > div')?.textContent?.trim() ??
    '';
  return /^[A-Za-z0-9+#.-]{1,20}$/.test(lang) ? lang.toLowerCase() : '';
}

/**
 * A code block in the new UI: either wrapped with its raw source in `data-chatgpt-copy-code`, or
 * (since late 2026-11) a `[data-code-block]` box whose source pane holds a plain <code>.
 */
function codeWidget(el: Element): string | null {
  let raw = el.getAttribute('data-chatgpt-copy-code');
  if (raw == null && el.getAttribute('data-code-block') === 'true') {
    raw = (el.querySelector('[data-code-block-source] code') ?? el.querySelector('code'))?.textContent ?? null;
  }
  if (raw == null) return null;
  return `\n\n${fencedCode(raw.replace(/\n$/, ''), codeLanguage(el))}\n\n`;
}

export const chatgpt = defineAdapter({
  service: 'chatgpt',
  siteNames: ['ChatGPT'],
  // `/c/local-chatgpt:<uuid>` is a transient id right after the first send: wait for the real one.
  // Temporary chats are meant to disappear, so gitchat never saves them.
  chatId: (url) => (url.searchParams.get('temporary-chat') === 'true' ? null : idFromPath(url, /\/c\/([0-9a-f]{8}-[0-9a-f-]{27,})/i)),
  // The page names its conversation even when the URL has not caught up (a branch, or another account).
  pageChatId(doc) {
    const panes = doc.querySelectorAll('.thread-scroll-container');
    const pane = panes.length ? visiblePane(doc) : doc.documentElement;
    // Panes exist but none is visible: a hidden copy can still name the previous chat.
    if (!pane) return null;
    const raw = conversationAttr(pane);
    if (!raw) return null;
    const id = raw.replace(/^local-chatgpt:/i, '').trim();
    return id ? id.toLowerCase() : null;
  },
  root: transcript,
  // ~11 turns in the DOM at a time
  virtualized: true,
  // Work-mode turns flicker complete → in progress → complete at the end (gap of 1.9 s observed)
  doneQuietMs: 3000,
  watchAttributes: ['data-talvt-turn-state', 'data-response-starting'],
  // older turns arrive 5 at a time and the app re-anchors the scroll after each batch
  topQuietMs: 3500,
  selectors: {
    user: ['[data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]', '[data-message-author-role="user"]'],
    assistant: ['[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]', '[data-message-author-role="assistant"]'],
    userBody: ['[data-user-message-bubble]', '.whitespace-pre-wrap'],
    assistantBody: [
      '[data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone])',
      '[data-dil-response]',
      '.markdown',
    ],
    generating: ['[data-response-starting][role="status"]', '[data-talvt-turn-state="in_progress"]', '[data-testid="stop-button"]'],
    composer: ['.ProseMirror[contenteditable="true"]', '#prompt-textarea'],
    scroller: ['.thread-scroll-container'],
    dark: ['html[data-theme="dark"]', 'html.dark'],
  },
  idOf: messageId,
  keep: isMessage,
  cardOf: (target) => {
    const button = target.closest('button');
    return button && fileCardName(button) ? button : null;
  },
  cardTitle: (card) => fileCardName(card) ?? '',
  // the turn being answered: remembered so that unmounting it (virtualization) is not "done"
  activeTurnId(doc) {
    const pane = transcript(doc);
    const busy = Array.from(pane.querySelectorAll(`${IN_PROGRESS}, [data-response-starting][role="status"]`)).find(isShown);
    if (!busy) return null;
    return busy.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? Array.from(pane.querySelectorAll('[data-turn-key]')).pop()?.getAttribute('data-turn-key') ?? null;
  },
  hasTurn: (doc, id) => !!transcript(doc).querySelector(`[data-turn-key="${CSS.escape(id)}"]`),
  aiPhase(doc) {
    // only visible elements count: the stale hidden pane keeps a "thinking" placeholder forever
    if (anyShown(doc, '[data-response-starting][role="status"]')) return 'thinking';
    if (anyShown(doc, '[data-talvt-turn-state="in_progress"]')) {
      const pane = transcript(doc);
      const runs = pane.querySelectorAll('[data-talvt-turn-state="in_progress"] [data-d-stream-run], [data-talvt-turn-state="in_progress"] [data-markdown-text-style="assistant-message"]:not([data-markdown-text-tone]) p');
      return runs.length ? 'streaming' : 'thinking';
    }
    if (anyShown(doc, '[data-testid="stop-button"]')) {
      const last = Array.from(doc.querySelectorAll('[data-message-author-role]')).pop();
      return last?.getAttribute('data-message-author-role') === 'assistant' && (last.textContent ?? '').trim() ? 'streaming' : 'thinking';
    }
    return 'idle';
  },
  async artifacts(doc, ctx) {
    const pane = transcript(doc);
    const requests: FrameRequest[] = [];
    // inline visualizations: identity = owning message + position among its frames
    const seen = new Map<string, number>();
    for (const frame of Array.from(pane.querySelectorAll<HTMLIFrameElement>(VIZ_FRAME))) {
      if (frame.closest(RIGHT_PANEL)) continue; // file previews, below
      const messageId = ctx.ownerId(frame);
      const n = (seen.get(messageId ?? '') ?? 0) + 1;
      seen.set(messageId ?? '', n);
      const key = `${messageId ?? 'viz'}:viz${n}`;
      if (!frame.contentWindow || ctx.skip(key)) continue;
      requests.push({ key, messageId, title: (frame.getAttribute('title') ?? '').trim() || 'Visualization', win: frame.contentWindow });
    }
    // an opened file preview belongs to the card the user opened in this tab. Without that click the
    // owner is unknown (one matching card in a virtualized list proves nothing): the preview is
    // skipped, and the copy saved earlier stays as it is.
    for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>(`${RIGHT_PANEL} ${VIZ_FRAME}`))) {
      const name = (frame.getAttribute('title') ?? '').trim();
      if (!name || !frame.contentWindow) continue;
      const opened = ctx.opened();
      const messageId = opened?.title === name ? opened.messageId : null;
      if (!messageId) continue;
      const key = `${messageId}:file:${name}`;
      if (!ctx.skip(key)) requests.push({ key, messageId, title: name, win: frame.contentWindow });
    }
    return serializeFrames(requests);
  },
  markdown: {
    ignore: [
      'button',
      '[role="button"]',
      '.sr-only',
      'h4[data-conversation-role]',
      '[data-markdown-copy="exclude"]',
      '[data-markdown-text-tone]',
      '[data-code-block-controls]',
      '.katex-html',
    ],
    // `##` renders as <h3 data-d-component="title"> in the new UI
    headingLevel: (el) => (el.hasAttribute('data-d-component') ? Number(el.tagName[1]) - 1 : Number(el.tagName[1])),
    math(el) {
      if (el.getAttribute('data-d-component') !== 'math') return null;
      const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      return tex ? { tex: tex.trim(), display: el.hasAttribute('data-d-block') } : null;
    },
    render(el, children, kind) {
      if (el.hasAttribute('data-chatgpt-copy-code') || el.getAttribute('data-code-block') === 'true') {
        const code = codeWidget(el);
        if (code != null) kind('code');
        return code;
      }
      // inline code is a span in the new UI
      if (el.getAttribute('data-markdown-copy') === 'inline-code') return inlineCode(el.textContent ?? '');
      const file = fileCardName(el);
      if (file) return `\n\n> **File:** ${file}\n\n`;
      if (el.getAttribute('data-d-component') === 'divider') return '\n\n---\n\n';
      if (el.hasAttribute('data-d-default-strong')) return `**${children(el).trim()}**`;
      if (el.getAttribute('data-d-font-style') === 'italic') return `*${children(el).trim()}*`;
      if (el.getAttribute('data-d-component') === 'popover-trigger') {
        // web-search citation pill: the URL is not in the page, keep the source name
        const name = (el.textContent ?? '').replace(/\s*\+\d+\s*$/, '').trim();
        return name ? ` [${name}]` : '';
      }
      if (el.tagName === 'IFRAME' && (el.getAttribute('src') ?? '').includes('web-sandbox.oaiusercontent.com')) {
        kind('viz');
        return `\n\n> **Artifact:** ${(el.getAttribute('title') ?? '').trim() || 'Visualization'}\n\n`;
      }
      return null;
    },
  },
});
