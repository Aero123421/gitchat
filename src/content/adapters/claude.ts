// Claude (claude.ai). Verified on the live site (2026-11, ja-JP UI); see DESIGN.md "Site adapters".
//
// - Every message is its own `[data-testid=transcript-row]`; the list is virtualized (~20 rows in
//   the DOM) and loads older rows in batches of 32 when the scroller reaches the top.
// - `data-testid`s and `data-*` hooks are not localized; aria-labels are, so never match on them.
// - An answer can have several `.standard-markdown` segments interleaved with tool-use groups.
import type { MessageNode } from './types';
import { defineAdapter, idFromPath } from './define';
import { serializeFrames, type FrameRequest } from '../capture/frames';

const CARD = '[data-testid="frame-card-open"]';
const cardTitle = (card: Element) => (card.textContent ?? '').trim() || 'Artifact';

/** Text segments and artifact cards of an answer, in order, without tool-use chrome. */
function answerBody(node: MessageNode): Element {
  const box = node.el.ownerDocument.createElement('div');
  const parts = node.el.querySelectorAll('.standard-markdown, [data-testid="frame-card-open"]');
  for (const part of Array.from(parts)) {
    if (part.parentElement?.closest('.standard-markdown')) continue;
    box.appendChild(part.cloneNode(true));
  }
  return parts.length ? box : node.el;
}

export const claude = defineAdapter({
  service: 'claude',
  siteNames: ['Claude'],
  chatId: (url) => idFromPath(url, /^\/chat\/([0-9a-f-]{36})/i),
  // ~20 rows in the DOM at a time
  virtualized: true,
  selectors: {
    user: ['[data-testid="user-message"]'],
    assistant: ['[data-testid="assistant-message"]'],
    generating: ['[data-testid="chat-input-stop"]', '[data-testid="assistant-message"][data-is-streaming="true"]'],
    composer: ['[data-testid="chat-input"]', 'div[contenteditable="true"].ProseMirror'],
    scroller: ['[data-autoscroll-container]'],
    // the first *loaded* row (positions are rebased after each batch): a hint, never proof of the start
    start: ['[data-testid="transcript-row"] [role="article"][aria-posinset="1"]'],
    dark: ['html[data-mode="dark"]'],
  },
  // user: data-turn-key=<turn uuid>, assistant: <turn uuid>-hub-reply — stable across reloads
  idOf: (el) => el.getAttribute('data-turn-key') ?? el.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? null,
  bodyOf: (node) => (node.role === 'assistant' ? answerBody(node) : null),
  // each message is one transcript row with its position among all loaded rows
  positionOf(el) {
    const n = Number(el.closest('[aria-posinset]')?.getAttribute('aria-posinset') ?? el.querySelector('[aria-posinset]')?.getAttribute('aria-posinset'));
    return Number.isInteger(n) && n > 0 ? n : null;
  },
  rowPositions: (doc) =>
    Array.from(doc.querySelectorAll('[data-testid="transcript-row"] [aria-posinset]'))
      .map((el) => Number(el.getAttribute('aria-posinset')))
      .filter((n) => Number.isInteger(n) && n > 0),
  cardOf: (target) => target.closest(CARD),
  cardTitle,
  loadedCount(doc) {
    const n = Number(doc.querySelector('[data-testid="transcript-row"] [role="article"][aria-setsize]')?.getAttribute('aria-setsize'));
    return Number.isFinite(n) && n > 0 ? n : null;
  },
  // The open artifact lives in a same-origin wrapper iframe that holds a cross-origin frame on
  // <uuid>.frame.claudeusercontent.com; gitchat's frame script there returns the rendered HTML. The
  // card of the open artifact carries aria-current="true", which ties the panel to its message.
  async artifacts(doc, ctx) {
    const requests: FrameRequest[] = [];
    const current = Array.from(doc.querySelectorAll(CARD))
      .filter((c) => c.getAttribute('aria-current') === 'true')
      .pop();
    /**
     * Owner of the open panel: the card marked current, else the card the user clicked in this tab.
     * A title alone proves nothing (the list is virtualized: the one matching card in the DOM may not
     * be the one that was opened), so without either the panel is skipped and the saved copy stays.
     */
    const ownerOf = (panelTitle: string): { messageId: string; title: string } | null => {
      if (current) {
        const messageId = ctx.ownerId(current);
        return messageId ? { messageId, title: cardTitle(current) } : null;
      }
      const opened = ctx.opened();
      return opened?.messageId && opened.title === panelTitle ? { messageId: opened.messageId, title: opened.title } : null;
    };
    for (const outer of Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe[src*="/code/artifact/"]'))) {
      const id = /\/code\/artifact\/([^/?#]+)/.exec(outer.getAttribute('src') ?? '')?.[1];
      const owner = ownerOf((outer.getAttribute('title') ?? '').trim());
      if (!owner) continue; // can't tell which message opened it: don't guess
      const key = id ? `artifact:${id}` : `${owner.messageId}:artifact`;
      if (ctx.skip(key)) continue;
      let inner: HTMLIFrameElement | null = null;
      try {
        inner = outer.contentDocument?.querySelector<HTMLIFrameElement>('iframe[src*="claudeusercontent.com"]') ?? null;
      } catch {
        // not readable (should be same-origin, but stay safe)
      }
      if (!inner?.contentWindow) continue;
      requests.push({ key, messageId: owner.messageId, title: owner.title, win: inner.contentWindow });
    }
    return serializeFrames(requests);
  },
  aiPhase(doc) {
    const msgs = doc.querySelectorAll('[data-testid="assistant-message"]');
    const last = msgs[msgs.length - 1];
    if (last?.getAttribute('data-is-streaming') === 'true') return 'streaming';
    if (doc.querySelector('[data-testid="chat-input-stop"]')) return 'thinking';
    return 'idle';
  },
  markdown: {
    ignore: [
      'button',
      '[data-testid="message-actions"]',
      '[data-testid="code-block-copy"]',
      '[data-find-omitted]',
      '[data-testid="TurnStatusClayMark"]',
      '.katex-html',
    ],
    // `##` renders as <h3>: the site shifts headings down one level
    headingLevel: (el) => Number(el.tagName[1]) - 1,
    render(el, _children, kind) {
      if (el.getAttribute('data-testid') !== 'frame-card-open') return null;
      kind('viz');
      return `\n\n> **Artifact:** ${cardTitle(el)}\n\n`;
    },
    // citation pills read "Source title +3": keep the title only
    linkLabel(a) {
      if (!(a.getAttribute('class') ?? '').includes('group/tag')) return null;
      const first = Array.from(a.childNodes).find((n) => (n.textContent ?? '').trim());
      return (first?.textContent ?? a.textContent ?? '').replace(/\s*\+\d+\s*$/, '').trim() || null;
    },
  },
});
