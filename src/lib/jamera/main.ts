import { mountLoginScreen } from './loginScreen';

const root = document.getElementById('jamera-root');
if (!root) {
  throw new Error('jamera.html missing #jamera-root container');
}

const params = new URLSearchParams(window.location.search);
const proxyUrl = params.get('proxy') ?? undefined;
const clientVersion = params.get('clientVersion')
  ? Number(params.get('clientVersion'))
  : undefined;

mountLoginScreen(root, {
  proxyUrl,
  clientVersion,
  onEnterGame: (client) => {
    // Phase 2 scaffold stops at "in game" — follow-up PRs attach the
    // live-map renderer, chat UI, and movement input. For now, surface
    // the live client on the window for ad-hoc poking in DevTools.
    (window as unknown as { jameraClient: typeof client }).jameraClient = client;
    console.info('[jamera] in_game — client attached to window.jameraClient');
  },
});
