// Push engine. Replays local commits on the current remote head with the Git Data API and moves the
// branch fast-forward only. If the branch moved meanwhile, it re-reads the head and replays again.
//
// Conflicts (another device changed the same chat file since our base): the newer capture wins —
// `captured` in front matter, then message count. A losing local commit is reported as superseded
// and skipped; its content remains recoverable from that device.

import { GitchatError } from '../shared/protocol';
import type { ChatKey, RepoRef, ServiceId } from '../shared/types';
import { gitBlobSha } from './hash';
import type { ChatDoc, ChatRecord, LocalCommit } from './model';
import { chatPath, findChatFile } from './paths';
import { parseFrontMatter, renderChat, type RepoFile } from './render';
import type { GitHub } from './github/client';
import {
  createBlob,
  createCommit,
  createTree,
  findEntry,
  getBlobText,
  getHead,
  getTreeIndex,
  listDir,
  updateRef,
  type Head,
  type TreeEntry,
  type TreeIndex,
} from './github/git';
import { bootstrapRepo } from './github/repo';

export interface ChatPathInfo {
  path: string;
  /** Blob SHA of the chat file on the remote after this push. */
  remoteBlob: string;
}

export interface PushOutcome {
  /** Local commit id → git commit SHA. */
  pushed: Map<string, string>;
  /** Local commits skipped because the remote had a newer capture. */
  superseded: Set<string>;
  /** Final path and remote blob of every chat this push touched. */
  chats: Map<ChatKey, ChatPathInfo>;
}

const MAX_ATTEMPTS = 4;

export async function pushCommits(
  gh: GitHub,
  repo: RepoRef,
  commits: LocalCommit[],
  getChat: (key: ChatKey) => Promise<ChatRecord | undefined>,
): Promise<PushOutcome> {
  for (let attempt = 1; ; attempt++) {
    const head = await ensureHead(gh, repo);
    try {
      return await pushOnto(gh, repo, head, commits, getChat);
    } catch (e) {
      if (e instanceof GitchatError && e.code === 'non-fast-forward' && attempt < MAX_ATTEMPTS) continue;
      throw e;
    }
  }
}

async function ensureHead(gh: GitHub, repo: RepoRef): Promise<Head> {
  const head = await getHead(gh, repo);
  if (head) return head;
  await bootstrapRepo(gh, repo, repo.branch);
  const after = await getHead(gh, repo);
  if (!after) throw new GitchatError('Could not initialize the repository.', 'github');
  return after;
}

async function pushOnto(
  gh: GitHub,
  repo: RepoRef,
  head: Head,
  commits: LocalCommit[],
  getChat: (key: ChatKey) => Promise<ChatRecord | undefined>,
): Promise<PushOutcome> {
  const index = await getTreeIndex(gh, repo, head.tree);
  const out: PushOutcome = { pushed: new Map(), superseded: new Set(), chats: new Map() };
  // Where each chat's file goes in this push, and the remote version our content is based on.
  const bases = new Map<ChatKey, { path: string; base?: string }>();
  const written = new Set<string>();
  let parent = head.commit;
  let tree = head.tree;

  for (const c of commits) {
    if (!c.doc) continue;
    let target = bases.get(c.key);
    if (!target) {
      target = await resolveTarget(gh, repo, head, index, c.doc, await getChat(c.key));
      bases.set(c.key, target);
    }
    const files = renderChat(c.doc, target.path);
    const chatFile = files[0];
    if (!chatFile) continue;
    const ourSha = await gitBlobSha(chatFile.content);

    if (!written.has(target.path)) {
      const remoteSha = await findEntry(gh, repo, head, index, target.path);
      if (remoteSha && remoteSha !== target.base && remoteSha !== ourSha) {
        const theirs = parseFrontMatter(await getBlobText(gh, repo, remoteSha));
        if (!oursIsNewer(c.doc, theirs)) {
          out.superseded.add(c.id);
          out.chats.set(c.key, { path: target.path, remoteBlob: remoteSha });
          continue;
        }
      }
    }

    const nextTree = await createTree(gh, repo, tree, await Promise.all(files.map((f) => toEntry(gh, repo, f))));
    if (nextTree !== tree) {
      parent = await createCommit(gh, repo, c.message, nextTree, [parent]);
      tree = nextTree;
    }
    out.pushed.set(c.id, parent);
    written.add(target.path);
    out.chats.set(c.key, { path: target.path, remoteBlob: ourSha });
  }

  if (parent !== head.commit) await updateRef(gh, repo, parent);
  return out;
}

/** Picks the file a chat is written to: its confirmed path, or a file another device already created. */
async function resolveTarget(
  gh: GitHub,
  repo: RepoRef,
  head: Head,
  index: TreeIndex,
  doc: ChatDoc,
  rec: ChatRecord | undefined,
): Promise<{ path: string; base?: string }> {
  if (rec?.pathConfirmed && rec.path) return { path: rec.path, base: rec.remoteBlob };
  const candidates = index.truncated ? await listDir(gh, repo, head, doc.service) : index.entries.keys();
  const found = findChatFile(candidates, doc.service, doc.chatId);
  if (found) return { path: found, base: found === rec?.path ? rec?.remoteBlob : undefined };
  return { path: rec?.path ?? chatPath(doc.service, doc.title, doc.chatId, doc.createdAt), base: rec?.remoteBlob };
}

/** The newer capture wins; on a tie, the one with more messages; a non-gitchat file never wins. */
export function oursIsNewer(doc: ChatDoc, theirs: Record<string, string>): boolean {
  if (theirs.gitchat === undefined) return true;
  const ours = Date.parse(doc.capturedAt);
  const other = Date.parse(theirs.captured ?? '');
  if (Number.isNaN(other)) return true;
  if (Number.isNaN(ours)) return false;
  if (ours !== other) return ours > other;
  return doc.messages.length >= Number(theirs.messages ?? 0);
}

async function toEntry(gh: GitHub, repo: RepoRef, f: RepoFile): Promise<TreeEntry> {
  if (f.encoding === 'utf8') return { path: f.path, mode: '100644', type: 'blob', content: f.content };
  return { path: f.path, mode: '100644', type: 'blob', sha: await createBlob(gh, repo, f.content) };
}

export interface RemoteChat {
  path: string;
  sha: string;
  text?: string;
}

/** Looks for a chat's file in the repository (any device may have created it). */
export async function findRemoteChat(gh: GitHub, repo: RepoRef, service: ServiceId, chatId: string, withText: boolean): Promise<RemoteChat | null> {
  const head = await getHead(gh, repo);
  if (!head) return null;
  const index = await getTreeIndex(gh, repo, head.tree);
  const path = findChatFile(index.truncated ? await listDir(gh, repo, head, service) : index.entries.keys(), service, chatId);
  if (!path) return null;
  const sha = await findEntry(gh, repo, head, index, path);
  if (!sha) return null;
  return withText ? { path, sha, text: await getBlobText(gh, repo, sha) } : { path, sha };
}
