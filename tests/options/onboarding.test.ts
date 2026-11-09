// @vitest-environment happy-dom
// A valid token aimed at the wrong repository used to trap first-run setup: Back only showed
// "Signed in", and the settings page (with Sign out) stays hidden until a repository is chosen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepoSummary } from '../../src/shared/protocol';
import type { WidgetPreview } from '../../src/options/preview';
import type { AuthInfo } from '../../src/options/state';

const REPO: RepoSummary = {
  owner: 'octocat',
  name: 'ai-chats',
  private: true,
  defaultBranch: 'main',
  empty: true,
  managed: false,
};

const preview = {
  show() {},
  hide() {},
  syncAuto() {},
  syncTheme() {},
  visible: false,
} as unknown as WidgetPreview;

type Reply = { ok: true; data: unknown } | { ok: false; error: string; code?: string };

async function boot(reply: (type: string) => Reply) {
  vi.resetModules();
  const calls: string[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      sendMessage: (env: { type: string }) => {
        calls.push(env.type);
        return Promise.resolve(reply(env.type));
      },
      reload() {},
    },
    i18n: { getMessage: (key: string) => key },
  };
  const state = await import('../../src/options/state');
  return { state, calls };
}

function ok(data: unknown = null): Reply {
  return { ok: true, data };
}

function fail(code: string): Reply {
  return { ok: false, error: code, code };
}

function click(root: ParentNode, text: string): HTMLButtonElement {
  const btn = [...root.querySelectorAll('button')].find((b) => !b.hidden && !b.closest('[hidden]') && b.textContent?.includes(text));
  if (!btn) throw new Error(`no visible button containing ${text}`);
  btn.click();
  return btn;
}

/** Primary actions. Tab labels such as "useExistingRepo" also contain "use". */
function clickSolid(root: ParentNode, text: string): void {
  const btn = [...root.querySelectorAll<HTMLButtonElement>('button.btn.solid')].find((b) => !b.hidden && b.textContent?.includes(text));
  if (!btn) throw new Error(`no solid button containing ${text}`);
  btn.click();
}

afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.resetModules();
});

