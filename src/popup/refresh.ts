// Before Commit/Push, the popup asks the chat tab to read the page once more.

import type { RefreshResult, ToContent } from '../shared/protocol';

/** How long the tab may take to read and stage the page (visualizations can take a moment). */
export const REFRESH_TIMEOUT_MS = 8000;

/**
 * Ask the chat tab to read the page once more, so a commit/push includes what it shows now. Only an
 * explicit `{ ok: true }` counts: no answer (the tab's script is gone), a timeout or a malformed reply
 * means the page was not read, and committing then could save stale content.
 */
export async function refreshPage(tabId: number, timeoutMs = REFRESH_TIMEOUT_MS): Promise<RefreshResult> {
  const msg: ToContent = { gitchat: 1, type: 'content/refresh' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply: unknown = await Promise.race([
    Promise.resolve()
      .then(() => chrome.tabs.sendMessage(tabId, msg))
      .catch(() => null),
    new Promise<null>((r) => {
      timer = setTimeout(() => r(null), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!reply || typeof reply !== 'object' || typeof (reply as RefreshResult).ok !== 'boolean') return { ok: false };
  const r = reply as RefreshResult;
  if (r.ok) return { ok: true };
  return typeof r.error === 'string' && r.error ? { ok: false, error: r.error } : { ok: false };
}
