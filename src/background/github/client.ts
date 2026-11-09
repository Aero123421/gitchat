// Minimal GitHub REST client: JSON in/out, typed errors, rate-limit waits and retries.

import { GitchatError } from '../../shared/protocol';

export const API_BASE = 'https://api.github.com';

export class RateLimitError extends GitchatError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, 'rate-limit');
    this.name = 'RateLimitError';
  }
}

export interface GhResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Longest rate-limit wait to sit through before giving up with RateLimitError. */
  maxWaitMs?: number;
}

const ATTEMPTS = 3;
const backoff = (attempt: number) => 500 * 2 ** attempt;

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class GitHub {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxWaitMs: number;

  constructor(
    private readonly token: string,
    opts: ClientOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxWaitMs = opts.maxWaitMs ?? 60_000;
  }

  /** Calls the API. Statuses in `allow` are returned instead of thrown. */
  async request<T>(method: string, path: string, body?: unknown, allow: number[] = []): Promise<GhResponse<T>> {
    let lastError: GitchatError | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(API_BASE + path, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${this.token}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (e) {
        lastError = new GitchatError(`Could not reach GitHub (${(e as Error).message}).`, 'network');
        await this.sleep(backoff(attempt));
        continue;
      }
      const data = await readJson(res);
      if (res.ok || allow.includes(res.status)) return { status: res.status, data: data as T, headers: res.headers };

      const wait = rateLimitWait(res, data);
      if (wait !== null) {
        if (wait <= this.maxWaitMs && attempt < ATTEMPTS - 1) {
          await this.sleep(wait);
          continue;
        }
        throw new RateLimitError(`GitHub's rate limit was reached. Try again in about ${Math.max(1, Math.ceil(wait / 60_000))} min.`, wait);
      }
      if (res.status >= 500) {
        lastError = toError(res.status, data);
        await this.sleep(backoff(attempt));
        continue;
      }
      throw toError(res.status, data);
    }
    throw lastError ?? new GitchatError('The GitHub request failed.', 'network');
  }
}

async function readJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function messageOf(data: unknown): string {
  const m = (data as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}

/** Milliseconds to wait for a rate limit, or null when the response is not rate limited. */
function rateLimitWait(res: Response, data: unknown): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter && Number.isFinite(Number(retryAfter))) return Math.max(1, Number(retryAfter)) * 1000;
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return Number.isFinite(reset) ? Math.max(1000, reset * 1000 - Date.now()) : 60_000;
  }
  if (res.status === 429 || /secondary rate limit/i.test(messageOf(data))) return 60_000;
  return null;
}

function toError(status: number, data: unknown): GitchatError {
  const msg = messageOf(data);
  switch (status) {
    case 401:
      return new GitchatError('GitHub rejected the sign-in. Connect GitHub again in the settings.', 'auth');
    case 403:
      return new GitchatError(`GitHub denied access${msg ? `: ${msg}` : '.'}`, 'forbidden');
    case 404:
      return new GitchatError(`Not found on GitHub${msg ? ` (${msg})` : ''}.`, 'not-found');
    case 409:
      return new GitchatError(msg || 'GitHub reported a conflict.', 'conflict');
    case 422:
      return /fast.forward/i.test(msg)
        ? new GitchatError('The branch moved on GitHub while pushing.', 'non-fast-forward')
        : new GitchatError(msg || 'GitHub rejected the request.', 'invalid');
    default:
      return new GitchatError(`GitHub error ${status}${msg ? `: ${msg}` : ''}.`, status >= 500 ? 'network' : 'github');
  }
}
