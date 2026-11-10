// The background's core: chat state, staging, local commits, pushing, and the status the widget
// shows. Network and Chrome APIs come in through EngineDeps, so this runs the same in tests.

import { GitchatError, type BackgroundEvent, type SnapshotReason, type SyncStatus } from '../shared/protocol';
import { chatKey, type CapturedMessage, type ChatKey, type ChatPhase, type ChatSnapshot, type ChatStatus, type CommitInfo, type ServiceId, type Settings, type StagedItem } from '../shared/types';
import { log } from '../shared/log';
import { toGitchatError } from './errors';
import { RateLimitError, type GitHub } from './github/client';
import { gitBlobSha } from './hash';
import type { ChatDoc, ChatRecord, CommitWithDoc, LocalCommit, PageRead, SyncMeta } from './model';
import { chatPath, encodePath, repoId } from './paths';
import { chatTitle } from './render';
import { diffStaged, hashesOf, keepArtifacts, keepChangesSince, mergeSnapshot, messageHash, recordReads, refsOf, threeWayMerge, unionMessages, uniqueIds } from './stage';
import type { Db } from './store/db';
import { findRemoteChat, oursIsNewer, pushCommits, type PushOutcome, type RemoteCopy } from './sync';

export interface Emitter {
  status(status: ChatStatus): void;
  broadcast(event: BackgroundEvent): void;
  /** Chats currently shown in some tab. */
  shownKeys(): ChatKey[];
}

export interface SettingsStore {
  get(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

/** The tab (and document) running an init, so another tab cannot interfere with it. */
export interface InitOwner {
  tabId?: number;
  documentId?: string;
}

/** An init session as stored, so it survives the service worker being restarted. */
export interface StoredInit {
  key: ChatKey;
  id: string;
  owner?: InitOwner;
  progress: number;
  touchedAt: number;
  /** id → hash of every message when the init started. */
  base: [string, string][];
}

export interface InitStore {
  load(): Promise<StoredInit[]>;
  save(inits: StoredInit[]): Promise<void>;
}

export interface EngineDeps {
  db: Db;
  settings: SettingsStore;
  /** A client for the signed-in account; rejects with code "no-auth" when signed out. */
  github(): Promise<GitHub>;
  emit: Emitter;
  now?: () => number;
  /** Delay before an automatic push, to batch several commits. */
  pushDelayMs?: number;
  /**
   * Ask to be woken up (retry()) later: after a failed automatic push, and as a safety net while an
   * automatic push is waiting (timers do not survive the service worker being stopped).
   */
  scheduleRetry?: (delayMs: number) => void;
  /** Nothing is waiting any more: cancel the wake-up. */
  clearRetry?: () => void;
  keepAlive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Where running init sessions are kept across worker restarts (chrome.storage.session). */
  initStore?: InitStore;
}

interface InitSession {
  id: string;
  owner?: InitOwner;
  progress: number;
  touchedAt: number;
  /** Message hashes when the capture started; anything changed since is kept over the capture. */
  base: Map<string, string>;
  /** When progress was last written to the store (it is reported every half second). */
  savedAt?: number;
}

type PushKind = 'manual' | 'auto';

const RECENT_COMMITS = 12;
const REMOTE_MISS_TTL = 5 * 60_000;
/** An init that reports no progress for this long is considered abandoned. */
const INIT_IDLE_MS = 2 * 60_000;
const RETRYABLE = new Set(['network', 'rate-limit', 'github', 'non-fast-forward', 'conflict']);
const REPO_META = 'repo';

function splitKey(key: ChatKey): { service: ServiceId; chatId: string } {
  const i = key.indexOf(':');
  return { service: key.slice(0, i) as ServiceId, chatId: key.slice(i + 1) };
}

/** A commit belongs to the current repository, or was made before any repository was chosen. */
const inRepo = (c: LocalCommit, repo: string | null) => c.repo === repo || c.repo === null;
const isPending = (c: LocalCommit, repo: string | null) => !c.pushed && !c.superseded && inRepo(c, repo);
const isOlder = (a: string, b: string | undefined) => !!b && Date.parse(a) < Date.parse(b);
const later = (a: string, b: string) => (isOlder(a, b) ? b : a);

export class Engine {
  private readonly inits = new Map<ChatKey, InitSession>();
  private initsLoaded: Promise<void> | null = null;
  private initSaving: Promise<unknown> = Promise.resolve();
  private readonly chatErrors = new Map<ChatKey, string>();
  private readonly remoteMisses = new Map<ChatKey, number>();
  private readonly adopting = new Set<ChatKey>();
  private pushing: Promise<void> | null = null;
  /** Work requested while a push was running: a manual push, or an automatic one. */
  private readonly again = { manual: false, auto: false };
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Staged items per chat as of a record revision (status is asked for often; hashing a long chat is not free). */
  private readonly stagedMemo = new Map<ChatKey, { rev: number; staged: StagedItem[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private repoQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: EngineDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Runs chat mutations one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Pushing and switching repositories never overlap (a push must finish against the repository it started with). */
  private withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.repoQueue.then(fn, fn);
    this.repoQueue = run.catch(() => undefined);
    return run;
  }

  private async currentRepo(): Promise<string | null> {
    return repoId((await this.deps.settings.get()).repo);
  }

  /** Aligns stored state with the chosen repository before working with it (it may have changed elsewhere). */
  private async ensureRepo(): Promise<void> {
    const repo = await this.currentRepo();
    if (repo === null || (await this.deps.db.getMeta<string>(REPO_META)) === repo) return;
    await this.withRepoLock(async () => this.syncRepoLocked(await this.currentRepo()));
  }

  // ---- chats

  async open(p: { service: ServiceId; chatId: string; url: string; title: string }): Promise<ChatStatus> {
    const key = chatKey(p.service, p.chatId);
    const known = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (rec && (rec.url !== p.url || (p.title && rec.title !== p.title))) {
        rec.url = p.url || rec.url;
        rec.title = p.title || rec.title;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      return !!rec;
    });
    if (!known) void this.adoptRemote(key, p);
    return this.status(key);
  }

  /**
   * A chat saved by another device is tracked here too, continuing from the repository's copy. The
   * lookup is network work outside any lock; the result is only stored if the repository it came
   * from is still the chosen one (otherwise it is looked up again in the new one).
   */
  private async adoptRemote(key: ChatKey, p: { service: ServiceId; chatId: string; url: string; title: string }): Promise<void> {
    const missedAt = this.remoteMisses.get(key);
    if (this.adopting.has(key) || (missedAt !== undefined && this.now() - missedAt < REMOTE_MISS_TTL)) return;
    this.adopting.add(key);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { repo } = await this.deps.settings.get();
        if (!repo) return;
        const id = repoId(repo);
        const gh = await this.deps.github().catch(() => null);
        if (!gh) return;
        const found = await findRemoteChat(gh, repo, p.service, p.chatId);
        const result = await this.withRepoLock(async () => {
          if ((await this.currentRepo()) !== id) return 'stale';
          await this.syncRepoLocked(id);
          if (!found) {
            this.remoteMisses.set(key, this.now());
            return 'missing';
          }
          return this.exclusive(async () => {
            if (await this.deps.db.getChat(key)) return 'known';
            const at = this.iso();
            await this.saveChat({
              key,
              service: p.service,
              chatId: p.chatId,
              url: p.url,
              title: p.title || found.front.title || '',
              tracked: true,
              repo: id,
              path: found.path,
              pathConfirmed: true,
              remoteBlob: found.sha,
              baseRefs: refsOf(found.messages),
              createdAt: found.front.created || at,
              capturedAt: found.front.captured || at,
              messages: found.messages,
              committed: refsOf(found.messages),
              // Baseline for the next page read: the adopted text, not "this device edited it".
              pageReads: seedPageReads(found.messages, this.now()),
              settled: true,
              updatedAt: this.now(),
            });
            return 'adopted';
          });
        });
        if (result === 'adopted') await this.emitStatus(key);
        if (result !== 'stale') return;
      }
    } catch (e) {
      log.debug('remote lookup failed', e);
    } finally {
      this.adopting.delete(key);
    }
  }

