// Toolbar popup: the current chat's git status and quick actions, or a way into setup.

import { request, type ContentCurrent, type ResOf, type SyncStatus, type ToContent } from '../shared/protocol';
import { t } from '../shared/i18n';
import { chatKey, type ChatStatus, type ServiceId, type Settings } from '../shared/types';
import { h, icon, midTrunc, mount, spinner } from '../options/kit/dom';
import { installDevShim } from '../options/kit/dev-shim';
import { errorText } from '../options/kit/errors';
import { glass } from '../options/kit/glass';
import { graphCSS, renderGraph } from '../options/kit/graph';
import { createMark } from '../options/kit/mark';
import { injectKitStyles } from '../options/kit/styles';
import { copy, SERVICE_LINKS } from '../options/kit/util';
import { refreshPage } from './refresh';

const GRAPH_W = 284;
const SERVICE_NAME: Record<ServiceId, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };

async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

/** Ask the content script of the active tab which chat it shows. Null on non-chat pages. */
async function contentCurrent(tabId: number): Promise<ContentCurrent | null> {
  try {
    const msg: ToContent = { gitchat: 1, type: 'content/current' };
    const res = (await chrome.tabs.sendMessage(tabId, msg)) as ContentCurrent | undefined;
    return res && typeof res === 'object' && 'service' in res ? res : null;
  } catch {
    return null;
  }
}

function card(...children: (Node | null)[]): HTMLElement {
  return glass(h('section', { class: 'p-card' }, h('div', { class: 'p-inner' }, ...children)), { radius: 16, scale: 16, bezel: 12, blur: 12 });
}

function footer(settings: Settings, sync: SyncStatus | null): HTMLElement {
  const r = settings.repo;
  const pending = sync?.pending ?? 0;
  return h(
    'footer',
    { class: 'p-foot' },
    r
      ? h(
          'a',
          {
            class: `chip${sync?.lastError ? ' err' : pending ? ' accent' : ' ok'}`,
            href: `https://github.com/${r.owner}/${r.name}`,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: sync?.lastError ? t('syncError', sync.lastError) : pending ? t('pendingCommits', String(pending)) : t('allPushed'),
          },
          h('span', { class: 'd' }),
          h('span', { class: 'nm' }, `${r.owner}/${r.name}`),
          pending ? h('span', { class: 'n' }, `↑${pending}`) : null,
        )
      : h('span'),
    h('span', { class: 'sp' }),
    h(
      'button',
      {
        class: 'ib',
        type: 'button',
        title: t('openSettings'),
        'aria-label': t('openSettings'),
        onClick: () => {
          void chrome.runtime.openOptionsPage();
          window.close();
        },
      },
      icon('gear'),
    ),
  );
}

function setupView(signedIn: boolean): HTMLElement {
  return card(
    h(
      'div',
      { class: 'setup' },
      createMark(56),
      h('h1', null, 'gitchat'),
      h('p', { class: 'muted' }, t('popSetupLead')),
      h(
        'button',
        {
          class: 'btn solid',
          type: 'button',
          onClick: () => {
            void chrome.runtime.openOptionsPage();
            window.close();
          },
        },
        h('span', null, signedIn ? t('popFinishSetup') : t('setUp')),
        icon('arrow'),
      ),
    ),
  );
}

