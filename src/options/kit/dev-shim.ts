// Development shim: lets popup.html and options.html render outside the extension (e.g. served from
// dist/ by a static server) so the UI can be reviewed in any browser. It does nothing inside the
// extension, where chrome.runtime.id exists.
//
// Query parameters:
//   ?demo=<scenario>   options: onboarding | signedin | settings      popup: setup | chat | untracked | new | other | pushing
//   ?lang=en|ja        ?theme=light|dark        ?nocid=1 (no OAuth client ID → token path)

import { applySettingsPatch, DEFAULT_SETTINGS } from '../../shared/settings';
import type { Envelope, Reply, RepoSummary } from '../../shared/protocol';
import type { AuthState, ChatStatus, CommitInfo, Settings } from '../../shared/types';

interface LocaleEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

export function isExtension(): boolean {
  const g = globalThis as unknown as { chrome?: { runtime?: { id?: string } } };
  return !!g.chrome?.runtime?.id;
}

function format(entry: LocaleEntry | undefined, subs: unknown): string {
  if (!entry) return '';
  const arr = subs == null ? [] : Array.isArray(subs) ? subs.map(String) : [String(subs)];
  let msg = entry.message;
  for (const [name, ph] of Object.entries(entry.placeholders ?? {})) {
    const val = ph.content.replace(/\$(\d)/g, (_m, d: string) => arr[Number(d) - 1] ?? '');
    msg = msg.replace(new RegExp(`\\$${name}\\$`, 'gi'), val);
  }
  return msg.replace(/\$(\d)/g, (_m, d: string) => arr[Number(d) - 1] ?? '');
}

const ago = (m: number) => Date.now() - m * 60_000;

function demoStatus(kind: string): ChatStatus {
  const commits: CommitInfo[] = [
    { id: 'c7', n: 4, t: ago(12), pushed: false },
    { id: 'c6', n: 2, t: ago(41), pushed: false },
    { id: 'c5', n: 6, t: ago(190), pushed: true },
    { id: 'c4', n: 3, t: ago(600), pushed: true },
    { id: 'c3', n: 8, t: ago(1500), pushed: true },
    { id: 'c2', n: 12, t: ago(3000), pushed: true },
  ];
  const tracked = kind !== 'untracked';
  return {
    key: 'claude:a1b2c3d4e5f6',
    service: 'claude',
    chatId: 'a1b2c3d4e5f6',
    tracked,
    path: tracked ? 'claude/2026-11-09-state-design--a1b2c3d4.md' : undefined,
    staged: tracked
      ? [
          { id: 's1', role: 'user', kind: 'text' },
          { id: 's2', role: 'assistant', kind: 'math' },
          { id: 's3', role: 'assistant', kind: 'viz' },
        ]
      : [],
    commits: tracked ? commits : [],
    aheadTotal: tracked ? 2 : 0,
    phase: kind === 'pushing' ? 'pushing' : 'idle',
    webUrl: tracked ? 'https://github.com/octocat/ai-chats/blob/main/claude/2026-11-09-state-design--a1b2c3d4.md' : undefined,
  };
}

