// IndexedDB cache for the four asset buffers, keyed by client version.
//
// After any successful boot (HTTP autoload or manual upload), the boot
// path stashes the buffers here; on the next launch the autoloader checks
// this cache first and skips both the network probe and the upload UI.
// This is what makes the app work as an installed PWA — first run needs
// network/upload, every subsequent run starts instantly, offline-capable.
//
// All API surface is best-effort: write/read failures are logged and the
// app degrades to the live HTTP/upload paths. Never let a cache problem
// take down boot.

import type { CompleteLoadedFiles } from './fileLoader';

const DB_NAME = 'otclient-web-assets';
const STORE = 'versions';
const DB_VERSION = 1;

interface CachedRecord {
  files: CompleteLoadedFiles;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns the cached buffers for `version` or null if absent / on error.
 * Never throws — callers can treat null as "fall through to the live path".
 */
export async function getCached(version: string): Promise<CompleteLoadedFiles | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const record = await promisifyRequest(tx.objectStore(STORE).get(version) as IDBRequest<CachedRecord | undefined>);
      return record ? record.files : null;
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('assetCache.getCached failed:', e);
    return null;
  }
}

/**
 * Stashes the buffers under `version`. Fire-and-forget from the caller's
 * perspective — never throws.
 */
export async function putCached(version: string, files: CompleteLoadedFiles): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const record: CachedRecord = { files, cachedAt: Date.now() };
      await promisifyRequest(tx.objectStore(STORE).put(record, version));
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('assetCache.putCached failed:', e);
  }
}

/** Removes a single version's cached bundle. */
export async function clearCached(version: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await promisifyRequest(tx.objectStore(STORE).delete(version));
      // Wait for the transaction itself — the corruption-recovery path
      // depends on the record actually being gone before the next boot.
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn('assetCache.clearCached failed:', e);
  }
}
