// The background's core: chat state, staging, local commits, pushing, and the status the widget
// shows. Network and Chrome APIs come in through EngineDeps, so this runs the same in tests.

import { GitchatError, type BackgroundEvent, type SnapshotReason, type SyncStatus } from '../shared/protocol';
import { chatKey, type ChatKey, type ChatPhase, type ChatSnapshot, type ChatStatus, type CommitInfo, type ServiceId, type Settings } from '../shared/types';
import { log } from '../shared/log';
import { toGitchatError } from './errors';
import { RateLimitError, type GitHub } from './github/client';
import type { ChatRecord, LocalCommit, SyncMeta } from './model';
import { chatPath, encodePath } from './paths';
import { chatTitle, parseChatFile } from './render';
import { diffStaged, mergeSnapshot, refsOf } from './stage';
import type { Db } from './store/db';
import { findRemoteChat, pushCommits, type PushOutcome } from './sync';

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

export interface EngineDeps {
  db: Db;
  settings: SettingsStore;
  /** A client for the signed-in account; rejects with code "no-auth" when signed out. */
  github(): Promise<GitHub>;
  emit: Emitter;
  now?: () => number;
  /** Delay before an automatic push, to batch several commits. */
  pushDelayMs?: number;
  /** Ask to be woken up (retry()) after a failed automatic push. */
  scheduleRetry?: (delayMs: number) => void;
  keepAlive?: <T>(fn: () => Promise<T>) => Promise<T>;
}

const RECENT_COMMITS = 12;
const REMOTE_MISS_TTL = 5 * 60_000;
const RETRYABLE = new Set(['network', 'rate-limit', 'github']);

function splitKey(key: ChatKey): { service: ServiceId; chatId: string } {
  const i = key.indexOf(':');
  return { service: key.slice(0, i) as ServiceId, chatId: key.slice(i + 1) };
}

export class Engine {
  private readonly capturing = new Map<ChatKey, number>();
  private readonly chatErrors = new Map<ChatKey, string>();
  private readonly remoteMisses = new Map<ChatKey, number>();
  private readonly adopting = new Set<ChatKey>();
  private pushing: Promise<void> | null = null;
  private pushAgain = false;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private queue: Promise<unknown> = Promise.resolve();

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

  // ---- chats

