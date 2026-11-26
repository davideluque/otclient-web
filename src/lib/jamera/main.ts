import { mountLoginScreen } from './loginScreen';
import type { GameClient } from '../net/common/GameClient';
import { OutputPacket } from '../net/common/OutputPacket';
import { ClientOp } from '../net/7.6/opcodes';
import { GameWorld } from '../GameWorld';
import type { SpriteAtlas } from '../spriteAtlas';
import { bindRenderer } from './renderer';
import { bindViewportCover } from './viewport';
import { createSettingsPane, type SettingsPaneHandle } from '../settingsPane';
import { createMetricsOverlay, type MetricsOverlayHandle } from './metricsOverlay';
import { initTelemetry, telemetry } from './telemetry';
import { renderItemThumbnail } from '../itemThumbnail';
import { createChangelogPane, type ChangelogPaneHandle } from '../changelogPane';
import { registerWireSkips } from '../net/7.6/wireSkips';
import { createWalkController } from './walkController';
import { bindChat, type ChatBindingHandle } from './chatBinding';
import { showDeathDialog } from '../deathDialog';
import type { ChatManager } from '../chat/ChatManager';
import { bindStats, type StatsBindingHandle } from './statsBinding';
import { bindInventory, type InventoryBindingHandle } from './inventoryBinding';
import { bindContainers, type ContainerBindingHandle } from './containerBinding';
import { bindShop, type ShopBindingHandle } from './shopBinding';
import { bindMinimap, type MinimapBindingHandle } from './minimapBinding';
import { bindBattleList, type BattleBindingHandle } from './battleBinding';
import { bindVip, type VipBindingHandle } from './vipBinding';
import { createSpellCustomizer, type SpellCustomizerHandle } from '../spellCustomizer';
import { loadSpellSlots, saveSpellSlots } from '../spells';
import { bindCombatModes, type CombatModesBindingHandle } from './combatModesBinding';
import { bindStatus, type StatusBindingHandle } from './statusBinding';
import { bindTextWindows, type TextWindowBindingHandle } from './textWindowBinding';
import { bindTrade, type TradeBindingHandle } from './tradeBinding';
import { bindInteractions, type InteractionsHandle } from './interactions';
import { bindCombat, type CombatBindingHandle } from './combatBinding';
import { loadBrightness, saveBrightness } from '../lighting';
import { loadTapToWalk, saveTapToWalk } from './interactionPreferences';
import { LIGHT_PREF_EVENT } from './renderer';
import { expectedStepMs } from '../render/motion/forward';
import {
  beginRoute, beginStep, createPrewalk, flushPrewalk, prewalkContinuation, prewalkStateAt,
} from '../render/motion/prewalk';
import { resolveSelfMotionMode } from '../render/motion/selfMotion';
import { createJoystick } from '../joystick';
import { createKeyboard } from '../keyboard';
import type { Direction } from '../player';
import { DatAttr } from '../dat';
import { createAssetPipeline } from './assetPipeline';
import { Application } from 'pixi.js';
import { resolveProxyOverride } from './proxyUrl';
import { bindScreenWakeLock, loadKeepScreenAwake, type ScreenWakeLockHandle } from './screenWakeLock';

const root = document.getElementById('jamera-root');
if (!root) {
  throw new Error('jamera.html missing #jamera-root container');
}

const params = new URLSearchParams(window.location.search);
const proxyUrl = resolveProxyOverride(params.get('proxy'));
const clientVersion = parseClientVersion(params.get('clientVersion'));
const rendererPreference = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
// Self-movement algorithm A/B switch (see motion/selfMotion.ts):
// ?selfmotion=playout falls back to the pre-prediction playout buffer.
const selfMotionMode = resolveSelfMotionMode(params.get('selfmotion'));
// Dev-server convenience: land straight in the game on every reload so
// changes are visible immediately. ?autologin=0 opts out (e.g. to test
// the login form itself); production builds never auto-login.
const autoLogin = import.meta.env.DEV && params.get('autologin') !== '0'
  ? { account: 1, password: '1' }
  : undefined;
