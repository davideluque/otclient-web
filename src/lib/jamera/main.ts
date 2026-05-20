import { mountLoginScreen } from './loginScreen';
import type { GameClient } from '../net/common/GameClient';
import { OutputPacket } from '../net/common/OutputPacket';
import { ClientOp } from '../net/7.6/opcodes';
import { tryAutoload } from '../assetAutoload';
import type { CompleteLoadedFiles } from '../fileLoader';

const root = document.getElementById('jamera-root');
if (!root) {
  throw new Error('jamera.html missing #jamera-root container');
}

const params = new URLSearchParams(window.location.search);
const proxyUrl = params.get('proxy') ?? undefined;
const clientVersion = parseClientVersion(params.get('clientVersion'));

mountLoginScreen(root, {
  proxyUrl,
  clientVersion,
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
    startPingLoop(client);
    loadAssetsForRendering();
  },
});

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

function loadAssetsForRendering(): void {
  if (assetsLoaded || assetsLoading) return;
  assetsLoading = true;
  tryAutoload({
    onStatus: (msg, isError) => {
      if (isError) console.warn('[jamera-assets]', msg);
      else console.info('[jamera-assets]', msg);
    },
    addFileToList: (name) => console.info('[jamera-assets] loaded', name),
    startApp: async (loaded: CompleteLoadedFiles) => {
      assetsLoaded = true;
      console.info('[jamera] assets ready (dat/spr/otb/otbm)');
      if (import.meta.env.DEV) {
        // Dev-only DevTools hook so the renderer PR can poke at the
        // parsed assets while it's being built. Not exposed in prod for
        // the same reason as window.jameraClient.
        (window as unknown as { jameraAssets: CompleteLoadedFiles }).jameraAssets = loaded;
      }
    },
  })
    .catch((err) => {
      console.warn('[jamera] asset auto-load failed:', (err as Error).message);
    })
    .finally(() => {
      assetsLoading = false;
    });
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
