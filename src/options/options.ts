// Settings page entry: onboarding until a repository is configured, then the settings view.

import { t } from '../shared/i18n';
import { h, icon, mount } from './kit/dom';
import { installDevShim } from './kit/dev-shim';
import { errorText } from './kit/errors';
import { createMark } from './kit/mark';
import { injectKitStyles } from './kit/styles';
import { applyPageTheme } from './kit/theme';
import { createOnboarding } from './onboarding';
import { WidgetPreview } from './preview';
import { createSettingsView } from './settings-view';
import { app, loadAll, on, refreshSync } from './state';

async function main(): Promise<void> {
  await installDevShim();
  injectKitStyles();
  document.documentElement.lang = chrome.i18n?.getUILanguage?.() ?? 'en';
  document.title = `gitchat — ${t('settings')}`;

  const chip = h('a', { class: 'chip sync-chip', target: '_blank', rel: 'noopener noreferrer' });
  const top = h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, createMark(24, false), h('span', null, 'gitchat')),
    h('span', { class: 'sp' }),
    chip,
  );
  const main = h('main', { id: 'main' });
  const banner = h('div', { class: 'banner' });
  document.body.append(top, banner, main);

  const errors = await loadAll();
  if (errors.length) mount(banner, h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, errorText(errors[0]))));

  const renderChip = () => {
    const r = app.settings.repo;
    const y = app.sync;
    chip.hidden = !r;
    if (!r) return;
    chip.href = `https://github.com/${r.owner}/${r.name}`;
    chip.className = `chip sync-chip${y?.lastError ? ' err' : y?.pending ? ' accent' : ' ok'}`;
    chip.replaceChildren(
      h('span', { class: 'd' }),
      `${r.owner}/${r.name}`,
      ...(y?.pending ? [h('span', { class: 'n' }, `↑${y.pending}`)] : []),
    );
    chip.title = y?.lastError ? t('syncError', y.lastError) : y?.pending ? t('pendingCommits', String(y.pending)) : t('allPushed');
  };
  on('settings', renderChip);
  on('sync', renderChip);
  renderChip();
  window.setInterval(() => {
    if (!document.hidden && app.settings.repo) void refreshSync();
  }, 15_000);

  const preview = new WidgetPreview();
  // Live: patchSettings and a change from another device both emit 'settings'.
  const paintTheme = () => {
    applyPageTheme(app.settings.theme);
    preview.syncTheme();
  };
  on('settings', paintTheme);
  paintTheme();
  const forceOnboarding = location.hash === '#onboarding';
  const showSettings = () => {
    preview.hide();
    document.body.dataset.view = 'settings';
    mount(main, createSettingsView({ preview, onReset: showOnboarding }));
    const target = location.hash.slice(1);
    if (target && target !== 'onboarding') document.getElementById(target)?.scrollIntoView();
  };
  function showOnboarding(): void {
    preview.hide();
    document.body.dataset.view = 'onboarding';
    mount(
      main,
      createOnboarding({
        preview,
        onFinish: () => {
          history.replaceState(null, '', location.pathname + location.search);
          showSettings();
          scrollTo({ top: 0 });
        },
      }),
    );
  }
  // Onboarding until a repository is configured; a signed-out user with a repo gets the settings
  // view, whose Account section offers to sign in again.
  if (!app.settings.repo || forceOnboarding) showOnboarding();
  else showSettings();
}

void main();
