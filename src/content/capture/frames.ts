// Ask gitchat's frame script inside a (cross-origin) visualization iframe for its rendered HTML.

export interface FrameHtml {
  html: string;
  title: string;
}

export function requestFrameHtml(target: Window, timeoutMs = 1500): Promise<FrameHtml | null> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { gitchat?: unknown; type?: unknown; nonce?: unknown; html?: unknown; title?: unknown } | null;
      if (!d || d.gitchat !== 1 || d.type !== 'frame/html' || d.nonce !== nonce || e.source !== target) return;
      done(typeof d.html === 'string' ? { html: d.html, title: typeof d.title === 'string' ? d.title : '' } : null);
    };
    const timer = window.setTimeout(() => done(null), timeoutMs);
    const done = (v: FrameHtml | null) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(v);
    };
    window.addEventListener('message', onMessage);
    target.postMessage({ gitchat: 1, type: 'frame/serialize', nonce }, '*');
  });
}

/** One frame to serialize, with what the capture needs to know about it. */
export interface FrameRequest {
  key: string;
  messageId: string | null;
  title: string;
  win: Window;
}

/**
 * Asks several frames at once (each answers or times out on its own), so one slow or blank frame
 * never holds up the others.
 */
export async function serializeFrames(requests: FrameRequest[], timeoutMs = 1500): Promise<Array<{ key: string; messageId: string | null; title: string; html: string }>> {
  const got = await Promise.all(requests.map((r) => requestFrameHtml(r.win, timeoutMs)));
  const out = [];
  for (const [i, r] of requests.entries()) {
    const html = got[i];
    if (html) out.push({ key: r.key, messageId: r.messageId, title: r.title || html.title || 'Visualization', html: html.html });
  }
  return out;
}

/** A short, file-name-safe slug. */
export function assetSlug(title: string): string {
  return (
    title
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'visualization'
  );
}
