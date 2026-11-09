// Choosing the archive repository: list, create, or use an existing one (must be empty or already
// managed by gitchat). An empty repository gets a README first, so the Git Data API can be used.

import { GitchatError, type RepoSummary } from '../../shared/protocol';
import type { RepoRef } from '../../shared/types';
import type { GitHub } from './client';
import { getBlobText, getHead, getTreeIndex, putFile, repoPath, type Head } from './git';

export const README_MARKER = '<!-- gitchat -->';
const TOPIC = 'gitchat';
const SERVICE_DIRS = ['chatgpt', 'claude', 'gemini'];

export const README = `${README_MARKER}
# AI chat archive

This repository is managed by [gitchat](https://github.com/Aero123421/gitchat). Each conversation is one Markdown file:

| Folder | Service |
| --- | --- |
| \`chatgpt/\` | ChatGPT |
| \`claude/\` | Claude |
| \`gemini/\` | Gemini |

File names look like \`2026-11-09-chat-title--a1b2c3d4.md\`: the date of the first save, the title, and the
start of the chat id. Interactive visualizations are saved next to their chat in a \`*.assets/\` folder.
`;

interface ApiRepo {
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch?: string;
  size?: number;
  topics?: string[];
  permissions?: { push?: boolean };
}

export async function listRepos(gh: GitHub): Promise<RepoSummary[]> {
  const r = await gh.request<ApiRepo[]>('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  return r.data
    .filter((x) => x.permissions?.push !== false)
    .map((x) => ({
      owner: x.owner.login,
      name: x.name,
      private: x.private,
      defaultBranch: x.default_branch || 'main',
      empty: (x.size ?? 0) === 0,
      managed: (x.topics ?? []).includes(TOPIC),
    }));
}

export async function createRepo(gh: GitHub, name: string, isPrivate: boolean): Promise<RepoRef> {
  const clean = name.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(clean)) {
    throw new GitchatError('Repository names can only use letters, numbers, ".", "-" and "_".', 'invalid');
  }
  const r = await gh
    .request<ApiRepo>('POST', '/user/repos', {
      name: clean,
      private: isPrivate,
      auto_init: false,
      description: 'AI chat archive managed by gitchat',
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    })
    .catch((e: unknown) => {
      // GitHub answers 422 "name already exists on this account"
      if (e instanceof GitchatError && e.code === 'invalid' && /already exists/i.test(e.message)) {
        throw new GitchatError(`You already have a repository named ${clean}. Pick it from the list or choose another name.`, 'repo-exists');
      }
      throw e;
    });
  return bootstrapRepo(gh, { owner: r.data.owner.login, name: r.data.name }, r.data.default_branch);
}

export async function useRepo(gh: GitHub, owner: string, name: string, branch?: string): Promise<RepoRef> {
  const info = await gh.request<ApiRepo>('GET', repoPath({ owner, name }), undefined, [404]);
  if (info.status === 404) throw new GitchatError(`${owner}/${name} was not found, or this sign-in cannot see it.`, 'not-found');
  if (info.data.permissions && !info.data.permissions.push) throw new GitchatError(`You don't have permission to push to ${owner}/${name}.`, 'forbidden');
  const ref: RepoRef = { owner: info.data.owner.login, name: info.data.name, branch: branch || info.data.default_branch || 'main' };
  const head = await getHead(gh, ref);
  if (!head) return bootstrapRepo(gh, ref, ref.branch);
  if (!(await isManaged(gh, ref, head))) {
    throw new GitchatError(`${ref.owner}/${ref.name} already has files that gitchat did not create. Choose an empty repository, or let gitchat create a new one.`, 'repo-not-empty');
  }
  return ref;
}

/** Writes the README that makes an empty repository usable (the Git Data API needs a first commit). */
export async function bootstrapRepo(gh: GitHub, repo: Pick<RepoRef, 'owner' | 'name'>, fallbackBranch?: string): Promise<RepoRef> {
  await putFile(gh, repo, 'README.md', README, 'Initialize gitchat archive');
  // Lets the repository picker recognize gitchat repositories; not essential.
  await gh.request('PUT', `${repoPath(repo)}/topics`, { names: [TOPIC] }).catch(() => undefined);
  const info = await gh.request<ApiRepo>('GET', repoPath(repo));
  return { owner: repo.owner, name: repo.name, branch: info.data.default_branch || fallbackBranch || 'main' };
}

async function isManaged(gh: GitHub, repo: RepoRef, head: Head): Promise<boolean> {
  const index = await getTreeIndex(gh, repo, head.tree);
  for (const p of index.entries.keys()) {
    if (SERVICE_DIRS.some((d) => p.startsWith(`${d}/`)) && p.endsWith('.md')) return true;
  }
  const readme = index.entries.get('README.md');
  return !!readme && (await getBlobText(gh, repo, readme)).includes(README_MARKER);
}
