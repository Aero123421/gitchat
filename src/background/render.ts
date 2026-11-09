// Renders a chat into its repository files: one Markdown file (front matter + messages) and the
// message assets next to it. Format: see DESIGN.md.

import { ASSET_URL_PREFIX, type CapturedAsset, type CapturedMessage } from '../shared/types';
import type { ChatDoc } from './model';
import { assetDir } from './paths';

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
    lines.push(`## ${ROLE_HEADING[m.role]}`, `<!-- gitchat:message id="${commentSafe(m.id)}" -->`, '');
    const body = rewriteAssetLinks(m.markdown, renames[i], dirName).trim();
    if (body) lines.push(body, '');
  });

  const out: RepoFile[] = [{ path, content: `${lines.join('\n').replace(/\n+$/, '')}\n`, encoding: 'utf8', kind: 'chat' }];
  for (const [name, a] of assets) out.push({ path: `${dir}/${name}`, content: a.data, encoding: a.encoding, kind: 'asset' });
  return out;
}

/** Gives every asset a unique, safe file name; returns the per-message renames. */
function collectAssets(messages: CapturedMessage[]): { files: Map<string, CapturedAsset>; renames: Map<string, string>[] } {
  const files = new Map<string, CapturedAsset>();
  const renames = messages.map((m) => {
    const map = new Map<string, string>();
    for (const a of m.assets ?? []) {
      const safe = safeName(a.name);
      let name = safe;
      for (let n = 2; files.has(name) && files.get(name)?.data !== a.data; n++) name = withSuffix(safe, n);
      files.set(name, a);
      map.set(a.name, name);
    }
    return map;
  });
  return { files, renames };
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
 */
export function parseChatFile(md: string): { front: Record<string, string>; messages: CapturedMessage[] } {
  const front = parseFrontMatter(md);
  const marker = /^## (User|Assistant)\n<!-- gitchat:message id="([^"]*)" -->\n/gm;
  const found = [...md.matchAll(marker)];
  const messages = found.map((m, i): CapturedMessage => {
    const start = (m.index ?? 0) + m[0].length;
    const end = found[i + 1]?.index ?? md.length;
    return { id: m[2] ?? '', role: m[1] === 'User' ? 'user' : 'assistant', markdown: md.slice(start, end).trim() };
  });
  return { front, messages };
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
