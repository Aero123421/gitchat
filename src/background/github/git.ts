// Git Data API helpers: read the branch head and tree, write blobs/trees/commits, move the ref.

import { GitchatError } from '../../shared/protocol';
import type { RepoRef } from '../../shared/types';
import { base64ToUtf8, utf8ToBase64 } from '../base64';
import { encodePath } from '../paths';
import type { GitHub } from './client';

export interface Head {
  commit: string;
  tree: string;
}

export interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha?: string;
  content?: string;
}

/** Repository paths → blob SHAs of one tree (recursive). `truncated` = GitHub cut the listing short. */
export interface TreeIndex {
  entries: Map<string, string>;
  truncated: boolean;
}

export const repoPath = (repo: Pick<RepoRef, 'owner' | 'name'>) => `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

/** The branch head, or null when the repository has no commits yet. */
export async function getHead(gh: GitHub, repo: RepoRef): Promise<Head | null> {
  const ref = await gh.request<{ object: { sha: string } }>('GET', `${repoPath(repo)}/git/ref/heads/${encodePath(repo.branch)}`, undefined, [404, 409]);
  if (ref.status === 409) return null; // "Git Repository is empty."
  if (ref.status === 404) {
    const commits = await gh.request<unknown>('GET', `${repoPath(repo)}/commits?per_page=1`, undefined, [409]);
    if (commits.status === 409) return null;
    throw new GitchatError(`The branch "${repo.branch}" does not exist in ${repo.owner}/${repo.name}.`, 'not-found');
  }
  const commit = await gh.request<{ tree: { sha: string } }>('GET', `${repoPath(repo)}/git/commits/${ref.data.object.sha}`);
  return { commit: ref.data.object.sha, tree: commit.data.tree.sha };
}

const treeCache = new Map<string, TreeIndex>();

export async function getTreeIndex(gh: GitHub, repo: RepoRef, treeSha: string): Promise<TreeIndex> {
  const cacheKey = `${repo.owner}/${repo.name}@${treeSha}`;
  const hit = treeCache.get(cacheKey);
  if (hit) return hit;
  const r = await gh.request<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>('GET', `${repoPath(repo)}/git/trees/${treeSha}?recursive=1`);
  const index: TreeIndex = { entries: new Map(), truncated: !!r.data.truncated };
  for (const e of r.data.tree) if (e.type === 'blob') index.entries.set(e.path, e.sha);
  if (treeCache.size > 16) treeCache.delete(treeCache.keys().next().value as string);
  treeCache.set(cacheKey, index);
  return index;
}

/** Blob SHA of `path` at `head`, or undefined when the file does not exist. */
export async function findEntry(gh: GitHub, repo: RepoRef, head: Head, index: TreeIndex, path: string): Promise<string | undefined> {
  const sha = index.entries.get(path);
  if (sha || !index.truncated) return sha;
  const r = await gh.request<{ sha?: string }>('GET', `${repoPath(repo)}/contents/${encodePath(path)}?ref=${head.commit}`, undefined, [404]);
  return r.status === 404 ? undefined : r.data.sha;
}

/** File paths directly inside `dir` (used when a recursive tree listing was truncated). */
export async function listDir(gh: GitHub, repo: RepoRef, head: Head, dir: string): Promise<string[]> {
  const r = await gh.request<{ path: string; type: string }[]>('GET', `${repoPath(repo)}/contents/${encodePath(dir)}?ref=${head.commit}`, undefined, [404]);
  if (r.status === 404 || !Array.isArray(r.data)) return [];
  return r.data.filter((e) => e.type === 'file').map((e) => e.path);
}

export async function getBlobText(gh: GitHub, repo: RepoRef, sha: string): Promise<string> {
  const r = await gh.request<{ content: string; encoding: string }>('GET', `${repoPath(repo)}/git/blobs/${sha}`);
  return r.data.encoding === 'base64' ? base64ToUtf8(r.data.content) : r.data.content;
}

export async function createBlob(gh: GitHub, repo: RepoRef, base64: string): Promise<string> {
  const r = await gh.request<{ sha: string }>('POST', `${repoPath(repo)}/git/blobs`, { content: base64, encoding: 'base64' });
  return r.data.sha;
}

export async function createTree(gh: GitHub, repo: RepoRef, baseTree: string, entries: TreeEntry[]): Promise<string> {
  const r = await gh.request<{ sha: string }>('POST', `${repoPath(repo)}/git/trees`, { base_tree: baseTree, tree: entries });
  return r.data.sha;
}

export async function createCommit(gh: GitHub, repo: RepoRef, message: string, tree: string, parents: string[]): Promise<string> {
  const r = await gh.request<{ sha: string }>('POST', `${repoPath(repo)}/git/commits`, { message, tree, parents });
  return r.data.sha;
}

/** Fast-forward the branch; throws code "non-fast-forward" when the remote moved. */
export async function updateRef(gh: GitHub, repo: RepoRef, sha: string): Promise<void> {
  await gh.request('PATCH', `${repoPath(repo)}/git/refs/heads/${encodePath(repo.branch)}`, { sha, force: false });
}

/** Creates the first commit of an empty repository (the Git Data API needs one to exist). */
export async function putFile(gh: GitHub, repo: Pick<RepoRef, 'owner' | 'name'>, path: string, text: string, message: string): Promise<void> {
  await gh.request('PUT', `${repoPath(repo)}/contents/${encodePath(path)}`, { message, content: utf8ToBase64(text) });
}
