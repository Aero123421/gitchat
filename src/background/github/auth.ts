// GitHub sign-in: OAuth device flow ("Sign in with GitHub") or a personal access token.
// The token is stored only in chrome.storage.local and only ever sent to github.com / api.github.com.

import { GitchatError, type DeviceCode } from '../../shared/protocol';
import type { AuthState } from '../../shared/types';
import { GitHub, defaultSleep, type ClientOptions } from './client';

/** OAuth app client id shipped with official builds (empty until the app is registered). */
export const DEFAULT_CLIENT_ID = '';

const AUTH_KEY = 'auth';
const PENDING_KEY = 'deviceFlow';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SCOPE = 'repo';

/**
 * Keeps the token out of reach of content scripts: chrome.storage.local is readable from them by
 * default. Older Chrome versions only support this for session storage; nothing else depends on it.
 */
export async function restrictStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // not supported for this storage area here
  }
}

export async function loadAuth(): Promise<AuthState | null> {
  const got = await chrome.storage.local.get(AUTH_KEY);
  const a = got[AUTH_KEY] as AuthState | undefined;
  return a?.token ? a : null;
}

export async function saveAuth(a: AuthState): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: a });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

/** Checks a token against GitHub and returns the account it belongs to. */
export async function identify(token: string, opts: ClientOptions = {}): Promise<{ login: string; scopes: string[] }> {
  const t = token.trim();
  if (!t) throw new GitchatError('Paste a token first.', 'invalid');
  const r = await new GitHub(t, opts).request<{ login: string }>('GET', '/user');
  const scopes = (r.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { login: r.data.login, scopes };
}

interface Pending {
  /** Identifies this sign-in attempt; a token is only saved while it is still the pending one. */
  id: string;
  clientId: string;
  deviceCode: string;
  interval: number;
  expiresAt: number;
}

type TokenReply = Record<string, string | undefined>;

export class DeviceFlow {
  private generation = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async start(clientId: string): Promise<DeviceCode> {
    if (!clientId) {
      throw new GitchatError('"Sign in with GitHub" is not available in this build. Use a personal access token, or set an OAuth client ID under Advanced.', 'no-client-id');
    }
    const generation = this.generation;
    const data = await this.post(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPE });
    // cancelled (or another sign-in started) while GitHub answered: this code must not become pending
    if (generation !== this.generation) throw new GitchatError('The sign-in was cancelled.', 'cancelled');
    if (!data.device_code || !data.user_code || !data.verification_uri) throw signInError(data);
    const expiresIn = Number(data.expires_in) || 900;
    const pending: Pending = { id: crypto.randomUUID(), clientId, deviceCode: data.device_code, interval: Number(data.interval) || 5, expiresAt: this.now() + expiresIn * 1000 };
    this.generation++;
    // Session storage survives a service-worker restart while the user approves the code.
    await chrome.storage.session.set({ [PENDING_KEY]: pending });
    return { userCode: data.user_code, verificationUri: data.verification_uri, expiresIn, interval: pending.interval };
  }

  /**
   * Polls GitHub until the user approves the code. Returns the access token and the attempt it
   * belongs to; the caller saves the token only if `claim(flowId)` still succeeds afterwards.
   */
  async wait(): Promise<{ token: string; flowId: string }> {
    const generation = this.generation;
    const p = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as Pending | undefined;
    if (!p) throw new GitchatError('The sign-in expired. Start again.', 'expired');
    const cancelled = () => new GitchatError('The sign-in was cancelled.', 'cancelled');
    let interval = p.interval;
    while (this.now() < p.expiresAt) {
      await this.sleep(interval * 1000);
      if (generation !== this.generation) throw cancelled();
      const data = await this.post(TOKEN_URL, { client_id: p.clientId, device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (generation !== this.generation) throw cancelled();
      if (data.access_token) return { token: data.access_token, flowId: p.id };
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') {
        interval = Number(data.interval) || interval + 5;
        continue;
      }
      await chrome.storage.session.remove(PENDING_KEY);
      if (data.error === 'expired_token') throw new GitchatError('The sign-in code expired. Start again.', 'expired');
      if (data.error === 'access_denied') throw new GitchatError('Sign-in was cancelled on GitHub.', 'denied');
      throw signInError(data);
    }
    await chrome.storage.session.remove(PENDING_KEY);
    throw new GitchatError('The sign-in code expired. Start again.', 'expired');
  }

  /** Ends the pending sign-in (cancel, sign-out, or a token signed in instead): its approval is ignored. */
  async cancel(): Promise<void> {
    this.generation++;
    await chrome.storage.session.remove(PENDING_KEY);
  }

  /** True (once) when `flowId` is still the pending sign-in; a stale approval returns false. */
  async claim(flowId: string): Promise<boolean> {
    const p = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as Pending | undefined;
    if (p?.id !== flowId) return false;
    await chrome.storage.session.remove(PENDING_KEY);
    return true;
  }

  private async post(url: string, params: Record<string, string>): Promise<TokenReply> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (e) {
      throw new GitchatError(`Could not reach GitHub (${(e as Error).message}).`, 'network');
    }
    const data = ((await res.json().catch(() => ({}))) ?? {}) as TokenReply;
    if (!res.ok && !data.error) data.error = `http_${res.status}`;
    return data;
  }
}

function signInError(data: TokenReply): GitchatError {
  if (data.error === 'device_flow_disabled') return new GitchatError('Device sign-in is turned off for this OAuth app.', 'device-flow-disabled');
  if (data.error === 'incorrect_client_credentials' || data.error === 'http_404' || data.error === 'Not Found') {
    return new GitchatError('The OAuth client ID is not valid.', 'no-client-id');
  }
  return new GitchatError(data.error_description || data.error || 'GitHub sign-in failed.', 'auth');
}