function linksView(service: ServiceId | null): HTMLElement {
  return card(
    h('p', { class: 'p-lead' }, service ? t('popNewChat') : t('popOpenChat')),
    h(
      'div',
      { class: 'p-links' },
      SERVICE_LINKS.map((sv) =>
        h(
          'a',
          { class: 'p-link', href: sv.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', null, sv.name),
          icon('external'),
        ),
      ),
    ),
  );
}

function chatView(tabId: number, cur: ContentCurrent & { chatId: string }, settings: Settings, initial: ChatStatus): { el: HTMLElement; stop: () => void } {
  const key = chatKey(cur.service, cur.chatId);
  let status = initial;
  let busy: 'commit' | 'push' | 'track' | null = null;
  let error = '';
  const graphBox = h('div', { class: 'p-graph' });
  const line = h('div', { class: 'p-line' });
  const actions = h('div', { class: 'p-actions' });
  const note = h('div', { class: 'p-note' });

  const run = async (kind: 'commit' | 'push', fn: () => Promise<ChatStatus | null>) => {
    busy = kind;
    error = '';
    render();
    try {
      // stage what the page shows now; unless the tab confirms it did, committing could save stale data
      const read = await refreshPage(tabId);
      if (!read.ok) {
        error = read.error || t('errRefresh');
        return;
      }
      const next = await fn();
      if (next) status = next;
    } catch (e) {
      error = errorText(e);
    } finally {
      busy = null;
      render();
    }
  };

  function render(): void {
    const s = status;
    // graph
    if (s.tracked && (s.commits.length || s.staged.length)) mount(graphBox, renderGraph(s, GRAPH_W));
    else mount(graphBox);
    // status line
    if (s.phase === 'capturing') {
      const p = Math.round((s.progress ?? 0) * 100);
      mount(
        line,
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: `width:${Math.max(4, p)}%` })),
        h('span', { class: 'mono muted' }, `${p}%`),
      );
    } else if (s.phase === 'pushing') {
      mount(line, spinner(), h('span', { class: 'muted' }, t('popPushing')));
    } else if (s.tracked && s.path) {
      mount(line, h('span', { class: 'mono path', title: s.path }, midTrunc(s.path, 40)));
    } else if (!s.tracked) {
      mount(line, h('span', { class: 'muted' }, t('popUntracked')));
    } else mount(line);

    // actions
    const items: (HTMLElement | null)[] = [];
    if (!s.tracked) {
      items.push(
        h(
          'button',
          {
            class: 'btn solid small',
            type: 'button',
            disabled: s.phase === 'capturing' || busy === 'track',
            onClick: async () => {
              busy = 'track';
              render();
              try {
                const msg: ToContent = { gitchat: 1, type: 'content/init' };
                await chrome.tabs.sendMessage(tabId, msg);
              } catch (e) {
                error = errorText(e);
              }
              busy = null;
              await refresh();
            },
          },
          s.phase === 'capturing' || busy === 'track' ? spinner() : icon('init'),
          h('span', null, t('track')),
        ),
      );
    } else {
      const staged = s.staged.length;
      const ahead = s.aheadTotal;
      if (!settings.autoCommit)
        items.push(
          h(
            'button',
            {
              class: `ib count${staged ? '' : ' dim'}`,
              type: 'button',
              title: t('commit'),
              'aria-label': `${t('commit')}${staged ? ` (${staged})` : ''}`,
              disabled: busy !== null || s.phase === 'capturing' || s.phase === 'pushing',
              onClick: () => void run('commit', () => request('chat/commit', { key })),
            },
            busy === 'commit' ? spinner() : icon('commit'),
            staged ? h('span', { class: 'n' }, String(staged)) : null,
          ),
        );
      if (!settings.autoPush) {
        const sending = s.phase === 'pushing' || busy === 'push';
        items.push(
          h(
            'button',
            {
              class: `ib count${ahead || staged || s.phase === 'error' ? '' : ' dim'}${s.phase === 'error' ? ' err' : ''}`,
              type: 'button',
              title: t('push'),
              'aria-label': `${t('push')}${ahead ? ` (${ahead})` : ''}`,
              disabled: busy !== null || sending,
              onClick: () => void run('push', () => request('chat/push', { key })),
            },
            sending ? spinner() : icon('push'),
            ahead ? h('span', { class: 'n accent' }, String(ahead)) : null,
          ),
        );
      }
      if (settings.autoCommit || settings.autoPush)
        items.push(h('span', { class: 'auto' }, [settings.autoCommit ? t('autoCommit') : '', settings.autoPush ? t('autoPush') : ''].filter(Boolean).join(' · ')));
    }
    items.push(h('span', { class: 'sp' }));
    // read the whole chat again (e.g. after switching to another branch of an edited conversation)
    if (s.tracked && s.phase !== 'capturing')
      items.push(
        h(
          'button',
          {
            class: 'ib',
            type: 'button',
            title: t('rescan'),
            'aria-label': t('rescan'),
            disabled: busy !== null || s.phase === 'pushing',
            onClick: async () => {
              busy = 'track';
              error = '';
              render();
              try {
                const msg: ToContent = { gitchat: 1, type: 'content/rescan' };
                await chrome.tabs.sendMessage(tabId, msg);
              } catch (e) {
                error = errorText(e);
              }
              busy = null;
              await refresh();
            },
          },
          icon('refresh'),
        ),
      );
    if (s.webUrl) {
      const linkBtn: HTMLButtonElement = h(
        'button',
        {
          class: 'ib',
          type: 'button',
          title: t('copyLink'),
          'aria-label': t('copyLink'),
          onClick: async () => {
            await copy(s.webUrl ?? '');
            linkBtn.classList.add('done');
            linkBtn.replaceChildren(icon('check'));
            setTimeout(() => {
              linkBtn.classList.remove('done');
              linkBtn.replaceChildren(icon('link'));
            }, 1300);
          },
        },
        icon('link'),
      );
      items.push(linkBtn, h('a', { class: 'ib', href: s.webUrl, target: '_blank', rel: 'noopener noreferrer', title: t('openOnGitHub'), 'aria-label': t('openOnGitHub') }, icon('external')));
    }
    mount(actions, items);

    const err = error || (s.phase === 'error' ? s.error ?? t('errGeneric') : '');
    mount(note, err ? h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, err)) : null);
  }

  async function refresh(): Promise<void> {
    try {
      const next = await request('chat/status', { key });
      if (JSON.stringify(next) !== JSON.stringify(status)) {
        status = next;
        render();
      }
    } catch {
      // keep showing the last status
    }
  }

  const el = card(
    h(
      'header',
      { class: 'p-head' },
      h('span', { class: 'p-svc mono' }, SERVICE_NAME[cur.service]),
      h('h1', { class: 'p-title', title: cur.title }, cur.title || t('untitledChat')),
    ),
    line,
    graphBox,
    actions,
    note,
  );
  render();
  const timer = window.setInterval(() => void refresh(), 1000);
  return { el, stop: () => clearInterval(timer) };
}

