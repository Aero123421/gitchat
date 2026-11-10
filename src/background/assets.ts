// Visualization cards and asset links inside message Markdown.
//
// The content script writes a card as one line, `> **Artifact:** Title` or `> **File:** name`, and
// links it to its saved copy as `> **Artifact:** [Title](gitchat-asset:<file>)` (with `[` and `]`
// in the title escaped). In the repository the link points at `<chat>.assets/<file>`.

import type { CapturedAsset, CapturedMessage } from '../shared/types';

export interface Marker {
  kind: string;
  title: string;
  /** Link target, or null for a card without a saved copy. */
  target: string | null;
}

/** One card line; group 1 is the kind, group 2 the rest (a title or a link). */
export const MARKER_LINE = /^> \*\*(Artifact|File):\*\* (.*?)[ \t]*$/gm;
// The saved format escapes brackets only, so a label may end with a literal backslash.
const LINKED = /^\[((?:\\.|[^\]\\])*\\?)\]\(([^()\s]+)\)$/;

export const escapeLabel = (s: string) => s.replace(/[[\]]/g, '\\$&');
const unescapeLabel = (s: string) => s.replace(/\\([[\]\\])/g, '$1');

export function parseMarker(kind: string, rest: string): Marker {
  const l = LINKED.exec(rest);
  return l ? { kind, title: unescapeLabel(l[1] ?? ''), target: l[2] ?? '' } : { kind, title: rest, target: null };
}

export function markerLine(m: Marker): string {
  return `> **${m.kind}:** ${m.target ? `[${escapeLabel(m.title)}](${m.target})` : m.title}`;
}

export function markers(md: string): Marker[] {
  return [...md.matchAll(MARKER_LINE)].map((m) => parseMarker(m[1] ?? '', m[2] ?? ''));
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The asset file name a link target points to (live or repository form), or null. */
export function assetNameOf(target: string): string | null {
  const m = /^(?:gitchat-asset:|[^/()\s]+\.assets\/)([^()\s]+)$/.exec(target);
  return m ? decode(m[1] ?? '') : null;
}

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};

/** Links to files already in the repository: `[label](<chat>.assets/<name>)`, images included. */
const REPO_LINK = /(!?)\[((?:\\.|[^\]\\])*)\]\(([^()\s/]+\.assets\/([^()\s]+))\)/g;

/**
 * Turns a message read from the repository back into live form: every linked asset gets its bytes
 * (`fetch` by file name) and a `gitchat-asset:` link, so the message can be written to any
 * repository later. `fetch` returns null only when the repository has no such file: then the link
 * goes (a card becomes a plain card, a link its label) rather than pointing at nothing. A failed
 * download rejects, and so does this: a message is never read without assets it still has.
 */
export async function materializeAssets(
  m: CapturedMessage,
  fetch: (name: string) => Promise<{ data: string; sha: string } | null>,
): Promise<CapturedMessage> {
  if (!m.markdown.includes('.assets/')) return m;
  const assets: CapturedAsset[] = [...(m.assets ?? [])];
  const found = new Map<string, boolean>();
  for (const [, , , , raw = ''] of m.markdown.matchAll(REPO_LINK)) {
    const name = decode(raw);
    if (found.has(name)) continue;
    const got = await fetch(name);
    found.set(name, !!got);
    if (got && !assets.some((a) => a.name === name)) {
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      assets.push({ name, mime: MIME[ext] ?? 'application/octet-stream', data: got.data, encoding: 'base64', sha: got.sha });
    }
  }
  const markdown = m.markdown
    .replace(MARKER_LINE, (line, kind: string, rest: string) => {
      const mk = parseMarker(kind, rest);
      const name = mk.target ? assetNameOf(mk.target) : null;
      if (!name || !mk.target?.includes('.assets/')) return line;
      return markerLine(found.get(name) ? { ...mk, target: `gitchat-asset:${encodeURIComponent(name)}` } : { ...mk, target: null });
    })
    .replace(REPO_LINK, (_s, bang: string, label: string, _target: string, raw: string) =>
      found.get(decode(raw)) ? `${bang}[${label}](gitchat-asset:${raw})` : unescapeLabel(label),
    );
  const out: CapturedMessage = { ...m, markdown };
  if (assets.length) out.assets = assets;
  return out;
}
