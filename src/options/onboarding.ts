// First-run wizard: Welcome → Connect GitHub → Repository → Style → Done.
// The progress indicator is drawn like a tiny commit graph: done steps are filled, the current one
// is the accent ring, the rest are hollow.

import { t } from '../shared/i18n';
import { createConnect } from './connect';
import { h, icon, mount } from './kit/dom';
import { glass } from './kit/glass';
import { createMark } from './kit/mark';
import { SERVICE_LINKS } from './kit/util';
import { createAutoSwitches, createStylePicker, row } from './prefs';
import type { WidgetPreview } from './preview';
import { createRepoChooser } from './repo';
import { app, refreshAuth, refreshSettings, refreshSync, patchSettings } from './state';

const STEPS = ['welcome', 'connect', 'repo', 'prefs', 'done'] as const;
type Step = (typeof STEPS)[number];
const STEP_LABEL: Record<Step, string> = { welcome: 'stepWelcome', connect: 'stepConnect', repo: 'stepRepo', prefs: 'stepPrefs', done: 'stepDone' };

export function createOnboarding(opts: { preview: WidgetPreview; onFinish: () => void }): HTMLElement {
  const root = h('div', { class: 'wizard' });
  const steps = h('ol', { class: 'steps', 'aria-label': t('setupProgress') });
  const card = glass(h('section', { class: 'step-card' }), { radius: 22, scale: 26, bezel: 18 });
  // Step content lives in its own element so re-rendering never removes the glass layers.
  const content = h('div', { class: 'step-content', 'aria-live': 'polite' });
  card.append(content);
  root.append(steps, card);
  let step: Step = app.auth ? (app.settings.repo ? 'prefs' : 'repo') : 'welcome';
  let error = '';

  function go(next: Step): void {
    step = next;
    error = '';
    render();
    content.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }

  function renderSteps(): void {
    const cur = STEPS.indexOf(step);
    mount(
      steps,
      STEPS.map((s, i) =>
        h(
          'li',
          { class: i < cur ? 'done' : i === cur ? 'current' : '', 'aria-current': i === cur ? 'step' : null },
          h('span', { class: 'node', 'aria-hidden': 'true' }),
          h('span', { class: 'lb' }, t(STEP_LABEL[s])),
        ),
      ),
    );
  }

  const title = (key: string) => h('h1', { tabindex: -1 }, t(key));
  const lead = (key: string) => h('p', { class: 'lead' }, t(key));
  const errNote = () => (error ? h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, error)) : null);
  const nav = (back: Step | null, primary: HTMLElement | null) =>
    h(
      'div',
      { class: 'nav' },
      back ? h('button', { class: 'btn ghost', type: 'button', onClick: () => go(back) }, icon('back'), h('span', null, t('back'))) : h('span'),
      primary,
    );
  const next = (label: string, to: Step | (() => void)) =>
    h(
      'button',
      { class: 'btn solid', type: 'button', onClick: () => (typeof to === 'function' ? to() : go(to)) },
      h('span', null, label),
      icon('arrow'),
    );

  function render(): void {
    renderSteps();
    if (step === 'prefs' || step === 'done') opts.preview.show(app.settings.widget);
    else opts.preview.hide();
    const body = h('div', { class: 'step-body enter' });
    switch (step) {
      case 'welcome':
        body.append(
          h('div', { class: 'hero' }, createMark(64)),
          title('obWelcomeTitle'),
          lead('obWelcomeBody'),
          h('ul', { class: 'points' }, ...['obPoint1', 'obPoint2', 'obPoint3'].map((k) => h('li', null, icon('check'), h('span', null, t(k))))),
          nav(null, next(t('obStart'), app.auth ? 'repo' : 'connect')),
        );
        break;
      case 'connect':
        body.append(title('obConnectTitle'), lead('obConnectBody'));
        if (app.auth) {
          body.append(
            h('div', { class: 'note ok' }, icon('check'), h('span', null, t('signedInAs', app.auth.login))),
            nav('welcome', next(t('continue'), 'repo')),
          );
        } else {
          body.append(
            createConnect(async () => {
              await refreshAuth().catch(() => undefined);
              go(app.settings.repo ? 'prefs' : 'repo');
            }),
            nav('welcome', null),
          );
        }
        break;
      case 'repo':
        body.append(title('obRepoTitle'), lead('obRepoBody'));
        if (app.settings.repo) {
          const r = app.settings.repo;
          body.append(
            h('div', { class: 'note ok' }, icon('check'), h('span', { class: 'mono' }, `${r.owner}/${r.name}`)),
            nav('connect', next(t('continue'), 'prefs')),
          );
        } else {
          body.append(
            createRepoChooser(async (repo) => {
              await refreshSettings().catch(() => undefined);
              // Make sure the choice is persisted even if the worker did not save it itself.
              if (!app.settings.repo) await patchSettings({ repo }).catch(() => undefined);
              void refreshSync();
              go('prefs');
            }),
            nav('connect', null),
          );
        }
        break;
      case 'prefs': {
        const autos = createAutoSwitches(opts.preview, (m) => showError(m));
        opts.preview.syncAuto(app.settings.autoCommit, app.settings.autoPush);
        body.append(
          title('obPrefsTitle'),
          lead('obPrefsBody'),
          h('div', { class: 'lbl' }, t('widgetStyle')),
          createStylePicker(opts.preview, (m) => showError(m)),
          h(
            'div',
            { class: 'rows' },
            row(t('autoCommit'), t('autoCommitHint'), autos.commit.el, 'gc-hint-autocommit', icon('commit')),
            row(t('autoPush'), t('autoPushHint'), autos.push.el, 'gc-hint-autopush', icon('push')),
          ),
          ...(error ? [errNote()!] : []),
          nav('repo', next(t('continue'), 'done')),
        );
        break;
      }
      case 'done':
        body.append(
          h('div', { class: 'hero' }, createMark(56)),
          title('obDoneTitle'),
          lead('obDoneBody'),
          h(
            'div',
            { class: 'links' },
            SERVICE_LINKS.map((sv) =>
              h('a', { class: 'link', href: sv.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, t('openService', sv.name)), icon('external')),
            ),
          ),
          nav('prefs', next(t('goToSettings'), () => opts.onFinish())),
        );
        break;
    }
    mount(content, body);
  }

  function showError(msg: string): void {
    error = msg;
    const n = content.querySelector('.note.err');
    const el = h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, msg));
    if (n) n.replaceWith(el);
    else content.querySelector('.nav')?.before(el);
  }

  render();
  return root;
}
