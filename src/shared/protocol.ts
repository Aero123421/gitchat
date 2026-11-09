// Message protocol between the extension's parts.
//
// - Requests go to the background service worker with chrome.runtime.sendMessage and get one reply.
// - The background pushes live updates (chat status, settings) to content scripts over a Port named
//   EVENTS_PORT that each content script opens on start.
//
// Every request type, its payload and its reply type are listed in `Requests`, so both sides are
// type-checked against the same table.

import type { AuthState, ChatKey, ChatSnapshot, ChatStatus, RepoRef, ServiceId, Settings } from './types';

export const EVENTS_PORT = 'gitchat:events';

export type SnapshotReason = 'sent' | 'answered' | 'manual';

export interface DeviceCode {
  userCode: string;
  verificationUri: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

export interface RepoSummary {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  /** True when the repository has no commits yet. */
  empty: boolean;
  /** True when the repository already contains gitchat files. */
  managed: boolean;
}

export interface SyncStatus {
  repo: RepoRef | null;
  /** Unpushed commits across all chats. */
  pending: number;
  lastPushAt?: number;
  lastError?: string;
}

export interface Requests {
  /** A chat page is showing this chat; returns its status. */
  'chat/open': { req: { service: ServiceId; chatId: string; url: string; title: string }; res: ChatStatus };
  /**
   * A fresh capture of a tracked chat, staged automatically. `reason` tells the background why:
   * 'sent' (the user just sent a message), 'answered' (the AI finished an answer — the only reason
   * that triggers auto-commit), or 'manual'. Missing reason = 'answered'.
   */
  'chat/snapshot': { req: { snapshot: ChatSnapshot; reason?: SnapshotReason }; res: ChatStatus };
  'chat/status': { req: { key: ChatKey }; res: ChatStatus };
  /**
   * The user started tracking (init) an untracked chat. The background hands out an `initId` owned by
   * the calling tab; progress/done/cancel must carry it, and a stale or foreign id is refused.
   */
  'chat/init/start': { req: { key: ChatKey }; res: { status: ChatStatus; initId: string } };
  'chat/init/progress': { req: { key: ChatKey; initId: string; progress: number }; res: null };
  /** The full history was captured; the chat becomes tracked and everything is staged. */
  'chat/init/done': { req: { snapshot: ChatSnapshot; initId: string }; res: ChatStatus };
  'chat/init/cancel': { req: { key: ChatKey; initId?: string }; res: ChatStatus };
  'chat/commit': { req: { key: ChatKey }; res: ChatStatus };
  /** Commits anything staged for `key` first, then pushes all pending commits. */
  'chat/push': { req: { key?: ChatKey }; res: ChatStatus | null };
  /** Stop tracking a chat on this device (the file in the repository is kept). */
  'chat/untrack': { req: { key: ChatKey }; res: ChatStatus };

  'settings/get': { req: Record<string, never>; res: Settings };
  'settings/set': { req: { patch: Partial<Settings> }; res: Settings };

  'auth/get': { req: Record<string, never>; res: Pick<AuthState, 'login' | 'method' | 'scopes'> | null };
  'auth/device/start': { req: Record<string, never>; res: DeviceCode };
  /** Resolves when the user has approved the device code (or rejects on expiry/denial). */
  'auth/device/wait': { req: Record<string, never>; res: { login: string } };
  'auth/device/cancel': { req: Record<string, never>; res: null };
  'auth/pat': { req: { token: string }; res: { login: string } };
  'auth/signout': { req: Record<string, never>; res: null };

  'repo/list': { req: Record<string, never>; res: RepoSummary[] };
  /** One repository by name (for a typed owner/name), so the UI can warn before using it. */
  'repo/info': { req: { owner: string; name: string }; res: RepoSummary };
  'repo/create': { req: { name: string; private: boolean }; res: RepoRef };
  'repo/use': { req: { owner: string; name: string; branch?: string }; res: RepoRef };
  'sync/status': { req: Record<string, never>; res: SyncStatus };
  /** Open the settings page (content scripts cannot open extension pages themselves). */
  'app/open-settings': { req: Record<string, never>; res: null };
}

export type RequestType = keyof Requests;
export type ReqOf<T extends RequestType> = Requests[T]['req'];
export type ResOf<T extends RequestType> = Requests[T]['res'];

export interface Envelope<T extends RequestType = RequestType> {
  gitchat: 1;
  type: T;
  payload: ReqOf<T>;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

/** Events pushed from the background over the EVENTS_PORT. */
export type BackgroundEvent =
  | { type: 'status'; status: ChatStatus }
  | { type: 'settings'; settings: Settings }
  | { type: 'sync'; sync: SyncStatus };

/** Messages the popup sends to the content script of the active tab (chrome.tabs.sendMessage). */
/**
 * Popup → content script. 'content/refresh' re-reads the page (a manual snapshot) and replies when
 * done, so Commit/Push from the popup include what is on screen right now.
 */
export type ToContent =
  | { gitchat: 1; type: 'content/current' }
  | { gitchat: 1; type: 'content/init' }
  /** Re-read a tracked chat from the top (complete capture): fixes what a live capture can't see, e.g. a branch switch. */
  | { gitchat: 1; type: 'content/rescan' }
  | { gitchat: 1; type: 'content/refresh' };

/** Reply to 'content/refresh': whether the page was read and staged; Commit/Push stop when it wasn't. */
export interface RefreshResult {
  ok: boolean;
  /** Why not, in the user's language (absent when there was simply nothing to read). */
  error?: string;
}

export interface ContentCurrent {
  service: ServiceId;
  chatId: string | null;
  title: string;
  status: ChatStatus | null;
}

/** Error with a stable code the UI can map to a localized message. */
export class GitchatError extends Error {
  constructor(
    message: string,
    readonly code: string = 'error',
  ) {
    super(message);
    this.name = 'GitchatError';
  }
}

export function isEnvelope(x: unknown): x is Envelope {
  return !!x && typeof x === 'object' && (x as { gitchat?: unknown }).gitchat === 1 && typeof (x as { type?: unknown }).type === 'string';
}

/** Send a request to the background and unwrap the reply. */
export async function request<T extends RequestType>(type: T, payload: ReqOf<T>): Promise<ResOf<T>> {
  const env: Envelope<T> = { gitchat: 1, type, payload };
  const reply = (await chrome.runtime.sendMessage(env)) as Reply<ResOf<T>> | undefined;
  if (!reply) throw new GitchatError('No reply from the background worker', 'no-reply');
  if (!reply.ok) throw new GitchatError(reply.error, reply.code);
  return reply.data;
}
