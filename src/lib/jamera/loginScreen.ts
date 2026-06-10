import { GameClient } from '../net/common/GameClient';
import type { GameClientState, GameClientEvents } from '../net/common/GameClient';
import type { CharacterInfo } from '../net/common/types';
import { GameProtocol } from '../net/7.6/GameProtocol';
// Vite `?raw` import: ships the file contents as a string at build time.
// Keeps the markup + styles out of the TS source so the file stays readable.
import templateHtml from './loginScreen.html?raw';

/**
 * Phase 2 scaffold. Mounts a minimal login + character-selection form,
 * drives the GameClient login flow, and surfaces the resulting client +
 * protocol + dispatcher so follow-up PRs can attach the live-map renderer,
 * chat UI, and movement input.
 *
 * Intentionally bare: no styling beyond the OTClient palette, no character
 * portraits, no MOTD rendering. Just enough surface to validate that the
 * refactored 7.6 protocol code talks to a real server from a real browser.
 */
export interface MountOptions {
  /**
   * WebSocket proxy that bridges the browser to the OT server. Defaults
   * to `ws://localhost:8090` to match `proxy/server.ts`'s default port.
   */
  proxyUrl?: string;

  /**
   * Tibia client version sent in the login packet. Canonical 7.6 servers
   * accept 760; jamera specifically demands 761.
   */
  clientVersion?: number;

  /**
   * Invoked once the player has been admitted into the game world (state
   * transitions to `in_game`). Receives the live GameClient so follow-up
   * code can register packet handlers, send chat, etc.
   */
  onEnterGame?: (client: GameClient) => void;

  /**
   * Invoked when the session leaves the game world (in_game → anything
   * else, e.g. a kick or disconnect). Pair with onEnterGame to tear down
   * per-session UI — input, chat, HUD — instead of leaving it mounted
   * over the re-shown login screen.
   */
  onLeaveGame?: () => void;

  /**
   * Awaited before entering the game world (character select). Use it to
   * gate game entry on prerequisites like the asset bundle: the first
   * map packet arrives instantly after game login and is unparseable
   * until the .dat-derived wire flags exist. Rejection is shown as an
   * error and the character list re-enables.
   */
  waitForReady?: () => Promise<void>;

  /**
   * Dev convenience: submit these credentials immediately on mount and
   * auto-pick the first character from the list — reload lands straight
   * in the game. One-shot: a logout or kick returns to the normal form
   * (otherwise logout would be untestable). Callers gate this on dev
   * builds; never wire it up in production.
   */
  autoLogin?: { account: number; password: string };
}

export interface MountedScreen {
  /** The live GameClient — exposed so tests and follow-up wire-up can use it. */
  client: GameClient;
  /** Tears down the screen DOM and disconnects the client. */
  unmount(): void;
}

const DEFAULT_PROXY_URL = 'ws://localhost:8090';
const DEFAULT_CLIENT_VERSION = 761; // jamera demands 761

export function mountLoginScreen(root: HTMLElement, opts: MountOptions = {}): MountedScreen {
  const proxyUrl = opts.proxyUrl ?? DEFAULT_PROXY_URL;
  const clientVersion = opts.clientVersion ?? DEFAULT_CLIENT_VERSION;

  const protocol = new GameProtocol({ clientVersion });

  const ui = createDom();
  root.appendChild(ui.container);

  // Event handlers close over `client`, but `client` itself takes `events`
  // at construction time. Build events as an empty object, hand it to the
  // client, then populate the handlers — GameClient stores the reference
  // and reads `events.onX?.(…)` at call time.
  const events: GameClientEvents = {};
  const client = new GameClient(proxyUrl, events, protocol);

  let lastState: GameClientState = 'disconnected';
  events.onStateChange = (state) => {
    updateState(ui, state);
    if (state === 'in_game') opts.onEnterGame?.(client);
    if (lastState === 'in_game' && state !== 'in_game') opts.onLeaveGame?.();
    lastState = state;
  };
  // One-shot auto-pilot flags; cleared as each leg completes (and on
  // login error, so a bad dev password doesn't loop).
  let autoPickCharacter = opts.autoLogin !== undefined;
  events.onLoginError = (msg) => {
    autoPickCharacter = false;
    showError(ui, msg);
  };
  events.onCharacterList = (characters, premiumDays, motd) => {
    renderCharacterList(ui, characters, premiumDays, motd, async (char) => {
      try {
        if (opts.waitForReady) {
          ui.statusEl.textContent = 'Loading game assets...';
          await opts.waitForReady();
        }
        await client.selectCharacter(char);
      } catch (err) {
        showError(ui, (err as Error).message);
        enableCharacterButtons(ui);
      }
    });
    if (autoPickCharacter && characters.length > 0) {
      autoPickCharacter = false;
      ui.characterListEl.querySelector('button')?.click();
    }
  };
  // Disconnect is already surfaced by `onStateChange` → `updateState`
  // (GameClient calls setState('disconnected') immediately before
  // triggering onDisconnect), so no extra handler needed here.

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(ui);

    // Defense-in-depth against re-submission once a login is in flight.
    // The UI also disables the form (see updateState) for any non-
    // `disconnected` state, but a programmatic form.dispatchEvent('submit')
    // bypasses the disabled button. If we let a second login through,
    // GameClient.login would open a fresh WebSocket on top of the existing
    // loginConn without closing the old one, and the old socket's onclose
    // would later null shared state out from under the new session.
    if (client.getState() !== 'disconnected') return;

    const account = Number(ui.accountInput.value);
    const password = ui.passwordInput.value;
    // The wire format serialises the account number as a U32. Anything
    // that's not a positive integer in [1, 4_294_967_295] either silently
    // truncates (fractions, values > 2^32) or wraps around when serialised,
    // which would land the user on a different account than the one they
    // typed — without raising any obvious error. Validate at the form
    // boundary so the wire only ever sees in-range values.
    const ACCOUNT_MAX = 0xffffffff; // 2^32 - 1
    if (!Number.isInteger(account) || account <= 0 || account > ACCOUNT_MAX) {
      showError(ui, `Account must be a positive integer between 1 and ${ACCOUNT_MAX}.`);
      return;
    }
    try {
      await client.login(account, password);
    } catch (err) {
      showError(ui, (err as Error).message);
    }
  });

  if (opts.autoLogin) {
    ui.accountInput.value = String(opts.autoLogin.account);
    ui.passwordInput.value = opts.autoLogin.password;
    // Through the real submit path so validation, error display, and the
    // in-flight guard all behave exactly as a manual login would.
    ui.form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  return {
    client,
    unmount() {
      client.disconnect();
      ui.container.remove();
    },
  };
}

