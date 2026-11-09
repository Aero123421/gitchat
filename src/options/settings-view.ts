// Settings after onboarding: Account, Repository, Behavior, Appearance, Advanced, About.
// Controls update in place (no wholesale re-render) so focus never jumps while you work.

import { request } from '../shared/protocol';
import { t } from '../shared/i18n';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { SERVICES, type ServiceId, type Settings } from '../shared/types';
import { fmtAgo } from '../content/ui/core/format.js';
import { createConnect } from './connect';
import { h, icon, mount, spinner } from './kit/dom';
import { errorText } from './kit/errors';
import { glass } from './kit/glass';
import { createSwitch } from './kit/switch';
import { createAutoSwitches, createStylePicker, createThemePicker, row } from './prefs';
import type { WidgetPreview } from './preview';
import { createRepoChooser } from './repo';
import { app, on, patchSettings, refreshAuth, refreshSettings, refreshSync } from './state';

export const PROJECT_URL = 'https://github.com/Aero123421/gitchat';
const SERVICE_NAME: Record<ServiceId, string> = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' };
const SECTIONS = ['account', 'repository', 'behavior', 'appearance', 'advanced', 'about'] as const;
type SectionId = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<SectionId, string> = {
  account: 'secAccount',
  repository: 'secRepository',
  behavior: 'secBehavior',
  appearance: 'secAppearance',
  advanced: 'secAdvanced',
  about: 'secAbout',
};

