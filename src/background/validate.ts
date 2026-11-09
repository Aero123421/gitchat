// Structural checks of request payloads. Everything that arrives over the message boundary is
// untrusted: a compromised page process can send anything a content script could.

import { GitchatError, type RequestType } from '../shared/protocol';
import { SERVICES, type ServiceId } from '../shared/types';

const LIMITS = {
  id: 512,
  text: 4096,
  messages: 20_000,
  markdown: 2_000_000,
  assets: 32,
  /** Characters of one asset (HTML text or base64). */
  asset: 16_000_000,
  /** Characters of a whole snapshot (Chrome messages are capped at 64 MB). */
  snapshot: 48_000_000,
};

type Obj = Record<string, unknown>;

function fail(what: string): never {
  throw new GitchatError(`Invalid request: ${what}.`, 'invalid');
}

function obj(v: unknown, what: string): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(what);
  return v as Obj;
}

function str(v: unknown, what: string, max = LIMITS.text, min = 0): string {
  if (typeof v !== 'string' || v.length > max || v.length < min) fail(what);
  return v;
}

function bool(v: unknown, what: string): void {
  if (typeof v !== 'boolean') fail(what);
}

function service(v: unknown): ServiceId {
  if (!SERVICES.includes(v as ServiceId)) fail('service');
  return v as ServiceId;
}

/** `service:chatId`; returns the service. */
function key(v: unknown): ServiceId {
  const k = str(v, 'chat key', LIMITS.id + 16, 3);
  const i = k.indexOf(':');
  if (i <= 0 || i === k.length - 1) fail('chat key');
  return service(k.slice(0, i));
}

function iso(v: unknown, what: string): void {
  if (Number.isNaN(Date.parse(str(v, what, 64, 1)))) fail(what);
}

/** Checks a snapshot's shape and size; returns its service. */
function snapshot(v: unknown): ServiceId {
  const s = obj(v, 'snapshot');
  const svc = service(s.service);
  str(s.chatId, 'chat id', LIMITS.id, 1);
  str(s.url, 'url');
  str(s.title, 'title');
  iso(s.capturedAt, 'capture time');
  bool(s.complete, 'complete');
  if (s.atEnd !== undefined) bool(s.atEnd, 'atEnd');
  if (s.startConfirmed !== undefined) bool(s.startConfirmed, 'startConfirmed');
  if (s.view !== undefined) {
    const view = obj(s.view, 'view');
    str(view.id, 'view id', 64, 1);
    if (typeof view.since !== 'number' || !Number.isFinite(view.since)) fail('view');
  }
  if (!Array.isArray(s.messages) || s.messages.length > LIMITS.messages) fail('messages');
  let size = 0;
  for (const raw of s.messages) {
    const m = obj(raw, 'message');
    str(m.id, 'message id', LIMITS.id, 1);
    if (m.role !== 'user' && m.role !== 'assistant') fail('message role');
    size += str(m.markdown, 'message text', LIMITS.markdown).length;
    if (m.kinds !== undefined && (!Array.isArray(m.kinds) || m.kinds.length > 16 || m.kinds.some((k) => typeof k !== 'string' || k.length > 32))) fail('message kinds');
    if (m.assets === undefined) continue;
    if (!Array.isArray(m.assets) || m.assets.length > LIMITS.assets) fail('message assets');
    for (const rawAsset of m.assets) {
      const a = obj(rawAsset, 'asset');
      str(a.name, 'asset name', 200, 1);
      str(a.mime, 'asset type', 200);
      size += str(a.data, 'asset data', LIMITS.asset).length;
      if (a.encoding !== 'utf8' && a.encoding !== 'base64') fail('asset encoding');
    }
  }
  if (size > LIMITS.snapshot) fail('snapshot size');
  return svc;
}

/**
 * Validates a request payload. Returns the service a chat request is about (so the router can check
 * it against the page that sent it), or null for requests not tied to one chat.
 */
export function validatePayload(type: RequestType, payload: unknown): ServiceId | null {
  const p = obj(payload ?? {}, 'payload');
  switch (type) {
    case 'chat/open':
      str(p.chatId, 'chat id', LIMITS.id, 1);
      str(p.url, 'url');
      str(p.title, 'title');
      return service(p.service);
    case 'chat/snapshot':
      if (p.reason !== undefined && !['sent', 'answered', 'manual'].includes(p.reason as string)) fail('reason');
      return snapshot(p.snapshot);
    case 'chat/init/done':
      str(p.initId, 'init id', 64, 1);
      return snapshot(p.snapshot);
    case 'chat/init/progress':
      str(p.initId, 'init id', 64, 1);
      if (typeof p.progress !== 'number' || !Number.isFinite(p.progress)) fail('progress');
      return key(p.key);
    case 'chat/init/cancel':
      if (p.initId !== undefined) str(p.initId, 'init id', 64, 1);
      return key(p.key);
    case 'chat/status':
    case 'chat/init/start':
    case 'chat/commit':
    case 'chat/untrack':
      return key(p.key);
    case 'chat/push':
      return p.key === undefined ? null : key(p.key);
    case 'settings/set':
      obj(p.patch, 'settings');
      return null;
    case 'auth/pat':
      str(p.token, 'token', 1000);
      return null;
    case 'repo/create':
      str(p.name, 'repository name', 100);
      bool(p.private, 'private');
      return null;
    case 'repo/info':
      str(p.owner, 'owner', 100, 1);
      str(p.name, 'repository name', 100, 1);
      return null;
    case 'repo/use':
      str(p.owner, 'owner', 100, 1);
      str(p.name, 'repository name', 100, 1);
      if (p.branch !== undefined) str(p.branch, 'branch', 255);
      return null;
    default:
      return null;
  }
}

const SITE_SERVICES: Record<string, ServiceId> = {
  'https://chatgpt.com': 'chatgpt',
  'https://claude.ai': 'claude',
  'https://gemini.google.com': 'gemini',
};

/**
 * The chat service of a content script's top frame, or null for anything else (an extension page,
 * a sub-frame such as a visualization sandbox, or an unexpected site).
 */
export function senderService(sender: chrome.runtime.MessageSender | undefined): ServiceId | null {
  if (!sender || sender.frameId !== 0) return null;
  let origin = sender.origin;
  if (!origin && sender.url) {
    try {
      origin = new URL(sender.url).origin;
    } catch {
      return null;
    }
  }
  return (origin && SITE_SERVICES[origin]) || null;
}
