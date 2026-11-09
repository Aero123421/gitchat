// Answers requests from the content scripts, the popup and the options page.

import { GitchatError, type Envelope, type ReqOf, type Reply, type RequestType, type ResOf } from '../shared/protocol';
import type { ServiceId, Settings } from '../shared/types';
import { toGitchatError } from './errors';
import { validatePayload } from './validate';

export interface RequestContext {
  /** The popup or the options page (not a content script running on a website). */
  fromExtensionPage: boolean;
  /** For content scripts: the chat service of the page that sent the request. */
  service?: ServiceId;
  tabId?: number;
  documentId?: string;
}

export type Handlers = { [T in RequestType]: (payload: ReqOf<T>, ctx: RequestContext) => Promise<ResOf<T>> };

/** Requests that only extension pages may send: sign-in and repository choice. */
const PAGE_ONLY = new Set<RequestType>(['auth/get', 'auth/device/start', 'auth/device/wait', 'auth/device/cancel', 'auth/pat', 'auth/signout', 'repo/list', 'repo/info', 'repo/create', 'repo/use']);

/** Settings the on-page widget may change, with the type each must have. */
const WIDGET_SETTINGS: [keyof Settings, string][] = [
  ['autoCommit', 'boolean'],
  ['autoPush', 'boolean'],
  ['widget', 'string'],
];

export async function dispatch(handlers: Handlers, env: Envelope, ctx: RequestContext): Promise<Reply<unknown>> {
  try {
    const handler = handlers[env.type] as ((payload: unknown, ctx: RequestContext) => Promise<unknown>) | undefined;
    if (!handler) throw new GitchatError(`Unknown request "${env.type}".`, 'invalid');
    if (!ctx.fromExtensionPage && !ctx.service) throw new GitchatError('Requests are only accepted from gitchat and the supported chat sites.', 'forbidden');
    if (PAGE_ONLY.has(env.type) && !ctx.fromExtensionPage) throw new GitchatError('This request is only allowed from the extension pages.', 'forbidden');
    let payload: unknown = env.payload ?? {};
    const about = validatePayload(env.type, payload);
    // A chat page may only act on chats of its own service.
    if (!ctx.fromExtensionPage && about && about !== ctx.service) throw new GitchatError('A page can only act on its own chats.', 'forbidden');
    if (env.type === 'settings/set' && !ctx.fromExtensionPage) {
      const patch = (payload as ReqOf<'settings/set'>).patch ?? {};
      payload = { patch: Object.fromEntries(WIDGET_SETTINGS.filter(([k, type]) => typeof patch[k] === type).map(([k]) => [k, patch[k]])) };
    }
    return { ok: true, data: await handler(payload, ctx) };
  } catch (e) {
    const err = toGitchatError(e);
    return { ok: false, error: err.message, code: err.code };
  }
}
