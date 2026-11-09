// Builds an Adapter from a declarative spec, so each service file is mostly selector data.

import type { MarkdownHooks } from '../capture/markdown';
import type { Role, ServiceId } from '../../shared/types';
import type { Adapter, CapturedArtifact, MessageNode, SelectorPack } from './types';
import { combine, exists, isShown, pick, pickAll, scrollableAncestor, themeFromBackground, titleFromDocument } from './dom';

export interface AdapterSpec {
  service: ServiceId;
  /** Where messages live, when the page keeps more than one copy of the transcript. */
  root?(doc: Document): ParentNode;
  doneQuietMs?: number;
  topQuietMs?: number;
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
  /** Custom content element for a message (e.g. a container built from several segments). */
  bodyOf?(node: MessageNode): Element | null;
  /** Precise AI state from site signals; null falls back to the generic guess. */
  aiPhase?(doc: Document): 'idle' | 'thinking' | 'streaming' | null;
  /** Messages loaded so far, if the site exposes it. */
  loadedCount?(doc: Document): number | null;
  /** Rendered HTML of open visualizations (see Adapter.artifacts). */
  artifacts?(doc: Document): Promise<CapturedArtifact[]>;
  markdown?: MarkdownHooks;
}

export function defineAdapter(spec: AdapterSpec): Adapter & { readonly selectors: SelectorPack } {
  const s = spec.selectors;
  const scope = (doc: Document): ParentNode => spec.root?.(doc) ?? doc;
  const messages = (doc: Document): MessageNode[] => {
    const root = scope(doc);
    return combine(pickAll(root, s.user), pickAll(root, s.assistant), (el, role) => spec.idOf?.(el, role) ?? null);
  };

  return {
    service: spec.service,
    selectors: s as SelectorPack,
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
      const explicit = s.scroller ? pick(scope(doc), s.scroller) ?? pick(doc, s.scroller) : null;
      if (explicit instanceof HTMLElement && explicit.scrollHeight > explicit.clientHeight) return explicit;
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
    ...(spec.artifacts ? { artifacts: spec.artifacts } : {}),
    theme: (doc) => (s.dark && exists(doc, s.dark) ? 'dark' : s.dark ? 'light' : themeFromBackground(doc)),
  };
}

/** Matches the first capture group of `re` against the URL path. */
export function idFromPath(url: URL, ...patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(url.pathname);
    if (m?.[1]) return m[1];
  }
  return null;
}