async function main(): Promise<void> {
  await installDevShim();
  injectKitStyles();
  const style = document.createElement('style');
  style.textContent = graphCSS;
  document.head.append(style);
  document.documentElement.lang = chrome.i18n?.getUILanguage?.() ?? 'en';
  const root = document.getElementById('app')!;
  mount(root, h('div', { class: 'p-loading' }, spinner()));

  let settings: Settings;
  let auth: ResOf<'auth/get'>;
  try {
    [settings, auth] = await Promise.all([request('settings/get', {}), request('auth/get', {})]);
  } catch (e) {
    mount(root, card(h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, errorText(e)))));
    return;
  }
  if (!auth || !settings.repo) {
    mount(root, setupView(!!auth));
    return;
  }

  const tabId = await activeTabId();
  const [cur, sync] = await Promise.all([tabId !== null ? contentCurrent(tabId) : Promise.resolve(null), request('sync/status', {}).catch(() => null)]);

  if (tabId !== null && cur?.chatId) {
    const withId = cur as ContentCurrent & { chatId: string };
    let status = cur.status;
    if (!status) status = await request('chat/status', { key: chatKey(cur.service, cur.chatId) }).catch(() => null);
    if (status) {
      const view = chatView(tabId, withId, settings, status);
      mount(root, view.el, footer(settings, sync));
      addEventListener('unload', view.stop);
      return;
    }
  }
  mount(root, linksView(cur?.service ?? null), footer(settings, sync));
}

void main();
