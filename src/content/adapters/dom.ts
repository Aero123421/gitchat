// Small DOM helpers shared by the adapters.

import type { MessageNode } from './types';
import type { Role } from '../../shared/types';

/** First element matching any of the candidates, tried in order. Invalid selectors are skipped. */
export function pick(root: ParentNode, candidates: readonly string[]): Element | null {
  for (const sel of candidates) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      // a selector this browser does not support; try the next one
    }
  }
  return null;
}

/** All elements for the first candidate that matches at least one element. */
export function pickAll(root: ParentNode, candidates: readonly string[]): Element[] {
  for (const sel of candidates) {
    try {
      const list = root.querySelectorAll(sel);
      if (list.length) return Array.from(list);
    } catch {
      // try the next one
    }
  }
  return [];
}

/** True when any candidate matches. */
export function exists(root: ParentNode, candidates: readonly string[]): boolean {
  return pick(root, candidates) !== null;
}

/** Sort nodes into document order and drop nodes nested inside another node of the list. */
export function inDocumentOrder(nodes: MessageNode[]): MessageNode[] {
  const sorted = [...nodes].sort((a, b) => {
    if (a.el === b.el) return 0;
    return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  // In document order a nested element comes right after its ancestor, so one pass is enough.
  const out: MessageNode[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && (last.el === n.el || last.el.contains(n.el))) continue;
    out.push(n);
  }
  return out;
}

/** Combine user and assistant elements into ordered MessageNodes. */
export function combine(user: Element[], assistant: Element[], idOf: (el: Element, role: Role) => string | null): MessageNode[] {
  return inDocumentOrder([
    ...user.map((el) => ({ el, role: 'user' as const, id: idOf(el, 'user') })),
    ...assistant.map((el) => ({ el, role: 'assistant' as const, id: idOf(el, 'assistant') })),
  ]);
}

/** Nearest ancestor (or the element itself) that actually scrolls vertically. */
export function scrollableAncestor(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    if (cur instanceof HTMLElement) {
      const oy = getComputedStyle(cur).overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && cur.scrollHeight > cur.clientHeight + 4) return cur;
    }
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** Decide light/dark from the page's background color when there is no explicit theme marker. */
export function themeFromBackground(doc: Document): 'light' | 'dark' {
  const pickBg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '');
  const bg = [pickBg(doc.body), pickBg(doc.documentElement)].find((c) => c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) ?? '';
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
  if (!m) return doc.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
}

/** Trimmed document.title without a trailing " - Site" / " | Site" suffix. */
export function titleFromDocument(doc: Document, siteNames: string[]): string {
  let t = doc.title.trim();
  for (const name of siteNames) {
    const re = new RegExp(`\\s*[-|–—]\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    t = t.replace(re, '');
    if (t.toLowerCase() === name.toLowerCase()) return '';
  }
  return t.trim();
}

/** Visible-ish check used for buttons such as "Stop generating". */
export function isShown(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
