// Reads the messages currently in the DOM into CapturedMessages.

import type { Adapter, CapturedArtifact, MessageNode } from '../adapters/types';
import { assetSlug } from './frames';
import type { CapturedMessage, ChatSnapshot } from '../../shared/types';
import { toMarkdown } from './markdown';

/** FNV-1a 32-bit, base36 — a short, stable content fingerprint (not for security). */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'SECTION', 'ARTICLE']);

/**
 * User messages are plain text on every site: keep their line breaks as typed. Uses textContent with
 * line breaks at block boundaries rather than innerText, which is empty for off-screen rows on sites
 * that use content-visibility:auto (Gemini).
 */
export function userText(body: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent ?? '';
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'BUTTON' || el.classList.contains('sr-only')) return;
    const block = BLOCKS.has(el.tagName);
    if (block && out && !out.endsWith('\n')) out += '\n';
    for (const c of Array.from(el.childNodes)) walk(c);
    if (block && !out.endsWith('\n')) out += '\n';
  };
  walk(body);
  return out
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert one message element. */
export function captureMessage(adapter: Adapter, node: MessageNode): Omit<CapturedMessage, 'id'> & { id: string | null } {
  const body = adapter.body(node);
  if (node.role === 'user') return { id: node.id, role: 'user', markdown: userText(body), kinds: [] };
  const { markdown, kinds } = toMarkdown(body, adapter.markdown);
  return { id: node.id, role: 'assistant', markdown, kinds };
}

/**
 * Give every message an ID: the service's own when present, otherwise a content fingerprint made
 * unique by its occurrence (two identical "OK" replies get different IDs).
 */
export function assignIds(list: Array<Omit<CapturedMessage, 'id'> & { id: string | null }>): CapturedMessage[] {
  const seen = new Map<string, number>();
  return list.map((m) => {
    if (m.id) return m as CapturedMessage;
    const base = `${m.role[0]}-${fingerprint(`${m.role}\n${m.markdown}`)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...m, id: n ? `${base}-${n}` : base };
  });
}

/** Everything currently rendered on the page (may be a window of a longer chat). */
export function captureVisible(adapter: Adapter, doc: Document): CapturedMessage[] {
  return assignIds(
    adapter
      .messages(doc)
      .map((n) => captureMessage(adapter, n))
      .filter((m) => m.markdown || m.kinds?.length),
  );
}

/**
 * Attach visualization HTML to the message whose artifact card has the same title, and turn the
 * card into a link. `gitchat-asset:<name>` is resolved to the chat's asset folder by the background.
 */
export function attachArtifacts(messages: CapturedMessage[], artifacts: CapturedArtifact[]): CapturedMessage[] {
  if (!artifacts.length) return messages;
  const out = messages.map((m) => ({ ...m, assets: [...(m.assets ?? [])] }));
  for (const art of artifacts) {
    const name = `${assetSlug(art.title)}.html`;
    const marker = `**Artifact:** ${art.title}`;
    const msg = [...out].reverse().find((m) => m.role === 'assistant' && m.markdown.includes(marker));
    if (!msg) continue;
    msg.markdown = msg.markdown.replace(marker, `**Artifact:** [${art.title}](gitchat-asset:${name})`);
    msg.assets = msg.assets.filter((a) => a.name !== name);
    msg.assets.push({ name, mime: 'text/html', data: art.html, encoding: 'utf8' });
    msg.kinds = [...new Set([...(msg.kinds ?? []), 'viz'])];
  }
  return out;
}

export function makeSnapshot(adapter: Adapter, doc: Document, chatId: string, messages: CapturedMessage[], complete: boolean): ChatSnapshot {
  return {
    service: adapter.service,
    chatId,
    url: location.href.split('#')[0] ?? location.href,
    title: adapter.title(doc),
    messages,
    capturedAt: new Date().toISOString(),
    complete,
  };
}
