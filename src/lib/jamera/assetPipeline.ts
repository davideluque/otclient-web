import { tryAutoloadFiles } from '../assetAutoload';
import type { CompleteLoadedFiles } from '../fileLoader';
import { buildSpriteAtlas, type SpriteAtlas } from '../spriteAtlas';
import { setItemWireFlags } from '../net/common/itemFlags';
import { parseDat } from '../dat';
import { parseOtb, floorChangeClientIds, moveableClientIds, useableClientIds } from '../otb';
import { telemetry } from './telemetry';

/**
 * Background-loads the renderer's required assets (.dat / .spr / .otb)
 * and owns everything derived from them: the wire item flags, the OTB
 * client-id sets, and the page-lifetime sprite atlas cache. Uses
 * `tryAutoloadFiles` so the Jamera flow shares the offline demo's
 * source-of-truth resolution (`?version=…` + `public/assets/<version>/`)
 * without downloading the unused full-map .otbm file.
 *
 * No fallback drag-drop UI here — if auto-load fails we just log it and
 * let the caller decide what to surface.
 */

export type JameraLoadedFiles = Pick<CompleteLoadedFiles, 'dat' | 'spr' | 'otb'>;
const JAMERA_FILE_KEYS = ['dat', 'spr', 'otb'] as const;

/** OTB-derived client-id knowledge the interaction layer needs. */
export interface WireData {
  /** Ids that floor-change (stairs, ramps, holes) — NotWalkable in .dat. */
  floorChangeIds: Set<number>;
  /** Ids a tap handles as UseItem: containers, doors, ladders, levers, grates. */
  useableIds: Set<number>;
  /** Ids safe to address through ThrowItem when a world drag completes. */
  moveableIds: Set<number>;
}

export interface AssetPipelineDeps {
  autoload: typeof tryAutoloadFiles<typeof JAMERA_FILE_KEYS[number]>;
  /**
   * Parse the wire-format knowledge out of the raw files and apply the
   * item wire flags. Must run before the first map packet parses —
   * stackables misalign the stream otherwise. Cheap (one .dat parse)
   * and safe to repeat on retries.
   */
  prepareWireData: (loaded: JameraLoadedFiles) => WireData;
  buildAtlas: (dat: ArrayBuffer, spr: ArrayBuffer) => SpriteAtlas;
}

export interface AssetPipeline {
  /** Kick a load attempt; no-op while one is in flight or after success. */
  load(): void;
  /**
   * The current readiness gate: resolves once the wire flags exist (the
   * .dat parsed), rejects when an attempt fails — and is then replaced
   * by a fresh pending gate so a retry can wait on the new attempt
   * instead of inheriting the old rejection.
   */
  ready(): Promise<void>;
  /** Page-lifetime atlas cache — null until built (or after a failed build). */
  readonly atlas: SpriteAtlas | null;
  readonly floorChangeIds: Set<number> | null;
  readonly useableIds: Set<number> | null;
  readonly moveableIds: Set<number> | null;
  /**
   * One-shot waiter for the atlas: fires immediately when the atlas is
   * already cached, otherwise queues until the build finishes. A single
   * slot — registering replaces the previous waiter, and null cancels
   * it (a re-login supersedes the dead session's mount).
   */
  onAtlasReady(waiter: ((atlas: SpriteAtlas) => void) | null): void;
}

function defaultPrepareWireData(loaded: JameraLoadedFiles): WireData {
  setItemWireFlags(parseDat(loaded.dat));
  const parsedOtb = parseOtb(loaded.otb);
  return {
    floorChangeIds: floorChangeClientIds(parsedOtb),
    useableIds: useableClientIds(parsedOtb),
    moveableIds: moveableClientIds(parsedOtb),
  };
}

