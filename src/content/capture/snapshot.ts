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
export function captureVisible(adapter: Adapter, doc: Document, nodes = adapter.messages(doc)): CapturedMessage[] {
  return assignIds(nodes.map((n) => captureMessage(adapter, n)).filter((m) => m.markdown || m.kinds?.length));
}

/** What one read of the page saw, frozen at the moment of the read. */
export interface PageRead {
  messages: CapturedMessage[];
  url: string;
  title: string;
  /** ISO time of the DOM read (not of any later enrichment). */
  capturedAt: string;
  /** The site's own ids of the messages on the page (content-derived ids left out). */
  serviceIds?: string[];
}

/**
 * The chat URL an adapter wants stored: its own canonical form, or origin + pathname. The hash is
 * never part of the chat, and a hand-built adapter without the hook still drops the query.
 */
export function canonicalPageUrl(adapter: Adapter, href: string): string {
  try {
    const url = new URL(href);
    return adapter.canonicalUrl?.(url) ?? `${url.origin}${url.pathname}`;
  } catch {
    return href.split('#')[0] ?? href;
  }
}

/** Reads the visible messages and the page's identity in one synchronous step. */
export function readPage(adapter: Adapter, doc: Document): PageRead {
  const nodes = adapter.messages(doc);
  return {
    messages: captureVisible(adapter, doc, nodes),
    serviceIds: nodes.flatMap((n) => (n.id ? [n.id] : [])),
    url: canonicalPageUrl(adapter, location.href),
    title: adapter.title(doc),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * True when the transcript shows its last message: everything after the first message we already
 * know is on the page, so turns missing from the capture really are gone (a branch edit). Lists
 * that keep every loaded message in the DOM always qualify.
 */
export function isAtEnd(adapter: Adapter, doc: Document): boolean {
  if (!adapter.virtualized) return true;
  const sc = adapter.scrollContainer(doc);
  if (!sc) return false;
  const remaining = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
  return remaining <= Math.max(40, sc.clientHeight * 0.5);
}

/** File name of a visualization's asset: readable, and fixed by the artifact's identity. */
export function artifactAssetName(art: CapturedArtifact): string {
  return `${assetSlug(art.title)}-${fingerprint(art.key)}.html`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Turns the first plain "**Artifact:** <title>" (or "**File:**") line into a link to the asset. */
function linkMarker(md: string, title: string, name: string): string | null {
  const re = new RegExp(`^(> \\*\\*(?:Artifact|File):\\*\\* )${escapeRe(title)}[ \\t]*$`, 'm');
  if (!re.test(md)) return null;
  const label = title.replace(/[[\]]/g, '\\$&');
  return md.replace(re, (_m, prefix: string) => `${prefix}[${label}](gitchat-asset:${name})`);
}

/**
 * Attach visualization HTML to the message that shows its card, and turn the card into a link.
 * The owner is found by message ID; only artifacts without a known owner fall back to the newest
 * answer with exactly that card title. `gitchat-asset:<name>` is resolved by the background.
 */
export function attachArtifacts(messages: CapturedMessage[], artifacts: CapturedArtifact[]): CapturedMessage[] {
  if (!artifacts.length) return messages;
  const out = messages.map((m) => ({ ...m, assets: [...(m.assets ?? [])] }));
  const byId = new Map(out.map((m) => [m.id, m]));
  for (const art of artifacts) {
    const name = artifactAssetName(art);
    const owner = art.messageId
      ? byId.get(art.messageId)
      : [...out].reverse().find((m) => m.role === 'assistant' && linkMarker(m.markdown, art.title, name) !== null);
    if (!owner) continue;
    const linked = linkMarker(owner.markdown, art.title, name);
    if (linked === null) continue;
    owner.markdown = linked;
    owner.assets = owner.assets.filter((a) => a.name !== name);
    owner.assets.push({ name, mime: 'text/html', data: art.html, encoding: 'utf8' });
    owner.kinds = [...new Set([...(owner.kinds ?? []), 'viz'])];
  }
  return out;
}

/**
 * `view`: the tab's visit to the chat that read the page (see ChatSnapshot.view). `startConfirmed`:
 * a complete capture known to begin at the chat's first message (see ChatSnapshot.startConfirmed).
 */
export function makeSnapshot(
  adapter: Adapter,
  chatId: string,
  read: PageRead,
  messages: CapturedMessage[],
  complete: boolean,
  atEnd = false,
  view?: ChatSnapshot['view'],
  startConfirmed = false,
): ChatSnapshot {
  return {
    service: adapter.service,
    chatId,
    url: read.url,
    title: read.title,
    messages,
    capturedAt: read.capturedAt,
    complete,
    ...(complete ? {} : { atEnd }),
    ...(complete && startConfirmed ? { startConfirmed: true } : {}),
    ...(view ? { view } : {}),
  };
}
