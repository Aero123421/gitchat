// Gemini (gemini.google.com). Verified on the live site (2026-11, ja-JP UI); see DESIGN.md.
//
// - Angular custom elements are the stable hooks (`user-query`, `model-response`); `ng-tns-*` and
//   `_ngcontent-*` classes change with every build. Each turn is `.conversation-container#<16hex>`.
// - Only the last 10 turns load first; older ones come in batches of 10 when the scroller
//   (`infinite-scroller.chat-history`) reaches the top. Turns are not removed again, but off-screen
//   turns use content-visibility:auto, so read them with textContent, never innerText.
// - The page enforces Trusted Types; gitchat never writes HTML into the page itself.
import type { MessageNode } from './types';
import { defineAdapter, idFromPath } from './define';
import { requestFrameHtml } from '../capture/frames';

const turnOf = (el: Element) => el.closest('.conversation-container');

/** Language id from the code block's display label ("TypeScript" → "typescript"). */
function codeLanguage(pre: Element): string | null {
  const label = pre.closest('code-block')?.querySelector('.code-block-decoration span')?.textContent?.trim() ?? '';
  // unknown languages get a localized generic label ("コード スニペット"): no language then
  if (!label || !/^[A-Za-z0-9+#.\- ]{1,20}$/.test(label) || /\s/.test(label)) return null;
  const map: Record<string, string> = { 'c++': 'cpp', 'c#': 'csharp', 'objective-c': 'objectivec', shell: 'bash' };
  const id = label.toLowerCase();
  return map[id] ?? id;
}

/** Stable title for a Canvas preview: its turn id + position (the chip has no title element). */
function canvasTitle(chip: Element): string {
  const turn = turnOf(chip);
  const chips = turn ? Array.from(turn.querySelectorAll('immersive-entry-chip')) : [chip];
  return `Canvas ${(turn?.id ?? 'x').slice(0, 6)}-${chips.indexOf(chip) + 1}`;
}

export const gemini = defineAdapter({
  service: 'gemini',
  siteNames: ['Google Gemini', 'Gemini'],
  chatId: (url) => idFromPath(url, /^\/app\/([0-9a-f]{12,})/i, /^\/gem\/[^/]+\/([0-9a-f]{12,})/i),
  selectors: {
    user: ['user-query'],
    assistant: ['model-response'],
    assistantBody: ['message-content .markdown-main-panel', 'message-content .markdown', 'message-content'],
    generating: ['pending-request', 'model-response .markdown[aria-busy="true"]'],
    composer: ['rich-textarea .ql-editor', 'rich-textarea [contenteditable="true"]'],
    scroller: ['infinite-scroller.chat-history', 'infinite-scroller'],
    loadingOlder: ['.loading-content-spinner-container'],
    dark: ['body.dark-theme'],
  },
  idOf: (el, role) => {
    const id = turnOf(el)?.id;
    return id ? `${id}:${role === 'user' ? 'u' : 'a'}` : null;
  },
  bodyOf: (node: MessageNode) => {
    if (node.role !== 'user') return null;
    // p.query-text-line holds the full prompt; the screen-reader h5 is truncated
    const box = node.el.ownerDocument.createElement('div');
    for (const p of Array.from(node.el.querySelectorAll('p.query-text-line'))) box.appendChild(p.cloneNode(true));
    return box.childElementCount ? box : null;
  },
  aiPhase(doc) {
    if (doc.querySelector('pending-request')) return 'thinking';
    const busy = doc.querySelectorAll('model-response .markdown[aria-busy="true"]');
    const last = busy[busy.length - 1];
    if (!last) return 'idle';
    return (last.textContent ?? '').trim() ? 'streaming' : 'thinking';
  },
  async artifacts(doc) {
    const out = [];
    for (const chip of Array.from(doc.querySelectorAll('immersive-entry-chip'))) {
      const frame = chip.querySelector<HTMLIFrameElement>('iframe[src*="usercontent.goog"]');
      if (!frame?.contentWindow) continue;
      const got = await requestFrameHtml(frame.contentWindow);
      if (got) out.push({ title: canvasTitle(chip), html: got.html });
    }
    return out;
  },
  markdown: {
    ignore: [
      'button',
      '[role="button"]',
      'mat-icon',
      '.code-block-decoration',
      '.cdk-visually-hidden',
      'source-footnote',
      'thinking-overlay',
      'message-actions',
    ],
    codeLanguage,
    render(el) {
      if (el.tagName !== 'IMMERSIVE-ENTRY-CHIP') return null;
      return `\n\n> **Artifact:** ${canvasTitle(el)}\n\n`;
    },
  },
});
