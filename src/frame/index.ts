// Runs inside interactive-visualization iframes (e.g. Claude artifacts on *.claudeusercontent.com).
// When gitchat in the chat page asks, it replies with a static HTML snapshot of what is rendered,
// so the visualization can be saved next to the chat. It never sends anything on its own.

export const ALLOWED_PARENTS = new Set(['https://claude.ai', 'https://chatgpt.com', 'https://gemini.google.com', 'https://grok.com']);

if (typeof window !== 'undefined') window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { gitchat?: unknown; type?: unknown; nonce?: unknown } | null;
  if (!d || d.gitchat !== 1 || d.type !== 'frame/serialize' || typeof d.nonce !== 'string') return;
  if (!ALLOWED_PARENTS.has(e.origin) || e.source !== window.top) return;
  const html = `<!doctype html>\n${document.documentElement.outerHTML}`;
  (e.source as Window).postMessage({ gitchat: 1, type: 'frame/html', nonce: d.nonce, html, title: document.title }, e.origin);
});
