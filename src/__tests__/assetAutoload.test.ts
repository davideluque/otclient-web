// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryAutoload, tryAutoloadFiles, type AutoloadOptions } from '../lib/assetAutoload';
import { getCached, putCached } from '../lib/assetCache';

const VALID_MANIFEST = {
  files: { dat: 'Tibia.dat', spr: 'Tibia.spr', otb: 'items.otb', otbm: 'world.otbm' },
};

function bufResponse(byte: number): Response {
  return new Response(new Uint8Array([byte]), { status: 200 });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}

function makeOptions() {
  const onStatus = vi.fn<AutoloadOptions['onStatus']>();
  const addFileToList = vi.fn<AutoloadOptions['addFileToList']>();
  const startApp = vi.fn<AutoloadOptions['startApp']>().mockResolvedValue(undefined);
  return { onStatus, addFileToList, startApp };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Fresh IDB per test so a cache hit in one case doesn't satisfy the next;
  // the was-cached markers live in localStorage and need the same isolation.
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, '', '/');
});

describe('tryAutoload', () => {
  it('returns false when manifest.json 404s — no startApp, no status churn', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(notFound()) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    expect(opts.onStatus).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns false when manifest fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('NetworkError')) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
  });

  it('returns false (with warning) when manifest JSON is malformed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' })) as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('reads filenames from manifest.json and calls startApp on full success', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      if (url.endsWith('Tibia.dat')) return Promise.resolve(bufResponse(1));
      if (url.endsWith('Tibia.spr')) return Promise.resolve(bufResponse(2));
      if (url.endsWith('items.otb')) return Promise.resolve(bufResponse(3));
      if (url.endsWith('world.otbm')) return Promise.resolve(bufResponse(4));
      throw new Error(`unexpected url ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(true);
    expect(opts.startApp).toHaveBeenCalledTimes(1);
    const [loaded] = opts.startApp.mock.calls[0];
    expect(loaded.dat).toBeInstanceOf(ArrayBuffer);
    expect(loaded.spr).toBeInstanceOf(ArrayBuffer);
    expect(loaded.otb).toBeInstanceOf(ArrayBuffer);
    expect(loaded.otbm).toBeInstanceOf(ArrayBuffer);
    expect(opts.addFileToList).toHaveBeenCalledTimes(4);
  });

  it('honours custom filenames from the manifest (not hardcoded)', async () => {
    const customManifest = {
      files: { dat: 'a.dat', spr: 'b.spr', otb: 'c.otb', otbm: 'd.otbm' },
    };
    const seenAssetUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(customManifest));
      seenAssetUrls.push(url);
      return Promise.resolve(bufResponse(0));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seenAssetUrls.some(u => u.endsWith('/a.dat'))).toBe(true);
    expect(seenAssetUrls.some(u => u.endsWith('/d.otbm'))).toBe(true);
  });

  it('fetches only a requested asset selection without consulting the full cache', async () => {
    await putCached('760', {
      dat: new Uint8Array([9]).buffer,
      spr: new Uint8Array([9]).buffer,
      otb: new Uint8Array([9]).buffer,
      otbm: new Uint8Array([9]).buffer,
    });
    const seenAssetUrls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      seenAssetUrls.push(url);
      return Promise.resolve(bufResponse(1));
    }) as typeof fetch;
    const startApp = vi.fn().mockResolvedValue(undefined);

    const ok = await tryAutoloadFiles(['dat', 'spr', 'otb'] as const, {
      onStatus: vi.fn(),
      addFileToList: vi.fn(),
      startApp,
    });

    expect(ok).toBe(true);
    expect(seenAssetUrls).toHaveLength(3);
    expect(seenAssetUrls.some(url => url.endsWith('world.otbm'))).toBe(false);
    expect(startApp.mock.calls[0][0]).not.toHaveProperty('otbm');
  });

  it('returns false on partial folder — listed file 404s after manifest succeeds', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      if (url.endsWith('items.otb')) return Promise.resolve(notFound());
      return Promise.resolve(bufResponse(1));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    // User set up a manifest but is missing a file — they want to know which
    // one. The final status call should be an isError=true message naming it.
    const lastCall = opts.onStatus.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain('items.otb');
    expect(lastCall?.[1]).toBe(true);
  });

  it('emits a Loading status as soon as the manifest is validated', async () => {
    let resolveDat: (r: Response) => void = () => {};
    const datPromise = new Promise<Response>(r => { resolveDat = r; });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      if (url.endsWith('Tibia.dat')) return datPromise;
      return Promise.resolve(bufResponse(0));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const run = tryAutoload(opts);
    // Wait for the manifest-validated status to fire, before the .dat
    // fetch ever resolves. vi.waitFor handles the IDB + fetch microtask
    // chain without coupling the test to its exact length.
    await vi.waitFor(() => {
      expect(opts.onStatus).toHaveBeenCalled();
    });
    expect(opts.onStatus.mock.calls[0][0]).toMatch(/loading/i);

    resolveDat(bufResponse(1));
    await run;
  });

  it('reports an error status when fetch rejects after manifest succeeds', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      // All asset fetches throw — simulates network failure, CORS, abort.
      return Promise.reject(new TypeError('NetworkError'));
    });
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(false);
    expect(opts.startApp).not.toHaveBeenCalled();
    const lastCall = opts.onStatus.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(true);
    expect(lastCall?.[0]).toMatch(/could not load/i);
  });

  it('targets the version folder from ?version=<v>', async () => {
    window.history.replaceState({}, '', '/?version=810');
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      seen.push(url);
      return Promise.resolve(notFound());
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seen[0]).toBe(`${import.meta.env.BASE_URL}assets/810/manifest.json`);
  });

  it('prefixes URLs with import.meta.env.BASE_URL for subpath deploys', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      seen.push(url);
      return Promise.resolve(notFound());
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await tryAutoload(makeOptions());

    expect(seen[0].startsWith(import.meta.env.BASE_URL)).toBe(true);
  });

  it('skips the network when the cache has a bundle for this version', async () => {
    await putCached('760', {
      dat: new Uint8Array([9]).buffer,
      spr: new Uint8Array([9]).buffer,
      otb: new Uint8Array([9]).buffer,
      otbm: new Uint8Array([9]).buffer,
    });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const opts = makeOptions();

    const ok = await tryAutoload(opts);

    expect(ok).toBe(true);
    expect(opts.startApp).toHaveBeenCalledTimes(1);
    // fromCache=true so the boot path doesn't re-write the bundle it just read.
    expect(opts.startApp.mock.calls[0][1]).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(opts.onStatus.mock.calls[0][0]).toMatch(/cached/i);
  });

  it('clears a bad cached bundle and falls back to the network when boot throws', async () => {
    await putCached('760', {
      dat: new Uint8Array([9]).buffer,
      spr: new Uint8Array([9]).buffer,
      otb: new Uint8Array([9]).buffer,
      otbm: new Uint8Array([9]).buffer,
    });
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('manifest.json')) return Promise.resolve(jsonResponse(VALID_MANIFEST));
      return Promise.resolve(bufResponse(1));
    }) as typeof fetch;
    const opts = makeOptions();
    opts.startApp
      .mockRejectedValueOnce(new Error('corrupt cached assets'))
      .mockResolvedValueOnce(undefined);

    const ok = await tryAutoload(opts);

    expect(ok).toBe(true);
    expect(opts.startApp).toHaveBeenCalledTimes(2);
    // First attempt was the cache, second the freshly fetched bundle.
    expect(opts.startApp.mock.calls[0][1]).toBe(true);
    expect(opts.startApp.mock.calls[1][1]).not.toBe(true);
    // The bad bundle must be gone so the next launch doesn't loop on it.
    expect(await getCached('760')).toBeNull();
  });

  it('fires the evicted notice once when a previously cached bundle is gone', async () => {
    await putCached('760', {
      dat: new Uint8Array([9]).buffer,
      spr: new Uint8Array([9]).buffer,
      otb: new Uint8Array([9]).buffer,
      otbm: new Uint8Array([9]).buffer,
    });
    // Simulate browser eviction: empty IDB, surviving localStorage marker.
    globalThis.indexedDB = new IDBFactory();
    globalThis.fetch = vi.fn().mockResolvedValue(notFound()) as typeof fetch;
    const onCacheNotice = vi.fn();

    await tryAutoload({ ...makeOptions(), onCacheNotice });
    expect(onCacheNotice).toHaveBeenCalledExactlyOnceWith('evicted');

    // Second launch: the notice was consumed, no repeat nagging.
    await tryAutoload({ ...makeOptions(), onCacheNotice });
    expect(onCacheNotice).toHaveBeenCalledTimes(1);
  });

  it('fires the unavailable notice when the browser has no IndexedDB', async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB;
    globalThis.fetch = vi.fn().mockResolvedValue(notFound()) as typeof fetch;
    const onCacheNotice = vi.fn();

    await tryAutoload({ ...makeOptions(), onCacheNotice });

    expect(onCacheNotice).toHaveBeenCalledExactlyOnceWith('unavailable');
  });
});
