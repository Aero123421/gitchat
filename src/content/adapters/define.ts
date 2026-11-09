// Builds an Adapter from a declarative spec, so each service file is mostly selector data.

import type { MarkdownHooks } from '../capture/markdown';
import type { Role, ServiceId } from '../../shared/types';
import type { Adapter, CapturedArtifact, MessageNode, SelectorPack } from './types';
import { combine, exists, isShown, pick, pickAll, scrollableAncestor, themeFromBackground, titleFromDocument } from './dom';

/** The preview card the user opened last (a click in the transcript). */
export interface OpenedCard {
  messageId: string | null;
  title: string;
}

/** Helpers handed to an adapter's `artifacts` hook. */
export interface ArtifactContext {
  /** ID of the message element that contains `el` (the same ID the message is captured with). */
  ownerId(el: Element): string | null;
  /** True when this artifact was already collected and need not be asked for again. */
  skip(key: string): boolean;
  /** The card the user last opened in this tab, if any (ties a side panel to its message). */
  opened(): OpenedCard | null;
}

export interface AdapterSpec {
  service: ServiceId;
  /** Where messages live, when the page keeps more than one copy of the transcript. */
  root?(doc: Document): ParentNode;
  /** The site removes off-screen messages from the DOM (see Adapter.virtualized). */
  virtualized: boolean;
  doneQuietMs?: number;
  topQuietMs?: number;
  watchAttributes?: readonly string[];
  /** Names to strip from document.title ("ChatGPT", "Claude", "Gemini"). */
  siteNames: string[];
  chatId(url: URL): string | null;
  selectors: {
    user: readonly string[];
    assistant: readonly string[];
    /** Content element inside a user message (defaults to the message element). */
    userBody?: readonly string[];
    /** Content element inside an assistant message (defaults to the message element). */
    assistantBody?: readonly string[];
    /** Shown only while the AI is generating (e.g. the stop button). */
    generating: readonly string[];
    composer: readonly string[];
    /** The conversation's scroll container (defaults to the nearest scrollable ancestor). */
    scroller?: readonly string[];
    /** Loader shown while older messages are fetched. */
    loadingOlder?: readonly string[];
    /** Element that exists only when the very start of the conversation is rendered. */
    start?: readonly string[];
    /** Title element (defaults to document.title). */
    title?: readonly string[];
    /** Present when the page is in dark mode. */
    dark?: readonly string[];
  };
  /** The service's message ID for an element, if the DOM exposes one. */
  idOf?(el: Element, role: Role): string | null;
  /** Leave out matched elements that are not messages (e.g. a work log's commentary units). */
  keep?(el: Element, role: Role): boolean;
  /** 1-based position of a message among all loaded ones, when the site exposes it. */
  positionOf?(el: Element): number | null;
  /** Positions of every numbered row in the DOM (see Adapter.rowPositions). */
  rowPositions?(doc: Document): number[];
  /** The preview card (artifact/file) a click landed on, and its title: remembered as "opened". */
  cardOf?(target: Element): Element | null;
  cardTitle?(card: Element): string;
  /** Custom content element for a message (e.g. a container built from several segments). */
  bodyOf?(node: MessageNode): Element | null;
  /** Precise AI state from site signals; null falls back to the generic guess. */
  aiPhase?(doc: Document): 'idle' | 'thinking' | 'streaming' | null;
  /** Messages loaded so far, if the site exposes it. */
  loadedCount?(doc: Document): number | null;
  /** Rendered HTML of open visualizations (see Adapter.artifacts). */
  artifacts?(doc: Document, ctx: ArtifactContext): Promise<CapturedArtifact[]>;
  /** See Adapter.activeTurnId / Adapter.hasTurn. */
  activeTurnId?(doc: Document): string | null;
  hasTurn?(doc: Document, id: string): boolean;
  markdown?: MarkdownHooks;
}

