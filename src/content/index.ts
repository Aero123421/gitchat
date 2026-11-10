// Content script entry: runs on chatgpt.com, claude.ai, gemini.google.com and grok.com (top frame only).
import { adapterFor } from './adapters/registry';
import { Controller } from './controller';
import { log } from '../shared/log';

/** Chrome sets this on a document it has prerendered and clears it when the page is activated. */
function isPrerendering(doc: Document): boolean {
  return (doc as Document & { prerendering?: boolean }).prerendering === true;
}

/** Starts gitchat on this chat page. A prerendered document is not the user's page yet. */
export function boot(): void {
  const adapter = adapterFor(location.hostname);
  if (!adapter || window.top !== window) return;
  const go = () => {
    new Controller(adapter).start().catch((e) => log.error('failed to start', e));
  };
  // The same document is activated later; starting now would fail its first settings/get and never retry.
  if (isPrerendering(document)) {
    document.addEventListener('prerenderingchange', go, { once: true });
    return;
  }
  go();
}

boot();
