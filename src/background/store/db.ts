// Tiny IndexedDB wrapper. Stores: "chats" (ChatRecord by key), "commits" (LocalCommit metadata by
// id, indexed by chat key), "docs" (the ChatDoc of an unpushed commit, by commit id) and "meta"
// (named values). Commit documents are kept apart so status queries never load whole chats.

import type { ChatKey } from '../../shared/types';
import type { ChatDoc, ChatRecord, LocalCommit } from '../model';

const VERSION = 3;
const STORES = ['chats', 'commits', 'docs', 'meta'] as const;

export interface Db {
  getChat(key: ChatKey): Promise<ChatRecord | undefined>;
  putChat(rec: ChatRecord): Promise<void>;
  allChats(): Promise<ChatRecord[]>;
  commitsFor(key: ChatKey): Promise<LocalCommit[]>;
  allCommits(): Promise<LocalCommit[]>;
  putCommits(commits: LocalCommit[]): Promise<void>;
  /** Deletes commits and their documents. */
  deleteCommits(ids: string[]): Promise<void>;
  getDocs(ids: string[]): Promise<Map<string, ChatDoc>>;
  putDocs(docs: Map<string, ChatDoc>): Promise<void>;
  deleteDocs(ids: string[]): Promise<void>;
  /**
   * Stores a new commit, its document and the chat's updated record in one transaction, numbering
   * the commit (`seq`) inside it, so a crash can never leave a commit without its chat update.
   */
  addCommit(commit: Omit<LocalCommit, 'seq'>, doc: ChatDoc, rec: ChatRecord): Promise<LocalCommit>;
  getMeta<T>(name: string): Promise<T | undefined>;
  setMeta(name: string, value: unknown): Promise<void>;
}

function result<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function openDb(name = 'gitchat'): Promise<Db> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = (e) => {
      const d = r.result;
      // Nothing was released before version 3: start over rather than migrate.
      if (e.oldVersion < 3) for (const s of [...d.objectStoreNames]) d.deleteObjectStore(s);
      if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('commits')) d.createObjectStore('commits', { keyPath: 'id' }).createIndex('key', 'key');
      if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  const read = <T>(store: (typeof STORES)[number], fn: (s: IDBObjectStore) => IDBRequest<T>) => result(fn(db.transaction(store, 'readonly').objectStore(store)));
  const write = (stores: (typeof STORES)[number][], fn: (tx: IDBTransaction) => void) => {
    const tx = db.transaction(stores, 'readwrite');
    fn(tx);
    return finished(tx);
  };

  return {
    getChat: (key) => read<ChatRecord | undefined>('chats', (s) => s.get(key)),
    putChat: (rec) => write(['chats'], (tx) => tx.objectStore('chats').put(rec)),
    allChats: () => read<ChatRecord[]>('chats', (s) => s.getAll()),
    commitsFor: (key) => read<LocalCommit[]>('commits', (s) => s.index('key').getAll(key)),
    allCommits: () => read<LocalCommit[]>('commits', (s) => s.getAll()),
    putCommits: (commits) => write(['commits'], (tx) => commits.forEach((c) => tx.objectStore('commits').put(c))),
    deleteCommits: (ids) =>
      write(['commits', 'docs'], (tx) =>
        ids.forEach((id) => {
          tx.objectStore('commits').delete(id);
          tx.objectStore('docs').delete(id);
        }),
      ),
    getDocs: async (ids) => {
      const tx = db.transaction('docs', 'readonly');
      const docs = await Promise.all(ids.map((id) => result<ChatDoc | undefined>(tx.objectStore('docs').get(id))));
      const out = new Map<string, ChatDoc>();
      ids.forEach((id, i) => {
        const d = docs[i];
        if (d) out.set(id, d);
      });
      return out;
    },
    putDocs: (docs) => write(['docs'], (tx) => docs.forEach((d, id) => tx.objectStore('docs').put(d, id))),
    deleteDocs: (ids) => write(['docs'], (tx) => ids.forEach((id) => tx.objectStore('docs').delete(id))),
    addCommit: async (commit, doc, rec) => {
      let stored!: LocalCommit;
      await write(['commits', 'docs', 'chats', 'meta'], (tx) => {
        const meta = tx.objectStore('meta');
        const r = meta.get('seq');
        r.onsuccess = () => {
          const seq = ((r.result as number | undefined) ?? 0) + 1;
          stored = { ...commit, seq };
          meta.put(seq, 'seq');
          tx.objectStore('commits').put(stored);
          tx.objectStore('docs').put(doc, stored.id);
          tx.objectStore('chats').put(rec);
        };
      });
      return stored;
    },
    getMeta: <T>(name: string) => read<T | undefined>('meta', (s) => s.get(name)),
    setMeta: (name, value) => write(['meta'], (tx) => tx.objectStore('meta').put(value, name)),
  };
}