export function defineAdapter(spec: AdapterSpec): Adapter & { readonly selectors: SelectorPack } {
  const s = spec.selectors;
  const scope = (doc: Document): ParentNode => spec.root?.(doc) ?? doc;
  const messages = (doc: Document): MessageNode[] => {
    const root = scope(doc);
    const all = combine(pickAll(root, s.user), pickAll(root, s.assistant), (el, role) => spec.idOf?.(el, role) ?? null);
    return spec.keep ? all.filter((n) => spec.keep!(n.el, n.role)) : all;
  };
  let opened: OpenedCard | null = null;
  const watched = new WeakSet<Document>();
  /** The outermost message element around `el`, as `messages()` would report it. */
  const ownerId = (el: Element): string | null => {
    for (const role of ['assistant', 'user'] as const) {
      let found: Element | null = null;
      for (const sel of role === 'user' ? s.user : s.assistant) {
        try {
          for (let cur = el.closest(sel); cur; cur = cur.parentElement?.closest(sel) ?? null) found = cur;
        } catch {
          // unsupported selector
        }
        if (found) break;
      }
      if (found) return spec.idOf?.(found, role) ?? null;
    }
    return null;
  };

  return {
    service: spec.service,
    selectors: s as SelectorPack,
    virtualized: spec.virtualized,
    ...(spec.positionOf ? { positionOf: (node: MessageNode) => spec.positionOf!(node.el) } : {}),
    ...(spec.rowPositions ? { rowPositions: (doc: Document) => spec.rowPositions!(doc) } : {}),
    watch(doc: Document) {
      if (!spec.cardOf || watched.has(doc)) return;
      watched.add(doc);
      doc.addEventListener(
        'click',
        (e) => {
          const card = e.target instanceof Element ? spec.cardOf!(e.target) : null;
          if (card) opened = { messageId: ownerId(card), title: spec.cardTitle?.(card) ?? (card.textContent ?? '').trim() };
        },
        true,
      );
    },
    ...(spec.watchAttributes ? { watchAttributes: spec.watchAttributes } : {}),
    ...(spec.activeTurnId ? { activeTurnId: spec.activeTurnId } : {}),
    ...(spec.hasTurn ? { hasTurn: spec.hasTurn } : {}),
    ...(spec.doneQuietMs ? { doneQuietMs: spec.doneQuietMs } : {}),
    ...(spec.topQuietMs ? { topQuietMs: spec.topQuietMs } : {}),
    chatId: (url) => spec.chatId(url),
    title(doc) {
      const el = s.title ? pick(doc, s.title) : null;
      const fromEl = el?.textContent?.trim();
      return fromEl || titleFromDocument(doc, spec.siteNames);
    },
    messages,
    body(node) {
      const custom = spec.bodyOf?.(node);
      if (custom) return custom;
      const sel = node.role === 'user' ? s.userBody : s.assistantBody;
      return (sel && pick(node.el, sel)) || node.el;
    },
    markdown: spec.markdown ?? {},
    scrollContainer(doc) {
      if (s.scroller) {
        // a known scroller is used even before it overflows (a short first batch may just fit);
        // overflow only guides the generic search below
        const known = scrollerCandidates(scope(doc), doc, s.scroller);
        const shown = known.find((el) => isShown(el));
        if (shown) return shown;
        const overflowing = known.find((el) => el.scrollHeight > el.clientHeight);
        if (overflowing) return overflowing;
      }
      const first = messages(doc)[0]?.el ?? null;
      return scrollableAncestor(first);
    },
    isGenerating(doc) {
      for (const sel of s.generating) {
        try {
          for (const el of Array.from(doc.querySelectorAll(sel))) if (isShown(el) || el.matches('[data-is-streaming="true"]')) return true;
        } catch {
          // unsupported selector
        }
      }
      return false;
    },
    isLoadingOlder: (doc) => (s.loadingOlder ? pickAll(doc, s.loadingOlder).some(isShown) : false),
    isAtStart: (doc) => (s.start ? exists(doc, s.start) : false),
    loadedCount: (doc) => spec.loadedCount?.(doc) ?? null,
    aiPhase: (doc) => spec.aiPhase?.(doc) ?? null,
    composer: (doc) => pick(doc, s.composer),
    ...(spec.artifacts
      ? {
          artifacts: (doc: Document, opts?: { skip?: ReadonlySet<string> }) =>
            spec.artifacts!(doc, { ownerId, skip: (key) => opts?.skip?.has(key) ?? false, opened: () => opened }),
        }
      : {}),
    theme: (doc) => (s.dark && exists(doc, s.dark) ? 'dark' : s.dark ? 'light' : themeFromBackground(doc)),
  };
}

/** Elements matching the scroller candidates: the scope itself first, then inside it, then anywhere. */
function scrollerCandidates(scope: ParentNode, doc: Document, sels: readonly string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = (el: Element | null) => {
    if (el instanceof HTMLElement && !out.includes(el)) out.push(el);
  };
  for (const sel of sels) {
    try {
      if (scope instanceof Element && scope.matches(sel)) add(scope);
      scope.querySelectorAll(sel).forEach(add);
      doc.querySelectorAll(sel).forEach(add);
    } catch {
      // unsupported selector
    }
  }
  return out;
}

/** Matches the first capture group of `re` against the URL path. */
export function idFromPath(url: URL, ...patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(url.pathname);
    if (m?.[1]) return m[1];
  }
  return null;
}
