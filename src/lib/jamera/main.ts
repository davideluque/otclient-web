import { mountLoginScreen } from './loginScreen';
import type { GameClient } from '../net/common/GameClient';
import { OutputPacket } from '../net/common/OutputPacket';
import { ClientOp } from '../net/7.6/opcodes';
import { tryAutoload } from '../assetAutoload';
import type { CompleteLoadedFiles } from '../fileLoader';
import { GameWorld } from '../GameWorld';
import { buildSpriteAtlas, type SpriteAtlas } from '../spriteAtlas';
import { bindRenderer } from './renderer';
import { registerWireSkips } from '../net/7.6/wireSkips';
import { createWalkController } from './walkController';
import { bindChat, type ChatBindingHandle } from './chatBinding';
import { bindStats, type StatsBindingHandle } from './statsBinding';
import { createJoystick } from '../joystick';
import { createKeyboard } from '../keyboard';
import type { Direction } from '../player';
import { setItemWireFlags } from '../net/common/itemFlags';
import { parseDat } from '../dat';
import { Application } from 'pixi.js';
import { resolveProxyOverride } from './proxyUrl';

const root = document.getElementById('jamera-root');
if (!root) {
  throw new Error('jamera.html missing #jamera-root container');
}

const params = new URLSearchParams(window.location.search);
const proxyUrl = resolveProxyOverride(params.get('proxy'));
const clientVersion = parseClientVersion(params.get('clientVersion'));

mountLoginScreen(root, {
  proxyUrl,
  clientVersion,
  // Gate game entry on the asset bundle: the first map packet lands
  // milliseconds after game login and needs the .dat-derived wire flags.
  // Calling loadAssetsForRendering here also makes the gate self-retrying
  // after a failed attempt.
  waitForReady: () => {
    loadAssetsForRendering();
    return assetsReady;
  },
  onEnterGame: (client) => {
    // Phase 2 scaffold stops at "in game" — follow-up PRs attach the
    // live-map renderer, chat UI, and movement input. Surface the live
    // client on `window` only in dev builds, never in production: the
    // GameClient instance retains the player's password (private field,
    // but readable from any code that gets the reference) so exposing
    // it on `window` would be a credential leak.
    if (import.meta.env.DEV) {
      (window as unknown as { jameraClient: typeof client }).jameraClient = client;
      console.info('[jamera] in_game — client attached to window.jameraClient (dev only)');
    } else {
      console.info('[jamera] in_game — client attached locally (suppressed from window in prod)');
    }
    // Baseline consumers for the full 7.6 wire vocabulary — without
    // these, the first unhandled opcode in a frame silently drops the
    // rest of it. GameWorld registers after and overrides per opcode.
    registerWireSkips(client.getDispatcher(), client.getProtocol());
    startPingLoop(client);
    loadAssetsForRendering();
    const world = bindGameWorld(client);
    bindMovementInput(client, world);
    teardownChat?.destroy();
    teardownChat = bindChat(client);
    teardownStats?.destroy();
    teardownStats = bindStats(client);
    ensurePixiApp().catch((err) => {
      console.warn('[jamera] PIXI bootstrap failed:', err);
    });
    void mountRenderer(world);
  },
});

/**
 * Lazy-init a PIXI Application on the first in_game transition and
 * append its canvas to the document body. **No scene graph yet** — the
 * renderer that draws tiles + creatures from GameWorld is a follow-up
 * PR. This PR just gets the WebGL/WebGPU context up so subsequent PRs
 * have somewhere to paint.
 *
 * Page-lifetime singleton (unlike GameWorld, which is per-session): the
 * GPU context is expensive to spin up and there's no reason to tear it
 * down between login attempts on the same tab.
 *
 * Cache the in-flight Promise (not just the resolved Application) so
 * concurrent callers — e.g. a fast disconnect + re-login that fires
 * `onEnterGame` again before the first WebGPU init resolves — share a
 * single bootstrap and we don't end up with two canvases stacked in
 * the DOM. If init throws we clear the promise so the next caller can
 * retry instead of permanently inheriting the failure.
 */
let pixiPromise: Promise<Application> | null = null;

