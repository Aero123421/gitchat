// Push engine. Replays local commits on the current remote head with the Git Data API and moves the
// branch fast-forward only. If the branch moved meanwhile, it re-reads the head and replays again.
//
// Conflicts (the repository's copy of a chat changed since the version this device last pushed or
// read): a three-way merge per message against that version. A message changed on one side only
// takes that side's version; changed on both, the newer capture wins; messages added on either side
// are kept. When the repository copy already has everything a local commit adds, the commit is
// skipped ("superseded"). The engine then rebases the chat on what the repository now holds.

import { GitchatError } from '../shared/protocol';
import type { CapturedMessage, ChatKey, RepoRef, ServiceId } from '../shared/types';
import { materializeAssets } from './assets';
import { gitBlobSha } from './hash';
import type { ChatDoc, ChatRecord, CommitWithDoc } from './model';
import { assetDir, chatFileCandidates, freePath } from './paths';
import { parseChatFile, parseFrontMatter, renderChat, type RepoFile } from './render';
import { hashesOf, messageHash, threeWayMerge } from './stage';
import type { GitHub } from './github/client';
import {
  createBlob,
  createCommit,
  createTree,
  findEntry,
  getBlobBase64,
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

/** A chat file as it is in the repository, its messages in live form (assets with their bytes). */
export interface RemoteCopy {
  path: string;
  sha: string;
  front: Record<string, string>;
  messages: CapturedMessage[];
}

/** Where a chat stands in the repository after a push. */
export interface ChatPushResult {
  path: string;
  /** Blob SHA of the chat file. */
  remoteBlob: string;
  /** The messages in that file. */
  messages: CapturedMessage[];
  /** `captured` of that file. */
  capturedAt: string;
  /** The repository copy had changes this device had not seen: the file is not just our last commit. */
  merged: boolean;
}

export interface PushOutcome {
  /** Local commit id → git commit SHA. */
  pushed: Map<string, string>;
  /** Local commits skipped because the repository copy already had everything in them. */
  superseded: Set<string>;
  /** Every chat this push touched. */
  chats: Map<ChatKey, ChatPushResult>;
}

const MAX_ATTEMPTS = 4;

export async function pushCommits(
  gh: GitHub,
  repo: RepoRef,
  items: CommitWithDoc[],
  getChat: (key: ChatKey) => Promise<ChatRecord | undefined>,
): Promise<PushOutcome> {
  for (let attempt = 1; ; attempt++) {
    const head = await ensureHead(gh, repo);
    try {
      return await pushOnto(gh, repo, head, items, getChat);
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

interface Target {
  path: string;
  /** The repository copy, when it changed since the version this device last saw. */
  theirs?: RemoteCopy;
  /** That version's messages (id → hash), when known: the base of the three-way merge. */
  base: Map<string, string> | null;
  written: boolean;
}

async function pushOnto(
  gh: GitHub,
  repo: RepoRef,
  head: Head,
  items: CommitWithDoc[],
  getChat: (key: ChatKey) => Promise<ChatRecord | undefined>,
): Promise<PushOutcome> {
  const index = await getTreeIndex(gh, repo, head.tree);
  const out: PushOutcome = { pushed: new Map(), superseded: new Set(), chats: new Map() };
  const targets = new Map<ChatKey, Target>();
  const claimed = new Set<string>();
  let parent = head.commit;
  let tree = head.tree;

  for (const { commit: c, doc } of items) {
    let target = targets.get(c.key);
    if (!target) {
      target = await resolveTarget(gh, repo, head, index, doc, await getChat(c.key), claimed);
      targets.set(c.key, target);
      claimed.add(target.path);
    }
    const theirs = target.theirs;
    const next = theirs ? combine(doc, theirs, target.base) : doc;
    if (theirs && !target.written && sameContent(next.messages, theirs.messages)) {
      out.superseded.add(c.id);
      out.chats.set(c.key, { path: target.path, remoteBlob: theirs.sha, messages: theirs.messages, capturedAt: theirs.front.captured || doc.capturedAt, merged: true });
      continue;
    }

    const files = renderChat(next, target.path);
    const nextTree = await createTree(gh, repo, tree, await Promise.all(files.map((f) => toEntry(gh, repo, f))));
    if (nextTree !== tree) {
      parent = await createCommit(gh, repo, c.message, nextTree, [parent]);
      tree = nextTree;
    }
    target.written = true;
    out.pushed.set(c.id, parent);
    out.chats.set(c.key, { path: target.path, remoteBlob: await gitBlobSha(files[0]!.content), messages: next.messages, capturedAt: next.capturedAt, merged: !!theirs });
  }

  if (parent !== head.commit) await updateRef(gh, repo, parent);
  return out;
}

/**
 * Picks the file a chat is written to — its confirmed path, a file another device already created
 * for it, or a free new name — and reads the repository copy when it changed since our base.
 */
async function resolveTarget(
  gh: GitHub,
  repo: RepoRef,
  head: Head,
  index: TreeIndex,
  doc: ChatDoc,
  rec: ChatRecord | undefined,
  claimed: Set<string>,
): Promise<Target> {
  let path: string;
  let copy: RemoteCopy | null = null;
  if (rec?.pathConfirmed && rec.path) {
    path = rec.path;
  } else {
    copy = await findChat(gh, repo, head, index, doc.service, doc.chatId);
    if (!copy) {
      const existing = new Set(index.truncated ? await listDir(gh, repo, head, doc.service) : index.entries.keys());
      const taken = (p: string) => existing.has(p) || claimed.has(p);
      path = rec?.path && !taken(rec.path) ? rec.path : freePath(doc.service, doc.title, doc.chatId, doc.createdAt, taken);
      return { path, base: null, written: false };
    }
    path = copy.path;
  }
  const knowsBase = path === rec?.path && !!rec.remoteBlob;
  const sha = copy?.sha ?? (await findEntry(gh, repo, head, index, path));
  if (!sha || (knowsBase && sha === rec.remoteBlob)) return { path, base: null, written: false };
  return {
    path,
    theirs: copy ?? (await readCopy(gh, repo, head, index, path, sha)),
    base: knowsBase && rec.baseRefs ? hashesOf(rec.baseRefs) : null,
    written: false,
  };
}

/** Our commit merged with the repository copy. */
function combine(doc: ChatDoc, theirs: RemoteCopy, base: Map<string, string> | null): ChatDoc {
  const oursWins = oursIsNewer(doc, theirs.front);
  const theirCapture = theirs.front.captured ?? '';
  const theirCreated = theirs.front.created ?? '';
  return {
    ...doc,
    title: oursWins ? doc.title : theirs.front.title || doc.title,
    capturedAt: Date.parse(theirCapture) > Date.parse(doc.capturedAt) ? theirCapture : doc.capturedAt,
    createdAt: Date.parse(theirCreated) < Date.parse(doc.createdAt) ? theirCreated : doc.createdAt,
    messages: threeWayMerge(base, doc.messages, theirs.messages, oursWins),
  };
}

function sameContent(a: CapturedMessage[], b: CapturedMessage[]): boolean {
  return a.length === b.length && a.every((m, i) => m.id === b[i]!.id && messageHash(m) === messageHash(b[i]!));
}

/** The newer capture wins; on a tie, the one with more messages; a non-gitchat file never wins. */
export function oursIsNewer(doc: Pick<ChatDoc, 'capturedAt' | 'messages'>, theirs: Record<string, string>): boolean {
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

// ---- finding a chat's file

/** Blob texts by SHA (immutable), so checking candidates does not download a file twice. */
const blobTexts = new Map<string, string>();

async function blobText(gh: GitHub, repo: RepoRef, sha: string): Promise<string> {
  const hit = blobTexts.get(sha);
  if (hit !== undefined) return hit;
  const text = await getBlobText(gh, repo, sha);
  if (blobTexts.size > 32) blobTexts.delete(blobTexts.keys().next().value as string);
  blobTexts.set(sha, text);
  return text;
}

/** Reads a chat file, fetching the bytes of the assets its messages link to. */
async function readCopy(gh: GitHub, repo: RepoRef, head: Head, index: TreeIndex, path: string, sha: string): Promise<RemoteCopy> {
  const { front, messages } = parseChatFile(await blobText(gh, repo, sha));
  const fetchAsset = async (name: string) => {
    const assetSha = await findEntry(gh, repo, head, index, `${assetDir(path)}/${name}`);
    return assetSha ? { data: await getBlobBase64(gh, repo, assetSha), sha: assetSha } : null;
  };
  const live: CapturedMessage[] = [];
  for (const m of messages) live.push(await materializeAssets(m, fetchAsset));
  return { path, sha, front, messages: live };
}

/**
 * The chat's file in the repository (written by any device). A file name only suggests a match —
 * two chat ids can start alike — so the front matter must name the same service and chat id.
 */
async function findChat(gh: GitHub, repo: RepoRef, head: Head, index: TreeIndex, service: ServiceId, chatId: string): Promise<RemoteCopy | null> {
  const paths = index.truncated ? await listDir(gh, repo, head, service) : index.entries.keys();
  for (const path of chatFileCandidates(paths, service, chatId)) {
    const sha = await findEntry(gh, repo, head, index, path);
    if (!sha) continue;
    const front = parseFrontMatter(await blobText(gh, repo, sha));
    if (front.service === service && front.id === chatId) return readCopy(gh, repo, head, index, path, sha);
  }
  return null;
}

/** Looks for a chat's file in the repository and reads it (any device may have created it). */
export async function findRemoteChat(gh: GitHub, repo: RepoRef, service: ServiceId, chatId: string): Promise<RemoteCopy | null> {
  const head = await getHead(gh, repo);
  if (!head) return null;
  return findChat(gh, repo, head, await getTreeIndex(gh, repo, head.tree), service, chatId);
}
