// @vitest-environment happy-dom

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCached, getCached, putCached } from '../lib/assetCache';
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
  // Fresh IDB per test so version keys don't leak across cases.
  globalThis.indexedDB = new IDBFactory();
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
});
