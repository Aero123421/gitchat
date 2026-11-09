// Connect GitHub: "Sign in with GitHub" (OAuth device flow) or a fine-grained personal access token.
// If the build has no OAuth client ID, the token path becomes the primary one.

import { request, type DeviceCode } from '../shared/protocol';
import { t } from '../shared/i18n';
import { h, icon, mount, spinner } from './kit/dom';
import { errorCode, errorText } from './kit/errors';
import { copy } from './kit/util';

export const PAT_URL =
  'https://github.com/settings/personal-access-tokens/new?name=gitchat&description=gitchat%20chat%20history&contents=write&metadata=read';

/** GitHub's "new repository" form, pre-filled. A token limited to one repository can't create it itself. */
export const NEW_REPO_URL =
  'https://github.com/new?name=ai-chats&visibility=private&description=AI%20chat%20archive%20managed%20by%20gitchat';

type View = 'choose' | 'code' | 'token';

export function createConnect(onDone: (login: string) => void): HTMLElement {
  const root = h('div', { class: 'connect' });
  let view: View = 'choose';
  let deviceUnavailable = false;
  let code: DeviceCode | null = null;
  let deadline = 0;
  let gen = 0;
  let busy = false;
  let error = '';
  let countdown = 0;

  const note = () => (error ? h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, error)) : null);

  function render(): void {
    clearInterval(countdown);
    if (view === 'code' && code) mount(root, renderCode(code));
    else if (view === 'token' || deviceUnavailable) mount(root, renderToken());
    else mount(root, renderChoose());
  }

  function renderChoose(): HTMLElement {
    return h(
      'div',
      { class: 'stack enter' },
      h(
        'button',
        { class: 'btn solid wide', type: 'button', disabled: busy, onClick: startDevice },
        busy ? spinner() : icon('key'),
        h('span', null, t('signInWithGitHub')),
      ),
      h('button', { class: 'btn ghost wide', type: 'button', onClick: () => go('token') }, t('useTokenInstead')),
      note(),
    );
  }

  function renderCode(dc: DeviceCode): HTMLElement {
    const timeEl = h('span', { class: 'mono' }, fmtTime(deadline - Date.now()));
    countdown = window.setInterval(() => {
      const left = deadline - Date.now();
      timeEl.textContent = fmtTime(left);
      if (left <= 0) clearInterval(countdown);
    }, 1000);
    const copyBtn = h(
      'button',
      {
        class: 'btn small',
        type: 'button',
        onClick: async () => {
          await copy(dc.userCode);
          copyBtn.replaceChildren(icon('check'), h('span', null, t('copied')));
          setTimeout(() => copyBtn.replaceChildren(icon('copy'), h('span', null, t('copy'))), 1300);
        },
      },
      icon('copy'),
      h('span', null, t('copy')),
    );
    const cells = [...dc.userCode].map((ch) => (ch === '-' ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '–') : h('span', { class: 'c' }, ch)));
    return h(
      'div',
      { class: 'stack enter' },
      h('p', { class: 'muted center' }, t('deviceCodeLead')),
      h('div', { class: 'code', role: 'group', 'aria-label': dc.userCode }, cells),
      h(
        'div',
        { class: 'row-actions center' },
        copyBtn,
        h(
          'a',
          { class: 'btn small solid', href: dc.verificationUri, target: '_blank', rel: 'noopener noreferrer' },
          h('span', null, t('openGitHub')),
          icon('external'),
        ),
      ),
      h(
        'div',
        { class: 'waiting', role: 'status', 'aria-live': 'polite' },
        spinner(),
        h('span', null, t('waitingForApproval')),
        h('span', { class: 'muted' }, ' · ', t('codeExpires')),
        timeEl,
      ),
      h('button', { class: 'btn ghost small mid', type: 'button', onClick: () => cancel() }, t('cancel')),
      note(),
    );
  }

  function renderToken(): HTMLElement {
    const input = h('input', {
      class: 'field mono',
      type: 'password',
      id: 'gc-token',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'github_pat_…',
      'aria-describedby': 'gc-token-help',
    });
    const submit = async () => {
      const token = input.value.trim();
      if (!token) {
        input.focus();
        return;
      }
      busy = true;
      error = '';
      connectBtn.setAttribute('disabled', '');
      connectBtn.replaceChildren(spinner(), h('span', null, t('connect')));
      try {
        const r = await request('auth/pat', { token });
        onDone(r.login);
      } catch (e) {
        // a sign-out or another sign-in replaced this one meanwhile: nothing to report
        if (errorCode(e) === 'cancelled') {
          busy = false;
          render();
          return;
        }
        error = errorText(e);
        busy = false;
        render();
      }
    };
    const connectBtn = h('button', { class: 'btn solid', type: 'button', onClick: submit }, h('span', null, t('connect')));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    queueMicrotask(() => input.focus());
    const link = (href: string, label: string) =>
      h('a', { class: 'btn small', href, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, label), icon('external'));
    // The repository comes first: a token limited to one repository can only be pointed at one that exists.
    return h(
      'div',
      { class: 'stack enter' },
      h('div', { class: 'token-head' }, icon('key'), h('strong', null, t('tokenTitle'))),
      h(
        'ol',
        { class: 'howto' },
        h('li', null, h('p', null, t('tokenStepRepo')), link(NEW_REPO_URL, t('createRepoOnGitHub'))),
        h('li', null, h('p', null, t('tokenStepToken')), link(PAT_URL, t('createToken'))),
        h(
          'li',
          null,
          h('p', { class: 'muted', id: 'gc-token-help' }, t('tokenStepPaste')),
          h('div', null, h('label', { class: 'lbl', for: 'gc-token' }, t('pasteToken')), h('div', { class: 'inline' }, input, connectBtn)),
        ),
      ),
      deviceUnavailable ? null : h('button', { class: 'btn ghost small', type: 'button', onClick: () => go('choose') }, t('signInWithGitHub')),
      note(),
    );
  }

  function go(v: View): void {
    gen++;
    view = v;
    error = '';
    busy = false;
    render();
  }

  function cancel(): void {
    // stop the background polling too, so a late approval of this code can't sign in
    void request('auth/device/cancel', {}).catch(() => undefined);
    go('choose');
  }

  async function startDevice(): Promise<void> {
    const my = ++gen;
    busy = true;
    error = '';
    render();
    try {
      const dc = await request('auth/device/start', {});
      if (my !== gen) return;
      code = dc;
      deadline = Date.now() + dc.expiresIn * 1000;
      busy = false;
      view = 'code';
      render();
      void waitForApproval(my);
    } catch (e) {
      if (my !== gen) return;
      busy = false;
      // no OAuth app configured, or device flow not enabled on it: offer the token path instead
      if (errorCode(e) === 'no-client-id' || errorCode(e) === 'device-flow-disabled') {
        deviceUnavailable = true;
        view = 'token';
      } else {
        error = errorText(e);
      }
      render();
    }
  }

  async function waitForApproval(my: number): Promise<void> {
    while (my === gen && Date.now() < deadline) {
      try {
        const r = await request('auth/device/wait', {});
        if (my !== gen) return;
        onDone(r.login);
        return;
      } catch (e) {
        if (my !== gen) return;
        // The worker may have been restarted while we waited; ask again until the code expires.
        if (errorCode(e) === 'no-reply') {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        error = errorText(e);
        view = 'choose';
        render();
        return;
      }
    }
    if (my === gen) {
      error = t('codeExpired');
      view = 'choose';
      render();
    }
  }

  render();
  return root;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
