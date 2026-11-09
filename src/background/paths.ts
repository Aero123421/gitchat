// Repository paths for chat files: `<service>/<date>-<title slug>--<id8>.md`.
// The name is fixed once created; other devices find the file by its `--<id8>.md` suffix.

import type { RepoRef, ServiceId } from '../shared/types';
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

/** The chat id reduced to file-name-safe characters. */
function safeId(chatId: string): string {
  return chatId.replace(/[^A-Za-z0-9_-]/g, '') || hash53(chatId);
}

/** First `length` (normally 8) file-name-safe characters of a chat id. */
export function shortId(chatId: string, length = 8): string {
  return safeId(chatId).slice(0, length);
}

/** YYYY-MM-DD in the device's time zone. */
export function localDate(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** `idLength` grows only when another chat already uses the 8-character name (see freePath). */
export function chatPath(service: ServiceId, title: string, chatId: string, createdIso: string, idLength = 8): string {
  return `${service}/${localDate(createdIso)}-${slugify(title)}--${shortId(chatId, idLength)}.md`;
}

/**
 * The chat's default path, or a variant with a longer id suffix when that path is taken by a file
 * of another chat (two chat ids can share their first 8 characters).
 */
export function freePath(service: ServiceId, title: string, chatId: string, createdIso: string, taken: (path: string) => boolean): string {
  for (const n of [8, 16, 32]) {
    const p = chatPath(service, title, chatId, createdIso, n);
    if (!taken(p)) return p;
  }
  return chatPath(service, title, chatId, createdIso, Infinity);
}

/** Folder next to the chat file that holds its assets: `claude/x.md` → `claude/x.assets`. */
export function assetDir(path: string): string {
  return `${path.replace(/\.md$/, '')}.assets`;
}

/**
 * Files that may belong to a chat (written by any device): in the service folder, named
 * `…--<start of the chat id>.md` with at least 8 characters of it. Only candidates — another chat's id
 * can start the same way, so callers confirm with the file's front matter.
 */
export function chatFileCandidates(paths: Iterable<string>, service: ServiceId, chatId: string): string[] {
  const prefix = `${service}/`;
  const id = safeId(chatId);
  const out: { path: string; match: number }[] = [];
  for (const path of paths) {
    if (!path.startsWith(prefix) || !path.endsWith('.md') || path.slice(prefix.length).includes('/')) continue;
    const cut = path.lastIndexOf('--');
    const suffix = cut < 0 ? '' : path.slice(cut + 2, -3);
    if (suffix.length >= Math.min(8, id.length) && id.startsWith(suffix)) out.push({ path, match: suffix.length });
  }
  // Longest id suffix first: the most specific name is the most likely match.
  return out.sort((a, b) => b.match - a.match).map((c) => c.path);
}

/** Percent-encodes each path segment for URLs. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Identity of an archive destination: `owner/name@branch` (owner and name are case-insensitive). */
export function repoId(repo: RepoRef | null | undefined): string | null {
  return repo ? `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}@${repo.branch}` : null;
}