export function createSettingsView(opts: { preview: WidgetPreview; onReset: () => void }): HTMLElement {
  const status = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  let toastTimer = 0;
  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    mount(status, h('div', { class: `note ${kind}` }, icon(kind === 'ok' ? 'check' : 'alert'), h('span', null, msg)));
    status.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => status.classList.remove('on'), kind === 'ok' ? 1600 : 5000);
  };
  const onError = (m: string) => flash(m, 'err');

  const nav = h(
    'nav',
    { class: 'sidenav', 'aria-label': t('settings') },
    SECTIONS.map((id) => h('a', { href: `#${id}`, 'data-sec': id }, t(SECTION_LABEL[id]))),
  );

  const section = (id: SectionId, ...children: (Node | null)[]) =>
    glass(h('section', { class: 'sec', id, 'aria-labelledby': `h-${id}` }, h('h2', { id: `h-${id}` }, t(SECTION_LABEL[id])), ...children), {
      radius: 18,
      scale: 18,
      bezel: 14,
    });

  // ---------------------------------------------------------------- account
  const accountBody = h('div', { class: 'rows' });
  const renderAccount = () => {
    const a = app.auth;
    if (!a) {
      mount(
        accountBody,
        h('div', { class: 'note' }, icon('alert'), h('span', null, t('notSignedIn'))),
        createConnect(async () => {
          await refreshAuth().catch(() => undefined);
          flash(t('signedInAs', app.auth?.login ?? ''));
        }),
      );
      return;
    }
    let confirming = false;
    let timer = 0;
    const out = h('button', { class: 'btn small', type: 'button' }, t('signOut'));
    out.addEventListener('click', async () => {
      if (!confirming) {
        confirming = true;
        out.classList.add('confirm');
        out.textContent = t('confirmSignOut');
        timer = window.setTimeout(() => {
          confirming = false;
          out.classList.remove('confirm');
          out.textContent = t('signOut');
        }, 3500);
        return;
      }
      clearTimeout(timer);
      out.setAttribute('disabled', '');
      try {
        await request('auth/signout', {});
        await refreshAuth();
      } catch (e) {
        onError(errorText(e));
        out.removeAttribute('disabled');
      }
    });
    mount(
      accountBody,
      row(
        `@${a.login}`,
        [a.method === 'pat' ? t('methodPat') : t('methodDevice'), a.scopes.length ? a.scopes.join(' ') : ''].filter(Boolean).join(' · '),
        out,
        undefined,
        icon('key'),
      ),
    );
  };
  on('auth', renderAccount);
  renderAccount();

  // ---------------------------------------------------------------- repository
  const repoBody = h('div', { class: 'rows' });
  let changing = false;
  const syncLine = h('span', { class: 'chip' });
  const renderSyncLine = () => {
    const y = app.sync;
    syncLine.className = 'chip';
    if (!y) {
      syncLine.replaceChildren(h('span', { class: 'd' }), '—');
      return;
    }
    if (y.lastError) {
      syncLine.classList.add('err');
      syncLine.replaceChildren(h('span', { class: 'd' }), t('syncError', y.lastError));
    } else if (y.pending) {
      syncLine.classList.add('accent');
      syncLine.replaceChildren(h('span', { class: 'd' }), t('pendingCommits', String(y.pending)));
    } else {
      syncLine.classList.add('ok');
      syncLine.replaceChildren(h('span', { class: 'd' }), y.lastPushAt ? t('lastPush', fmtAgo(y.lastPushAt)) : t('allPushed'));
    }
  };
  const renderRepo = () => {
    const r = app.settings.repo;
    if (!r || changing) {
      mount(
        repoBody,
        createRepoChooser(async (repo) => {
          await refreshSettings().catch(() => undefined);
          if (!app.settings.repo) await patchSettings({ repo }).catch(() => undefined);
          changing = false;
          renderRepo();
          void refreshSync();
          flash(t('saved'));
        }),
        r ? h('button', { class: 'btn ghost small', type: 'button', onClick: () => ((changing = false), renderRepo()) }, t('cancel')) : null,
      );
      return;
    }
    const url = `https://github.com/${r.owner}/${r.name}`;
    mount(
      repoBody,
      row(
        `${r.owner}/${r.name}`,
        null,
        h(
          'div',
          { class: 'row-actions' },
          h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, t('openOnGitHub')), icon('external')),
          h('button', { class: 'btn small ghost', type: 'button', onClick: () => ((changing = true), renderRepo()) }, t('change')),
        ),
        undefined,
        icon('repo'),
      ),
      row(t('branch'), null, h('span', { class: 'mono muted' }, r.branch)),
      row(t('syncState'), null, syncLine),
    );
    renderSyncLine();
  };
  on('sync', renderSyncLine);
  let lastRepoKey = JSON.stringify(app.settings.repo);
  on('settings', () => {
    const k = JSON.stringify(app.settings.repo);
    if (k !== lastRepoKey) {
      lastRepoKey = k;
      renderRepo();
    }
  });
  renderRepo();

  // ---------------------------------------------------------------- behavior
  const autos = createAutoSwitches(opts.preview, onError);
  const svcSwitches = SERVICES.map((id) => {
    const sw = createSwitch({
      label: SERVICE_NAME[id],
      checked: app.settings.services[id],
      onChange: async (v) => {
        sw.set(v);
        try {
          // only this service: another settings tab may have changed the others
          await patchSettings({ services: { [id]: v } as Partial<Settings['services']> as Settings['services'] });
        } catch (e) {
          sw.set(!v);
          onError(errorText(e));
        }
      },
    });
    return { id, sw };
  });
  const vizSw = createSwitch({
    label: t('saveVisualizations'),
    checked: app.settings.saveVisualizations,
    describedBy: 'gc-hint-saveVisualizations',
    onChange: async (v) => {
      vizSw.set(v);
      try {
        await patchSettings({ saveVisualizations: v });
      } catch (e) {
        vizSw.set(!v);
        onError(errorText(e));
      }
    },
  });
  on('settings', () => {
    for (const { id, sw } of svcSwitches) if (sw.get() !== app.settings.services[id]) sw.set(app.settings.services[id]);
    if (vizSw.get() !== app.settings.saveVisualizations) vizSw.set(app.settings.saveVisualizations);
  });

  // ---------------------------------------------------------------- advanced
  const cid = h('input', {
    class: 'field mono',
    id: 'gc-client-id',
    value: app.settings.githubClientId,
    placeholder: t('builtIn'),
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-describedby': 'gc-hint-cid',
  });
  const saveCid = async () => {
    const v = cid.value.trim();
    if (v === app.settings.githubClientId) return;
    try {
      await patchSettings({ githubClientId: v });
      flash(t('saved'));
    } catch (e) {
      onError(errorText(e));
    }
  };
  cid.addEventListener('change', () => void saveCid());
  cid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void saveCid();
  });
  let resetArmed = false;
  let resetTimer = 0;
  const resetBtn = h('button', { class: 'btn small danger', type: 'button' }, t('resetAll'));
  resetBtn.addEventListener('click', async () => {
    if (!resetArmed) {
      resetArmed = true;
      resetBtn.classList.add('confirm');
      resetBtn.textContent = t('confirmReset');
      resetTimer = window.setTimeout(() => {
        resetArmed = false;
        resetBtn.classList.remove('confirm');
        resetBtn.textContent = t('resetAll');
      }, 3500);
      return;
    }
    clearTimeout(resetTimer);
    resetBtn.setAttribute('disabled', '');
    resetBtn.replaceChildren(spinner(), h('span', null, t('resetAll')));
    try {
      await request('auth/signout', {}).catch(() => null);
      await patchSettings({ ...DEFAULT_SETTINGS });
      await refreshAuth().catch(() => undefined);
      opts.onReset();
    } catch (e) {
      onError(errorText(e));
      resetBtn.removeAttribute('disabled');
      resetBtn.textContent = t('resetAll');
    }
  });

  // ---------------------------------------------------------------- layout
  const appearance = section(
    'appearance',
    h('div', { class: 'rows' }, row(t('theme'), null, createThemePicker(onError))),
    createStylePicker(opts.preview, onError),
  );
  const behavior = section(
    'behavior',
    h(
      'div',
      { class: 'rows' },
      row(t('autoCommit'), t('autoCommitHint'), autos.commit.el, 'gc-hint-autocommit', icon('commit')),
      row(t('autoPush'), t('autoPushHint'), autos.push.el, 'gc-hint-autopush', icon('push')),
    ),
    h('h3', null, t('services')),
    h(
      'div',
      { class: 'rows' },
      svcSwitches.map(({ id, sw }) => row(SERVICE_NAME[id], null, sw.el)),
    ),
    h('h3', null, t('captureHeading')),
    h(
      'div',
      { class: 'rows' },
      row(t('saveVisualizations'), t('saveVisualizationsHint'), vizSw.el, 'gc-hint-saveVisualizations'),
    ),
  );
  const content = h(
    'div',
    { class: 'sections' },
    section('account', accountBody),
    section('repository', repoBody),
    behavior,
    appearance,
    section(
      'advanced',
      h(
        'div',
        { class: 'stack' },
        h('div', null, h('label', { class: 'lbl', for: 'gc-client-id' }, t('clientId')), cid, h('p', { class: 'hint', id: 'gc-hint-cid' }, t('clientIdHint'))),
        row(t('resetAll'), t('resetHint'), resetBtn),
      ),
    ),
    section(
      'about',
      h(
        'div',
        { class: 'rows' },
        row(t('version'), null, h('span', { class: 'mono muted' }, __GITCHAT_VERSION__)),
        row(t('project'), null, h('a', { class: 'mono', href: PROJECT_URL, target: '_blank', rel: 'noopener noreferrer' }, PROJECT_URL.replace('https://', ''))),
        row(t('license'), null, h('span', { class: 'mono muted' }, 'MIT')),
      ),
    ),
  );

  // Highlight the section in view; show the widget preview while Behavior or Appearance is visible.
  const visible = new Set<string>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      }
      const firstVisible = SECTIONS.find((id) => visible.has(id));
      for (const a of nav.querySelectorAll('a')) a.classList.toggle('on', a.dataset.sec === firstVisible);
      if (visible.has('appearance') || visible.has('behavior')) {
        opts.preview.show(app.settings.widget);
        opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
      } else opts.preview.hide();
    },
    { rootMargin: '-64px 0px -30% 0px' },
  );
  requestAnimationFrame(() => content.querySelectorAll('section.sec').forEach((s) => io.observe(s)));
  on('settings', () => {
    if (opts.preview.visible) {
      opts.preview.show(app.settings.widget);
      opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
    }
  });

  return h('div', { class: 'layout' }, nav, content, status);
}
