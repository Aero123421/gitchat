// Claude (claude.ai). Verified on the live site (2026-11, ja-JP UI); see DESIGN.md "Site adapters".
//
// - Every message is its own `[data-testid=transcript-row]`; the list is virtualized (~20 rows in
//   the DOM) and loads older rows in batches of 32 when the scroller reaches the top.
// - `data-testid`s and `data-*` hooks are not localized; aria-labels are, so never match on them.
// - An answer can have several `.standard-markdown` segments interleaved with tool-use groups.
import type { MessageNode } from './types';
import { defineAdapter, idFromPath } from './define';
import { serializeFrames, type FrameRequest } from '../capture/frames';

/** Preview card: the older testid, plus the 2026-09 block class. */
const CARD = '[data-testid="frame-card-open"], .artifact-block-cell';
// These hooks can coexist in one transcript. One selector collects them all; combine drops nested roots.
const ASSISTANT = ['div[data-is-streaming], .font-claude-response, [data-testid="assistant-message"]'];
/** `data-is-streaming="true"` is enough; the testid is not required. */
const STREAMING = ['div[data-is-streaming="true"]', '[data-testid="assistant-message"][data-is-streaming="true"]'];
// Top-level /code/frame/ viewers have no verified stable artifact identity yet.
const PANEL = 'iframe[src*="/code/artifact/"]';

const cardTitle = (card: Element) => (card.textContent ?? '').trim() || 'Artifact';
const isCard = (el: Element) => el.matches(CARD);

function frameURL(frame: HTMLIFrameElement): URL | null {
  try {
    const raw = frame.getAttribute('src') || frame.src || '';
    if (!raw) return null;
    return new URL(raw, 'https://claude.ai');
  } catch {
    return null;
  }
}

function hostIs(url: URL, host: string): boolean {
  return url.hostname === host || url.hostname.endsWith(`.${host}`);
}

function frameWindow(frame: HTMLIFrameElement): Window | null {
  try {
    return frame.contentWindow;
  } catch {
    return null;
  }
}

function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

function childFrames(root: ParentNode): HTMLIFrameElement[] {
  try {
    return Array.from(root.querySelectorAll('iframe')).filter((el): el is HTMLIFrameElement => el.tagName.toUpperCase() === 'IFRAME');
  } catch {
    return [];
  }
}

/**
 * Window of the claudeusercontent.com frame inside a same-origin viewer.
 * Intermediate documents (including claude.ai/code/frame/) are walked. An unreadable window is null.
 */
function userContentWindow(outer: HTMLIFrameElement): Window | null {
  const seen = new Set<ParentNode>();
  const walk = (root: ParentNode): Window | null => {
    if (seen.has(root)) return null;
    seen.add(root);
    const frames = childFrames(root);
    for (const frame of frames) {
      const url = frameURL(frame);
      if (!url || !hostIs(url, 'claudeusercontent.com')) continue;
      const win = frameWindow(frame);
      if (win) return win;
    }
    for (const frame of frames) {
      const url = frameURL(frame);
      if (url && !hostIs(url, 'claude.ai')) continue;
      const child = frameDocument(frame);
      if (!child || child === root) continue;
      const win = walk(child);
      if (win) return win;
    }
    return null;
  };
  try {
    const doc = frameDocument(outer);
    return doc ? walk(doc) : null;
  } catch {
    return null;
  }
}

/** Text segments and artifact cards of an answer, in order, without tool-use chrome. */
function answerBody(node: MessageNode): Element {
  const box = node.el.ownerDocument.createElement('div');
  const parts = node.el.querySelectorAll(`.standard-markdown, ${CARD}`);
  for (const part of Array.from(parts)) {
    if (part.parentElement?.closest('.standard-markdown')) continue;
    box.appendChild(part.cloneNode(true));
  }
  return parts.length ? box : node.el;
}

export const claude = defineAdapter({
  service: 'claude',
  siteNames: ['Claude'],
  // Incognito is a temporary chat: the URL keeps `?incognito=` (empty value counts). No
  // language-independent DOM flag is present here, so a `/chat/<uuid>` without that query is saved.
  chatId: (url) => (url.searchParams.has('incognito') ? null : idFromPath(url, /^\/chat\/([0-9a-f-]{36})/i)),
  // ~20 rows in the DOM at a time
  virtualized: true,
  selectors: {
    user: ['[data-testid="user-message"]'],
    assistant: ASSISTANT,
    generating: ['[data-testid="chat-input-stop"]', ...STREAMING],
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
  // The open artifact is a cross-origin frame on <uuid>.frame.claudeusercontent.com. The viewer is
  // same-origin and may nest another same-origin document (claude.ai/code/frame/) before that frame.
  // The card of the open artifact carries aria-current="true", which ties the panel to its message.
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
    for (const outer of Array.from(doc.querySelectorAll<HTMLIFrameElement>(PANEL))) {
      try {
        const id = /\/code\/artifact\/([^/?#]+)/.exec(outer.getAttribute('src') ?? '')?.[1];
        if (!id) continue;
        const owner = ownerOf((outer.getAttribute('title') ?? '').trim());
        if (!owner) continue; // can't tell which message opened it: don't guess
        const key = `artifact:${id}`;
        if (ctx.skip(key)) continue;
        const win = userContentWindow(outer);
        if (!win) continue; // viewer not readable, or the usercontent frame was never reached
        requests.push({ key, messageId: owner.messageId, title: owner.title, win });
      } catch {
        // one bad panel must not drop the rest
      }
    }
    return serializeFrames(requests);
  },
  // The streaming answer's turn. The observer keeps it, so unmounting that row is not "done".
  activeTurnId(doc) {
    const streaming = Array.from(doc.querySelectorAll(STREAMING.join(', '))).pop();
    return streaming?.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? null;
  },
  hasTurn: (doc, id) => !!doc.querySelector(`[data-turn-key="${CSS.escape(id)}"]`),
  aiPhase(doc) {
    if (doc.querySelector(STREAMING.join(', '))) return 'streaming';
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
      if (!isCard(el)) return null;
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
