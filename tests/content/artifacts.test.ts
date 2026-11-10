// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CapturedMessage } from '../../src/shared/types';
import { keepArtifacts } from '../../src/background/stage';

// Frames cannot answer in the test DOM: report what each adapter would ask for instead.
vi.mock('../../src/content/capture/frames', async (orig) => ({
  ...(await orig<typeof import('../../src/content/capture/frames')>()),
  serializeFrames: async (reqs: Array<{ key: string; messageId: string | null; title: string }>) =>
    reqs.map((r) => ({ key: r.key, messageId: r.messageId, title: r.title, html: `<html>${r.key}</html>` })),
}));

const { attachArtifacts, artifactAssetName, captureVisible } = await import('../../src/content/capture/snapshot');
const { chatgpt } = await import('../../src/content/adapters/chatgpt');
const { claude } = await import('../../src/content/adapters/claude');
const { gemini } = await import('../../src/content/adapters/gemini');

const load = (dir: string, name: string) => {
  document.body.innerHTML = readFileSync(path.resolve('tests/fixtures', dir, name), 'utf8');
};
const a = (id: string, markdown: string): CapturedMessage => ({ id, role: 'assistant', markdown });
/** The test DOM has no layout: give ChatGPT's transcript panes a size (only a visible pane is read). */
const showPanes = () => {
  for (const pane of Array.from(document.querySelectorAll<HTMLElement>('.thread-scroll-container')))
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 800, width: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
};
/** The test DOM does not load frames: give them a window to talk to. */
const withWindows = (frames: Iterable<HTMLIFrameElement>) => {
  for (const f of frames) Object.defineProperty(f, 'contentWindow', { get: () => window, configurable: true });
};
/** happy-dom does not load frames: put a real same-origin document behind `frame`. */
const setFrameDocument = (frame: HTMLIFrameElement, fill: (doc: Document) => void): Document => {
  const doc = document.implementation.createHTMLDocument('');
  fill(doc);
  Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => doc });
  return doc;
};
const addUserContent = (doc: Document, src = 'https://x.frame.claudeusercontent.com/'): HTMLIFrameElement => {
  const inner = doc.createElement('iframe');
  inner.setAttribute('src', src);
  doc.body.append(inner);
  withWindows([inner]);
  return inner;
};

describe('attachArtifacts', () => {
  it('escapes a trailing backslash as well as brackets in a card title', () => {
    const title = 'Path [v2] \\';
    const [linked] = attachArtifacts([a('m1', `> **Artifact:** ${title}`)], [{ key: 'k', messageId: 'm1', title, html: '<p></p>' }]);
    expect(linked?.markdown).toContain(String.raw`[Path \[v2\] \\](gitchat-asset:`);
  });

  it('attaches each visualization to the message that owns it, even with equal titles', () => {
    const msgs = [a('m1', '> **Artifact:** Chart'), a('m2', '> **Artifact:** Chart')];
    const out = attachArtifacts(msgs, [{ key: 'artifact:x1', messageId: 'm1', title: 'Chart', html: '<p>old</p>' }]);
    expect(out[0]?.markdown).toMatch(/^> \*\*Artifact:\*\* \[Chart\]\(gitchat-asset:chart-\w+\.html\)$/);
    expect(out[0]?.assets?.[0]?.data).toBe('<p>old</p>');
    expect(out[1]?.markdown).toBe('> **Artifact:** Chart');
  });

  it('matches titles exactly, not by prefix', () => {
    const msgs = [a('m1', '> **Artifact:** Chart of sales'), a('m2', 'text')];
    const out = attachArtifacts(msgs, [{ key: 'k', messageId: null, title: 'Chart', html: '<p></p>' }]);
    expect(out[0]?.assets ?? []).toHaveLength(0);
  });

  it('names assets by identity, so recapturing one never renames another', () => {
    const one = artifactAssetName({ key: 'm1:viz1', messageId: 'm1', title: 'Chart', html: '' });
    const two = artifactAssetName({ key: 'm2:viz1', messageId: 'm2', title: 'Chart', html: '' });
    expect(one).not.toBe(two);
    expect(artifactAssetName({ key: 'm1:viz1', messageId: 'm1', title: 'Chart', html: 'changed' })).toBe(one);
  });

  it('links generated-file cards too', () => {
    const out = attachArtifacts([a('m1', '> **File:** report.html')], [{ key: 'm1:file:report.html', messageId: 'm1', title: 'report.html', html: '<p></p>' }]);
    expect(out[0]?.markdown).toMatch(/^> \*\*File:\*\* \[report\.html\]\(gitchat-asset:report-html-\w+\.html\)$/);
  });
});

