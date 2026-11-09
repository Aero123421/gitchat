import type { CapturedMessage, ChatKey, Role, ServiceId } from '../shared/types';

/** A message as of the last local commit (enough to tell what changed since). */
export interface CommittedRef {
  id: string;
  role: Role;
  hash: string;
}

/** Everything the background knows about one chat (IndexedDB store "chats"). */
export interface ChatRecord {
  key: ChatKey;
  service: ServiceId;
  chatId: string;
  url: string;
  title: string;
  tracked: boolean;
  /** Repository path of the chat file. */
  path?: string;
  /** True once `path` was checked against the remote (another device may already have the file). */
  pathConfirmed: boolean;
  /** Git blob SHA of the remote file as of our last push or adoption; the base for conflict checks. */
  remoteBlob?: string;
  /** ISO time of the first capture (file name date and `created`). */
  createdAt: string;
  /** ISO time of the latest capture. */
  capturedAt: string;
  /** Current content (the "working tree"). */
  messages: CapturedMessage[];
  /** Messages as of the last local commit. */
  committed: CommittedRef[];
  updatedAt: number;
}

/** What a commit contains. Rendered to files at push time, once the final path is known. */
export interface ChatDoc {
  service: ServiceId;
  chatId: string;
  url: string;
  title: string;
  createdAt: string;
  capturedAt: string;
  messages: CapturedMessage[];
}

/** A local commit waiting to be pushed, or a recent pushed one (IndexedDB store "commits"). */
export interface LocalCommit {
  id: string;
  key: ChatKey;
  /** Global order of commits. */
  seq: number;
  message: string;
  /** Messages added or changed. */
  n: number;
  /** Epoch ms. */
  createdAt: number;
  /** Dropped once pushed (the content lives in git history then). */
  doc?: ChatDoc;
  pushed: boolean;
  sha?: string;
  /** Another device pushed a newer capture of this chat first, so this commit was skipped. */
  superseded?: boolean;
}

export interface SyncMeta {
  lastPushAt?: number;
  lastError?: string;
}
