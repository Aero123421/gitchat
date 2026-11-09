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
  /**
   * URL stored for this chat. Default is origin + pathname (no query, no hash). Gemini also drops
   * the `/u/<n>` account slot. Never used as the chat key.
   */
  canonicalUrl?(url: URL): string;
  /**
   * Conversation id the page itself reports, when it exposes one (ChatGPT's selection attribute).
   * Null when the attribute is missing — callers then keep the URL-only behaviour.
   */
  pageChatId?(doc: Document): string | null;
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
  /**
   * Rendered HTML of visualizations that are open right now (e.g. an artifact side panel). Frames
   * whose `key` is in `skip` are not asked again (init collects them step by step).
   */
  artifacts?(doc: Document, opts?: { skip?: ReadonlySet<string> }): Promise<CapturedArtifact[]>;
  /**
   * True when the site removes off-screen messages from the DOM (a virtualized list). Init then has
   * to harvest while scrolling; otherwise every loaded message is in the DOM and one read is enough.
   */
  readonly virtualized: boolean;
  /** Extra attributes whose changes tell the AI observer to look again (busy/turn-state flags). */
  readonly watchAttributes?: readonly string[];
  /**
   * Identity of the turn the AI is working on right now, when the site exposes it. The observer
   * remembers it, so a virtualized list that unmounts the busy turn is not mistaken for "done".
   */
  activeTurnId?(doc: Document): string | null;
  /** Whether the turn with this identity is currently in the DOM (see `activeTurnId`). */
  hasTurn?(doc: Document, id: string): boolean;
  /**
   * 1-based position of a message among all loaded messages, when the site exposes it (Claude's
   * aria-posinset). Init then checks that every position up to `loadedCount` was read.
   */
  positionOf?(node: MessageNode): number | null;
  /** Positions of every numbered row in the DOM now, messages or not (coverage counts all rows). */
  rowPositions?(doc: Document): number[];
  /** Start listening to the page (e.g. which preview card the user opens). Called once per page. */
  watch?(doc: Document): void;
  /** How long the page must stay idle before an answer counts as finished (default 700 ms). */
  readonly doneQuietMs?: number;
  /** Init: how long nothing may change at the top before we call it the start (default 2500 ms). */
  readonly topQuietMs?: number;
}

export interface CapturedArtifact {
  /**
   * Stable identity of the visualization: the site's artifact id, or the owning message id plus the
   * frame's position in it. Names the saved asset, so a recapture never renames or overwrites
   * another visualization's file.
   */
  key: string;
  /** ID of the message that shows the artifact's card, when known; otherwise matched by title. */
  messageId: string | null;
  /** Label of the card in the message (the text after "**Artifact:**" / "**File:**"). */
  title: string;
  html: string;
}

/** Ranked selector candidates per concept. The first selector that matches wins. */
export type SelectorPack = Record<string, readonly string[]>;
