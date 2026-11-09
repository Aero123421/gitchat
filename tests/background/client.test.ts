import { describe, expect, it, vi } from 'vitest';
import { GitHub, RateLimitError } from '../../src/background/github/client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(responses: Response[]) {
  const fetch = vi.fn(async () => responses.shift() ?? json(200, {}));
  const sleep = vi.fn(async () => undefined);
  return { gh: new GitHub('tok', { fetch: fetch as unknown as typeof globalThis.fetch, sleep }), fetch, sleep };
}

describe('GitHub client', () => {
  it('sends the token and API version', async () => {
    const { gh, fetch } = client([json(200, { login: 'octo' })]);
    await gh.request('GET', '/user');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(new Headers(init.headers).get('x-github-api-version')).toBe('2022-11-28');
  });

  it('waits out a short rate limit and retries', async () => {
    const { gh, sleep } = client([json(429, { message: 'slow down' }, { 'retry-after': '2' }), json(200, { ok: 1 })]);
    const r = await gh.request<{ ok: number }>('GET', '/user');
    expect(r.data.ok).toBe(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('gives up on a long rate limit with the wait time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    const { gh } = client([json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) })]);
    const err = await gh.request('GET', '/user').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBeGreaterThan(60_000);
  });

  it('maps errors to codes and retries server errors', async () => {
    const { gh: a } = client([json(401, { message: 'Bad credentials' })]);
    await expect(a.request('GET', '/user')).rejects.toMatchObject({ code: 'auth' });
    const { gh: b } = client([json(422, { message: 'Update is not a fast forward' })]);
    await expect(b.request('PATCH', '/x')).rejects.toMatchObject({ code: 'non-fast-forward' });
    const { gh: c, fetch } = client([json(502, {}), json(200, { ok: 1 })]);
    await expect(c.request('GET', '/x')).resolves.toMatchObject({ status: 200 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const { gh: d } = client([json(404, { message: 'Not Found' })]);
    await expect(d.request('GET', '/x', undefined, [404])).resolves.toMatchObject({ status: 404 });
  });

  it('reports network failures', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const gh = new GitHub('tok', { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => undefined });
    await expect(gh.request('GET', '/user')).rejects.toMatchObject({ code: 'network' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