function ensurePixiApp(): Promise<Application> {
  if (pixiPromise) return pixiPromise;
  pixiPromise = (async () => {
    try {
      const app = new Application();
      await app.init({
        background: '#000000',
        width: window.innerWidth,
        height: window.innerHeight,
        antialias: false,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        // Match the offline demo's preference — PixiJS falls back to WebGL
        // automatically if WebGPU init fails or isn't supported.
        preference: 'webgpu',
      });
      app.canvas.style.cssText = 'position:fixed;inset:0;z-index:0;';
      document.body.appendChild(app.canvas);
      window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
      });
      console.info(`[jamera] PIXI canvas ready (${app.renderer.name})`);
      if (import.meta.env.DEV) {
        (window as unknown as { jameraPixi: Application }).jameraPixi = app;
      }
      return app;
    } catch (err) {
      pixiPromise = null;
      throw err;
    }
  })();
  return pixiPromise;
}

/**
 * Spin up a GameWorld and register its handlers on the client's
 * dispatcher so server map / creature packets land in a live state
 * object. **Data-binding only — nothing is rendered yet.** The
 * renderer that consumes this state is a separate follow-up PR.
 *
 * Always builds a fresh GameWorld per in_game transition: a disconnect
 * + re-login on the same page would otherwise reuse the previous
 * session's stale tile/creature state, AND we *want* the new
 * registration to land — `PacketDispatcher.on()` is a Map.set, so
 * overwriting the previous closure's handler is exactly the right
 * thing here.
 */
function bindGameWorld(client: GameClient): GameWorld {
  const world = new GameWorld(client.getProtocol());
  world.registerHandlers(client.getDispatcher());
  console.info('[jamera] GameWorld bound to dispatcher');
  if (import.meta.env.DEV) {
    // Dev-only DevTools hook so we can inspect live tiles / creatures /
    // player position. Replaced on each re-login so the reference
    // always points at the live world.
    (window as unknown as { jameraWorld: GameWorld }).jameraWorld = world;
  }
  return world;
}

/**
 * Coordinate the three async deps (PIXI, asset atlas, fresh GameWorld)
 * and invoke `bindRenderer` once all are ready. PIXI and the atlas are
 * page-lifetime singletons; the world is per-session. On re-login we
 * tear down the previous renderer first so the old session's container
 * doesn't leak into the new stage.
 *
 * Atlas may arrive before or after this mount runs:
 *   - Already cached (re-login): `jameraAtlas` is set, bind immediately.
 *   - Still loading: register a one-shot callback that the asset-load
 *     path fires once the atlas finishes building.
 */
let teardownRenderer: (() => void) | null = null;
let onAtlasReady: ((atlas: SpriteAtlas) => void) | null = null;
// Monotonic mount generation. Every mountRenderer call claims a new epoch;
// any continuation (post-await resume, queued atlas callback) belonging to
// an older epoch is stale and must not bind. Without this, a re-login during
// the `ensurePixiApp` await — or an atlas that finishes building between two
// mounts — can bind a dead session's world and leak its container.
let mountEpoch = 0;

async function mountRenderer(world: GameWorld): Promise<void> {
  const epoch = ++mountEpoch;
  teardownRenderer?.();
  teardownRenderer = null;
  // Cancel a waiter queued by a previous session — its world is dead.
  onAtlasReady = null;

  let app: Application;
  try {
    app = await ensurePixiApp();
  } catch (err) {
    console.warn('[jamera] renderer: PIXI not ready, aborting:', err instanceof Error ? err.message : err);
    return;
  }
  if (epoch !== mountEpoch) return; // superseded while awaiting PIXI

  const mount = (atlas: SpriteAtlas): void => {
    if (epoch !== mountEpoch) return; // stale atlas callback
    teardownRenderer?.(); // never stack two bindings
    teardownRenderer = bindRenderer(world, atlas, app);
    console.info('[jamera] renderer bound to GameWorld');
  };

  if (jameraAtlas) {
    mount(jameraAtlas);
  } else {
    onAtlasReady = mount;
  }
}