export function createAssetPipeline(deps?: Partial<AssetPipelineDeps>): AssetPipeline {
  const autoload = deps?.autoload ?? tryAutoloadFiles;
  const prepareWireData = deps?.prepareWireData ?? defaultPrepareWireData;
  const buildAtlas = deps?.buildAtlas ?? buildSpriteAtlas;

  let loading = false;
  let loaded = false;
  let atlas: SpriteAtlas | null = null;
  let wireData: WireData | null = null;
  let atlasWaiter: ((atlas: SpriteAtlas) => void) | null = null;

  // Resolved once the wire flags exist; replaced with a fresh pending
  // promise when a load attempt fails so a retry can gate on the new
  // attempt instead of inheriting the old rejection.
  let readyResolve: (() => void) | null = null;
  let readyReject: ((err: Error) => void) | null = null;
  const armGate = (): Promise<void> => {
    const gate = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    // Rejections are consumed on demand via ready() — don't let an
    // unobserved failure trip the global unhandled-rejection handler.
    gate.catch(() => { /* observed lazily */ });
    return gate;
  };
  let gate = armGate();

  async function attempt(): Promise<void> {
    const loadStartedAt = performance.now();
    await autoload(JAMERA_FILE_KEYS, {
      onStatus: (msg, isError) => {
        if (isError) console.warn('[jamera-assets]', msg);
        else console.info('[jamera-assets]', msg);
      },
      addFileToList: (name) => console.info('[jamera-assets] loaded', name),
      startApp: async (files: JameraLoadedFiles) => {
        const bytes = files.dat.byteLength + files.spr.byteLength + files.otb.byteLength;
        telemetry('assets-loaded', {
          ms: Math.round(performance.now() - loadStartedAt),
          bytes,
          files: JAMERA_FILE_KEYS.length,
        });
        console.info('[jamera] assets ready (dat/spr/otb)');
        wireData = prepareWireData(files);
        readyResolve?.();
        try {
          const atlasStartedAt = performance.now();
          atlas = buildAtlas(files.dat, files.spr);
          telemetry('atlas-ready', { ms: Math.round(performance.now() - atlasStartedAt) });
          // Only flip `loaded` once the atlas exists — otherwise a build
          // failure here would permanently short-circuit the guard in
          // load(), and a re-login could never retry.
          loaded = true;
          console.info(
            `[jamera] atlas cache ready (${atlas.atlasTextures.pages.size} page(s), ${atlas.layout.size} sprites)`,
          );
          // Consumed exactly once — re-logins re-register from scratch.
          const pending = atlasWaiter;
          atlasWaiter = null;
          pending?.(atlas);
        } catch (err) {
          // Leave `loaded` false so the next in_game transition gets
          // another shot. Still expose `jameraAssets` below — the raw
          // buffers are useful for diagnosing the failure in DevTools.
          // `instanceof Error` because JS allows throwing anything; the
          // cast-and-`.message` form crashes if a non-Error is thrown.
          console.warn('[jamera] atlas build failed:', err instanceof Error ? err.message : err);
        }
        if (import.meta.env.DEV && typeof window !== 'undefined') {
          // Dev-only DevTools hooks for poking at the parsed assets +
          // atlas. Not exposed in prod for the same reason as
          // window.jameraClient.
          (window as unknown as { jameraAssets: JameraLoadedFiles }).jameraAssets = files;
          if (atlas) {
            (window as unknown as { jameraAtlas: SpriteAtlas }).jameraAtlas = atlas;
          }
        }
      },
    })
      .catch((err) => {
        console.warn('[jamera] asset auto-load failed:', err instanceof Error ? err.message : err);
      })
      .finally(() => {
        loading = false;
      });

    if (!loaded) {
      // The attempt failed (missing manifest, fetch error, atlas build
      // failure): reject the gate so character-select surfaces an error,
      // then re-arm a fresh promise for the retry the next gate call kicks.
      readyReject?.(new Error('Game assets failed to load — check public/assets/<version>/ and retry.'));
      gate = armGate();
    }
  }

  return {
    load: () => {
      if (loaded || loading) return;
      loading = true;
      void attempt();
    },
    ready: () => gate,
    get atlas() { return atlas; },
    get floorChangeIds() { return wireData?.floorChangeIds ?? null; },
    get useableIds() { return wireData?.useableIds ?? null; },
    get moveableIds() { return wireData?.moveableIds ?? null; },
    onAtlasReady: (waiter) => {
      if (waiter && atlas) {
        waiter(atlas);
        return;
      }
      atlasWaiter = waiter;
    },
  };
}
