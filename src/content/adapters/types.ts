import type { MarkdownHooks } from '../capture/markdown';
import type { Role, ServiceId } from '../../shared/types';

/** One message element found on the page. */
export interface MessageNode {
  el: Element;
  role: Role;
  /** The service's own message ID when the DOM exposes one. */
  id: string | null;
}

/**
 * Everything gitchat needs to know about one chat service.
 *
 * Adapters are mostly data: ranked selector candidates (see `SelectorPack`) plus a few small hooks.
 * When the first candidate stops matching after a site update, the next one is tried, and the
 * generic heuristics in `generic.ts` are the last resort. Keep site knowledge here and nowhere else.
 */
export interface Adapter {
  readonly service: ServiceId;
  /** Chat ID from the page URL, or null on pages that are not a saved conversation. */
  chatId(url: URL): string | null;
  /** Conversation title as shown by the site (empty when not known yet). */
  title(doc: Document): string;
  /** All message elements currently in the DOM, in conversation order. */
  messages(doc: Document): MessageNode[];
  /** The element holding the rendered message content (without toolbars). Defaults to the node. */
  body(node: MessageNode): Element;
  /** Site-specific Markdown conversion hooks. */
  markdown: MarkdownHooks;
  /** The element that scrolls the conversation. */
  scrollContainer(doc: Document): HTMLElement | null;
  /** True while the AI is thinking or writing an answer. */
  isGenerating(doc: Document): boolean;
  /** True while older messages are being fetched (a loader at the top of the list). */
  isLoadingOlder(doc: Document): boolean;
  /** True when the very beginning of the conversation is rendered. */
  isAtStart(doc: Document): boolean;
  /** Messages loaded so far, when the site exposes it (e.g. aria-setsize); null if unknown. */
  loadedCount(doc: Document): number | null;
  /** What the AI is doing right now, if the site exposes precise signals; null to use the generic guess. */
  aiPhase(doc: Document): 'idle' | 'thinking' | 'streaming' | null;
  /** The message input box. */
  composer(doc: Document): Element | null;
  /** Light or dark page theme, for the widget's glass. */
  theme(doc: Document): 'light' | 'dark';
  /** Rendered HTML of visualizations that are open right now (e.g. an artifact side panel). */
  artifacts?(doc: Document): Promise<CapturedArtifact[]>;
  /** How long the page must stay idle before an answer counts as finished (default 700 ms). */
  readonly doneQuietMs?: number;
  /** Init: how long nothing may change at the top before we call it the start (default 2500 ms). */
  readonly topQuietMs?: number;
}

export interface CapturedArtifact {
  /** Title shown on the artifact's card in the message, used to match the two. */
  title: string;
  html: string;
}

/** Ranked selector candidates per concept. The first selector that matches wins. */
export type SelectorPack = Record<string, readonly string[]>;