// Dev telemetry: stream walk/render events to the proxy's /telemetry
// sink (same host/port as the game bridge) for offline aggregation.
// ?telemetry=0 opts out; production builds never stream.
if (import.meta.env.DEV && params.get('telemetry') !== '0' && proxyUrl) {
  // Diagnostics must never take the game down: a throwing init (e.g. a
  // secure-context-only API on plain http) would kill the whole module
  // graph from top level — exactly the failure telemetry exists to see.
  try {
    initTelemetry(proxyUrl);
  } catch (e) {
    console.warn('[telemetry] init failed, continuing without:', e instanceof Error ? e.message : e);
  }
}

mountLoginScreen(root, {
  proxyUrl,
  clientVersion,
  autoLogin,
  // Gate game entry on the asset bundle: the first map packet lands
  // milliseconds after game login and needs the .dat-derived wire flags.
  // Calling assetPipeline.load() here also makes the gate self-retrying
  // after a failed attempt.
  waitForReady: () => {
    assetPipeline.load();
    return assetPipeline.ready();
  },
  onLeaveGame: () => {
    // Disconnect/kick: drop the per-session surfaces instead of leaving
    // a live joystick and chat floating over the re-shown login screen.
    // The atlas waiter goes too — the game can be entered before the
    // atlas finishes building, and a still-armed waiter would otherwise
    // retain the dead session's world and bind a renderer for it over
    // the login screen when the build lands.
    assetPipeline.onAtlasReady(null);
    teardownMovement?.();
    teardownChat?.destroy();
    teardownChat = null;
    teardownStats?.destroy();
    teardownStats = null;
    teardownInventory?.destroy();
    teardownInventory = null;
    teardownContainers?.destroy();
    teardownContainers = null;
    teardownShop?.destroy();
    teardownShop = null;
    // The renderer too: its container and tinted-outfit textures belong
    // to the dead session (mountRenderer also bumps the epoch on the
    // next login, but freeing GPU resources shouldn't wait for one).
    teardownRenderer?.();
    teardownRenderer = null;
    teardownInteractions?.destroy();
    teardownInteractions = null;
    teardownCombat?.destroy();
    teardownCombat = null;
    settingsPane?.destroy();
    settingsPane = null;
    teardownMinimap?.destroy();
    teardownMinimap = null;
    teardownBattle?.destroy();
    teardownBattle = null;
    teardownVip?.destroy();
    teardownVip = null;
    spellCustomizer?.destroy();
    spellCustomizer = null;
    teardownCombatModes?.destroy();
    teardownCombatModes = null;
    teardownStatus?.destroy();
    teardownStatus = null;
    teardownTextWindows?.destroy();
    teardownTextWindows = null;
    teardownTrade?.destroy();
    teardownTrade = null;
    screenWakeLock?.destroy();
    screenWakeLock = null;
    setMetricsVisible(false);
    // Page-lifetime pane, but it must not stay open over the re-shown
    // login screen after a logout/kick.
    changelogPane?.close();
  },
  onEnterGame: (client) => {
    screenWakeLock?.destroy();
    screenWakeLock = bindScreenWakeLock();
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
    // Death → dialog instead of a silent dump to the login form. Two
    // signals: standard 7.6 servers send ReloginWindow (0x28,
    // protocol76.cpp:2386), but Jamera's only call site is commented out
    // (player.cpp:3398) — it sends a 0xB4 "You are dead." text message
    // instead, hooked below via bindChat's onDeathMessage. The dialog is
    // deliberately NOT in onLeaveGame's teardown: death drops the
    // connection while it's showing and it must outlive the session.
    const onDeath = (): void => {
      showDeathDialog({
        onContinue: () => {
          // Usually the server already closed the connection by now;
          // disconnect() covers a Continue tap that beats the close.
          if (client.getState() !== 'disconnected') client.disconnect();
        },
      });
    };
    client.getDispatcher().on(client.getProtocol().serverOpcodes.ReloginWindow, onDeath);
    startPingLoop(client);
    assetPipeline.load();
    const world = bindGameWorld(client);
    bindMovementInput(client, world);
    teardownCombat?.destroy();
    teardownCombat = bindCombat(client, world);
    teardownChat?.destroy();
    teardownChat = bindChat(client, document.body, { onDeathMessage: onDeath });
    teardownInventory?.destroy();
    teardownInventory = bindInventory(client, document.body, {
      // Lazy atlas read: the bundle may still be loading when the pane
      // binds; slots re-render on every 0x78, so thumbnails appear as
      // soon as the atlas exists.
      renderThumb: (id) => assetPipeline.atlas
        ? renderItemThumbnail(id, assetPipeline.atlas.datIndex, assetPipeline.atlas.layout, assetPipeline.atlas.atlasPages)
        : null,
      // Late-bound: interactions mount with the renderer (after the
      // atlas), later than this binding — the optional chain no-ops in
      // that brief window instead of arming a dead handle.
      armUseWith: (from) => teardownInteractions?.armUseWith(from),
      armTrade: (from) => teardownInteractions?.armTrade(from),
    });
    teardownContainers?.destroy();
    teardownContainers = bindContainers(client, document.body, {
      // Same lazy atlas read as the inventory pane above: windows
      // re-render on every container packet, so thumbnails appear as
      // soon as the atlas exists.
      renderThumb: (id) => assetPipeline.atlas
        ? renderItemThumbnail(id, assetPipeline.atlas.datIndex, assetPipeline.atlas.layout, assetPipeline.atlas.atlasPages)
        : null,
      // Drop target: the tile under the player, read at selection time.
      playerPosition: () => ({ x: world.playerX, y: world.playerY, z: world.playerZ }),
      // Same late-bound interactions handle as the inventory pane above.
      armUseWith: (from) => teardownInteractions?.armUseWith(from),
      armTrade: (from) => teardownInteractions?.armTrade(from),
    });
    teardownShop?.destroy();
    teardownShop = bindShop(client, document.body, {
      // Same lazy atlas read as the container pane above.
      renderThumb: (id) => jameraAtlas
        ? renderItemThumbnail(id, jameraAtlas.datIndex, jameraAtlas.layout, jameraAtlas.atlasPages)
        : null,
    });
    teardownStats?.destroy();
    teardownMinimap?.destroy();
    teardownMinimap = bindMinimap(world, () => assetPipeline.atlas?.datIndex ?? null);
    teardownBattle?.destroy();
    teardownBattle = bindBattleList(world, () => teardownCombat);
    teardownBattle.setVisible(false); // opt-in from the menu
    teardownVip?.destroy();
    teardownVip = bindVip(client);
    teardownCombatModes?.destroy();
    teardownCombatModes = bindCombatModes(client);
    teardownStatus?.destroy();
    teardownStatus = bindStatus(client);
    teardownTextWindows?.destroy();
    teardownTextWindows = bindTextWindows(client, document.body, {
      isWritable: (id) => {
        const attrs = assetPipeline.atlas?.datIndex.get(id)?.attrs;
        return attrs?.has(DatAttr.Writable) === true || attrs?.has(DatAttr.WritableOnce) === true;
      },
    });
    teardownTrade?.destroy();
    teardownTrade = bindTrade(client, document.body, {
      renderThumb: (id) => assetPipeline.atlas
        ? renderItemThumbnail(id, assetPipeline.atlas.datIndex, assetPipeline.atlas.layout, assetPipeline.atlas.atlasPages)
        : null,
    });
    // Per-session: the toggles adapt the live combat binding; reading
    // through the teardownCombat reference keeps them pointing at the
    // current session even across re-logins.
    settingsPane?.destroy();
    settingsPane = createSettingsPane([
      {
        kind: 'toggle',
        label: 'Auto-attack',
        hint: 'Same switch as the ⚔ circle on the combat bar.',
        get: () => teardownCombat?.attacking ?? false,
        set: (on) => teardownCombat?.setAttacking(on),
      },
      {
        kind: 'toggle',
        label: 'Show minimap',
        get: () => teardownMinimap?.visible ?? false,
        set: (on) => teardownMinimap?.setVisible(on),
      },
      {
        kind: 'toggle',
        label: 'Show metrics',
        hint: 'FPS, walk-step latency, repaint cost — for the lag hunt.',
        get: () => metricsOverlay !== null,
        set: (on) => setMetricsVisible(on),
      },
      {
        kind: 'toggle',
        label: 'Tap to walk',
        hint: 'Off: move with the joystick; taps still open and use objects.',
        get: () => loadTapToWalk(),
        set: (on) => saveTapToWalk(on),
      },
      {
        kind: 'toggle',
        label: 'Keep screen awake',
        hint: 'Prevents sleep while the game is visible when the browser allows it.',
        get: () => screenWakeLock?.enabled ?? loadKeepScreenAwake(),
        set: (on) => screenWakeLock?.setEnabled(on),
      },
      {
        kind: 'slider',
        label: 'Brightness',
        hint: '0% is dark; 100% shows the server’s full day/night light.',
        min: 0,
        max: 100,
        step: 5,
        unit: '%',
        get: () => loadBrightness(),
        set: (pct) => {
          saveBrightness(pct);
          window.dispatchEvent(new Event(LIGHT_PREF_EVENT));
        },
      },
    ]);
    // ?metrics=1 arms the overlay from the URL (e.g. before reporting a
    // lag trace) — the Settings toggle does the same thing in-game.
    if (params.get('metrics') === '1') setMetricsVisible(true);
    teardownStats = bindStats(client, document.body, [
      { label: 'Inventory', onSelect: () => teardownInventory?.toggle() },
      { label: 'Chat', onSelect: () => teardownChat?.presentation.openFull() },
      { label: 'Battle', onSelect: () => teardownBattle?.setVisible(!teardownBattle.visible) },
      { label: 'VIP', onSelect: () => teardownVip?.list.open() },
      {
        label: 'Hotkeys',
        onSelect: () => {
          spellCustomizer ??= createSpellCustomizer({
            initial: loadSpellSlots(),
            onChange: (slots) => {
              saveSpellSlots(slots);
              teardownCombat?.reloadSpells();
            },
          });
          spellCustomizer.open();
        },
      },
      { label: 'Settings', onSelect: () => settingsPane?.open() },
      {
        label: 'Changelog',
        onSelect: () => {
          // Page-lifetime, lazily created: it's informational, not
          // session state — no teardown needed on logout.
          changelogPane ??= createChangelogPane();
          changelogPane.open();
        },
      },
      {
        label: 'Log out',
        onSelect: () => {
          try {
            client.send(client.getProtocol().actions.buildLogout());
          } catch (e) {
            console.warn('[jamera] logout send failed:', e instanceof Error ? e.message : e);
          }
          // The server saves and closes; the disconnect flows through
          // onLeaveGame, which tears every per-session surface down.
        },
      },
    ]);
    if (import.meta.env.DEV) {
      // Dev hook for E2E assertions on bubbles/messages.
      (window as unknown as { jameraChat: typeof teardownChat }).jameraChat = teardownChat;
    }
    ensurePixiApp().catch((err) => {
      console.warn('[jamera] PIXI bootstrap failed:', err);
    });
    void mountRenderer(world, teardownChat.manager, client);
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
        // visualViewport is the actually-visible area on mobile (post
        // URL-bar / status-bar layout); innerWidth/Height as fallback.
        width: window.visualViewport?.width ?? window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
        antialias: false,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        // Pixi documents WebGPU as experimental and recommends WebGL for
        // production. The iPhone trace also showed WebGPU render-target and
        // event-system error storms. Keep ?renderer=webgpu for explicit A/Bs.
        preference: rendererPreference,
      });
      // Pixi's autoDensity writes the CSS size that maps its HiDPI backing
      // buffer back to viewport pixels. Assigning cssText here used to erase
      // that width/height, so an iPhone DPR=3 canvas became three times wider
      // and taller than the screen and looked severely zoomed/cropped.
      app.canvas.style.position = 'fixed';
      app.canvas.style.left = '0';
      app.canvas.style.top = '0';
      app.canvas.style.zIndex = '0';
      document.body.appendChild(app.canvas);
      // Cover-zoom + debounced resize/orientation tracking; the app is a
      // page-lifetime singleton so the binding never needs tearing down.
      bindViewportCover(app);
      telemetry('renderer-ready', {
        renderer: app.renderer.name,
        preference: rendererPreference,
        resolution: app.renderer.resolution,
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
 *   - Already cached (re-login): the pipeline fires the waiter immediately.
 *   - Still loading: register a one-shot callback that the asset-load
 *     path fires once the atlas finishes building.
 */
let teardownRenderer: (() => void) | null = null;
// Monotonic mount generation. Every mountRenderer call claims a new epoch;
// any continuation (post-await resume, queued atlas callback) belonging to
// an older epoch is stale and must not bind. Without this, a re-login during
// the `ensurePixiApp` await — or an atlas that finishes building between two
// mounts — can bind a dead session's world and leak its container.
let mountEpoch = 0;

async function mountRenderer(world: GameWorld, chatManager?: ChatManager, client?: GameClient): Promise<void> {
  const epoch = ++mountEpoch;
  teardownRenderer?.();
  teardownRenderer = null;
  // Cancel a waiter queued by a previous session — its world is dead.
  assetPipeline.onAtlasReady(null);

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
    teardownInteractions?.destroy();
    // Stack-order classification for 0x6A inserts (top vs down items).
    world.setDatIndex(atlas.datIndex);
    teardownInteractions = client
      ? bindInteractions(client, world, app, atlas.datIndex, {
        // Client-chosen window id for 0x82: the first free one, so a
        // second container opens beside the first instead of over it.
        nextContainerId: () => teardownContainers?.manager.nextFreeId() ?? 0,
        floorChangeIds: assetPipeline.floorChangeIds ?? undefined,
        useableIds: assetPipeline.useableIds ?? undefined,
        moveableIds: assetPipeline.moveableIds ?? undefined,
        onCreatureTap: (id) => teardownCombat?.attackTarget(id),
        // The camera renders the predicted position; taps must decode
        // against it, not the confirmed tile a route runs ahead of
        // (Codex review, #305).
        getSelfRenderPos: selfMotionMode !== 'prewalk'
          ? undefined
          : () => prewalkStateAt(selfPrewalk, performance.now()),
        // Tap-to-walk: predict the whole 0x64 route — the server walks
        // it without per-step sends, so this is the only place the
        // prediction chain can learn it.
        onRouteSent: selfMotionMode !== 'prewalk' ? undefined : (route) => {
          beginRoute(
            selfPrewalk,
            { x: world.playerX, y: world.playerY, z: world.playerZ },
            route,
            performance.now(),
            (from, diagonal) => selfStepMsFrom(world, from, diagonal),
          );
          // Same idle-start wake as onStepSent: a tap from a still
          // scene arms no rAF loop and gets no world change until the
          // first confirmation (Codex review, #305).
          world.onChange?.();
        },
      })
      : null;
    teardownRenderer = bindRenderer(
      world, atlas, app, chatManager,
      selfMotionMode === 'prewalk' ? selfPrewalk : undefined,
    );
    console.info('[jamera] renderer bound to GameWorld');
  };

  // Fires immediately when the atlas is already cached (re-login).
  assetPipeline.onAtlasReady(mount);
}

/**
 * Page-lifetime asset pipeline (.dat / .spr / .otb → wire flags, OTB id
 * sets, sprite atlas). Assets don't change between re-logins, so the
 * expensive sprite-decode + GPU upload only runs once per tab.
 */
const assetPipeline = createAssetPipeline();

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
assetPipeline.load();

/**
 * Movement input: joystick (coarse-pointer devices) + keyboard feed a
 * walk controller that does server-confirmed stepping. Re-login tears
 * the previous session's input down first — two controllers would
 * double-send steps for the same hold.
 */
let teardownMovement: (() => void) | null = null;

// Self pre-walk prediction chain. Page-lifetime like the renderer's other
// cross-binding state, but flushed on every session (re)bind and teardown
// so a dead session's predictions never render into a new one. Fed by the
// walk controller (sends), reconciled and drawn by the renderer.
const selfPrewalk = createPrewalk();

/**
 * The step duration the server will charge for a predicted step leaving
 * `from`: that tile's ground speed over the player's current speed.
 * Before the atlas is ready there is no ground attribute to read;
 * expectedStepMs falls back to its default ground.
 */
function selfStepMsFrom(
  world: GameWorld,
  from: { x: number; y: number; z: number },
  diagonal: boolean,
): number {
  const speed = world.getCreature(world.playerCreatureId)?.speed ?? 0;
  const groundId = world.getTile(from.x, from.y, from.z)?.items[0]?.id;
  const groundAttr = groundId !== undefined && assetPipeline.atlas
    ? assetPipeline.atlas.datIndex.get(groundId)?.attrs.get(DatAttr.Ground)
    : undefined;
  return expectedStepMs(speed, typeof groundAttr === 'number' ? groundAttr : 0, diagonal);
}

/**
 * Duration for the NEXT held-direction step, which leaves the prediction
 * chain's continuation tile — not the (older) confirmed position.
 * prewalkContinuation skips a route's unconfirmed tail, which beginStep
 * is about to drop (Codex review, #305).
 */
function predictedSelfStepMs(world: GameWorld): number {
  const from = prewalkContinuation(selfPrewalk)
    ?? { x: world.playerX, y: world.playerY, z: world.playerZ };
  return selfStepMsFrom(world, from, false);
}

function bindMovementInput(client: GameClient, world: GameWorld): void {
  teardownMovement?.();
  flushPrewalk(selfPrewalk);

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
    // Pre-walk: predict the step the packet will cause so the renderer
    // glides from the send instant instead of standing out the
    // confirmation round-trip (the level-1 step-pause-step stutter).
    // In playout mode the hook stays unset — no chain is ever seeded.
    onStepSent: selfMotionMode !== 'prewalk' ? undefined : (dir, now) => {
      beginStep(
        selfPrewalk,
        { x: world.playerX, y: world.playerY, z: world.playerZ },
        dir,
        now,
        predictedSelfStepMs(world),
      );
      // Wake the renderer: starting from idle there is no armed rAF loop
      // and no world change until the confirmation — exactly the round
      // trip the prediction exists to hide (Codex review, #303). The
      // update pass sees the live chain and keeps itself armed.
      world.onChange?.();
    },
  });
  // GameWorld snaps the facing on 0xB5; the controller flushes its
  // pipeline so a rejected step stops the walk instantly. The wire
  // direction pins the suppression to the direction that actually hit
  // the wall. The prediction chain flushes with it — its head step is
  // the one the server just rejected.
  world.onCancelWalk = (dir) => {
    walker.cancel(dir as Direction);
    flushPrewalk(selfPrewalk);
  };

  teardownMovement = () => {
    world.onCancelWalk = null;
    flushPrewalk(selfPrewalk);
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

// Per-session inventory binding, replaced on re-login like the rest.
let teardownInventory: InventoryBindingHandle | null = null;

// Per-session container windows (wire state + pane), same lifecycle.
let teardownContainers: ContainerBindingHandle | null = null;

// Per-session npc shop window (wire state + pane), same lifecycle.
let teardownShop: ShopBindingHandle | null = null;

// Per-session canvas interactions (look/use), replaced with the renderer.
let teardownInteractions: InteractionsHandle | null = null;

// Per-session combat controls (spell circles + auto-attack).
let teardownCombat: CombatBindingHandle | null = null;
let settingsPane: SettingsPaneHandle | null = null;
let screenWakeLock: ScreenWakeLockHandle | null = null;
let teardownMinimap: MinimapBindingHandle | null = null;
let teardownBattle: BattleBindingHandle | null = null;
let teardownTextWindows: TextWindowBindingHandle | null = null;
let teardownTrade: TradeBindingHandle | null = null;
let teardownVip: VipBindingHandle | null = null;
let spellCustomizer: SpellCustomizerHandle | null = null;
let teardownCombatModes: CombatModesBindingHandle | null = null;
let teardownStatus: StatusBindingHandle | null = null;
let metricsOverlay: MetricsOverlayHandle | null = null;

function setMetricsVisible(on: boolean): void {
  if (on && !metricsOverlay) {
    metricsOverlay = createMetricsOverlay();
  } else if (!on && metricsOverlay) {
    metricsOverlay.destroy();
    metricsOverlay = null;
  }
}
let changelogPane: ChangelogPaneHandle | null = null;
