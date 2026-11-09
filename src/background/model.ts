import type { CapturedMessage, ChatKey, Role, ServiceId } from '../shared/types';

/** A message as of the last local commit (enough to tell what changed since). */
export interface CommittedRef {
  id: string;
  role: Role;
  hash: string;
}

/**
 * Everything the background knows about one chat (IndexedDB store "chats"). `path`, `remoteBlob`,
 * `baseRefs` and `committed` describe the chat in one repository: `repo`. Choosing another
 * repository re-baselines them.
 */
export interface ChatRecord {
  key: ChatKey;
  service: ServiceId;
  chatId: string;
  url: string;
  title: string;
  tracked: boolean;
  /** Repository (`owner/name@branch`) the fields below refer to. */
  repo?: string | null;
  /** Repository path of the chat file. */
  path?: string;
  /** True once `path` was checked against the remote (another device may already have the file). */
  pathConfirmed: boolean;
  /** Git blob SHA of the remote file as of our last push or adoption; the base for conflict checks. */
  remoteBlob?: string;
  /** The messages in that remote file (id + hash): the common base of a three-way merge. */
  baseRefs?: CommittedRef[];
  /** ISO time of the first capture (file name date and `created`). */
  createdAt: string;
  /** ISO time of the latest capture (from any device; written as `captured`). */
  capturedAt: string;
  /** DOM-read time of the newest capture this device applied; older captures are refused. */
  seenAt?: string;
  /**
   * Ids of messages a capture on this device has seen on the page. Messages that only came from
   * another device's copy are not in it, so a capture of this page cannot prune them as a branch.
   */
  seen?: string[];
  /**
   * False while the last applied capture was taken mid-turn ('sent'); automatic commits wait until a
   * settled capture ('answered', 'manual' or init) arrives.
   */
  settled?: boolean;
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

/**
 * A local commit waiting to be pushed, or a recent pushed one (IndexedDB store "commits"). Its
 * document lives in the "docs" store (by commit id) until it is pushed, so listing commits stays cheap.
 */
export interface LocalCommit {
  id: string;
  key: ChatKey;
  /** Repository (`owner/name@branch`) this commit is for; null when made before one was chosen. */
  repo: string | null;
  /** Global order of commits. */
  seq: number;
  message: string;
  /** Messages added or changed. */
  n: number;
  /** Epoch ms. */
  createdAt: number;
  pushed: boolean;
  sha?: string;
  /** Another device pushed a capture that already had everything in this commit, so it was skipped. */
  superseded?: boolean;
}

/** A pending commit with its document, as the push needs it. */
export interface CommitWithDoc {
  commit: LocalCommit;
  doc: ChatDoc;
}

export interface SyncMeta {
  lastPushAt?: number;
  lastError?: string;
}