describe('replacing a sign-in during setup', () => {
  async function wizard(auth: AuthInfo, reply: (type: string) => Reply) {
    const booted = await boot(reply);
    booted.state.app.auth = auth;
    booted.state.app.settings.widget = 'dot';
    booted.state.app.settings.githubClientId = 'cid';
    const { createOnboarding } = await import('../../src/options/onboarding');
    const root = createOnboarding({ preview, onFinish() {} });
    document.body.append(root);
    return { ...booted, root };
  }

  const pat: AuthInfo = { login: 'octocat', method: 'pat', scopes: [] };

  it('offers a different token on the connect step and returns to the token form', async () => {
    const { root, calls, state } = await wizard(pat, (type) => (type === 'repo/list' ? ok([]) : ok()));
    click(root, 'back');
    expect(root.textContent).toContain('signedInAs');
    expect(root.textContent).toContain('useDifferentToken');
    expect(root.textContent).toContain('back');
    expect(root.textContent).toContain('continue');
    expect(root.querySelector('#gc-token')).toBeNull();

    click(root, 'useDifferentToken');
    await vi.waitFor(() => expect(root.querySelector('#gc-token')).toBeTruthy());
    const signedOut = calls.indexOf('auth/signout');
    expect(signedOut).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('auth/get')).toBeGreaterThan(signedOut);
    expect(calls).not.toContain('settings/set');
    expect(state.app.auth).toBeNull();
    expect(state.app.settings.widget).toBe('dot');
    expect(state.app.settings.githubClientId).toBe('cid');
  });

  it('names the action for a device-flow sign-in and returns to account sign-in', async () => {
    const { root, calls } = await wizard({ login: 'octocat', method: 'device', scopes: ['repo'] }, (type) => (type === 'repo/list' ? ok([]) : ok()));
    click(root, 'back');
    expect(root.textContent).toContain('signInDifferentAccount');
    expect(root.textContent).not.toContain('useDifferentToken');
    click(root, 'signInDifferentAccount');
    await vi.waitFor(() => expect(root.textContent).toContain('signInWithGitHub'));
    expect(root.querySelector('#gc-token')).toBeNull();
    expect(calls).toContain('auth/signout');
  });

  it('shows an error and stays signed in when sign-out fails', async () => {
    const { root, calls, state } = await wizard(pat, (type) => (type === 'auth/signout' ? fail('network') : type === 'repo/list' ? ok([]) : ok()));
    click(root, 'back');
    click(root, 'useDifferentToken');
    await vi.waitFor(() => expect(root.textContent).toContain('errNetwork'));
    expect(root.textContent).toContain('signedInAs');
    expect(root.querySelector('#gc-token')).toBeNull();
    expect(calls).not.toContain('auth/get');
    expect(state.app.auth?.login).toBe('octocat');
    expect(state.app.settings.widget).toBe('dot');
  });

  it('offers a way back from the repository step and a stronger hint after a forbidden error', async () => {
    const { root, calls } = await wizard(pat, (type) => {
      if (type === 'repo/list') return ok([REPO]);
      if (type === 'repo/use') return fail('forbidden');
      return ok();
    });
    const wayBack = () => [...root.querySelectorAll('button')].find((b) => !b.hidden && b.textContent?.includes('wrongTokenUseDifferent'));
    expect(wayBack()).toBeTruthy();
    expect(root.textContent).not.toContain('tokenLacksAccess');

    await vi.waitFor(() => expect(root.querySelector('.repo')).toBeTruthy());
    (root.querySelector('.repo') as HTMLElement).click();
    clickSolid(root, 'use');
    await vi.waitFor(() => expect(root.querySelector('.token-hint')).toBeTruthy());
    expect(root.textContent).toContain('errNoPermission');
    expect(root.textContent).toContain('tokenLacksAccess');
    expect(wayBack()).toBeTruthy();

    wayBack()!.click();
    await vi.waitFor(() => expect(root.querySelector('#gc-token')).toBeTruthy());
    expect(calls).toContain('auth/signout');
  });

  it('explains an auth failure while listing repositories', async () => {
    const { root } = await wizard(pat, (type) => (type === 'repo/list' ? fail('auth') : ok()));
    await vi.waitFor(() => expect(root.querySelector('.token-hint')).toBeTruthy());
    expect(root.textContent).toContain('errAuth');
    expect(root.textContent).toContain('tokenLacksAccess');
    expect(root.textContent).toContain('wrongTokenUseDifferent');
  });

  it('does not treat other repository errors as a bad token', async () => {
    const { root } = await wizard(pat, (type) => (type === 'repo/list' ? fail('network') : ok()));
    await vi.waitFor(() => expect(root.textContent).toContain('errNetwork'));
    expect(root.textContent).not.toContain('tokenLacksAccess');
    expect(root.textContent).toContain('wrongTokenUseDifferent');
  });

  it('shows the stronger hint when creating a repository is forbidden', async () => {
    const { root } = await wizard({ login: 'octocat', method: 'device', scopes: ['repo'] }, (type) => {
      if (type === 'repo/create') return fail('forbidden');
      return ok();
    });
    clickSolid(root, 'create');
    await vi.waitFor(() => expect(root.querySelector('.token-hint')).toBeTruthy());
    expect(root.textContent).toContain('tokenLacksAccess');
  });

  it('does not show the wizard-only action on the settings repository chooser', async () => {
    const { state } = await boot((type) => {
      if (type === 'repo/list') return ok([REPO]);
      if (type === 'repo/use') return fail('forbidden');
      return ok();
    });
    state.app.auth = pat;
    const { createSettingsView } = await import('../../src/options/settings-view');
    const view = createSettingsView({ preview, onReset() {} });
    document.body.append(view);
    await vi.waitFor(() => expect(view.querySelector('.repo')).toBeTruthy());
    expect(view.textContent).not.toContain('wrongTokenUseDifferent');
    (view.querySelector('.repo') as HTMLElement).click();
    clickSolid(view, 'use');
    await vi.waitFor(() => expect(view.textContent).toContain('errNoPermission'));
    expect(view.textContent).not.toContain('tokenLacksAccess');
    expect(view.textContent).not.toContain('wrongTokenUseDifferent');
  });
});