/**
 * Background-load the asset bundle (.dat / .spr / .otb / .otbm) the
 * upcoming renderer PR will need. Uses the existing `tryAutoload` from
 * `assetAutoload.ts` so the jamera flow shares the same source-of-truth
 * resolution (`?version=…` + `public/assets/<version>/`) as the offline
 * demo.
 *
 * Module-scoped guards prevent re-fetching the (large) bundle on every
 * re-login or overlapping in-flight requests — assets only need to load
 * once per page load.
 *
 * No fallback drag-drop UI here — if auto-load fails we just log it and
 * let the renderer PR decide what to surface. The drag-drop fallback is
 * its own tiny follow-up PR.
 */
let assetsLoading = false;
let assetsLoaded = false;
// Resolved once the wire flags exist (the .dat parsed); replaced with a
// fresh pending promise when a load attempt fails so a retry can gate on
// the new attempt instead of inheriting the old rejection.
let assetsReadyResolve: (() => void) | null = null;
let assetsReadyReject: ((err: Error) => void) | null = null;
let assetsReady = new Promise<void>((resolve, reject) => {
  assetsReadyResolve = resolve;
  assetsReadyReject = reject;
});
// Rejections are consumed on demand via waitForReady — don't let an
// unobserved failure trip the global unhandled-rejection handler.
assetsReady.catch(() => { /* observed lazily */ });
// Page-lifetime cache: assets don't change between re-logins, so the
// expensive sprite-decode + GPU upload only runs once per tab.
let jameraAtlas: SpriteAtlas | null = null;

function loadAssetsForRendering(): void {
  if (assetsLoaded || assetsLoading) return;
  assetsLoading = true;
  void tryAutoloadAssets();
}

async function tryAutoloadAssets(): Promise<void> {
  await tryAutoload({
    onStatus: (msg, isError) => {
      if (isError) console.warn('[jamera-assets]', msg);
      else console.info('[jamera-assets]', msg);
    },
    addFileToList: (name) => console.info('[jamera-assets] loaded', name),
    startApp: async (loaded: CompleteLoadedFiles) => {
      console.info('[jamera] assets ready (dat/spr/otb/otbm)');
      // Wire-format item knowledge: which client IDs carry a count byte.
      // Must be set before the first map packet parses — stackables
      // misalign the stream otherwise. Cheap (one .dat parse) and safe
      // to repeat on retries.
      setItemWireFlags(parseDat(loaded.dat));
      assetsReadyResolve?.();
      try {
        jameraAtlas = buildSpriteAtlas(loaded.dat, loaded.spr);
        // Only flip `assetsLoaded` once the atlas exists — otherwise a
        // build failure here would permanently short-circuit the guard
        // in `loadAssetsForRendering`, and a re-login could never retry.
        assetsLoaded = true;
        console.info(
          `[jamera] atlas cache ready (${jameraAtlas.atlasTextures.pages.size} page(s), ${jameraAtlas.layout.size} sprites)`,
        );
        // Notify any renderer mount that was waiting for the atlas.
        // Consumed exactly once — re-logins re-register from scratch.
        const pending = onAtlasReady;
        onAtlasReady = null;
        pending?.(jameraAtlas);
      } catch (err) {
        // Leave `assetsLoaded` false so the next in_game transition gets
        // another shot. Still expose `jameraAssets` below — the raw
        // buffers are useful for diagnosing the failure in DevTools.
        // `instanceof Error` because JS allows throwing anything; the
        // cast-and-`.message` form crashes if a non-Error is thrown.
        console.warn('[jamera] atlas build failed:', err instanceof Error ? err.message : err);
      }
      if (import.meta.env.DEV) {
        // Dev-only DevTools hooks so the renderer PR can poke at the
        // parsed assets + atlas while it's being built. Not exposed in
        // prod for the same reason as window.jameraClient.
        (window as unknown as { jameraAssets: CompleteLoadedFiles }).jameraAssets = loaded;
        if (jameraAtlas) {
          (window as unknown as { jameraAtlas: SpriteAtlas }).jameraAtlas = jameraAtlas;
        }
      }
    },
  })
    .catch((err) => {
      console.warn('[jamera] asset auto-load failed:', err instanceof Error ? err.message : err);
    })
    .finally(() => {
      assetsLoading = false;
    });

  if (!assetsLoaded) {
    // The attempt failed (missing manifest, fetch error, atlas build
    // failure): reject the gate so character-select surfaces an error,
    // then re-arm a fresh promise for the retry the next gate call kicks.
    assetsReadyReject?.(new Error('Game assets failed to load — check public/assets/<version>/ and retry.'));
    assetsReady = new Promise<void>((resolve, reject) => {
      assetsReadyResolve = resolve;
      assetsReadyReject = reject;
    });
    assetsReady.catch(() => { /* consumed via waitForReady when retried */ });
  }
}

