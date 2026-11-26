import { describe, expect, it, vi } from 'vitest';
import { createAssetPipeline, type AssetPipelineDeps } from '../lib/jamera/assetPipeline';
import type { SpriteAtlas } from '../lib/spriteAtlas';

const FILES = { dat: new ArrayBuffer(4), spr: new ArrayBuffer(4), otb: new ArrayBuffer(4) };
const ATLAS = {
  atlasTextures: { pages: new Map() },
  layout: new Map(),
} as unknown as SpriteAtlas;
const WIRE_DATA = {
  floorChangeIds: new Set([1]),
  useableIds: new Set([2]),
  moveableIds: new Set([3]),
};

/**
 * Deps where `autoload` resolves after delivering the files to startApp,
 * mirroring tryAutoloadFiles. Overridable per test.
 */
function makeDeps(overrides: Partial<AssetPipelineDeps> = {}): AssetPipelineDeps {
  return {
    autoload: async (_keys, callbacks) => {
      await callbacks.startApp(FILES);
      return true;
    },
    prepareWireData: () => WIRE_DATA,
    buildAtlas: () => ATLAS,
    ...overrides,
  };
}

/** Let the fire-and-forget load attempt fully settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('createAssetPipeline', () => {
  it('loads once: ready resolves, atlas and OTB id sets are exposed', async () => {
    const deps = makeDeps();
    const spy = vi.spyOn(deps, 'autoload');
    const pipeline = createAssetPipeline(deps);
    expect(pipeline.atlas).toBeNull();

    pipeline.load();
    await expect(pipeline.ready()).resolves.toBeUndefined();
    await settle();
    expect(pipeline.atlas).toBe(ATLAS);
    expect(pipeline.floorChangeIds).toBe(WIRE_DATA.floorChangeIds);
    expect(pipeline.useableIds).toBe(WIRE_DATA.useableIds);
    expect(pipeline.moveableIds).toBe(WIRE_DATA.moveableIds);

    // Loaded: further load() calls are no-ops.
    pipeline.load();
    pipeline.load();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ignores load() re-entry while an attempt is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const deps = makeDeps({
      autoload: async (_keys, callbacks) => {
        await gate;
        await callbacks.startApp(FILES);
        return true;
      },
    });
    const spy = vi.spyOn(deps, 'autoload');
    const pipeline = createAssetPipeline(deps);

    pipeline.load();
    pipeline.load();
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    await pipeline.ready();
  });

  it('fires a queued atlas waiter once the atlas is built', async () => {
    const pipeline = createAssetPipeline(makeDeps());
    const waiter = vi.fn();
    pipeline.onAtlasReady(waiter);
    pipeline.load();
    await pipeline.ready();
    await settle();
    expect(waiter).toHaveBeenCalledExactlyOnceWith(ATLAS);
  });

  it('invokes a waiter registered after the atlas is cached immediately', async () => {
    const pipeline = createAssetPipeline(makeDeps());
    pipeline.load();
    await pipeline.ready();
    await settle();
    const waiter = vi.fn();
    pipeline.onAtlasReady(waiter);
    expect(waiter).toHaveBeenCalledExactlyOnceWith(ATLAS);
  });

  it('a null waiter cancels the queued one (re-login supersedes it)', async () => {
    const pipeline = createAssetPipeline(makeDeps());
    const stale = vi.fn();
    pipeline.onAtlasReady(stale);
    pipeline.onAtlasReady(null);
    pipeline.load();
    await pipeline.ready();
    await settle();
    expect(stale).not.toHaveBeenCalled();
  });

  it('consumes the waiter exactly once', async () => {
    const pipeline = createAssetPipeline(makeDeps());
    const waiter = vi.fn();
    pipeline.onAtlasReady(waiter);
    pipeline.load();
    await pipeline.ready();
    await settle();
    expect(waiter).toHaveBeenCalledTimes(1);
  });

  it('a failed attempt rejects ready() and re-arms a fresh gate for the retry', async () => {
    let attempts = 0;
    const deps = makeDeps({
      autoload: async (_keys, callbacks) => {
        attempts++;
        if (attempts === 1) throw new Error('fetch failed');
        await callbacks.startApp(FILES);
        return true;
      },
    });
    const pipeline = createAssetPipeline(deps);

    const firstGate = pipeline.ready();
    pipeline.load();
    await expect(firstGate).rejects.toThrow(/failed to load/);
    await settle();

    // The character-select gate calls load() again on retry.
    pipeline.load();
    await expect(pipeline.ready()).resolves.toBeUndefined();
    await settle();
    expect(attempts).toBe(2);
    expect(pipeline.atlas).toBe(ATLAS);
  });

  it('an atlas build failure still resolves ready() but allows a retry to rebuild', async () => {
    let buildCalls = 0;
    const deps = makeDeps({
      buildAtlas: () => {
        buildCalls++;
        if (buildCalls === 1) throw new Error('corrupt spr');
        return ATLAS;
      },
    });
    const pipeline = createAssetPipeline(deps);
    const waiter = vi.fn();
    pipeline.onAtlasReady(waiter);

    pipeline.load();
    // Wire flags landed, so the game can proceed — the gate resolves.
    await expect(pipeline.ready()).resolves.toBeUndefined();
    await settle();
    expect(pipeline.atlas).toBeNull();
    expect(waiter).not.toHaveBeenCalled();

    // Not marked loaded: the next in_game transition retries the build.
    pipeline.load();
    await settle();
    expect(buildCalls).toBe(2);
    expect(pipeline.atlas).toBe(ATLAS);
    expect(waiter).toHaveBeenCalledExactlyOnceWith(ATLAS);
  });
});