describe('chatgpt fallbacks', () => {
  it('reads answers that only carry data-content-search-unit-key, with turn-based ids', () => {
    load('chatgpt', 'long-top.html');
    const msgs = captureVisible(chatgpt, document);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs.map((m) => m.id)).toEqual(['TURN_UUID_1', 'TURN_UUID_1:a2', 'TURN_UUID_2', 'TURN_UUID_2:a2']);
    expect(msgs[1]?.markdown).toBe('1');
  });

  it('falls back to a descendant id before anything content-derived', () => {
    load('chatgpt', 'basic.html');
    for (const el of Array.from(document.querySelectorAll('[data-chatgpt-search-message-ids]'))) el.removeAttribute('data-chatgpt-search-message-ids');
    const ids = chatgpt.messages(document).map((m) => m.id);
    expect(ids).toEqual(['98726113-85fe-4de7-aa65-d4a86b38344f', '70b0aef7-c8c2-4b10-adcd-2a1b77bfda5d']);
  });

  it('reports code for the new code widgets', () => {
    load('chatgpt', 'code.html');
    document.body.innerHTML = `<div data-turn-key="t1"><div data-chatgpt-search-unit-key="x:2:assistant"><div data-markdown-text-style="assistant-message">${document.body.innerHTML}</div></div></div>`;
    const [msg] = captureVisible(chatgpt, document);
    expect(msg?.kinds).toContain('code');
  });

  it('turns a generated-file card into a marker; an open preview nobody clicked here has no known owner', async () => {
    document.body.innerHTML = `
      <div class="thread-scroll-container"><div data-turn-key="t1">
        <div data-chatgpt-search-unit-key="x:2:assistant" data-chatgpt-search-message-ids="m-1">
          <div data-markdown-text-style="assistant-message"><p>Here it is</p>
            <div><button type="button"><span title="report.html">report.html</span></button><button type="button"></button></div>
            <div role="group"><iframe title="Bars" src="https://codex-inline-visualization-ab.web-sandbox.oaiusercontent.com/"></iframe></div>
          </div>
        </div></div></div>
      <aside data-app-shell-focus-area="right-panel"><iframe title="report.html" src="https://codex-inline-visualization-cd.web-sandbox.oaiusercontent.com/"></iframe></aside>`;
    showPanes();
    withWindows(document.querySelectorAll('iframe'));
    const [msg] = captureVisible(chatgpt, document);
    expect(msg?.markdown).toContain('> **File:** report.html');
    expect(msg?.markdown).toContain('> **Artifact:** Bars');
    // the only matching card in a virtualized list does not prove it opened the preview (c-services H4)
    const arts = await chatgpt.artifacts!(document);
    expect(arts.map((x) => [x.key, x.messageId, x.title])).toEqual([['m-1:viz1', 'm-1', 'Bars']]);
    // already collected frames are not asked for again
    expect(await chatgpt.artifacts!(document, { skip: new Set(['m-1:viz1']) })).toEqual([]);
    const linked = attachArtifacts([msg!], arts);
    expect(linked[0]?.assets?.map((x) => x.name)).toHaveLength(1);
  });
});

