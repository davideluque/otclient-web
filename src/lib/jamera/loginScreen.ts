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

  events.onStateChange = (state) => {
    updateState(ui, state);
    if (state === 'in_game') opts.onEnterGame?.(client);
  };
  events.onLoginError = (msg) => showError(ui, msg);
  events.onCharacterList = (characters, premiumDays, motd) => {
    renderCharacterList(ui, characters, premiumDays, motd, async (char) => {
      try {
        await client.selectCharacter(char);
      } catch (err) {
        showError(ui, (err as Error).message);
      }
    });
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
