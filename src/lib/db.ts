import type { Cover, Song } from './types';

const DB_NAME = 'rong-loei';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('covers')) {
          const covers = db.createObjectStore('covers', { keyPath: 'id' });
          covers.createIndex('songId', 'songId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const listeners = new Set<() => void>();
function changed() {
  listeners.forEach((fn) => fn());
}

export function onSongsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** เติมฟิลด์ที่อาจไม่มีในข้อมูลเก่า */
function normalize(song: Song): Song {
  return {
    ...song,
    key: song.key ?? null,
    peaks: song.peaks ?? [],
    offset: song.offset ?? 0,
    stereo: song.stereo ?? null,
    audioName: song.audioName ?? '',
  };
}

export const songsDb = {
  async all(): Promise<Song[]> {
    const songs = await run<Song[]>('songs', 'readonly', (s) => s.getAll());
    return songs.map(normalize).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id: string): Promise<Song | undefined> {
    const song = await run<Song | undefined>('songs', 'readonly', (s) => s.get(id));
    return song ? normalize(song) : undefined;
  },
  async put(song: Song): Promise<void> {
    await run('songs', 'readwrite', (s) => s.put(song));
    changed();
  },
  async delete(id: string): Promise<void> {
    await run('songs', 'readwrite', (s) => s.delete(id));
    const covers = await coversDb.bySong(id);
    for (const c of covers) await coversDb.delete(c.id);
    changed();
  },
};

export const coversDb = {
  async bySong(songId: string): Promise<Cover[]> {
    const covers = await run<Cover[]>('covers', 'readonly', (s) => s.index('songId').getAll(songId));
    return covers.sort((a, b) => b.createdAt - a.createdAt);
  },
  put: (cover: Cover) => run('covers', 'readwrite', (s) => s.put(cover)),
  delete: (id: string) => run('covers', 'readwrite', (s) => s.delete(id)),
};

/** ขอให้เบราว์เซอร์ไม่ลบข้อมูลเพลงอัตโนมัติเมื่อพื้นที่เต็ม */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}
