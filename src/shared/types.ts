// Domain types shared by the content script, the background service worker, the popup and the
// options page. Keep this file free of runtime code so every bundle can import it cheaply.

export type ServiceId = 'chatgpt' | 'claude' | 'gemini';
export const SERVICES: readonly ServiceId[] = ['chatgpt', 'claude', 'gemini'] as const;

export type Role = 'user' | 'assistant';

/** A file captured alongside a message, e.g. the HTML of an interactive visualization. */
export interface CapturedAsset {
  /** File name inside the chat's asset folder, e.g. "viz-1.html". */
  name: string;
  mime: string;
  /** Text for utf8, base64 for binary. */
  data: string;
  encoding: 'utf8' | 'base64';
}

/**
 * Link target for a message's assets inside `CapturedMessage.markdown`, e.g.
 * `[Open visualization](gitchat-asset:viz-1.html)`. The background rewrites it to the asset's
 * relative path in the repository.
 */
export const ASSET_URL_PREFIX = 'gitchat-asset:';

export interface CapturedMessage {
  /** Stable ID: the service's own message ID when available, otherwise a content hash. */
  id: string;
  role: Role;
  /** The message rendered as Markdown (math as TeX, code fenced with its language). */
  markdown: string;
  /** Short markers of rich content found in the message ("math", "code", "viz", "image", "table"). */
  kinds?: string[];
  assets?: CapturedAsset[];
}

/** One read of a conversation from the page. */
export interface ChatSnapshot {
  service: ServiceId;
  chatId: string;
  url: string;
  title: string;
  messages: CapturedMessage[];
  /** ISO timestamp of the capture. */
  capturedAt: string;
  /** True when the whole history was captured (init), false for a partial/live capture. */
  complete: boolean;
}

/** Key that identifies a chat across the extension: `${service}:${chatId}`. */
export type ChatKey = `${ServiceId}:${string}`;
export const chatKey = (service: ServiceId, chatId: string): ChatKey => `${service}:${chatId}`;

export interface CommitInfo {
  /** Local commit ID (stable before and after push). */
  id: string;
  /** Number of messages added or changed in this commit. */
  n: number;
  /** Commit time, epoch ms. */
  t: number;
  pushed: boolean;
  /** Git commit SHA once pushed. */
  sha?: string;
}

export type ChatPhase = 'idle' | 'capturing' | 'pushing' | 'error';

/** What the on-page widget and the popup show for one chat. */
export interface ChatStatus {
  key: ChatKey;
  service: ServiceId;
  chatId: string;
  tracked: boolean;
  /** Repository path of the chat's Markdown file once known. */
  path?: string;
  /** Messages that changed since the last commit (auto-staged). */
  staged: StagedItem[];
  /** Recent commits for this chat, newest first (unpushed ones first). */
  commits: CommitInfo[];
  /** Unpushed commits across all chats (a push sends all of them). */
  aheadTotal: number;
  phase: ChatPhase;
  /** Init progress, 0..1, while phase === 'capturing'. */
  progress?: number;
  /** Human-readable reason when phase === 'error'. */
  error?: string;
  /** Web URL of the file on GitHub when the repo is configured. */
  webUrl?: string;
}

export interface StagedItem {
  id: string;
  role: Role;
  kind: string;
}

export type WidgetStyle = 'creature' | 'line' | 'dot';

export interface RepoRef {
  owner: string;
  name: string;
  branch: string;
}

/** Synced across the user's devices via chrome.storage.sync. Never put secrets here. */
export interface Settings {
  widget: WidgetStyle;
  autoCommit: boolean;
  autoPush: boolean;
  repo: RepoRef | null;
  services: Record<ServiceId, boolean>;
  /** Save the HTML source of interactive visualizations as files next to the chat. */
  saveVisualizations: boolean;
  /** Save images shown in the conversation (generated images, uploads) when they can be fetched. */
  saveImages: boolean;
  /** OAuth client ID used for "Sign in with GitHub" (device flow). Empty = use the built-in one. */
  githubClientId: string;
}

/** Device-local auth state (chrome.storage.local, never synced). */
export interface AuthState {
  token: string;
  /** How the token was obtained. */
  method: 'device' | 'pat';
  login: string;
  /** Scopes reported by GitHub for classic/OAuth tokens; empty for fine-grained PATs. */
  scopes: string[];
  savedAt: number;
}

/** What the chat's AI is doing, as observed on the page. */
export type AiPhase = 'idle' | 'thinking' | 'streaming';
