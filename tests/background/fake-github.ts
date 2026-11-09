// In-memory GitHub: just enough of the REST, Git Data and device-flow APIs for the background tests.
// Blob SHAs are real git blob ids; tree SHAs depend only on content (like git); commit SHAs are counters.

import { base64ToUtf8, utf8ToBase64 } from '../../src/background/base64';
import { gitBlobSha, hash53 } from '../../src/background/hash';

interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

export interface FakeRepo {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  push: boolean;
  topics: string[];
  branches: Map<string, string>;
  commits: Map<string, Commit>;
  trees: Map<string, Map<string, string>>;
  blobs: Map<string, string>;
}

type Req = { method: string; url: URL; body: Record<string, unknown> | null; auth: string | null };
type Injection = { match: (r: Req) => boolean; respond: (r: Req) => Response; times: number };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export class FakeGitHub {
  readonly repos = new Map<string, FakeRepo>();
  readonly calls: string[] = [];
  login = 'octo';
  token = 'tok';
  scopes = 'repo';
  /** Scripted replies for /login/oauth/access_token. */
  tokenReplies: Record<string, unknown>[] = [];
  /** Runs once right before the next ref update (to simulate another device pushing). */
  beforeRefUpdate: ((repo: FakeRepo) => Promise<void>) | null = null;
  private injections: Injection[] = [];
  private seq = 0;

  /** Make the next `times` matching requests return a custom response. */
  inject(match: (r: Req) => boolean, respond: (r: Req) => Response, times = 1): void {
    this.injections.push({ match, respond, times });
  }

  addRepo(name: string, opts: Partial<Pick<FakeRepo, 'owner' | 'private' | 'push' | 'defaultBranch'>> = {}): FakeRepo {
    const repo: FakeRepo = {
      owner: opts.owner ?? this.login,
      name,
      private: opts.private ?? true,
      defaultBranch: opts.defaultBranch ?? 'main',
      push: opts.push ?? true,
      topics: [],
      branches: new Map(),
      commits: new Map(),
      trees: new Map([[this.treeSha(new Map()), new Map()]]),
      blobs: new Map(),
    };
    this.repos.set(`${repo.owner}/${name}`, repo);
    return repo;
  }

  /** Commits text files on a branch, as another device or a person would. */
  async commitFiles(repo: FakeRepo, files: Record<string, string>, message = 'remote change'): Promise<string> {
    const head = repo.branches.get(repo.defaultBranch);
    const base = new Map(head ? repo.trees.get(repo.commits.get(head)!.tree) : []);
    for (const [path, text] of Object.entries(files)) base.set(path, await this.putBlob(repo, utf8ToBase64(text)));
    const tree = this.storeTree(repo, base);
    const sha = this.newCommit(repo, { tree, parents: head ? [head] : [], message });
    repo.branches.set(repo.defaultBranch, sha);
    return sha;
  }

  /** Text of a file at the branch head. */
  fileAt(repo: FakeRepo, path: string): string | undefined {
    const tree = this.headTree(repo);
    const sha = tree?.get(path);
    const blob = sha ? repo.blobs.get(sha) : undefined;
    return blob === undefined ? undefined : base64ToUtf8(blob);
  }

  paths(repo: FakeRepo): string[] {
    return [...(this.headTree(repo)?.keys() ?? [])].sort();
  }

  commitCount(repo: FakeRepo): number {
    let n = 0;
    for (let sha = repo.branches.get(repo.defaultBranch); sha; sha = repo.commits.get(sha)?.parents[0]) n++;
    return n;
  }

  private headTree(repo: FakeRepo) {
    const head = repo.branches.get(repo.defaultBranch);
    return head ? repo.trees.get(repo.commits.get(head)!.tree) : undefined;
  }

  private treeSha(entries: Map<string, string>): string {
    const s = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([p, sha]) => `${p}\0${sha}`).join('\n');
    return `tree${hash53(s)}`;
  }

  private storeTree(repo: FakeRepo, entries: Map<string, string>): string {
    const sha = this.treeSha(entries);
    repo.trees.set(sha, entries);
    return sha;
  }

  private newCommit(repo: FakeRepo, c: Commit): string {
    const sha = `c${(++this.seq).toString(16).padStart(39, '0')}`;
    repo.commits.set(sha, c);
    return sha;
  }

  private async putBlob(repo: FakeRepo, base64: string): Promise<string> {
    const sha = await gitBlobSha(base64, 'base64');
    repo.blobs.set(sha, base64);
    return sha;
  }

  private isAncestor(repo: FakeRepo, ancestor: string, sha: string | undefined): boolean {
    for (let cur = sha; cur; cur = repo.commits.get(cur)?.parents[0]) if (cur === ancestor) return true;
    return false;
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') {
      body = init.body.startsWith('{') ? (JSON.parse(init.body) as Record<string, unknown>) : Object.fromEntries(new URLSearchParams(init.body));
    }
    const headers = new Headers(init?.headers);
    const req: Req = { method, url, body, auth: headers.get('authorization') };
    this.calls.push(`${method} ${url.pathname}`);
    const inj = this.injections.find((i) => i.times > 0 && i.match(req));
    if (inj) {
      inj.times--;
      return inj.respond(req);
    }
    if (url.host === 'github.com') return this.oauth(req);
    if (req.auth !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });
    return this.api(req);
  };

  private oauth(req: Req): Response {
    if (req.url.pathname === '/login/device/code') {
      if (!req.body?.client_id) return json(404, { error: 'Not Found' });
      return json(200, { device_code: 'dev-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    }
    if (req.url.pathname === '/login/oauth/access_token') return json(200, this.tokenReplies.shift() ?? { error: 'authorization_pending' });
    return json(404, { message: 'Not Found' });
  }

  private async api(req: Req): Promise<Response> {
    const { method, url, body } = req;
    const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (p[0] === 'user' && p.length === 1) return json(200, { login: this.login }, { 'x-oauth-scopes': this.scopes });
    if (p[0] === 'user' && p[1] === 'repos') {
      if (method === 'POST') {
        const name = String(body?.name);
        if (this.repos.has(`${this.login}/${name}`)) return json(422, { message: 'name already exists on this account' });
        const r = this.addRepo(name, { private: body?.private !== false });
        return json(201, this.repoJson(r));
      }
      return json(200, [...this.repos.values()].map((r) => this.repoJson(r)));
    }
    if (p[0] !== 'repos' || p.length < 3) return json(404, { message: 'Not Found' });
    const repo = this.repos.get(`${p[1]}/${p[2]}`);
    if (!repo) return json(404, { message: 'Not Found' });
    const rest = p.slice(3);
    const empty = repo.branches.size === 0;

    if (rest.length === 0) return json(200, this.repoJson(repo));
    if (rest[0] === 'topics') {
      repo.topics = (body?.names as string[]) ?? [];
      return json(200, { names: repo.topics });
    }
    if (rest[0] === 'commits') return empty ? json(409, { message: 'Git Repository is empty.' }) : json(200, []);
    if (rest[0] === 'contents') return this.contents(repo, req, rest.slice(1).join('/'));
    if (rest[0] !== 'git') return json(404, { message: 'Not Found' });

    const [kind, ...tail] = rest.slice(1);
    if (kind === 'ref' && tail[0] === 'heads') {
      if (empty) return json(409, { message: 'Git Repository is empty.' });
      const sha = repo.branches.get(tail.slice(1).join('/'));
      return sha ? json(200, { object: { sha } }) : json(404, { message: 'Not Found' });
    }
    if (kind === 'refs' && tail[0] === 'heads' && method === 'PATCH') {
      const branch = tail.slice(1).join('/');
      if (this.beforeRefUpdate) {
        const hook = this.beforeRefUpdate;
        this.beforeRefUpdate = null;
        await hook(repo);
      }
      const current = repo.branches.get(branch);
      const next = String(body?.sha);
      if (current && !this.isAncestor(repo, current, next) && body?.force !== true) return json(422, { message: 'Update is not a fast forward' });
      repo.branches.set(branch, next);
      return json(200, { object: { sha: next } });
    }
    if (kind === 'commits') {
      if (method === 'POST') {
        const sha = this.newCommit(repo, { tree: String(body?.tree), parents: (body?.parents as string[]) ?? [], message: String(body?.message) });
        return json(201, { sha });
      }
      const c = repo.commits.get(tail[0] ?? '');
      return c ? json(200, { sha: tail[0], tree: { sha: c.tree } }) : json(404, { message: 'Not Found' });
    }
    if (kind === 'trees') {
      if (method === 'POST') {
        const base = new Map(repo.trees.get(String(body?.base_tree)) ?? []);
        for (const e of (body?.tree as { path: string; sha?: string; content?: string }[]) ?? []) {
          base.set(e.path, e.content !== undefined ? await this.putBlob(repo, utf8ToBase64(e.content)) : String(e.sha));
        }
        return json(201, { sha: this.storeTree(repo, base) });
      }
      const t = repo.trees.get(tail[0] ?? '');
      if (!t) return json(404, { message: 'Not Found' });
      return json(200, { sha: tail[0], truncated: false, tree: [...t].map(([path, sha]) => ({ path, type: 'blob', sha, mode: '100644' })) });
    }
    if (kind === 'blobs') {
      if (method === 'POST') return json(201, { sha: await this.putBlob(repo, String(body?.content)) });
      const b = repo.blobs.get(tail[0] ?? '');
      return b === undefined ? json(404, { message: 'Not Found' }) : json(200, { content: b, encoding: 'base64' });
    }
    return json(404, { message: 'Not Found' });
  }

  private async contents(repo: FakeRepo, req: Req, path: string): Promise<Response> {
    if (req.method === 'PUT') {
      const base64 = String(req.body?.content);
      const blob = await this.putBlob(repo, base64);
      const head = repo.branches.get(repo.defaultBranch);
      const tree = new Map(head ? repo.trees.get(repo.commits.get(head)!.tree) : []);
      tree.set(path, blob);
      const sha = this.newCommit(repo, { tree: this.storeTree(repo, tree), parents: head ? [head] : [], message: String(req.body?.message) });
      repo.branches.set(repo.defaultBranch, sha);
      return json(201, { commit: { sha } });
    }
    const t = this.headTree(repo);
    const sha = t?.get(path);
    if (sha) return json(200, { type: 'file', path, sha, content: repo.blobs.get(sha), encoding: 'base64' });
    const children = [...(t?.keys() ?? [])].filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
    return children.length ? json(200, children.map((k) => ({ type: 'file', path: k }))) : json(404, { message: 'Not Found' });
  }

  private repoJson(r: FakeRepo) {
    const size = r.branches.size ? 10 : 0;
    return { name: r.name, owner: { login: r.owner }, private: r.private, default_branch: r.defaultBranch, size, topics: r.topics, permissions: { push: r.push } };
  }
}