  async open(p: { service: ServiceId; chatId: string; url: string; title: string }): Promise<ChatStatus> {
    const key = chatKey(p.service, p.chatId);
    const known = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (rec && (rec.url !== p.url || (p.title && rec.title !== p.title))) {
        rec.url = p.url || rec.url;
        rec.title = p.title || rec.title;
        rec.updatedAt = this.now();
        await this.deps.db.putChat(rec);
      }
      return !!rec;
    });
    if (!known) void this.adoptRemote(key, p);
    return this.status(key);
  }

  /** A chat saved by another device is tracked here too, continuing from the repository's copy. */
  private async adoptRemote(key: ChatKey, p: { service: ServiceId; chatId: string; url: string; title: string }): Promise<void> {
    const missedAt = this.remoteMisses.get(key);
    if (this.adopting.has(key) || (missedAt !== undefined && this.now() - missedAt < REMOTE_MISS_TTL)) return;
    this.adopting.add(key);
    try {
      const { repo } = await this.deps.settings.get();
      if (!repo) return;
      const gh = await this.deps.github().catch(() => null);
      if (!gh) return;
      const found = await findRemoteChat(gh, repo, p.service, p.chatId, true);
      if (!found?.text) {
        this.remoteMisses.set(key, this.now());
        return;
      }
      const { front, messages } = parseChatFile(found.text);
      const adopted = await this.exclusive(async () => {
        if (await this.deps.db.getChat(key)) return false;
        const at = this.iso();
        await this.deps.db.putChat({
          key,
          service: p.service,
          chatId: p.chatId,
          url: p.url,
          title: p.title || front.title || '',
          tracked: true,
          path: found.path,
          pathConfirmed: true,
          remoteBlob: found.sha,
          createdAt: front.created || at,
          capturedAt: front.captured || at,
          messages,
          committed: refsOf(messages),
          updatedAt: this.now(),
        });
        return true;
      });
      if (adopted) await this.emitStatus(key);
    } catch (e) {
      log.debug('remote lookup failed', e);
    } finally {
      this.adopting.delete(key);
    }
  }

  /** Applies a capture of a tracked chat. Auto-commit only runs once the AI finished answering. */
  async snapshot(snap: ChatSnapshot, reason: SnapshotReason = 'answered'): Promise<ChatStatus> {
    const key = chatKey(snap.service, snap.chatId);
    const committed = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (!rec?.tracked) return false;
      const merged = mergeSnapshot(rec.messages, snap);
      if (!merged.ok) {
        this.chatErrors.set(key, merged.message);
        return false;
      }
      this.chatErrors.delete(key);
      rec.messages = merged.messages;
      rec.capturedAt = snap.capturedAt || this.iso();
      rec.title = snap.title || rec.title;
      rec.url = snap.url || rec.url;
      rec.updatedAt = this.now();
      await this.deps.db.putChat(rec);
      return reason === 'answered' && (await this.autoCommit(rec));
    });
    if (committed) this.afterCommit();
    return this.emitStatus(key);
  }

  async initStart(key: ChatKey): Promise<ChatStatus> {
    this.capturing.set(key, 0);
    this.chatErrors.delete(key);
    return this.emitStatus(key);
  }

  async initProgress(key: ChatKey, progress: number): Promise<null> {
    if (this.capturing.has(key)) {
      this.capturing.set(key, Math.min(1, Math.max(0, progress)));
      await this.emitStatus(key);
    }
    return null;
  }

  /** A complete capture: the chat becomes tracked and everything new is staged. */
  async initDone(snap: ChatSnapshot): Promise<ChatStatus> {
    const key = chatKey(snap.service, snap.chatId);
    const committed = await this.exclusive(async () => {
      const merged = mergeSnapshot([], { ...snap, complete: true });
      if (!merged.ok) {
        this.chatErrors.set(key, merged.message);
        return false;
      }
      const at = snap.capturedAt || this.iso();
      const rec: ChatRecord = (await this.deps.db.getChat(key)) ?? {
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
      rec.messages = merged.messages;
      rec.capturedAt = at;
      rec.url = snap.url || rec.url;
      rec.title = snap.title || rec.title;
      rec.updatedAt = this.now();
      if (!rec.path) await this.assignPath(rec);
      this.chatErrors.delete(key);
      await this.deps.db.putChat(rec);
      return this.autoCommit(rec);
    });
    this.capturing.delete(key);
    if (committed) this.afterCommit();
    return this.emitStatus(key);
  }

  async initCancel(key: ChatKey): Promise<ChatStatus> {
    this.capturing.delete(key);
    return this.emitStatus(key);
  }

  async untrack(key: ChatKey): Promise<ChatStatus> {
    await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      if (rec) {
        rec.tracked = false;
        rec.updatedAt = this.now();
        await this.deps.db.putChat(rec);
      }
    });
    this.capturing.delete(key);
    this.chatErrors.delete(key);
    return this.emitStatus(key);
  }

  /** New file name, or the file another device already created for this chat. */
  private async assignPath(rec: ChatRecord): Promise<void> {
    rec.path = chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
    rec.pathConfirmed = false;
    try {
      const { repo } = await this.deps.settings.get();
      if (!repo) return;
      const found = await findRemoteChat(await this.deps.github(), repo, rec.service, rec.chatId, false);
      if (found) {
        rec.path = found.path;
        rec.remoteBlob = found.sha;
      }
      rec.pathConfirmed = true;
    } catch (e) {
      // Offline or signed out: the path is confirmed when pushing.
      log.debug('path lookup failed', e);
    }
  }

  // ---- commits

  async commit(key: ChatKey): Promise<ChatStatus> {
    const c = await this.exclusive(async () => {
      const rec = await this.deps.db.getChat(key);
      return rec?.tracked ? this.commitLocked(rec) : null;
    });
    if (c) this.afterCommit();
    return this.emitStatus(key);
  }

  private async autoCommit(rec: ChatRecord): Promise<boolean> {
    const s = await this.deps.settings.get();
    return s.autoCommit && !!(await this.commitLocked(rec));
  }

  private async commitLocked(rec: ChatRecord): Promise<LocalCommit | null> {
    const staged = diffStaged(rec.messages, rec.committed);
    if (!staged.length) return null;
    rec.path ??= chatPath(rec.service, rec.title, rec.chatId, rec.createdAt);
    const commit: LocalCommit = {
      id: crypto.randomUUID(),
      key: rec.key,
      seq: await this.deps.db.nextSeq(),
      message: `${rec.service}: ${chatTitle(rec.title)} (+${staged.length})`,
      n: staged.length,
      createdAt: this.now(),
      doc: { service: rec.service, chatId: rec.chatId, url: rec.url, title: rec.title, createdAt: rec.createdAt, capturedAt: rec.capturedAt, messages: rec.messages },
      pushed: false,
    };
    await this.deps.db.putCommits([commit]);
    rec.committed = refsOf(rec.messages);
    rec.updatedAt = this.now();
    await this.deps.db.putChat(rec);
    return commit;
  }

  private afterCommit(): void {
    void this.emitSync();
    void this.deps.settings.get().then((s) => {
      if (s.autoPush) this.schedulePush();
    });
  }

  // ---- push

  /** Commits anything staged for `key`, then pushes every pending commit. */
  async push(key?: ChatKey): Promise<ChatStatus | null> {
    if (key) {
      const c = await this.exclusive(async () => {
        const rec = await this.deps.db.getChat(key);
        return rec?.tracked ? this.commitLocked(rec) : null;
      });
      if (c) void this.emitSync();
    }
    clearTimeout(this.pushTimer);
    await this.runPush();
    return key ? this.emitStatus(key) : null;
  }

  private runPush(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true;
      return this.pushing;
    }
    const run = (async () => {
      try {
        do {
          this.pushAgain = false;
          await this.pushOnce();
        } while (this.pushAgain);
      } finally {
        this.pushing = null;
        await this.emitAll();
      }
    })();
    this.pushing = run;
    return run;
  }

  private async pushOnce(): Promise<void> {
    const pending = (await this.deps.db.allCommits()).filter((c) => !c.pushed && !c.superseded).sort((a, b) => a.seq - b.seq);
    if (!pending.length) return;
    let outcome: PushOutcome;
    try {
      const { repo } = await this.deps.settings.get();
      if (!repo) throw new GitchatError('Choose a repository in the gitchat settings first.', 'no-repo');
      await this.emitAll();
      const gh = await this.deps.github();
      const run = () => pushCommits(gh, repo, pending, (k) => this.deps.db.getChat(k));
      outcome = await (this.deps.keepAlive ? this.deps.keepAlive(run) : run());
    } catch (e) {
      const err = toGitchatError(e);
      await this.setSyncMeta({ lastError: err.message });
      throw err;
    }
    await this.exclusive(async () => {
      for (const c of pending) {
        const sha = outcome.pushed.get(c.id);
        if (sha) {
          c.pushed = true;
          c.sha = sha;
          delete c.doc;
        } else if (outcome.superseded.has(c.id)) {
          c.superseded = true;
          delete c.doc;
        }
      }
      await this.deps.db.putCommits(pending);
      for (const [key, info] of outcome.chats) {
        const rec = await this.deps.db.getChat(key);
        if (!rec) continue;
        rec.path = info.path;
        rec.pathConfirmed = true;
        rec.remoteBlob = info.remoteBlob;
        rec.updatedAt = this.now();
        await this.deps.db.putChat(rec);
      }
      await this.prune();
    });
    await this.setSyncMeta({ lastPushAt: this.now() });
    this.retries = 0;
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
  }

  private async autoPush(): Promise<void> {
    try {
      await this.runPush();
    } catch (e) {
      const err = toGitchatError(e);
      if (!RETRYABLE.has(err.code)) return;
      this.retries++;
      const wait = err instanceof RateLimitError ? err.retryAfterMs : Math.min(30 * 60_000, 30_000 * 2 ** (this.retries - 1));
      this.deps.scheduleRetry?.(wait);
    }
  }

  /** Woken up after a failed automatic push. */
  async retry(): Promise<void> {
    if ((await this.deps.settings.get()).autoPush) await this.autoPush();
  }

  /** On start, after sign-in, etc.: push what is waiting when auto-push is on. */
  async resume(): Promise<void> {
    if ((await this.deps.settings.get()).autoPush && (await this.pendingCount()) > 0) this.schedulePush(1000);
  }

  // ---- settings

  async settingsChanged(prev: Settings, next: Settings): Promise<void> {
    const repoChanged = JSON.stringify(prev.repo) !== JSON.stringify(next.repo);
    if (repoChanged) {
      // Paths must be re-checked against the new repository.
      await this.exclusive(async () => {
        for (const rec of await this.deps.db.allChats()) {
          rec.pathConfirmed = false;
          delete rec.remoteBlob;
          await this.deps.db.putChat(rec);
        }
      });
      this.remoteMisses.clear();
      await this.clearError();
    }
    let committed = false;
    if (next.autoCommit && !prev.autoCommit) {
      committed = await this.exclusive(async () => {
        let any = false;
        for (const rec of await this.deps.db.allChats()) if (rec.tracked && (await this.commitLocked(rec))) any = true;
        return any;
      });
    }
    if (next.autoPush && (committed || !prev.autoPush) && (await this.pendingCount()) > 0) this.schedulePush();
    if (committed || repoChanged) await this.emitAll();
  }

  /** Forget the last push error (e.g. after signing in again). */
  async clearError(): Promise<void> {
    await this.setSyncMeta({});
  }

  // ---- status

  async status(key: ChatKey): Promise<ChatStatus> {
    const [rec, mine, all, settings, meta] = await Promise.all([
      this.deps.db.getChat(key),
      this.deps.db.commitsFor(key),
      this.deps.db.allCommits(),
      this.deps.settings.get(),
      this.deps.db.getMeta<SyncMeta>('sync'),
    ]);
    const { service, chatId } = rec ?? splitKey(key);
    const tracked = !!rec?.tracked;
    const commits = mine
      .filter((c) => !c.superseded)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, RECENT_COMMITS);
    const aheadHere = commits.some((c) => !c.pushed);
    const chatError = this.chatErrors.get(key);
    const pushError = aheadHere ? meta?.lastError : undefined;

    let phase: ChatPhase = 'idle';
    if (this.capturing.has(key)) phase = 'capturing';
    else if (this.pushing && aheadHere) phase = 'pushing';
    else if (chatError || pushError) phase = 'error';

    const status: ChatStatus = {
      key,
      service,
      chatId,
      tracked,
      staged: tracked && rec ? diffStaged(rec.messages, rec.committed) : [],
      commits: commits.map(toInfo),
      aheadTotal: all.filter((c) => !c.pushed && !c.superseded).length,
      phase,
    };
    if (rec?.path) status.path = rec.path;
    if (phase === 'capturing') status.progress = this.capturing.get(key) ?? 0;
    if (phase === 'error') status.error = chatError ?? pushError;
    if (rec?.path && settings.repo) {
      const { owner, name, branch } = settings.repo;
      status.webUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/blob/${encodePath(branch)}/${encodePath(rec.path)}`;
    }
    return status;
  }

  async syncStatus(): Promise<SyncStatus> {
    const [settings, meta] = await Promise.all([this.deps.settings.get(), this.deps.db.getMeta<SyncMeta>('sync')]);
    const out: SyncStatus = { repo: settings.repo, pending: await this.pendingCount() };
    if (meta?.lastPushAt) out.lastPushAt = meta.lastPushAt;
    if (meta?.lastError) out.lastError = meta.lastError;
    return out;
  }

  private async pendingCount(): Promise<number> {
    return (await this.deps.db.allCommits()).filter((c) => !c.pushed && !c.superseded).length;
  }

  private async setSyncMeta(patch: SyncMeta): Promise<void> {
    const cur = (await this.deps.db.getMeta<SyncMeta>('sync')) ?? {};
    const next: SyncMeta = { ...cur, ...patch };
    if (!('lastError' in patch)) delete next.lastError;
    await this.deps.db.setMeta('sync', next);
    await this.emitSync();
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