export async function installDevShim(): Promise<boolean> {
  if (isExtension()) return false;
  const params = new URLSearchParams(location.search);
  const lang = params.get('lang') ?? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en');
  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  const messages: Record<string, LocaleEntry> = await fetch(`_locales/${lang}/messages.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  const scenario = params.get('demo') ?? '';
  const noClientId = params.get('nocid') === '1';

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let auth: AuthState | null = null;
  if (['signedin', 'settings', 'chat', 'untracked', 'new', 'other', 'pushing', ''].includes(scenario) && scenario !== 'onboarding') {
    auth = { token: 'demo', method: 'device', login: 'octocat', scopes: ['repo'], savedAt: Date.now() };
  }
  if (['settings', 'chat', 'untracked', 'new', 'other', 'pushing'].includes(scenario) || (scenario === '' && location.pathname.endsWith('popup.html'))) {
    settings = { ...settings, repo: { owner: 'octocat', name: 'ai-chats', branch: 'main' } };
  }
  if (scenario === 'setup') {
    auth = null;
    settings = { ...settings, repo: null };
  }
  let status = demoStatus(scenario || 'chat');
  const repos: RepoSummary[] = [
    { owner: 'octocat', name: 'ai-chats', private: true, defaultBranch: 'main', empty: true, managed: false },
    { owner: 'octocat', name: 'chat-history', private: true, defaultBranch: 'main', empty: false, managed: true },
    { owner: 'octocat', name: 'notes', private: true, defaultBranch: 'main', empty: false, managed: false },
    { owner: 'octocat', name: 'website', private: false, defaultBranch: 'main', empty: false, managed: false },
    { owner: 'octocat', name: 'dotfiles', private: false, defaultBranch: 'master', empty: false, managed: false },
    { owner: 'octo-org', name: 'research-log', private: true, defaultBranch: 'main', empty: true, managed: false },
  ];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fail = (error: string, code: string): Reply<never> => ({ ok: false, error, code });

  async function handle(env: Envelope): Promise<Reply<unknown>> {
    const p = env.payload as Record<string, unknown>;
    await sleep(120);
    switch (env.type) {
      case 'settings/get':
        return { ok: true, data: settings };
      case 'settings/set':
        settings = applySettingsPatch(settings, p.patch as Partial<Settings>);
        return { ok: true, data: settings };
      case 'auth/get':
        return { ok: true, data: auth && { login: auth.login, method: auth.method, scopes: auth.scopes } };
      case 'auth/device/start':
        if (noClientId) return fail('No OAuth client ID is configured', 'no-client-id');
        return { ok: true, data: { userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 } };
      case 'auth/device/wait':
        await sleep(3500);
        auth = { token: 'demo', method: 'device', login: 'octocat', scopes: ['repo'], savedAt: Date.now() };
        return { ok: true, data: { login: 'octocat' } };
      case 'auth/pat': {
        const token = String(p.token ?? '');
        if (token.length < 10) return fail('GitHub did not accept this token', 'bad-token');
        auth = { token, method: 'pat', login: 'octocat', scopes: [], savedAt: Date.now() };
        return { ok: true, data: { login: 'octocat' } };
      }
      case 'auth/signout':
        auth = null;
        return { ok: true, data: null };
      case 'repo/list':
        await sleep(600);
        return { ok: true, data: repos };
      case 'repo/create': {
        await sleep(700);
        const name = String(p.name);
        if (name === 'notes') return fail('A repository with this name already exists', 'repo-exists');
        settings = { ...settings, repo: { owner: 'octocat', name, branch: 'main' } };
        return { ok: true, data: settings.repo };
      }
      case 'repo/use':
        await sleep(500);
        settings = { ...settings, repo: { owner: String(p.owner), name: String(p.name), branch: String(p.branch ?? 'main') } };
        return { ok: true, data: settings.repo };
      case 'sync/status':
        return { ok: true, data: { repo: settings.repo, pending: status.aheadTotal, lastPushAt: ago(3) } };
      case 'chat/status':
        return { ok: true, data: status };
      case 'chat/commit':
        if (!status.staged.length) return fail('Nothing to commit', 'nothing');
        status = { ...status, commits: [{ id: `c${Date.now()}`, n: status.staged.length, t: Date.now(), pushed: false }, ...status.commits], staged: [], aheadTotal: status.aheadTotal + 1 };
        return { ok: true, data: status };
      case 'chat/push': {
        const staged = status.staged.length ? [{ id: `c${Date.now()}`, n: status.staged.length, t: Date.now(), pushed: false }] : [];
        status = { ...status, phase: 'pushing', staged: [], commits: [...staged, ...status.commits] };
        setTimeout(() => {
          status = { ...status, phase: 'idle', aheadTotal: 0, commits: status.commits.map((c) => ({ ...c, pushed: true })) };
        }, 1600);
        return { ok: true, data: status };
      }
      default:
        return fail(`Not available in the preview: ${env.type}`, 'preview');
    }
  }

  const noop = () => undefined;
  const fake = {
    runtime: {
      sendMessage: (env: Envelope) => handle(env),
      openOptionsPage: () => {
        location.href = 'options.html';
      },
      getURL: (p: string) => p,
      onMessage: { addListener: noop, removeListener: noop },
    },
    i18n: {
      getMessage: (key: string, subs?: unknown) => format(messages[key], subs),
      getUILanguage: () => lang,
    },
    tabs: {
      query: async () => [{ id: 1, active: true }],
      sendMessage: async (_id: number, msg: { type: string }) => {
        await sleep(60);
        if (scenario === 'other') throw new Error('Could not establish connection. Receiving end does not exist.');
        if (msg.type === 'content/init') {
          status = { ...status, phase: 'capturing', progress: 0.1 };
          return { ok: true };
        }
        if (scenario === 'new') return { service: 'chatgpt', chatId: null, title: '', status: null };
        return { service: status.service, chatId: status.chatId, title: 'State design for a mid-size React app', status };
      },
      create: ({ url }: { url: string }) => window.open(url, '_blank', 'noopener'),
    },
    storage: {
      onChanged: { addListener: noop, removeListener: noop },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
  console.info(`[gitchat] preview mode (no extension runtime): demo=${scenario || 'default'} lang=${lang}`);
  return true;
}
