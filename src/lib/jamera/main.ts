import { mountLoginScreen } from './loginScreen';

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
  },
});

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
