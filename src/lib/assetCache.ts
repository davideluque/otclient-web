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
// take down boot. Do not "fix" that by letting these throw — see #109.
//
// Storage caveats this module deals with (mobile-first reality check):
// - QuotaExceededError: a full bundle is ~100MB; phones low on space will
//   reject the write. Surfaced as { ok: false, reason: 'quota' } so the UI
//   can tell the user, while the app keeps running off the live buffers.
// - Eviction: without navigator.storage.persist() the browser may drop the
//   whole DB under disk pressure. A small localStorage marker remembers
//   that we *did* cache once, so a later miss can be reported as "your
//   saved assets were cleared" instead of silently re-downloading.
// - No IndexedDB at all (old WebViews, some private modes): reported as
//   reason 'unavailable' / notice 'unavailable'.

import type { CompleteLoadedFiles } from './fileLoader';

const DB_NAME = 'otclient-web-assets';
const STORE = 'versions';
const DB_VERSION = 1;

// localStorage marker: "a bundle for <version> was cached at some point".
// Deliberately not in IDB itself — it has to survive the IDB being evicted.
const MARKER_PREFIX = 'otclient-web-assets-cached:';

export type CachePutResult =
  | { ok: true; firstWrite: boolean }
  | { ok: false; reason: 'quota' | 'unavailable' | 'unknown' };

/** False when this browser/mode has no IndexedDB to begin with. */
export function cacheAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.code === 22);
}

function isUnavailableError(e: unknown): boolean {
  // Open being refused outright (restrictive private modes, enterprise
  // profiles) — distinct from a healthy DB rejecting one write.
  return e instanceof DOMException &&
    (e.name === 'SecurityError' || e.name === 'InvalidStateError');
}

function wasCachePopulated(version: string): boolean {
  try {
    return localStorage.getItem(MARKER_PREFIX + version) === '1';
  } catch {
    return false;
  }
}

function setCachePopulated(version: string, populated: boolean): void {
  try {
    if (populated) localStorage.setItem(MARKER_PREFIX + version, '1');
    else localStorage.removeItem(MARKER_PREFIX + version);
  } catch {
    // localStorage unavailable — eviction detection degrades gracefully.
  }
}

/**
 * True exactly once after the browser evicted a previously-cached bundle:
 * call it when getCached came back empty to decide whether to tell the
 * user their saved assets were cleared. Consumes the marker so the notice
 * doesn't repeat on every launch.
 */
export function consumeEvictionNotice(version: string): boolean {
  if (!wasCachePopulated(version)) return false;
  setCachePopulated(version, false);
  return true;
}

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
  if (!cacheAvailable()) return null;
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
 * Stashes the buffers under `version`. Never throws — failures come back
 * as a classified result so the caller can surface the actionable ones
 * (quota, no-IDB) to the user instead of only console-logging them.
 */
export async function putCached(version: string, files: CompleteLoadedFiles): Promise<CachePutResult> {
  if (!cacheAvailable()) return { ok: false, reason: 'unavailable' };
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
    const firstWrite = !wasCachePopulated(version);
    setCachePopulated(version, true);
    return { ok: true, firstWrite };
  } catch (e) {
    console.warn('assetCache.putCached failed:', e);
    if (isQuotaError(e)) return { ok: false, reason: 'quota' };
    if (isUnavailableError(e)) return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'unknown' };
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
    // The bundle is intentionally gone — a future miss is not an eviction.
    setCachePopulated(version, false);
  } catch (e) {
    console.warn('assetCache.clearCached failed:', e);
  }
}