  /**
   * Applies a capture of a tracked chat. A capture read from the page before one we already applied
   * is ignored (captures can arrive out of order). Auto-commit only runs once the AI finished answering.
   * A capture that cannot be placed safely changes nothing. The reply asks the page to read the whole
   * chat again (`fullRead`), including a branch seen away from the bottom. A capture taken while the
   * AI is still answering (`sent`) does not.
   */
  async snapshot(snap: ChatSnapshot, reason: SnapshotReason = 'answered'): Promise<ChatStatus> {
    const key = chatKey(snap.service, snap.chatId);
    await this.ensureRepo();
    const messages = uniqueIds(await withAssetShas(snap.messages));
    let fullRead = false;
    const committed = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (!rec?.tracked || isOlder(snap.capturedAt, rec.seenAt)) return false;
      const reads = pageReadsOf(rec);
      // The first read after adopting another computer's file records what the page shows, but does
      // not replace the adopted bodies. Otherwise a stale page becomes a one-sided local edit and
      // the next push fast-forwards over the other computer.
      const baseline = isAdoptedBaseline(reads);
      const merged = baseline
        ? { ok: true as const, messages: keepAdoptedBodies(rec.messages, messages) }
        : mergeSnapshot(rec.messages, { ...snap, messages }, reads);
      if (!merged.ok) {
        if (merged.code === 'ambiguous') fullRead = reason !== 'sent';
        else this.chatErrors.set(key, merged.message);
        return false;
      }
      this.chatErrors.delete(key);
      rec.messages = merged.messages;
      const readView = baseline ? (snap.view ?? { id: 'page' }) : snap.view;
      rec.pageReads = recordReads(baseline ? stripAdoptedMark(reads) : reads, messages, merged.messages, readView, this.now());
      delete rec.seen;
      rec.settled = reason !== 'sent';
      rec.capturedAt = snap.capturedAt || this.iso();
      rec.seenAt = rec.capturedAt;
      rec.title = snap.title || rec.title;
      rec.url = snap.url || rec.url;
      rec.updatedAt = this.now();
      await this.saveChat(rec);
      return reason === 'answered' && (await this.autoCommit(rec));
    });
    if (committed) this.afterCommit();
    const status = await this.emitStatus(key);
    return fullRead ? { ...status, fullRead: true } : status;
  }

  // ---- init (tracking a chat, or rescanning a tracked one: one complete capture of its history)

  private loadInits(): Promise<void> {
    return (this.initsLoaded ??= (async () => {
      const stored = (await this.deps.initStore?.load().catch(() => [])) ?? [];
      for (const s of stored) {
        if (this.inits.has(s.key)) continue;
        const session: InitSession = { id: s.id, progress: s.progress, touchedAt: s.touchedAt, base: new Map(s.base) };
        if (s.owner) session.owner = s.owner;
        this.inits.set(s.key, session);
      }
    })());
  }

  private persistInits(): void {
    const store = this.deps.initStore;
    if (!store) return;
    const list: StoredInit[] = [...this.inits].map(([key, s]) => ({ key, id: s.id, ...(s.owner ? { owner: s.owner } : {}), progress: s.progress, touchedAt: s.touchedAt, base: [...s.base] }));
    this.initSaving = this.initSaving.then(() => store.save(list)).catch(() => undefined);
  }

  private activeInit(key: ChatKey): InitSession | undefined {
    const s = this.inits.get(key);
    if (s && this.now() - s.touchedAt > INIT_IDLE_MS) {
      this.endInit(key, s.id);
      return undefined;
    }
    return s;
  }

  /** Ends the init `id` (only that one: a newer init of the same chat is left alone). */
  private endInit(key: ChatKey, id?: string): void {
    const s = this.inits.get(key);
    if (!s || (id !== undefined && s.id !== id)) return;
    this.inits.delete(key);
    this.persistInits();
  }

  /** The session `initId` of `key`, when it is still running and belongs to the caller. */
  private ownSession(key: ChatKey, initId: string, owner?: InitOwner): InitSession {
    const s = this.activeInit(key);
    if (!s || s.id !== initId || (s.owner && owner && !sameOwner(s.owner, owner))) throw staleInit();
    return s;
  }

  /**
   * Starts an init owned by the calling tab; a tracked chat can be rescanned the same way. Another
   * tab's running init is not taken over. Checking and reserving happen without a pause in between,
   * so two tabs starting at once cannot both get it.
   */
  async initStart(key: ChatKey, owner?: InitOwner): Promise<{ status: ChatStatus; initId: string }> {
    await this.loadInits();
    const current = this.activeInit(key);
    if (current && !sameOwner(current.owner, owner)) throw new GitchatError('This chat is already being saved in another tab.', 'busy');
    const session: InitSession = { id: crypto.randomUUID(), progress: 0, touchedAt: this.now(), base: new Map() };
    if (owner) session.owner = owner;
    this.inits.set(key, session);
    this.chatErrors.delete(key);
    // The baseline is read in order with every other change to the chat.
    await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      session.base = new Map((rec?.messages ?? []).map((m) => [m.id, messageHash(m)]));
    });
    this.persistInits();
    return { status: await this.emitStatus(key), initId: session.id };
  }

  async initProgress(key: ChatKey, initId: string, progress: number, owner?: InitOwner): Promise<null> {
    await this.loadInits();
    const s = this.ownSession(key, initId, owner);
    s.progress = Math.min(1, Math.max(0, progress));
    s.touchedAt = this.now();
    if (this.now() - (s.savedAt ?? 0) > 20_000) {
      s.savedAt = this.now();
      this.persistInits();
    }
    await this.emitStatus(key);
    return null;
  }

  /**
   * A complete capture: the chat becomes tracked (or is replaced, for a rescan) and the differences
   * are staged. Network work (has another device saved this chat?) happens first; then, in order
   * with cancellation and every other change, the session is checked and the change applied in one
   * step, so a cancel either wins entirely or comes too late. Changes applied since the init started
   * are kept.
   */
  async initDone(snap: ChatSnapshot, initId: string, owner?: InitOwner): Promise<ChatStatus> {
    const key = chatKey(snap.service, snap.chatId);
    await this.loadInits();
    this.ownSession(key, initId, owner);
    await this.ensureRepo();
    const messages = uniqueIds(await withAssetShas(snap.messages));
    const lookup = (await this.deps.db.getChat(key))?.path ? null : await this.lookupRemote(snap.service, snap.chatId);
    try {
      const committed = await this.exclusive(async () => {
        const session = this.ownSession(key, initId, owner);
        const existing = await this.deps.db.getChat(key);
        const reads = existing ? pageReadsOf(existing) : new Map<string, PageRead>();
        const merged = mergeSnapshot(existing?.messages ?? [], { ...snap, messages, complete: true }, reads);
        if (!merged.ok) {
          this.chatErrors.set(key, merged.message);
          return false;
        }
        const list = existing ? keepChangesSince(merged.messages, existing.messages, session.base) : merged.messages;
        const at = snap.capturedAt || this.iso();
        const rec: ChatRecord = existing ?? {
          key,
          service: snap.service,
          chatId: snap.chatId,
          url: snap.url,
          title: snap.title,
          tracked: true,
          pathConfirmed: false,
          createdAt: at,
          capturedAt: at,
          messages: [],
          committed: [],
          updatedAt: this.now(),
        };
        rec.tracked = true;
        rec.messages = list;
        rec.pageReads = recordReads(reads, messages, list, snap.view, this.now());
        delete rec.seen;
        rec.settled = true;
        rec.capturedAt = later(at, rec.capturedAt);
        rec.seenAt = rec.seenAt ? later(at, rec.seenAt) : at;
        rec.url = snap.url || rec.url;
        rec.title = snap.title || rec.title;
        rec.updatedAt = this.now();
        if (!rec.path) {
          const repo = await this.currentRepo();
          placeChat(rec, repo, lookup && lookup.repo === repo ? lookup.found : null);
        }
        this.chatErrors.delete(key);
        // the session ends with the change, in the same step: a cancel queued behind it finds nothing
        this.endInit(key, initId);
        await this.saveChat(rec);
        return this.autoCommit(rec);
      });
      if (committed) this.afterCommit();
    } finally {
      this.endInit(key, initId);
    }
    return this.emitStatus(key);
  }

  /**
   * Ends an init. Without an id (the user pressed Cancel anywhere), whichever init runs is ended. It
   * runs in order with the init's completion: whichever comes first wins.
   */
  async initCancel(key: ChatKey, initId?: string): Promise<ChatStatus> {
    await this.loadInits();
    await this.exclusive(async () => this.endInit(key, initId));
    return this.emitStatus(key);
  }

  /** A tab closed or navigated away: the inits it was running end with it. */
  async ownerGone(tabId: number): Promise<void> {
    await this.loadInits();
    const gone = await this.exclusive(async () => {
      const keys: ChatKey[] = [];
      for (const [key, s] of [...this.inits]) {
        if (s.owner?.tabId !== tabId) continue;
        this.endInit(key, s.id);
        keys.push(key);
      }
      return keys;
    });
    for (const key of gone) await this.emitStatus(key);
  }

  async untrack(key: ChatKey): Promise<ChatStatus> {
    await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (rec) {
        rec.tracked = false;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      this.endInit(key);
    });
    this.chatErrors.delete(key);
    return this.emitStatus(key);
  }

  /**
   * Whether another device already saved this chat in the chosen repository (network, so done
   * before taking the chat queue). Null when it could not be checked (offline, signed out, a failed
   * download): the push checks again.
   */
  private async lookupRemote(service: ServiceId, chatId: string): Promise<{ repo: string | null; found: RemoteCopy | null } | null> {
    try {
      const { repo } = await this.deps.settings.get();
      if (!repo) return { repo: null, found: null };
      return { repo: repoId(repo), found: await findRemoteChat(await this.deps.github(), repo, service, chatId) };
    } catch (e) {
      log.debug('path lookup failed', e);
      return null;
    }
  }

  // ---- commits

  async commit(key: ChatKey): Promise<ChatStatus> {
    await this.ensureRepo();
    const c = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      return rec?.tracked ? this.commitLocked(rec) : null;
    });
    if (c) this.afterCommit();
    return this.emitStatus(key);
  }

  /** Automatic commits never split a question from its answer: the last capture must have been settled. */
  private async autoCommit(rec: ChatRecord): Promise<boolean> {
    const s = await this.deps.settings.get();
    return s.autoCommit && rec.settled !== false && !!(await this.commitLocked(rec));
  }

  private async commitLocked(rec: ChatRecord): Promise<LocalCommit | null> {
    const staged = diffStaged(rec.messages, rec.committed);
    if (!staged.length) return null;
    const repo = await this.currentRepo();
    rec.path ??= chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
    rec.repo ??= repo;
    const doc: ChatDoc = { service: rec.service, chatId: rec.chatId, url: rec.url, title: rec.title, createdAt: rec.createdAt, capturedAt: rec.capturedAt, messages: rec.messages };
    rec.committed = refsOf(rec.messages);
    rec.updatedAt = this.now();
    rec.rev = (rec.rev ?? 0) + 1;
    return this.deps.db.addCommit(
      {
        id: crypto.randomUUID(),
        key: rec.key,
        repo,
        message: `${rec.service}: ${chatTitle(rec.title)} (+${staged.length})`,
        n: staged.length,
        createdAt: this.now(),
        pushed: false,
      },
      doc,
      rec,
    );
  }

  private afterCommit(): void {
    void this.emitSync();
    void this.deps.settings.get().then((s) => {
      if (s.autoPush) this.schedulePush();
    });
  }

  // ---- push

  /** Commits anything staged for `key`, then pushes every pending commit of the current repository. */
  async push(key?: ChatKey): Promise<ChatStatus | null> {
    await this.ensureRepo();
    if (key) {
      const c = await this.exclusive(async () => {
        const rec = await this.deps.db.getChat(key);
        return rec?.tracked ? this.commitLocked(rec) : null;
      });
      if (c) void this.emitSync();
    }
    this.cancelScheduledPush();
    await this.runPush('manual');
    return key ? this.emitStatus(key) : null;
  }

  /**
   * One push at a time. A request arriving meanwhile runs right after it: a manual one always, an
   * automatic one only if auto-push is still on by then.
   */
  private runPush(kind: PushKind): Promise<void> {
    if (this.pushing) {
      this.again[kind] = true;
      return this.pushing;
    }
    const run = (async () => {
      try {
        for (;;) {
          await this.withRepoLock(() => this.pushOnce());
          if (this.again.manual) {
            this.again.manual = this.again.auto = false;
            continue;
          }
          if (!this.again.auto) break;
          this.again.auto = false;
          if (!(await this.deps.settings.get()).autoPush) break;
        }
      } finally {
        this.pushing = null;
        await this.emitAll();
        await this.emitSync();
      }
    })();
    this.pushing = run;
    return run;
  }

  private async pushOnce(): Promise<void> {
    const { repo } = await this.deps.settings.get();
    const id = repoId(repo);
    await this.syncRepoLocked(id);
    const commits = await this.deps.db.allCommits();
    const pending = commits.filter((c) => isPending(c, id)).sort((a, b) => a.seq - b.seq);
    if (!repo && commits.some((c) => !c.pushed && !c.superseded)) {
      const err = new GitchatError('Choose a repository in the gitchat settings first.', 'no-repo');
      await this.setSyncMeta({ lastError: err.message });
      throw err;
    }
    if (!repo || !pending.length) {
      this.deps.clearRetry?.();
      return;
    }
    let outcome: PushOutcome;
    let items: CommitWithDoc[];
    try {
      await this.emitAll();
      const docs = await this.deps.db.getDocs(pending.map((c) => c.id));
      items = pending.flatMap((commit) => {
        const doc = docs.get(commit.id);
        return doc ? [{ commit, doc }] : [];
      });
      const gh = await this.deps.github();
      const run = () => pushCommits(gh, repo, items, (k) => this.deps.db.getChat(k));
      outcome = await (this.deps.keepAlive ? this.deps.keepAlive(run) : run());
    } catch (e) {
      const err = toGitchatError(e);
      await this.setSyncMeta({ lastError: err.message });
      throw err;
    }
    await this.exclusive(() => this.applyPush(pending, items, outcome, id));
    await this.setSyncMeta({ lastPushAt: this.now() }, { clearWait: true });
    this.deps.clearRetry?.();
  }

  /**
   * Records a push: receipts, final paths and bases. Where the repository copy had changes from
   * another device, the chat is rebased on it: the pushed batch's last document is the common base,
   * and both the working messages and the commits made while the push ran keep their own changes.
   */
  private async applyPush(pending: LocalCommit[], items: CommitWithDoc[], outcome: PushOutcome, repo: string | null): Promise<void> {
    const sent = new Set(items.map((i) => i.commit.id));
    const batch = new Map(items.map((i) => [i.commit.key, i.doc])); // last document per chat (seq order)
    const done: string[] = [];
    for (const c of pending) {
      const sha = outcome.pushed.get(c.id);
      if (sha) {
        c.pushed = true;
        c.sha = sha;
      } else if (outcome.superseded.has(c.id) || !sent.has(c.id)) {
        c.superseded = true; // a commit whose document is missing has nothing left to send
      } else continue;
      c.repo = repo;
      done.push(c.id);
    }
    await this.deps.db.putCommits(pending);
    await this.deps.db.deleteDocs(done);
    for (const [key, res] of outcome.chats) {
      const rec = await this.deps.db.getChat(key);
      if (!rec) continue;
      const pushedDoc = batch.get(key);
      if (res.merged && pushedDoc) {
        const base = hashesOf(refsOf(pushedDoc.messages));
        const newer = (at: string) => !isOlder(at, res.capturedAt);
        rec.messages = threeWayMerge(base, rec.messages, res.messages, newer(rec.capturedAt));
        const waiting = (await this.deps.db.commitsFor(key)).filter((c) => !c.pushed && !c.superseded && !sent.has(c.id)).sort((a, b) => a.seq - b.seq);
        const docs = await this.deps.db.getDocs(waiting.map((c) => c.id));
        for (const doc of docs.values()) doc.messages = threeWayMerge(base, doc.messages, res.messages, newer(doc.capturedAt));
        await this.deps.db.putDocs(docs);
        const last = waiting.length ? docs.get(waiting.at(-1)!.id) : undefined;
        rec.committed = refsOf(last ? last.messages : res.messages);
        rec.capturedAt = later(rec.capturedAt, res.capturedAt);
      }
      rec.baseRefs = refsOf(res.messages);
      rec.repo = repo;
      rec.path = res.path;
      rec.pathConfirmed = true;
      rec.remoteBlob = res.remoteBlob;
      rec.updatedAt = this.now();
      await this.saveChat(rec);
    }
    await this.prune();
  }

  /** Keeps the most recent pushed commits per chat (for the graph); older ones live in git. */
  private async prune(): Promise<void> {
    const done = (await this.deps.db.allCommits()).filter((c) => c.pushed || c.superseded);
    const byChat = new Map<ChatKey, LocalCommit[]>();
    for (const c of done) byChat.set(c.key, [...(byChat.get(c.key) ?? []), c]);
    const drop: string[] = [];
    for (const list of byChat.values()) {
      const keep = new Set(
        list
          .filter((c) => c.pushed)
          .sort((a, b) => b.seq - a.seq)
          .slice(0, RECENT_COMMITS)
          .map((c) => c.id),
      );
      for (const c of list) if (!keep.has(c.id)) drop.push(c.id);
    }
    if (drop.length) await this.deps.db.deleteCommits(drop);
  }

  private schedulePush(delay = this.deps.pushDelayMs ?? 3000): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined;
      void this.autoPush();
    }, delay);
    // If the worker is stopped before the timer fires, the alarm wakes it up to push.
    this.deps.scheduleRetry?.(delay + 30_000);
  }

  /** Drops automatic work that has not started yet (a running push finishes). */
  private cancelScheduledPush(): void {
    clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.again.auto = false;
  }

  /**
   * An automatic push. After a failed one the next waits (the rate limit's reset, or a growing
   * backoff); the deadline and the attempt count are stored, so a restarted worker keeps waiting
   * instead of pushing right away. A manual push does not wait.
   */
  private async autoPush(): Promise<void> {
    // The setting may have been turned off while the push was waiting.
    if (!(await this.deps.settings.get()).autoPush) {
      this.deps.clearRetry?.();
      return;
    }
    const left = await this.waitLeft();
    if (left > 0) {
      this.deps.scheduleRetry?.(left);
      return;
    }
    try {
      await this.runPush('auto');
    } catch (e) {
      const err = toGitchatError(e);
      if (!RETRYABLE.has(err.code)) return;
      const retries = ((await this.deps.db.getMeta<SyncMeta>('sync'))?.retries ?? 0) + 1;
      const wait = err instanceof RateLimitError ? err.retryAfterMs : Math.min(30 * 60_000, 30_000 * 2 ** (retries - 1));
      await this.setSyncMeta({ nextAllowedAt: this.now() + wait, retries }, { keepError: true });
      this.deps.scheduleRetry?.(wait);
    }
  }

  /** Time left before an automatic push may run again (0 when it may run now). */
  private async waitLeft(): Promise<number> {
    const until = (await this.deps.db.getMeta<SyncMeta>('sync'))?.nextAllowedAt ?? 0;
    return Math.max(0, until - this.now());
  }

  /** Woken up by the alarm: after a failed automatic push, or because the worker was restarted. */
  async retry(): Promise<void> {
    await this.autoPush();
  }

  /** On every start of the worker, after sign-in, etc.: push what is waiting when auto-push is on. */
  async resume(): Promise<void> {
    await this.ensureRepo();
    const s = await this.deps.settings.get();
    if (!s.autoPush || (await this.pendingCount()) === 0) return;
    // still waiting after a failed push (e.g. a rate limit): only re-arm the wake-up for when it ends
    const left = await this.waitLeft();
    if (left > 0) this.deps.scheduleRetry?.(left);
    else this.schedulePush(Math.min(1000, this.deps.pushDelayMs ?? 1000));
  }

  // ---- settings

  async settingsChanged(prev: Settings, next: Settings): Promise<void> {
    if (!next.autoPush) {
      this.cancelScheduledPush();
      if (prev.autoPush) this.deps.clearRetry?.();
    }
    const repoChanged = repoId(prev.repo) !== repoId(next.repo);
    if (repoChanged) await this.withRepoLock(() => this.syncRepoLocked(repoId(next.repo)));
    let committed = false;
    if (next.autoCommit && !prev.autoCommit) {
      committed = await this.exclusive(async () => {
        let any = false;
        for (const rec of await this.deps.db.allChats()) if (rec.tracked && (await this.autoCommit(rec))) any = true;
        return any;
      });
    }
    // a new repository (e.g. after "choose a repository first") gets what is waiting
    if (next.autoPush && (committed || !prev.autoPush || repoChanged) && (await this.pendingCount()) > 0) this.schedulePush();
    if (committed || repoChanged) {
      await this.emitAll();
      await this.emitSync();
    }
  }

  /**
   * Makes the stored state match the chosen repository. When it changed (here, or synced from
   * another device while this worker was asleep): commits for other repositories are dropped — their
   * content is still in the chats, assets included — and chats saved to another repository are
   * staged in full again, so the next commit writes them to this one.
   */
  private async syncRepoLocked(repo: string | null): Promise<void> {
    // No repository (e.g. settings were reset): nothing to align with until one is chosen again.
    if (repo === null) return;
    const stored = await this.deps.db.getMeta<string>(REPO_META);
    if (stored === repo) return;
    await this.exclusive(async () => {
      const commits = await this.deps.db.allCommits();
      const drop = commits.filter((c) => c.repo !== null && c.repo !== repo).map((c) => c.id);
      if (drop.length) await this.deps.db.deleteCommits(drop);
      for (const rec of await this.deps.db.allChats()) {
        if (rec.repo === repo) continue;
        if (rec.repo) rec.committed = [];
        rec.repo = repo;
        rec.pathConfirmed = false;
        delete rec.remoteBlob;
        delete rec.baseRefs;
        rec.updatedAt = this.now();
        await this.saveChat(rec);
      }
      await this.deps.db.setMeta(REPO_META, repo);
    });
    this.remoteMisses.clear();
    // errors were about the previous choice (or about having none): they no longer apply
    await this.clearError();
  }

  /** Forget the last push error (e.g. after signing in again). */
  async clearError(): Promise<void> {
    await this.setSyncMeta({});
  }

  // ---- status

  async status(key: ChatKey): Promise<ChatStatus> {
    await this.loadInits();
    const [rec, all, settings, meta] = await Promise.all([
      this.deps.db.getChat(key),
      this.deps.db.allCommits(),
      this.deps.settings.get(),
      this.deps.db.getMeta<SyncMeta>('sync'),
    ]);
    const mine = all.filter((c) => c.key === key);
    const repo = repoId(settings.repo);
    const { service, chatId } = rec ?? splitKey(key);
    const tracked = !!rec?.tracked;
    const commits = mine
      .filter((c) => !c.superseded && inRepo(c, repo))
      .sort((a, b) => b.seq - a.seq)
      .slice(0, RECENT_COMMITS);
    const aheadHere = commits.some((c) => !c.pushed);
    const chatError = this.chatErrors.get(key);
    const pushError = aheadHere ? meta?.lastError : undefined;
    const init = this.activeInit(key);

    let phase: ChatPhase = 'idle';
    if (init) phase = 'capturing';
    else if (this.pushing && aheadHere) phase = 'pushing';
    else if (chatError || pushError) phase = 'error';

    const status: ChatStatus = {
      key,
      service,
      chatId,
      tracked,
      staged: tracked && rec ? this.stagedOf(rec) : [],
      commits: commits.map(toInfo),
      aheadTotal: all.filter((c) => isPending(c, repo)).length,
      phase,
    };
    if (rec?.path) status.path = rec.path;
    if (init) status.progress = init.progress;
    if (phase === 'error') status.error = chatError ?? pushError;
    // Only link to a file that exists in this repository.
    if (rec?.path && rec.remoteBlob && rec.repo === repo && settings.repo) {
      const { owner, name, branch } = settings.repo;
      status.webUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodePath(branch)}/${encodePath(rec.path)}`;
    }
    return status;
  }

  /** What is staged in a chat, computed once per revision of its record. */
  private stagedOf(rec: ChatRecord): StagedItem[] {
    const hit = this.stagedMemo.get(rec.key);
    if (rec.rev !== undefined && hit?.rev === rec.rev) return hit.staged;
    const staged = diffStaged(rec.messages, rec.committed);
    if (rec.rev !== undefined) this.stagedMemo.set(rec.key, { rev: rec.rev, staged });
    return staged;
  }

  async syncStatus(): Promise<SyncStatus> {
    const [settings, meta] = await Promise.all([this.deps.settings.get(), this.deps.db.getMeta<SyncMeta>('sync')]);
    const out: SyncStatus = { repo: settings.repo, pending: await this.pendingCount() };
    if (meta?.lastPushAt) out.lastPushAt = meta.lastPushAt;
    if (meta?.lastError) out.lastError = meta.lastError;
    return out;
  }

  private async pendingCount(): Promise<number> {
    const repo = await this.currentRepo();
    return (await this.deps.db.allCommits()).filter((c) => isPending(c, repo)).length;
  }

  /**
   * Updates the sync meta. The last error goes unless the patch sets it (or `keepError`); the wait
   * after a failed automatic push stays until a push succeeds (`clearWait`).
   */
  private async setSyncMeta(patch: SyncMeta, opts: { keepError?: boolean; clearWait?: boolean } = {}): Promise<void> {
    const cur = (await this.deps.db.getMeta<SyncMeta>('sync')) ?? {};
    const next: SyncMeta = { ...cur, ...patch };
    if (!('lastError' in patch) && !opts.keepError) delete next.lastError;
    if (opts.clearWait) {
      delete next.nextAllowedAt;
      delete next.retries;
    }
    await this.deps.db.setMeta('sync', next);
    await this.emitSync();
  }

  /** Writes a chat record; every write gets a new revision. */
  private saveChat(rec: ChatRecord): Promise<void> {
    rec.rev = (rec.rev ?? 0) + 1;
    return this.deps.db.putChat(rec);
  }

  private async emitStatus(key: ChatKey): Promise<ChatStatus> {
    const s = await this.status(key);
    this.deps.emit.status(s);
    return s;
  }

  private async emitSync(): Promise<void> {
    this.deps.emit.broadcast({ type: 'sync', sync: await this.syncStatus() });
  }

  /** Re-sends the status of every chat that is open somewhere. */
  async emitAll(): Promise<void> {
    await Promise.all(this.deps.emit.shownKeys().map((k) => this.emitStatus(k)));
  }
}

function toInfo(c: LocalCommit): CommitInfo {
  return c.sha ? { id: c.id, n: c.n, t: c.createdAt, pushed: c.pushed, sha: c.sha } : { id: c.id, n: c.n, t: c.createdAt, pushed: c.pushed };
}

/** Marks page reads copied from an adopted file, before any capture on this device has seen the page. */
const ADOPTED_VIEW = '\0adopted';

function seedPageReads(messages: CapturedMessage[], at: number): Record<string, PageRead> {
  const out: Record<string, PageRead> = {};
  for (const m of messages) out[m.id] = { h: messageHash(m), at, v: [ADOPTED_VIEW] };
  return out;
}

function isAdoptedBaseline(reads: Map<string, PageRead>): boolean {
  if (reads.size === 0) return false;
  for (const r of reads.values()) {
    if (!r.h || r.v?.length !== 1 || r.v[0] !== ADOPTED_VIEW) return false;
  }
  return true;
}

function stripAdoptedMark(reads: Map<string, PageRead>): Map<string, PageRead> {
  const next = new Map<string, PageRead>();
  for (const [id, r] of reads) {
    const v = (r.v ?? []).filter((x) => x !== ADOPTED_VIEW);
    const copy: PageRead = { h: r.h, at: r.at };
    if (v.length) copy.v = v;
    if (r.hv && Object.keys(r.hv).length) copy.hv = { ...r.hv };
    next.set(id, copy);
  }
  return next;
}

/**
 * The adopted messages stay. A page message whose id is new is kept (this device added it). A page
 * message whose body differs does not replace the adopted one: that difference is what the page
 * happened to show, and the next unchanged read keeps the adopted text. New visualizations enrich
 * matching cards in that text before the reading is recorded.
 */
function keepAdoptedBodies(adopted: CapturedMessage[], page: CapturedMessage[]): CapturedMessage[] {
  const byId = new Map(adopted.map((m) => [m.id, m]));
  return unionMessages(
    page.map((m) => {
      const old = byId.get(m.id);
      return old ? keepArtifacts(m, old) : m;
    }),
    adopted,
  );
}

/** Page reads of a chat; records from before `pageReads` know only which ids were read, not when. */
function pageReadsOf(rec: ChatRecord): Map<string, PageRead> {
  if (rec.pageReads) return new Map(Object.entries(rec.pageReads));
  return new Map((rec.seen ?? rec.messages.map((m) => m.id)).map((id) => [id, { h: '', at: 0 }]));
}

/**
 * File name of a newly tracked chat. When another device already saved it (`found`), continue from
 * that copy: the newer capture wins for what both have, and nothing only the repository has is lost
 * unless our capture is newer (then it shows as removed in staging). Either way, a message keeps the
 * other copy's saved visualization when the winning one only has a plain card for it.
 */
function placeChat(rec: ChatRecord, repo: string | null, found: RemoteCopy | null): void {
  rec.path = chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
  rec.pathConfirmed = false;
  rec.repo = repo;
  if (!found) return; // the push checks the path again and picks a free name if needed
  rec.path = found.path;
  rec.pathConfirmed = true;
  rec.remoteBlob = found.sha;
  rec.baseRefs = refsOf(found.messages);
  rec.createdAt = found.front.created || rec.createdAt;
  const theirs = new Map(found.messages.map((m) => [m.id, m]));
  const ours = new Map(rec.messages.map((m) => [m.id, m]));
  if (oursIsNewer(rec, found.front)) {
    rec.messages = rec.messages.map((m) => (theirs.has(m.id) ? keepArtifacts(theirs.get(m.id)!, m) : m));
  } else {
    rec.messages = unionMessages(
      found.messages.map((m) => (ours.has(m.id) ? keepArtifacts(ours.get(m.id)!, m) : m)),
      rec.messages,
    );
  }
  rec.committed = refsOf(found.messages);
}

function sameOwner(a: InitOwner | undefined, b: InitOwner | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.tabId === b.tabId && (!a.documentId || !b.documentId || a.documentId === b.documentId);
}

function staleInit(message = 'This capture was cancelled or replaced. Start again.'): GitchatError {
  return new GitchatError(message, 'stale-init');
}

/** Git blob SHAs of the captured assets (recomputed: never trust a SHA sent by a page). */
async function withAssetShas(messages: CapturedMessage[]): Promise<CapturedMessage[]> {
  return Promise.all(
    messages.map(async (m) =>
      m.assets?.length ? { ...m, assets: await Promise.all(m.assets.map(async (a) => ({ ...a, sha: await gitBlobSha(a.data, a.encoding) }))) } : m,
    ),
  );
}
