// Assign HTML in a way that also works on pages that enforce Trusted Types (Gemini does).
// Content scripts normally run outside the page's Trusted Types rules; if a page or browser ever
// applies them to us, fall back to a named policy instead of failing to show the widget.
let policy = null;

export function setHTML(el, html) {
  try {
    el.innerHTML = html;
    return;
  } catch (e) {
    if (!(e instanceof TypeError) || !globalThis.trustedTypes?.createPolicy) throw e;
  }
  policy ??= globalThis.trustedTypes.createPolicy('gitchat', { createHTML: (s) => s });
  el.innerHTML = policy.createHTML(html);
}
