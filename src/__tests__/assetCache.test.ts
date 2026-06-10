// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCached, consumeEvictionNotice, getCached, putCached } from '../lib/assetCache';
import type { CompleteLoadedFiles } from '../lib/fileLoader';

function makeBundle(seed: number): CompleteLoadedFiles {
  return {
    dat: new Uint8Array([seed, 1]).buffer,
    spr: new Uint8Array([seed, 2]).buffer,
    otb: new Uint8Array([seed, 3]).buffer,
    otbm: new Uint8Array([seed, 4]).buffer,
  };
}

beforeEach(() => {
  // Fresh IDB per test so version keys don't leak across cases; the
  // was-cached markers live in localStorage and need the same isolation.
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(async () => {
  await clearCached('760');
  await clearCached('810');
});

describe('assetCache', () => {
  it('returns null when nothing is cached for the version', async () => {
    expect(await getCached('760')).toBeNull();
  });

  it('roundtrips a bundle through put + get', async () => {
    const bundle = makeBundle(7);
    await putCached('760', bundle);

    const got = await getCached('760');
    expect(got).not.toBeNull();
    expect(new Uint8Array(got!.dat)).toEqual(new Uint8Array(bundle.dat));
    expect(new Uint8Array(got!.spr)).toEqual(new Uint8Array(bundle.spr));
    expect(new Uint8Array(got!.otb)).toEqual(new Uint8Array(bundle.otb));
    expect(new Uint8Array(got!.otbm)).toEqual(new Uint8Array(bundle.otbm));
  });

  it('keeps versions isolated', async () => {
    await putCached('760', makeBundle(7));
    await putCached('810', makeBundle(8));

    const v760 = await getCached('760');
    const v810 = await getCached('810');

    expect(new Uint8Array(v760!.dat)[0]).toBe(7);
    expect(new Uint8Array(v810!.dat)[0]).toBe(8);
  });

  it('overwrites a previous bundle on re-put', async () => {
    await putCached('760', makeBundle(1));
    await putCached('760', makeBundle(2));

    const got = await getCached('760');
    expect(new Uint8Array(got!.dat)[0]).toBe(2);
  });

  it('clearCached removes the version', async () => {
    await putCached('760', makeBundle(7));
    expect(await getCached('760')).not.toBeNull();

    await clearCached('760');
    expect(await getCached('760')).toBeNull();
  });

  it('reports ok with firstWrite only on the first successful put', async () => {
    expect(await putCached('760', makeBundle(1))).toEqual({ ok: true, firstWrite: true });
    expect(await putCached('760', makeBundle(2))).toEqual({ ok: true, firstWrite: false });
  });

  it('classifies QuotaExceededError as a quota failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(await putCached('760', makeBundle(1))).toEqual({ ok: false, reason: 'quota' });
    // A failed write must not arm the eviction notice.
    expect(consumeEvictionNotice('760')).toBe(false);

    put.mockRestore();
    warn.mockRestore();
  });

  it('reports unavailable when there is no IndexedDB at all', async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    delete globalThis.indexedDB;

    expect(await putCached('760', makeBundle(1))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await getCached('760')).toBeNull();
  });

  it('detects eviction: cached before, gone now, notice fires exactly once', async () => {
    await putCached('760', makeBundle(7));
    // The browser silently dropping the DB under disk pressure looks like
    // a brand-new empty IDB while the localStorage marker survives.
    globalThis.indexedDB = new IDBFactory();
    expect(await getCached('760')).toBeNull();

    expect(consumeEvictionNotice('760')).toBe(true);
    expect(consumeEvictionNotice('760')).toBe(false);
  });

  it('does not arm the eviction notice for an intentional clearCached', async () => {
    await putCached('760', makeBundle(7));
    await clearCached('760');

    expect(consumeEvictionNotice('760')).toBe(false);
  });
});
