// Choose where chats are saved: create a new private repository, or pick an existing one.

import { request, type RepoSummary } from '../shared/protocol';
import { t } from '../shared/i18n';
import type { RepoRef } from '../shared/types';
import { h, icon, mount, spinner } from './kit/dom';
import { errorText } from './kit/errors';
import { createSwitch } from './kit/switch';
import { NEW_REPO_URL } from './connect';
import { app } from './state';

type Mode = 'create' | 'existing';
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const FULL_NAME_RE = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;

export function createRepoChooser(onDone: (repo: RepoRef) => void): HTMLElement {
  const root = h('div', { class: 'repo-chooser' });
  // A personal access token is usually limited to one repository that already exists, and such a
  // token can't create repositories: start on the list instead.
  const limitedToken = app.auth?.method === 'pat';
  let mode: Mode = limitedToken ? 'existing' : 'create';
  let name = 'ai-chats';
  let priv = true;
  let busy = false;
  let error = '';
  let repos: RepoSummary[] | null = null;
  let loading = false;
  let listError = '';
  let filter = '';
  let selected: RepoSummary | null = null;
  const body = h('div', { class: 'stack' });

  const seg = h(
    'div',
    { class: 'seg', role: 'tablist', 'aria-label': t('obRepoTitle') },
    segBtn('create', t('createPrivateRepo')),
    segBtn('existing', t('useExistingRepo')),
  );

  function segBtn(m: Mode, label: string): HTMLButtonElement {
    return h(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': String(mode === m),
        'data-mode': m,
        onClick: () => {
          mode = m;
          error = '';
          for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
          render();
          if (m === 'existing' && !repos && !loading) void loadRepos();
        },
      },
      label,
    );
  }

  const note = (msg: string) => (msg ? h('div', { class: 'note err', role: 'alert' }, icon('alert'), h('span', null, msg)) : null);
  const githubLink = () =>
    h('a', { class: 'btn small', href: NEW_REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, h('span', null, t('createRepoOnGitHub')), icon('external'));

  function render(): void {
    mount(body, mode === 'create' ? renderCreate() : renderExisting());
  }

  function renderCreate(): HTMLElement {
    const input = h('input', {
      class: 'field mono',
      id: 'gc-repo-name',
      value: name,
      spellcheck: 'false',
      autocomplete: 'off',
      maxlength: 100,
    });
    const valid = () => NAME_RE.test(name) && name !== '.' && name !== '..';
    const createBtn = h(
      'button',
      { class: 'btn solid', type: 'button', disabled: busy || !valid() },
      busy ? spinner() : icon('plus'),
      h('span', null, t('create')),
    );
    input.addEventListener('input', () => {
      name = input.value.trim();
      if (valid()) createBtn.removeAttribute('disabled');
      else createBtn.setAttribute('disabled', '');
    });
    const submit = async () => {
      if (!valid() || busy) return;
      busy = true;
      error = '';
      render();
      try {
        const repo = await request('repo/create', { name, private: priv });
        onDone(repo);
      } catch (e) {
        error = errorText(e);
        busy = false;
        render();
      }
    };
    createBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    const privSwitch = createSwitch({
      label: t('repoPrivateLabel'),
      checked: priv,
      onChange: (v) => {
        priv = v;
        privSwitch.set(v);
        render();
      },
    });
    return h(
      'div',
      { class: 'stack fade' },
      limitedToken ? h('div', { class: 'note' }, icon('alert'), h('span', null, t('repoPatNote'))) : null,
      limitedToken ? githubLink() : null,
      h('div', null, h('label', { class: 'lbl', for: 'gc-repo-name' }, t('repoName')), h('div', { class: 'inline' }, input, createBtn)),
      h('div', { class: 'row tight' }, h('div', { class: 'text' }, h('div', { class: 'title' }, icon('lock'), t('repoPrivateLabel'))), privSwitch.el),
      priv ? null : h('div', { class: 'note err' }, icon('alert'), h('span', null, t('repoPublicWarn'))),
      note(error),
    );
  }

  function renderExisting(): HTMLElement {
    if (loading) return h('div', { class: 'loading', role: 'status' }, spinner(), h('span', null, t('loadingRepos')));
    if (listError || !repos)
      return h(
        'div',
        { class: 'stack' },
        note(listError || t('errGeneric')),
        h('button', { class: 'btn small', type: 'button', onClick: () => void loadRepos() }, icon('refresh'), h('span', null, t('retry'))),
      );
    const search = h('input', {
      class: 'field',
      type: 'search',
      placeholder: t('filterRepos'),
      'aria-label': t('filterRepos'),
      value: filter,
    });
    const list = h('div', { class: 'repos', role: 'listbox', 'aria-label': t('useExistingRepo'), tabindex: 0 });
    const detail = h('div', { class: 'stack' });
    const shown = () => repos!.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(filter.toLowerCase()));

    const typed = h('div', { class: 'stack' });
    // A repository that isn't listed (the list is capped, or the token can't list it) can be typed.
    const fillTyped = () => {
      const m = FULL_NAME_RE.exec(filter.trim());
      const listed = m && repos!.some((r) => `${r.owner}/${r.name}`.toLowerCase() === filter.trim().toLowerCase());
      if (!m || listed) {
        mount(typed);
        return;
      }
      const [, owner, name] = m as unknown as [string, string, string];
      // Look it up first, so a typed repository gets the same checks (public, not empty) as a listed one.
      const btn = h(
        'button',
        {
          class: 'btn small',
          type: 'button',
          disabled: busy,
          onClick: async () => {
            busy = true;
            error = '';
            btn.setAttribute('disabled', '');
            btn.replaceChildren(spinner(), h('span', null, t('lookUpTyped', `${owner}/${name}`)));
            try {
              const info = await request('repo/info', { owner, name });
              busy = false;
              const id = `${info.owner}/${info.name}`.toLowerCase();
              const known = repos!.find((r) => `${r.owner}/${r.name}`.toLowerCase() === id);
              if (!known) repos!.unshift(info);
              filter = `${info.owner}/${info.name}`;
              search.value = filter;
              select(known ?? info);
            } catch (e) {
              error = errorText(e);
              busy = false;
              fillTyped();
            }
          },
        },
        h('span', null, t('lookUpTyped', `${owner}/${name}`)),
      );
      mount(typed, h('div', null, btn), selected ? null : note(error));
    };

    const fill = () => {
      fillTyped();
      const items = shown();
      if (!items.length) {
        mount(list, h('div', { class: 'empty muted' }, t('noRepos')));
        return;
      }
      mount(
        list,
        items.map((r) =>
          h(
            'div',
            {
              class: 'repo',
              role: 'option',
              'aria-selected': String(selected === r),
              onClick: () => select(r),
            },
            h('span', { class: 'nm' }, `${r.owner}/${r.name}`),
            r.managed ? h('span', { class: 'tag accent' }, 'gitchat') : null,
            r.empty ? h('span', { class: 'tag' }, t('repoEmpty')) : null,
            r.private ? h('span', { class: 'tag', title: t('repoPrivate') }, icon('lock')) : h('span', { class: 'tag warn' }, t('repoPublic')),
          ),
        ),
      );
    };

    const select = (r: RepoSummary) => {
      selected = r;
      fill();
      renderDetail();
    };

    const renderDetail = () => {
      if (!selected) {
        mount(detail);
        return;
      }
      const r = selected;
      const warn: string[] = [];
      if (!r.private) warn.push(t('repoPublicWarn'));
      if (!r.empty && !r.managed) warn.push(t('repoNotEmptyWarn'));
      const useBtn = h(
        'button',
        {
          class: 'btn solid',
          type: 'button',
          disabled: busy,
          onClick: async () => {
            busy = true;
            error = '';
            useBtn.setAttribute('disabled', '');
            useBtn.replaceChildren(spinner(), h('span', null, t('use')));
            try {
              const repo = await request('repo/use', { owner: r.owner, name: r.name, branch: r.defaultBranch });
              onDone(repo);
            } catch (e) {
              error = errorText(e);
              busy = false;
              renderDetail();
            }
          },
        },
        h('span', null, t('use')),
        h('span', { class: 'mono' }, `${r.owner}/${r.name}`),
      );
      mount(
        detail,
        warn.map((w) => h('div', { class: 'note' }, icon('alert'), h('span', null, w))),
        h('div', null, useBtn),
        note(error),
      );
    };

    search.addEventListener('input', () => {
      filter = search.value;
      fill();
    });
    list.addEventListener('keydown', (e) => {
      const items = shown();
      if (!items.length) return;
      const i = selected ? items.indexOf(selected) : -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) select(next);
        list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
      }
    });
    fill();
    renderDetail();
    return h(
      'div',
      { class: 'stack fade' },
      search,
      typed,
      list,
      detail,
      h('p', { class: 'muted hint' }, t('repoMissingHint')),
      limitedToken ? githubLink() : null,
    );
  }

  async function loadRepos(): Promise<void> {
    loading = true;
    listError = '';
    render();
    try {
      repos = await request('repo/list', {});
      // Empty and gitchat-managed repositories first: those are the good choices.
      repos.sort((a, b) => Number(b.managed) - Number(a.managed) || Number(b.empty) - Number(a.empty) || a.name.localeCompare(b.name));
    } catch (e) {
      listError = errorText(e);
    } finally {
      loading = false;
      if (mode === 'existing') render();
    }
  }

  root.append(seg, body);
  render();
  if (mode === 'existing') void loadRepos();
  return root;
}
