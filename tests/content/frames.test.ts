// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { requestFrameHtml } from '../../src/content/capture/frames';

const SAMPLE = '<script>alert(1)</script><h1 onclick="alert(1)">Revenue</h1><img src="../secret.png" alt="chart">';

function frame(origin: string) {
  const posted: Array<{ data: { nonce?: string }; targetOrigin: unknown }> = [];
  const target = {
    get location() {
      return { origin };
    },
    postMessage(data: { nonce?: string }, targetOrigin?: unknown) {
      posted.push({ data, targetOrigin });
    },
  } as unknown as Window;
  return { target, posted };
}

function reply(target: Window, origin: string, nonce: string, html: string) {
  window.dispatchEvent(new MessageEvent('message', { data: { gitchat: 1, type: 'frame/html', nonce, html, title: 'Chart' }, origin, source: target }));
}

describe('requestFrameHtml', () => {
  it('posts to the frame origin, ignores any other origin, and keeps only the first reply', async () => {
    const { target, posted } = frame('https://viz.example');
    const pending = requestFrameHtml(target, 400);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.targetOrigin).toBe('https://viz.example');
    expect(posted[0]?.targetOrigin).not.toBe('*');
    const nonce = posted[0]?.data.nonce ?? '';
    expect(nonce).not.toBe('');
    reply(target, 'https://claude.ai', nonce, '<p>from the page</p>');
    reply(target, 'https://viz.example', nonce, SAMPLE);
    reply(target, 'https://viz.example', nonce, '<p>second</p>');
    const got = await pending;
    expect(got?.title).toBe('Chart');
    expect(got?.html).not.toMatch(/<script[\s>/]/i);
    expect(got?.html).not.toMatch(/\son[a-z]/i);
    expect(got?.html).not.toContain('../');
    expect(got?.html).not.toContain('from the page');
    expect(got?.html).not.toContain('second');
    expect(got?.html).toContain('https://viz.example/secret.png');
    expect(got?.html).toContain('Revenue');
    expect(got?.html).toContain("script-src 'none'");
  });

  it('ignores a reply whose source is not the frame it asked', async () => {
    const { target, posted } = frame('https://viz.example');
    const pending = requestFrameHtml(target, 400);
    const nonce = posted[0]?.data.nonce ?? '';
    reply(window, 'https://viz.example', nonce, '<p>wrong source</p>');
    reply(target, 'https://viz.example', nonce, '<p>ok</p>');
    const got = await pending;
    expect(got?.html).toContain('<p>ok</p>');
    expect(got?.html).not.toContain('wrong source');
  });

  it('does not post when the frame origin cannot be known', async () => {
    const postMessage = vi.fn();
    const target = {
      get location() {
        throw new Error('cross-origin');
      },
      postMessage,
    } as unknown as Window;
    await expect(requestFrameHtml(target, 20)).resolves.toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
  });

  /** Remote iframe navigation is disabled in happy-dom. `srcdoc` still yields a child window; `src` is stubbed. */
  function mountedFrame(src: string, sandbox?: string): Window {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = '<!doctype html><html><body></body></html>';
    if (sandbox !== undefined) iframe.setAttribute('sandbox', sandbox);
    document.body.appendChild(iframe);
    const target = iframe.contentWindow;
    if (!target || target === window) throw new Error('expected a nested frame window');
    const real = iframe.getAttribute.bind(iframe);
    vi.spyOn(iframe, 'getAttribute').mockImplementation((name: string) => (name === 'src' ? src : real(name)));
    Object.defineProperty(target, 'location', { configurable: true, get() { throw new Error('cross-origin'); } });
    return target;
  }

  it('uses the iframe src origin when location is not readable', async () => {
    const target = mountedFrame('https://abc.frame.claudeusercontent.com/app');
    let nonce = '';
    let targetOrigin: unknown;
    target.postMessage = ((data: { nonce?: string }, origin?: unknown) => {
      nonce = data.nonce ?? '';
      targetOrigin = origin;
    }) as Window['postMessage'];
    const pending = requestFrameHtml(target, 300);
    expect(targetOrigin).toBe('https://abc.frame.claudeusercontent.com');
    reply(target, 'https://evil.example', nonce, '<p>no</p>');
    reply(target, 'https://abc.frame.claudeusercontent.com', nonce, '<p>ok</p>');
    const got = await pending;
    expect(got?.html).toContain('<p>ok</p>');
    expect(got?.html).not.toContain('<p>no</p>');
  });

  it('addresses a sandboxed opaque frame as the "null" origin', async () => {
    const target = mountedFrame('https://abc.frame.claudeusercontent.com/app', 'allow-scripts');
    let nonce = '';
    let targetOrigin: unknown;
    target.postMessage = ((data: { nonce?: string }, origin?: unknown) => {
      nonce = data.nonce ?? '';
      targetOrigin = origin;
    }) as Window['postMessage'];
    const pending = requestFrameHtml(target, 300);
    expect(targetOrigin).toBe('null');
    reply(target, 'https://abc.frame.claudeusercontent.com', nonce, '<p>https</p>');
    reply(target, 'null', nonce, '<b>ok</b>');
    const got = await pending;
    expect(got?.html).toContain('<b>ok</b>');
    expect(got?.html).not.toContain('<p>https</p>');
  });
});