describe('claude artifacts', () => {
  it('ties the open panel to the card marked current, keyed by the artifact id', async () => {
    load('claude', 'artifact.html');
    const outer = document.querySelector<HTMLIFrameElement>('iframe[src*="/code/artifact/"]')!;
    setFrameDocument(outer, (doc) => {
      addUserContent(doc);
    });
    document.querySelector('[data-testid="assistant-message"]')!.setAttribute('data-turn-key', 'turn-9-hub-reply');
    const arts = await claude.artifacts!(document);
    expect(arts).toHaveLength(1);
    expect(arts[0]?.key).toBe('artifact:ARTIFACT_UUID');
    expect(arts[0]?.messageId).toBe('turn-9-hub-reply');
    expect(arts[0]?.title).toBe('Four Value Bar Chart');
    const answer = captureVisible(claude, document).find((m) => m.id === 'turn-9-hub-reply')!;
    const [linked] = attachArtifacts([answer], arts);
    expect(linked?.assets).toHaveLength(1);
    expect(linked?.markdown).toContain('> **Artifact:** [Four Value Bar Chart](gitchat-asset:');
  });

  it('forgets a clicked card when the chat id changes', async () => {
    const chatA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const chatB = '11111111-2222-3333-4444-555555555555';
    const mount = (id: string) => {
      document.body.innerHTML = `<div data-testid="assistant-message" data-turn-key="turn-a-hub-reply">
        <button data-testid="frame-card-open">Chart</button></div>
        <iframe id="${id}" src="https://claude.ai/code/artifact/ART" title="Chart"></iframe>`;
      const outer = document.getElementById(id) as HTMLIFrameElement;
      setFrameDocument(outer, (doc) => {
        addUserContent(doc);
      });
    };
    history.replaceState(null, '', `/chat/${chatA}`);
    mount('outer-a');
    claude.watch!(document);
    document.querySelector('[data-testid="frame-card-open"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await claude.artifacts!(document)).toHaveLength(1);
    history.replaceState(null, '', `/chat/${chatB}`);
    mount('outer-b');
    expect(await claude.artifacts!(document)).toEqual([]);
  });

  it('walks a same-origin /code/frame/ document to the claudeusercontent frame', async () => {
    load('claude', 'artifact.html');
    const outer = document.querySelector<HTMLIFrameElement>('iframe[src*="/code/artifact/"]')!;
    setFrameDocument(outer, (doc) => {
      const mid = doc.createElement('iframe');
      mid.setAttribute('src', 'https://claude.ai/code/frame/viewer');
      doc.body.append(mid);
      setFrameDocument(mid, (midDoc) => {
        addUserContent(midDoc, 'https://ARTIFACT_UUID.frame.claudeusercontent.com/_f/signed');
      });
    });
    document.querySelector('[data-testid="assistant-message"]')!.setAttribute('data-turn-key', 'turn-9-hub-reply');
    const arts = await claude.artifacts!(document);
    expect(arts.map((x) => [x.key, x.messageId, x.title])).toEqual([['artifact:ARTIFACT_UUID', 'turn-9-hub-reply', 'Four Value Bar Chart']]);
  });

  it('skips top-level /code/frame/ previews without a verified artifact identity', async () => {
    load('claude', 'artifact-frame.html');
    const outer = document.querySelector<HTMLIFrameElement>('iframe[src*="/code/frame/"]')!;
    const other = outer.cloneNode() as HTMLIFrameElement;
    other.src = 'https://claude.ai/code/frame/OTHER_UUID';
    document.body.append(other);
    for (const frame of [outer, other]) {
      setFrameDocument(frame, (doc) => {
        addUserContent(doc);
      });
    }
    expect(await claude.artifacts!(document)).toEqual([]);
    expect(await claude.artifacts!(document, { skip: new Set(['turn-frame-hub-reply:artifact']) })).toEqual([]);
    expect(captureVisible(claude, document)[0]?.markdown).toContain('> **Artifact:** Frame Chart');
  });

  it('ties an .artifact-block-cell card to the open panel', async () => {
    load('claude', 'artifact-cell.html');
    const outer = document.querySelector<HTMLIFrameElement>('iframe[src*="/code/artifact/"]')!;
    setFrameDocument(outer, (doc) => {
      addUserContent(doc);
    });
    const arts = await claude.artifacts!(document);
    expect(arts.map((x) => [x.key, x.messageId, x.title])).toEqual([['artifact:CELL_UUID', 'turn-cell-hub-reply', 'Cell Chart']]);
    const answer = captureVisible(claude, document).find((m) => m.id === 'turn-cell-hub-reply')!;
    expect(answer.markdown).toContain('> **Artifact:** Cell Chart');
    expect(answer.markdown).toContain('Published the chart.');
  });

  it('skips an artifact when the usercontent window cannot be reached', async () => {
    load('claude', 'artifact.html');
    const outer = document.querySelector<HTMLIFrameElement>('iframe[src*="/code/artifact/"]')!;
    Object.defineProperty(outer, 'contentDocument', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    document.querySelector('[data-testid="assistant-message"]')!.setAttribute('data-turn-key', 'turn-9-hub-reply');
    await expect(claude.artifacts!(document)).resolves.toEqual([]);

    setFrameDocument(outer, (doc) => {
      const inner = addUserContent(doc);
      Object.defineProperty(inner, 'contentWindow', { configurable: true, get: () => null });
    });
    await expect(claude.artifacts!(document)).resolves.toEqual([]);

    setFrameDocument(outer, (doc) => {
      const mid = doc.createElement('iframe');
      mid.setAttribute('src', 'https://claude.ai/code/frame/viewer');
      doc.body.append(mid);
      Object.defineProperty(mid, 'contentDocument', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await expect(claude.artifacts!(document)).resolves.toEqual([]);
  });
});

describe('gemini', () => {
  it('preserves legacy Canvas links and files when titled previews are closed after upgrading', async () => {
    load('gemini', 'canvas-title.html');
    const turn = document.querySelector('.conversation-container')!.id;
    const titles = ['Canvas', 'Canvas 2', 'Canvas 3', 'Canvas 4'];
    const [saved] = attachArtifacts(
      [a(`${turn}:a`, titles.map((title) => `> **Artifact:** ${title}`).join('\n\n'))],
      titles.map((title, i) => ({ key: `${turn}:canvas${i + 1}`, messageId: `${turn}:a`, title, html: `<p>Preview ${i + 1}</p>` })),
    );
    expect(saved?.assets).toHaveLength(4);

    for (const frame of Array.from(document.querySelectorAll('iframe'))) frame.remove();
    expect(await gemini.artifacts!(document)).toEqual([]);
    const [closed] = captureVisible(gemini, document);
    expect(closed?.id).toBe(saved?.id);
    const kept = keepArtifacts(saved!, closed!);
    expect(kept.markdown).toBe(saved?.markdown);
    expect(kept.assets).toEqual(saved?.assets);
  });

  it('keeps numbered citation markers', () => {
    document.body.innerHTML = `<div class="conversation-container" id="abc"><model-response><message-content><div class="markdown-main-panel">
      <p>Fact one<source-footnote><sup class="superscript" data-turn-source-index="1">1</sup></source-footnote> and two.</p></div></message-content></model-response></div>`;
    const [msg] = captureVisible(gemini, document);
    expect(msg?.markdown).toBe('Fact one[1] and two.');
  });

  it('keys Canvas previews by the full turn id', async () => {
    load('gemini', 'artifact.html');
    withWindows(document.querySelectorAll('iframe'));
    const arts = await gemini.artifacts!(document);
    const turn = document.querySelector('immersive-entry-chip')!.closest('.conversation-container')!.id;
    expect(arts[0]?.key).toBe(`${turn}:canvas1`);
    expect(arts[0]?.messageId).toBe(`${turn}:a`);
  });
});

describe('preview ownership (N11)', () => {
  const twoReports = () => {
    document.body.innerHTML = `
      <div class="thread-scroll-container">
        <div data-turn-key="t1"><div data-chatgpt-search-unit-key="x:2:assistant" data-chatgpt-search-message-ids="old">
          <div data-markdown-text-style="assistant-message"><button id="old-card" type="button"><span title="report.html">report.html</span></button></div></div></div>
        <div data-turn-key="t2"><div data-chatgpt-search-unit-key="y:2:assistant" data-chatgpt-search-message-ids="new">
          <div data-markdown-text-style="assistant-message"><button id="new-card" type="button"><span title="report.html">report.html</span></button></div></div></div>
      </div>
      <aside data-app-shell-focus-area="right-panel"><iframe title="report.html" src="https://codex-inline-visualization-cd.web-sandbox.oaiusercontent.com/"></iframe></aside>`;
    withWindows(document.querySelectorAll('iframe'));
  };

  it('skips a ChatGPT file preview whose card is ambiguous, and binds it to the card the user opened', async () => {
    twoReports();
    chatgpt.watch!(document);
    expect(await chatgpt.artifacts!(document)).toEqual([]);
    document.getElementById('old-card')!.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const arts = await chatgpt.artifacts!(document);
    expect(arts.map((x) => [x.key, x.messageId])).toEqual([['old:file:report.html', 'old']]);
  });

  it('skips a Claude panel when no card is current and the title is ambiguous', async () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message" data-turn-key="a1"><span role="button" data-testid="frame-card-open">Chart</span></div>
      <div data-testid="assistant-message" data-turn-key="a2"><span role="button" data-testid="frame-card-open">Chart</span></div>
      <iframe title="Chart" src="https://claude.ai/code/artifact/U1"></iframe>`;
    const outer = document.querySelector<HTMLIFrameElement>('iframe')!;
    setFrameDocument(outer, (doc) => {
      addUserContent(doc, 'https://x.frame.claudeusercontent.com/');
    });
    claude.watch!(document);
    expect(await claude.artifacts!(document)).toEqual([]);
    document.querySelectorAll<HTMLElement>('[data-testid="frame-card-open"]')[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const arts = await claude.artifacts!(document);
    expect(arts.map((x) => [x.key, x.messageId])).toEqual([['artifact:U1', 'a1']]);
  });
});

describe('preview ownership in virtualized lists (c-services H4)', () => {
  it('skips a restored Claude panel when the one mounted card with its title is not marked current', async () => {
    // an older "Plot" was open; its card was virtualized away, a newer "Plot" card is mounted
    document.body.innerHTML = `
      <div data-testid="assistant-message" data-turn-key="new"><span role="button" data-testid="frame-card-open">Plot</span></div>
      <iframe title="Plot" src="https://claude.ai/code/artifact/OLD"></iframe>`;
    const outer = document.querySelector<HTMLIFrameElement>('iframe')!;
    setFrameDocument(outer, (doc) => {
      addUserContent(doc);
    });
    expect(await claude.artifacts!(document)).toEqual([]);
    // marked current by the site: that card owns the panel
    document.querySelector('[data-testid="frame-card-open"]')!.setAttribute('aria-current', 'true');
    expect((await claude.artifacts!(document)).map((x) => [x.key, x.messageId])).toEqual([['artifact:OLD', 'new']]);
  });
});

describe('chatgpt transcript panes (c-services H1)', () => {
  const pane = (id: string) =>
    `<div class="thread-scroll-container"><div data-turn-key="${id}"><div data-chatgpt-search-unit-key="x:0:user" data-chatgpt-search-message-ids="${id}-u"><div data-user-message-bubble>${id} question</div></div></div></div>`;

  it('reads nothing while the only transcript pane is a hidden stale copy', () => {
    document.body.innerHTML = pane('old');
    expect(captureVisible(chatgpt, document)).toEqual([]);
    expect(chatgpt.hasTurn!(document, 'old')).toBe(false);
  });

  it('reads the visible pane, never the hidden copy next to it', () => {
    document.body.innerHTML = pane('old') + pane('new');
    const panes = document.querySelectorAll<HTMLElement>('.thread-scroll-container');
    panes[1]!.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 800, width: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    expect(captureVisible(chatgpt, document).map((m) => m.id)).toEqual(['new-u']);
  });

  it('keeps reading the whole document in the classic UI (no panes)', () => {
    load('chatgpt', 'basic.html');
    expect(captureVisible(chatgpt, document)).toHaveLength(2);
  });
});

describe('chatgpt Work mode (N15)', () => {
  it('captures only the final answer, not commentary units of the work log', () => {
    load('chatgpt', 'work.html');
    // the documented commentary form: an assistant unit of the same turn outside the final wrapper
    const log = document.querySelector('[data-local-conversation-item-target-ids]')!;
    const unit = document.createElement('div');
    unit.setAttribute('data-chatgpt-search-unit-key', 'fallback-turn-1:1:assistant');
    unit.setAttribute('data-chatgpt-search-message-ids', 'COMMENTARY_UUID');
    unit.innerHTML = '<div data-markdown-text-style="assistant-message"><p>Checking the slider ranges.</p></div>';
    log.appendChild(unit);
    const msgs = captureVisible(chatgpt, document);
    expect(msgs.filter((m) => m.role === 'assistant').map((m) => m.id)).toEqual(['ASSISTANT_MESSAGE_UUID']);
    expect(msgs.map((m) => m.markdown).join('\n')).not.toContain('Checking the slider ranges');
  });

  it('leaves work-log commentary out also before the final answer exists', () => {
    document.body.innerHTML = `<div data-turn-key="U">
      <div data-chatgpt-search-unit-key="turn:0:user" data-chatgpt-search-message-ids="U"><div data-user-message-bubble>Question</div></div>
      <div data-local-conversation-item-target-ids="worklog"><div data-chatgpt-search-unit-key="turn:1:assistant" data-chatgpt-search-message-ids="C">
        <div data-markdown-text-style="assistant-message"><p>Provisional Work commentary</p></div></div></div></div>`;
    expect(captureVisible(chatgpt, document).map((m) => m.id)).toEqual(['U']);
    document.querySelector('[data-turn-key]')!.insertAdjacentHTML(
      'beforeend',
      '<div data-local-conversation-final-assistant="true"><div data-chatgpt-search-unit-key="turn:2:assistant" data-chatgpt-search-message-ids="F"><div data-markdown-text-style="assistant-message"><p>Final answer</p></div></div></div>',
    );
    expect(captureVisible(chatgpt, document).map((m) => m.id)).toEqual(['U', 'F']);
  });

  it('keeps ordinary chat turns unchanged', () => {
    load('chatgpt', 'basic.html');
    expect(captureVisible(chatgpt, document).map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});

describe('scroller (N8)', () => {
  it('uses the explicit chat scroller even before it overflows', () => {
    document.body.innerHTML = '<infinite-scroller class="chat-history"><div class="conversation-container" id="c1"><user-query><p class="query-text-line">hi</p></user-query></div></infinite-scroller>';
    const sc = document.querySelector<HTMLElement>('infinite-scroller')!;
    sc.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 800, width: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    Object.defineProperty(sc, 'scrollHeight', { get: () => 600 });
    Object.defineProperty(sc, 'clientHeight', { get: () => 600 });
    expect(gemini.scrollContainer(document)).toBe(sc);
  });
});
