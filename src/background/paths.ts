// Repository paths for chat files: `<service>/<date>-<title slug>--<id8>.md`.
// The name is fixed once created; other devices find the file by its `--<id8>.md` suffix.

import type { ServiceId } from '../shared/types';
import { hash53 } from './hash';

const MAX_SLUG = 48;

/** Lower-case, script-agnostic slug (keeps letters, marks and digits of any language). */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const cut = Array.from(s).slice(0, MAX_SLUG).join('').replace(/-+$/, '');
  return cut || 'chat';
}

/** First 8 file-name-safe characters of a chat id. */
export function shortId(chatId: string): string {
  const clean = chatId.replace(/[^A-Za-z0-9_-]/g, '');
  return (clean || hash53(chatId)).slice(0, 8);
}

/** YYYY-MM-DD in the device's time zone. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function chatPath(service: ServiceId, title: string, chatId: string, createdIso: string): string {
  return `${service}/${localDate(createdIso)}-${slugify(title)}--${shortId(chatId)}.md`;
}

/** Folder next to the chat file that holds its assets: `claude/x.md` → `claude/x.assets`. */
export function assetDir(path: string): string {
  return `${path.replace(/\.md$/, '')}.assets`;
}

/** Finds a chat's existing file among repository paths (written by any device). */
export function findChatFile(paths: Iterable<string>, service: ServiceId, chatId: string): string | undefined {
  const prefix = `${service}/`;
  const suffix = `--${shortId(chatId)}.md`;
  for (const p of paths) {
    if (p.startsWith(prefix) && p.endsWith(suffix) && !p.slice(prefix.length).includes('/')) return p;
  }
  return undefined;
}

/** Percent-encodes each path segment for URLs. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
