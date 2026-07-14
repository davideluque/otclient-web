import { GameClient } from '../net/common/GameClient';
import type { GameClientState, GameClientEvents } from '../net/common/GameClient';
import type { CharacterInfo } from '../net/common/types';
import { GameProtocol } from '../net/7.6/GameProtocol';
import { defaultProxyUrl } from './proxyUrl';
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
   * WebSocket proxy that bridges the browser to the OT server. When
   * omitted, `defaultProxyUrl()` picks the local bridge in dev and the
   * page's own origin (wss://) in production.
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

const DEFAULT_CLIENT_VERSION = 761;
const MAX_U32_ACCOUNT = 0xffffffff;

type LoginAccount =
  | { ok: true; account: number }
  | { ok: false; message: string };

// The wire format serialises the account as a U32. Anything that's not a
// positive integer in [1, 2^32-1] silently truncates (fractions, values
// > 2^32) or wraps when serialised, landing the user on a different account
// than they typed with no obvious error — so validate at the form boundary.
export function parseLoginAccount(raw: string): LoginAccount {
  const account = Number(raw);
  if (!Number.isInteger(account) || account <= 0 || account > MAX_U32_ACCOUNT) {
    return {
      ok: false,
      message: `Account must be a positive integer between 1 and ${MAX_U32_ACCOUNT}.`,
    };
  }
  return { ok: true, account };
}

export function mountLoginScreen(root: HTMLElement, opts: MountOptions = {}): MountedScreen {
  const proxyUrl = opts.proxyUrl ?? defaultProxyUrl();
  const clientVersion = opts.clientVersion ?? DEFAULT_CLIENT_VERSION;

  const protocol = new GameProtocol({ clientVersion });

  const ui = createLoginScreenUi();
  root.appendChild(ui.container);

  // Handlers close over `client`, but `client` takes `events` at
  // construction. Build events empty, hand it over, then populate — the
  // client stores the reference and reads `events.onX?.(…)` at call time.
  const events: GameClientEvents = {};
  const client = new GameClient(proxyUrl, events, protocol);

  // One-shot auto-pilot flag, disarmed when the pick fires AND on every
  // failure path (login error, drop to disconnected, malformed config) so a
  // stale auto-pick can never hijack a later manual login.
  let autoPickCharacter = opts.autoLogin !== undefined;
  let lastState: GameClientState = 'disconnected';
  const disarmAutoCharacterPick = (): void => {
    autoPickCharacter = false;
  };

  events.onStateChange = (state) => {
    applyClientStateToLoginScreen(ui, state);
    if (state === 'disconnected') disarmAutoCharacterPick();
    if (state === 'in_game') opts.onEnterGame?.(client);
    if (lastState === 'in_game' && state !== 'in_game') opts.onLeaveGame?.();
    lastState = state;
  };
  events.onLoginError = (msg) => {
    disarmAutoCharacterPick();
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
        // Re-enable selection after a failed attempt so the player can retry
        // without a full re-login; the next state transition re-applies the
        // state-driven disabling anyway.
        showError(ui, (err as Error).message);
        setCharacterSelectionDisabled(ui, false);
      }
    });
    // Disarm on the FIRST list response either way — an empty list must not
    // leave the auto-pilot lurking for a later manual login. (clickFirst… is
    // a no-op when there's no button, i.e. an empty character list.)
    if (autoPickCharacter) {
      disarmAutoCharacterPick();
      clickFirstCharacterButton(ui);
    }
  };
  // No onDisconnect handler needed: GameClient calls setState('disconnected')
  // immediately before onDisconnect, so onStateChange already surfaces it.

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(ui);

    // Defense-in-depth against re-submission once a login is in flight. The
    // form is also disabled for any non-disconnected state, but a programmatic
    // form.dispatchEvent('submit') bypasses the disabled button. A second
    // login would open a fresh WebSocket on top of the existing loginConn
    // without closing the old one, and the old socket's onclose would later
    // null shared state out from under the new session.
    if (client.getState() !== 'disconnected') return;

    const parsedAccount = parseLoginAccount(ui.accountInput.value);
    if (!parsedAccount.ok) {
      disarmAutoCharacterPick();
      showError(ui, parsedAccount.message);
      return;
    }

    const password = ui.passwordInput.value;
    try {
      await client.login(parsedAccount.account, password);
    } catch (err) {
      disarmAutoCharacterPick();
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

function createLoginScreenUi(): UiHandles {
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

function applyClientStateToLoginScreen(ui: UiHandles, state: GameClientState): void {
  ui.statusEl.textContent = STATE_LABELS[state];
  ui.statusEl.classList.toggle('error', state === 'disconnected');

  // Hide the overlay only once in_game so the PIXI canvas below shows; its
  // solid background would otherwise cover the canvas mid-paint. Any other
  // state (a kick → disconnected, retry → character_list) re-shows it.
  ui.container.hidden = state === 'in_game';

  // Disable the login form past `disconnected`: a second submit on
  // character_list would open a fresh loginConn over the existing one (see
  // the submit guard), and there's nothing to re-submit once listed.
  setLoginFormDisabled(ui, state !== 'disconnected');
  // Disable character buttons once a selection is in flight so a double-click
  // can't kick off overlapping selectCharacter calls that race transitions.
  setCharacterSelectionDisabled(ui, state === 'entering_game' || state === 'in_game');

  // Hide the stale list when dropping back to pre-character states — keeping
  // it visible would suggest selection is still possible.
  if (state === 'disconnected' || state === 'logging_in') {
    ui.characterListEl.hidden = true;
  }
}

function setLoginFormDisabled(ui: UiHandles, disabled: boolean): void {
  ui.accountInput.disabled = disabled;
  ui.passwordInput.disabled = disabled;
  ui.loginButton.disabled = disabled;
}

function setCharacterSelectionDisabled(ui: UiHandles, disabled: boolean): void {
  for (const btn of ui.characterListEl.querySelectorAll('button')) {
    (btn as HTMLButtonElement).disabled = disabled;
  }
}

function clickFirstCharacterButton(ui: UiHandles): void {
  ui.characterListEl.querySelector('button')?.click();
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

  ui.characterListEl.setAttribute('data-character-count', String(characters.length));
}
