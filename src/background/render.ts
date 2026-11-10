// Renders a chat into its repository files: one Markdown file (front matter + messages) and the
// message assets next to it. Format: see DESIGN.md.

import { ASSET_URL_PREFIX, type CapturedAsset, type CapturedMessage } from '../shared/types';
import type { ChatDoc } from './model';
import { assetDir } from './paths';
import { canonicalMarkdown } from './stage';

export interface RepoFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
  kind: 'chat' | 'asset';
}

const ROLE_HEADING = { user: 'User', assistant: 'Assistant' } as const;
const UNTITLED = 'Untitled chat';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** YAML double-quoted scalar; JSON string escapes are valid YAML. */
const yamlString = (s: string) => JSON.stringify(s);
/** Keeps an id from closing the HTML comment it sits in. */
const commentSafe = (s: string) => s.replace(/--+/g, '-').replace(/[<>"]/g, '');

export function chatTitle(title: string): string {
  return oneLine(title) || UNTITLED;
}

export function renderChat(doc: ChatDoc, path: string): RepoFile[] {
  const dir = assetDir(path);
  const dirName = dir.slice(dir.lastIndexOf('/') + 1);
  const { files: assets, renames } = collectAssets(doc.messages);
  const title = chatTitle(doc.title);

  const lines = [
    '---',
    'gitchat: 1',
    `service: ${doc.service}`,
    `id: ${yamlString(doc.chatId)}`,
    `url: ${yamlString(doc.url)}`,
    `title: ${yamlString(title)}`,
    `created: ${doc.createdAt}`,
    `captured: ${doc.capturedAt}`,
    `messages: ${doc.messages.length}`,
    '---',
    '',
    `# ${title}`,
    '',
  ];
  doc.messages.forEach((m, i) => {
    // The body length lets a reader find where the message ends even when the text itself contains
    // something that looks like the next message's heading (e.g. a pasted gitchat file).
    const body = canonicalMarkdown(rewriteAssetLinks(m.markdown, renames[i], dirName));
    lines.push(`## ${ROLE_HEADING[m.role]}`, `<!-- gitchat:message id="${commentSafe(m.id)}" length="${body.length}" -->`, '');
    if (body) lines.push(body, '');
  });

  const out: RepoFile[] = [{ path, content: `${lines.join('\n').replace(/\n+$/, '')}\n`, encoding: 'utf8', kind: 'chat' }];
  for (const [name, a] of assets) out.push({ path: `${dir}/${name}`, content: a.data, encoding: a.encoding, kind: 'asset' });
  return out;
}

/** A link to a message asset: not yet uploaded (`gitchat-asset:`) or a file next to the chat. */
const ASSET_MARKDOWN_LINK = /\[((?:\\.|[^\\\]])*)\]\((?:gitchat-asset:[^()\s]+|[^()\s/]+\.assets\/[^()\s]+)\)/g;

/**
 * The chat as Markdown to paste elsewhere: the title and one section per message, without the front
 * matter and message comments the repository file needs. A pasted text cannot bring the asset
 * files along, so a link to one turns back into its card label ("> **Artifact:** <title>").
 */
export function renderCopy(doc: Pick<ChatDoc, 'title' | 'messages'>): string {
  const lines = [`# ${chatTitle(doc.title)}`, ''];
  for (const m of doc.messages) {
    const body = canonicalMarkdown(m.markdown.replace(ASSET_MARKDOWN_LINK, (_m, label: string) => label.replace(/\\([[\]])/g, '$1')));
    lines.push(`## ${ROLE_HEADING[m.role]}`, '');
    if (body) lines.push(body, '');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

/**
 * Gives every asset a unique, safe file name; returns the per-message renames. Names that other
 * messages already link to in the repository (read back from a file, without data) are taken, so
 * a new file never overwrites another message's visualization.
 */
function collectAssets(messages: CapturedMessage[]): { files: Map<string, CapturedAsset>; renames: Map<string, string>[] } {
  const files = new Map<string, CapturedAsset>();
  const linkedBy = new Map<string, number>();
  messages.forEach((m, i) => {
    for (const name of repositoryLinks(m.markdown)) if (!linkedBy.has(name)) linkedBy.set(name, i);
  });
  const taken = (name: string, a: CapturedAsset, i: number) =>
    (files.has(name) && files.get(name)?.data !== a.data) || (linkedBy.has(name) && linkedBy.get(name) !== i);
  const renames = messages.map((m, i) => {
    const map = new Map<string, string>();
    for (const a of m.assets ?? []) {
      const safe = safeName(a.name);
      let name = safe;
      for (let n = 2; taken(name, a, i); n++) name = withSuffix(safe, n);
      files.set(name, a);
      map.set(a.name, name);
    }
    return map;
  });
  return { files, renames };
}

/** Asset file names a message links to as files already in the repository (`<chat>.assets/<name>`). */
function repositoryLinks(md: string): string[] {
  return [...md.matchAll(/\]\([^()\s/]+\.assets\/([^()\s]+)\)/g)].map((m) => decodeURIComponentSafe(m[1] ?? ''));
}

function safeName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
  return s || 'asset';
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`;
}

/** URL-encodes one path segment, including the parentheses that would end a Markdown link. */
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');

const ASSET_LINK = new RegExp(`${ASSET_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\s)"'<>]+)`, 'g');

/**
 * `gitchat-asset:<name>` → `<base>.assets/<name>` (relative to the chat file) when the message has
 * that asset; otherwise the prefix is dropped and the name left as it is.
 */
function rewriteAssetLinks(md: string, renames: Map<string, string> | undefined, dirName: string): string {
  if (!md.includes(ASSET_URL_PREFIX)) return md;
  return md.replace(ASSET_LINK, (_m, raw: string) => {
    const name = renames?.get(raw) ?? renames?.get(decodeURIComponentSafe(raw));
    return name ? `${encodeSegment(dirName)}/${encodeSegment(name)}` : raw;
  });
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Reads a chat file written by renderChat back into messages. Lets a second device continue a chat
 * that another device saved. Asset links stay relative paths: the assets are already in the
 * repository, and rendering leaves such links unchanged.
 *
 * A message heading only counts as one when it is followed by gitchat's message comment and is not
 * inside a code block. Newer files record each body's length, which settles even a body that
 * contains a pasted gitchat file; older (or hand-edited) files fall back to scanning.
 */
export function parseChatFile(md: string): { front: Record<string, string>; messages: CapturedMessage[] } {
  const front = parseFrontMatter(md);
  const text = md.replace(/\r\n?/g, '\n');
  const messages: CapturedMessage[] = [];
  let header = nextHeader(text, 0);
  while (header) {
    let body: string | undefined;
    let next: Header | null = null;
    if (header.length !== undefined) {
      const at = text.startsWith('\n', header.end) ? header.end + 1 : header.end;
      const rest = text.slice(at + header.length);
      const fits = rest === '' || rest === '\n' || rest.startsWith('\n\n## ') || (header.length === 0 && rest.startsWith('## '));
      if (fits) {
        body = text.slice(at, at + header.length);
        next = nextHeader(text, header.length === 0 ? at : at + header.length + 2);
      }
    }
    if (body === undefined) {
      next = nextHeader(text, header.end);
      body = canonicalMarkdown(text.slice(header.end, next ? next.start : text.length));
    }
    messages.push({ id: header.id, role: header.role, markdown: body });
    header = next;
  }
  return { front, messages };
}

interface Header {
  role: CapturedMessage['role'];
  id: string;
  length?: number;
  /** Index of the heading line. */
  start: number;
  /** Index right after the message comment line. */
  end: number;
}

const HEADER = /^## (User|Assistant)\n<!-- gitchat:message id="([^"]*)"(?: length="(\d+)")? -->(?:\n|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The next message heading at or after `from` (a line start), skipping fenced code. */
function nextHeader(text: string, from: number): Header | null {
  let fence: string | null = null;
  for (let at = from; at < text.length; ) {
    const eol = text.indexOf('\n', at);
    const line = text.slice(at, eol < 0 ? text.length : eol);
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length && line.trim() === f) fence = null;
    } else if (f) {
      fence = f;
    } else {
      const h = HEADER.exec(text.slice(at, at + 400));
      if (h) {
        const header: Header = { role: h[1] === 'User' ? 'user' : 'assistant', id: h[2] ?? '', start: at, end: at + h[0].length };
        if (h[3] !== undefined) header.length = Number(h[3]);
        return header;
      }
    }
    if (eol < 0) break;
    at = eol + 1;
  }
  return null;
}

/** Reads the simple `key: value` front matter that renderChat writes. */
export function parseFrontMatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!md.startsWith('---\n')) return out;
  const end = md.indexOf('\n---', 4);
  if (end < 0) return out;
  for (const line of md.slice(4, end).split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        // keep the raw text
      }
    }
    out[key] = value;
  }
  return out;
}
