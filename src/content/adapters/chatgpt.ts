// ChatGPT (chatgpt.com). Two DOM generations are supported; the first selector that matches wins.
//
// New app shell (verified live 2026-11, ja-JP, "Chat | Work" switch):
// - Each message is a "search unit": `[data-chatgpt-search-unit-key$=":user"|":assistant"]` with the
//   message uuid in `data-chatgpt-search-message-ids`. `fallback-turn-N` keys are window-relative,
//   so never use them as identity.
// - The answer is rendered with `data-d-component` blocks; bold/italic are spans, the horizontal rule
//   is a div, display math is marked by `data-d-block`, and code keeps its raw source in
//   `data-chatgpt-copy-code`.
// - Reasoning summaries share the answer's style attribute but carry `data-markdown-text-tone`.
// - The transcript is virtualized (~11 turns in the DOM) and older turns load 5 at a time; the app
//   re-anchors the scroll after each load and has no start marker.
// - A stale, hidden copy of the transcript (0×0) can stay in the DOM: always read the visible one.
// Classic UI: `[data-message-author-role]`, `.markdown`, `#prompt-textarea`, stop-button test id.
import { defineAdapter, idFromPath } from './define';
import { isShown } from './dom';
import { requestFrameHtml } from '../capture/frames';

/** The visible transcript pane (there may be a hidden duplicate). */
function visiblePane(doc: Document): HTMLElement | null {
  const panes = Array.from(doc.querySelectorAll<HTMLElement>('.thread-scroll-container'));
  return panes.find((p) => p.getBoundingClientRect().height > 0) ?? null;
}

function anyShown(doc: Document, selector: string): boolean {
  return Array.from(doc.querySelectorAll(selector)).some(isShown);
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
  const runs = raw.match(/^`{3,}/gm) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return `\n\n${fence}${id}\n${raw.replace(/\n$/, '')}\n${fence}\n\n`;
}

export const chatgpt = defineAdapter({
  service: 'chatgpt',
  siteNames: ['ChatGPT'],
  // `/c/local-chatgpt:<uuid>` is a transient id right after the first send: wait for the real one.
  // Temporary chats are meant to disappear, so gitchat never saves them.
  chatId: (url) => (url.searchParams.get('temporary-chat') === 'true' ? null : idFromPath(url, /\/c\/([0-9a-f]{8}-[0-9a-f-]{27,})/i)),
  root: (doc) => visiblePane(doc) ?? doc,
  // Work-mode turns flicker complete → in progress → complete at the end
  doneQuietMs: 1300,
  // older turns arrive 5 at a time and the app re-anchors the scroll after each batch
  topQuietMs: 3500,
  selectors: {
    user: ['[data-chatgpt-search-unit-key$=":user"]', '[data-message-author-role="user"]'],
    assistant: ['[data-chatgpt-search-unit-key$=":assistant"]', '[data-message-author-role="assistant"]'],
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
  idOf: (el) => el.getAttribute('data-chatgpt-search-message-ids')?.split(/[\s,]+/)[0] || el.getAttribute('data-message-id'),
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
  async artifacts(doc) {
    const out = [];
    const pane = visiblePane(doc) ?? doc;
    for (const frame of Array.from(pane.querySelectorAll<HTMLIFrameElement>('iframe[src*="web-sandbox.oaiusercontent.com"]'))) {
      if (!frame.contentWindow) continue;
      const got = await requestFrameHtml(frame.contentWindow);
      if (got) out.push({ title: (frame.getAttribute('title') ?? '').trim() || got.title || 'Visualization', html: got.html });
    }
    return out;
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
    render(el, children) {
      if (el.hasAttribute('data-chatgpt-copy-code')) return codeWidget(el);
      if (el.getAttribute('data-d-component') === 'divider') return '\n\n---\n\n';
      if (el.hasAttribute('data-d-default-strong')) return `**${children(el).trim()}**`;
      if (el.getAttribute('data-d-font-style') === 'italic') return `*${children(el).trim()}*`;
      if (el.getAttribute('data-d-component') === 'popover-trigger') {
        // web-search citation pill: the URL is not in the page, keep the source name
        const name = (el.textContent ?? '').replace(/\s*\+\d+\s*$/, '').trim();
        return name ? ` [${name}]` : '';
      }
      if (el.tagName === 'IFRAME' && (el.getAttribute('src') ?? '').includes('web-sandbox.oaiusercontent.com')) {
        return `\n\n> **Artifact:** ${(el.getAttribute('title') ?? '').trim() || 'Visualization'}\n\n`;
      }
      return null;
    },
  },
});
