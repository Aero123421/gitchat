// Tiny IndexedDB wrapper. Stores: "chats" (ChatRecord by key), "commits" (LocalCommit by id,
// indexed by chat key) and "meta" (named values).

import type { ChatKey } from '../../shared/types';
import type { ChatRecord, LocalCommit } from '../model';

const VERSION = 1;

export interface Db {
  getChat(key: ChatKey): Promise<ChatRecord | undefined>;
  putChat(rec: ChatRecord): Promise<void>;
  allChats(): Promise<ChatRecord[]>;
  commitsFor(key: ChatKey): Promise<LocalCommit[]>;
  allCommits(): Promise<LocalCommit[]>;
  putCommits(commits: LocalCommit[]): Promise<void>;
  deleteCommits(ids: string[]): Promise<void>;
  getMeta<T>(name: string): Promise<T | undefined>;
  setMeta(name: string, value: unknown): Promise<void>;
  /** Next value of a global counter (ordering of commits). */
  nextSeq(): Promise<number>;
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
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('chats')) d.createObjectStore('chats', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('commits')) d.createObjectStore('commits', { keyPath: 'id' }).createIndex('key', 'key');
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  const read = <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>) => result(fn(db.transaction(store, 'readonly').objectStore(store)));
  const write = (store: string, fn: (s: IDBObjectStore) => void) => {
    const tx = db.transaction(store, 'readwrite');
    fn(tx.objectStore(store));
    return finished(tx);
  };

  return {
    getChat: (key) => read<ChatRecord | undefined>('chats', (s) => s.get(key)),
    putChat: (rec) => write('chats', (s) => s.put(rec)),
    allChats: () => read<ChatRecord[]>('chats', (s) => s.getAll()),
    commitsFor: (key) => read<LocalCommit[]>('commits', (s) => s.index('key').getAll(key)),
    allCommits: () => read<LocalCommit[]>('commits', (s) => s.getAll()),
    putCommits: (commits) => write('commits', (s) => commits.forEach((c) => s.put(c))),
    deleteCommits: (ids) => write('commits', (s) => ids.forEach((id) => s.delete(id))),
    getMeta: <T>(name: string) => read<T | undefined>('meta', (s) => s.get(name)),
    setMeta: (name, value) => write('meta', (s) => s.put(value, name)),
    nextSeq: async () => {
      let next = 1;
      await write('meta', (s) => {
        const r = s.get('seq');
        r.onsuccess = () => {
          next = ((r.result as number | undefined) ?? 0) + 1;
          s.put(next, 'seq');
        };
      });
      return next;
    },
  };
}