// ─── DOM helpers ───────────────────────────────────────────────────────────

interface UiHandles {
  container: HTMLElement;
  form: HTMLFormElement;
  accountInput: HTMLInputElement;
  passwordInput: HTMLInputElement;
  loginButton: HTMLButtonElement;
  statusEl: HTMLElement;
  errorEl: HTMLElement;
  characterListEl: HTMLElement;
}

function createDom(): UiHandles {
  const container = document.createElement('div');
  container.className = 'jamera-login';
  container.innerHTML = templateHtml;

  return {
    container,
    form: container.querySelector('form')!,
    accountInput: container.querySelector('input[name="account"]') as HTMLInputElement,
    passwordInput: container.querySelector('input[name="password"]') as HTMLInputElement,
    loginButton: container.querySelector('button[type="submit"]') as HTMLButtonElement,
    statusEl: container.querySelector('[data-role="status"]') as HTMLElement,
    errorEl: container.querySelector('[data-role="error"]') as HTMLElement,
    characterListEl: container.querySelector('[data-role="characters"]') as HTMLElement,
  };
}

const STATE_LABELS: Record<GameClientState, string> = {
  disconnected: 'Disconnected.',
  logging_in: 'Logging in…',
  character_list: 'Select a character.',
  entering_game: 'Entering game…',
  in_game: 'In game.',
};

function updateState(ui: UiHandles, state: GameClientState): void {
  ui.statusEl.textContent = STATE_LABELS[state];
  ui.statusEl.classList.toggle('error', state === 'disconnected');

  // Hide the login overlay once we're actually `in_game` so the PIXI
  // canvas below becomes visible. Without this the overlay's solid
  // background covers the canvas even while the renderer is painting.
  // Any other state re-shows it (e.g., `disconnected` after a kick, or
  // `character_list` on retry).
  ui.container.hidden = state === 'in_game';

  // Disable the account/password form for every state past `disconnected`.
  // Leaving it enabled on `character_list` would let a second submit
  // open a fresh `loginConn` WebSocket on top of the existing one (the
  // old socket's `onclose` would then null out the new session's state),
  // and there's nothing for the user to re-submit after `character_list`
  // — they pick a character from the list, they don't re-log-in.
  const formDisabled = state !== 'disconnected';
  ui.accountInput.disabled = formDisabled;
  ui.passwordInput.disabled = formDisabled;
  ui.loginButton.disabled = formDisabled;

  // Disable character-selection buttons once a selection is in flight so
  // a double-click (or two different characters clicked in quick
  // succession) can't kick off overlapping `selectCharacter` calls that
  // race state transitions and disconnect handlers.
  const selectionInFlight = state === 'entering_game' || state === 'in_game';
  for (const btn of ui.characterListEl.querySelectorAll('button')) {
    (btn as HTMLButtonElement).disabled = selectionInFlight;
  }

  // Hide the stale character list when we drop back to the pre-character
  // states — keeping it visible would suggest selection is still possible.
  if (state === 'disconnected' || state === 'logging_in') {
    ui.characterListEl.hidden = true;
  }
}

/**
 * Re-enable character selection after a failed attempt (waitForReady
 * rejection or selectCharacter error) so the player can retry without a
 * full re-login. State-driven disabling in updateState still applies on
 * the next transition.
 */
function enableCharacterButtons(ui: UiHandles): void {
  for (const btn of ui.characterListEl.querySelectorAll('button')) {
    (btn as HTMLButtonElement).disabled = false;
  }
}

function showError(ui: UiHandles, message: string): void {
  ui.errorEl.textContent = message;
}

function clearError(ui: UiHandles): void {
  ui.errorEl.textContent = '';
}

function renderCharacterList(
  ui: UiHandles,
  characters: CharacterInfo[],
  premiumDays: number,
  motd: string | undefined,
  onSelect: (char: CharacterInfo) => void,
): void {
  ui.characterListEl.innerHTML = '';
  ui.characterListEl.hidden = false;

  if (motd) {
    const motdEl = document.createElement('div');
    motdEl.className = 'motd';
    motdEl.textContent = motd;
    ui.characterListEl.appendChild(motdEl);
  }

  for (const char of characters) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${char.name}  ·  ${char.worldName}  (${char.worldIp}:${char.worldPort})`;
    btn.addEventListener('click', () => onSelect(char));
    ui.characterListEl.appendChild(btn);
  }

  if (premiumDays > 0) {
    const premium = document.createElement('div');
    premium.className = 'motd';
    premium.textContent = `Premium days remaining: ${premiumDays}`;
    ui.characterListEl.appendChild(premium);
  }

  // Surface count for tests + a11y screen readers.
  ui.characterListEl.setAttribute('data-character-count', String(characters.length));
}