/**
 * Keep-alive + end-to-end send() smoke test. Tibia 7.6 servers expect
 * a periodic Ping (client opcode `0x1E`) and treat long silence as
 * disconnect. Running this also exercises `GameClient.send()` against
 * the real jamera server every 30s, surfacing any wire-path regression
 * via a thrown send error long before it would otherwise show up.
 */
const PING_INTERVAL_MS = 30_000;

// Module-scoped so a re-entry into `in_game` (e.g. after a disconnect +
// re-login) can clear the old timer before starting a new one.
let pingIntervalId: ReturnType<typeof setInterval> | null = null;

function startPingLoop(client: GameClient): void {
  // Replace any existing loop first — back-to-back in_game transitions
  // should never stack two timers, and after a disconnect the previous
  // timer would otherwise keep firing send() against a dead client.
  if (pingIntervalId !== null) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }

  const sendPing = () => {
    // Self-teardown when the client leaves in_game (disconnect path).
    // GameClient.send() would throw on the next tick anyway; clearing
    // here just prevents the every-30s warning spam.
    if (client.getState() !== 'in_game') {
      if (pingIntervalId !== null) {
        clearInterval(pingIntervalId);
        pingIntervalId = null;
      }
      return;
    }
    try {
      const packet = new OutputPacket();
      packet.addU8(ClientOp.Ping);
      client.send(packet);
    } catch (err) {
      console.warn('[jamera] ping failed:', (err as Error).message);
    }
  };

  sendPing();
  pingIntervalId = setInterval(sendPing, PING_INTERVAL_MS);
}

/**
 * Coerce a `?clientVersion=` query param to a U16-range positive integer,
 * or `undefined` to fall back to the default. The wire field is a U16, so
 * values outside `[1, 65535]` would wrap on serialisation and produce a
 * server-side version mismatch with a confusing error instead of falling
 * back to the default. Also guards `Number("bad") === NaN`.
 */
function parseClientVersion(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 0xffff) return undefined;
  return n;
}

// Kick the asset load immediately (not on first in_game): the .dat drives
// wire-format parsing (item count bytes), so it should be ready long
// before a human finishes typing credentials. onEnterGame calls this
// again, which retries if this first attempt failed and no-ops otherwise.
loadAssetsForRendering();

/**
 * Movement input: joystick (coarse-pointer devices) + keyboard feed a
 * walk controller that does server-confirmed stepping. Re-login tears
 * the previous session's input down first — two controllers would
 * double-send steps for the same hold.
 */
let teardownMovement: (() => void) | null = null;

function bindMovementInput(client: GameClient, world: GameWorld): void {
  teardownMovement?.();

  let joystickDir: Direction | null = null;
  const joystick = createJoystick({ onChange: (dir) => { joystickDir = dir; } });
  const joystickQuery = window.matchMedia('(pointer: coarse)');
  const applyJoystickVisibility = (): void => joystick.setVisible(joystickQuery.matches);
  applyJoystickVisibility();
  joystickQuery.addEventListener('change', applyJoystickVisibility);

  const keyboard = createKeyboard();

  const walker = createWalkController({
    client,
    world,
    getHeldDirection: () => joystickDir ?? keyboard.heldDirection,
  });

  teardownMovement = () => {
    walker.destroy();
    joystickQuery.removeEventListener('change', applyJoystickVisibility);
    joystick.destroy();
    keyboard.destroy();
    teardownMovement = null;
  };
}

// Per-session chat binding — replaced on re-login like the renderer and
// movement input, so a dead session's handlers never feed the UI.
let teardownChat: ChatBindingHandle | null = null;

// Per-session HUD/skills binding, replaced on re-login like the rest.
let teardownStats: StatsBindingHandle | null = null;
