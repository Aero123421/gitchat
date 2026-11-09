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
//   The panel is tied to the card the user clicked (or to the only card with that name).
// - Work-mode turns hold commentary units next to the answer; the answer itself sits inside
//   `[data-local-conversation-final-assistant]`, so in such turns only that unit is a message.
// - The answer is rendered with `data-d-component` blocks; bold/italic are spans, the horizontal rule
//   is a div, display math is marked by `data-d-block`, and code keeps its raw source in
//   `data-chatgpt-copy-code`.
// - Reasoning summaries share the answer's style attribute but carry `data-markdown-text-tone`.
// - The transcript is virtualized (~11 turns in the DOM) and older turns load 5 at a time; the app
//   re-anchors the scroll after each load and has no start marker.
// - A stale, hidden copy of the transcript (0×0) can stay in the DOM: always read the visible one.
// Classic UI: `[data-message-author-role]`, `.markdown`, `#prompt-textarea`, stop-button test id.
import type { Role } from '../../shared/types';
import { defineAdapter, idFromPath } from './define';
import { isShown } from './dom';
import { serializeFrames, type FrameRequest } from '../capture/frames';
import { fencedCode } from '../capture/markdown';

/** The visible transcript pane (there may be a hidden duplicate). */
function visiblePane(doc: Document): HTMLElement | null {
  const panes = Array.from(doc.querySelectorAll<HTMLElement>('.thread-scroll-container'));
  return panes.find((p) => p.getBoundingClientRect().height > 0) ?? null;
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
  if (!turn) return null;
  if (role === 'user') return turn;
  const unit = /:(\d+):assistant$/.exec(el.getAttribute('data-chatgpt-search-unit-key') ?? el.getAttribute('data-content-search-unit-key') ?? '');
  return `${turn}:a${unit?.[1] ?? ''}`;
}

const FINAL = '[data-local-conversation-final-assistant]';

/** In a Work turn that has a final answer, only that answer counts (commentary units are work log). */
function isMessage(el: Element, role: Role): boolean {
  if (role !== 'assistant') return true;
  const turn = el.closest('[data-turn-key]');
  if (!turn?.querySelector(FINAL)) return true;
  return !!el.closest(FINAL);
}

/** File name of a generated-file card: a button holding exactly one `span[title=<file name>]`. */
function fileCardName(el: Element): string | null {
  if (el.tagName !== 'BUTTON') return null;
  const spans = el.querySelectorAll('span[title]');
  if (spans.length !== 1) return null;
  const name = spans[0]!.getAttribute('title')?.trim() ?? '';
  return /^[^\s/\\]{1,120}\.[A-Za-z0-9]{1,10}$/.test(name) ? name : null;
}

/** Raw code and language of a code widget in the new UI. */
function codeWidget(el: Element): string | null {
  const raw = el.getAttribute('data-chatgpt-copy-code');
  if (raw == null) return null;
  const lang =
    el.querySelector('.cm-content[data-language]')?.getAttribute('data-language') ??
    el.querySelector('[data-markdown-copy="exclude"] .truncate, [data-markdown-copy="exclude"] > div')?.textContent?.trim() ??
    '';
  const id = /^[A-Za-z0-9+#.-]{1,20}$/.test(lang) ? lang.toLowerCase() : '';
  return `\n\n${fencedCode(raw.replace(/\n$/, ''), id)}\n\n`;
}

export const chatgpt = defineAdapter({
  service: 'chatgpt',
  siteNames: ['ChatGPT'],
  // `/c/local-chatgpt:<uuid>` is a transient id right after the first send: wait for the real one.
  // Temporary chats are meant to disappear, so gitchat never saves them.
  chatId: (url) => (url.searchParams.get('temporary-chat') === 'true' ? null : idFromPath(url, /\/c\/([0-9a-f]{8}-[0-9a-f-]{27,})/i)),
  root: (doc) => visiblePane(doc) ?? doc,
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
    const pane = visiblePane(doc) ?? doc;
    const busy = Array.from(pane.querySelectorAll(`${IN_PROGRESS}, [data-response-starting][role="status"]`)).find(isShown);
    if (!busy) return null;
    return busy.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? Array.from(pane.querySelectorAll('[data-turn-key]')).pop()?.getAttribute('data-turn-key') ?? null;
  },
  hasTurn: (doc, id) => !!(visiblePane(doc) ?? doc).querySelector(`[data-turn-key="${CSS.escape(id)}"]`),
  aiPhase(doc) {
    // only visible elements count: the stale hidden pane keeps a "thinking" placeholder forever
    if (anyShown(doc, '[data-response-starting][role="status"]')) return 'thinking';
    if (anyShown(doc, '[data-talvt-turn-state="in_progress"]')) {
      const pane = visiblePane(doc) ?? doc;
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
    const pane = visiblePane(doc) ?? doc;
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
    // an opened file preview: tied to the card the user opened, or to the only card with that name;
    // with several candidates and no click to go by, the owner is unknown and the preview is skipped
    for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>(`${RIGHT_PANEL} ${VIZ_FRAME}`))) {
      const name = (frame.getAttribute('title') ?? '').trim();
      if (!name || !frame.contentWindow) continue;
      const opened = ctx.opened();
      let messageId: string | null = null;
      if (opened?.title === name) messageId = opened.messageId;
      else {
        const cards = Array.from(pane.querySelectorAll('button')).filter((b) => fileCardName(b) === name);
        if (cards.length === 1) messageId = ctx.ownerId(cards[0]!);
      }
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
      if (el.hasAttribute('data-chatgpt-copy-code')) {
        const code = codeWidget(el);
        if (code != null) kind('code');
        return code;
      }
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
