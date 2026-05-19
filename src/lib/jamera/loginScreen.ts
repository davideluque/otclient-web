import { GameClient } from '../net/common/GameClient';
import type { GameClientState, GameClientEvents } from '../net/common/GameClient';
import type { CharacterInfo } from '../net/common/types';
import { GameProtocol } from '../net/7.6/GameProtocol';

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
  events.onDisconnect = () => {
    ui.statusEl.textContent = 'Disconnected.';
    ui.statusEl.classList.add('error');
  };

  ui.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(ui);
    const account = Number(ui.accountInput.value);
    const password = ui.passwordInput.value;
    if (!Number.isFinite(account) || account <= 0) {
      showError(ui, 'Account must be a positive number.');
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
  container.innerHTML = `
    <style>
      .jamera-login {
        position: fixed; inset: 0;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 1rem;
        background: #1a1a2e; color: #e0e0e0;
        font-family: system-ui, sans-serif; font-size: 0.9rem;
        padding: 1rem;
      }
      .jamera-login h1 { font-size: 1.4rem; color: #7c5cbf; }
      .jamera-login form {
        display: flex; flex-direction: column; gap: 0.5rem;
        width: min(320px, 90vw);
      }
      .jamera-login input {
        background: #111; color: #eee; border: 1px solid #444;
        border-radius: 4px; padding: 0.5rem 0.75rem;
        font-size: 0.95rem;
      }
      .jamera-login input:focus { outline: none; border-color: #7c5cbf; }
      .jamera-login button {
        background: #7c5cbf; color: #fff; border: none;
        border-radius: 4px; padding: 0.5rem 0.75rem;
        font-size: 0.95rem; cursor: pointer;
      }
      .jamera-login button:disabled { background: #555; cursor: not-allowed; }
      .jamera-login .status { color: #888; min-height: 1.2rem; }
      .jamera-login .status.error { color: #ff6b6b; }
      .jamera-login .error { color: #ff6b6b; min-height: 1.2rem; }
      .jamera-login .characters {
        display: flex; flex-direction: column; gap: 0.5rem;
        width: min(320px, 90vw);
      }
      .jamera-login .characters button {
        text-align: left; padding: 0.6rem 0.8rem;
        background: #2a2a44; color: #e0e0e0;
      }
      .jamera-login .characters button:hover { background: #3a3a5a; }
      .jamera-login .motd {
        max-width: min(320px, 90vw);
        padding: 0.5rem; background: #15152a; border-radius: 4px;
        color: #aaa; font-size: 0.8rem; white-space: pre-wrap;
      }
    </style>
    <h1>Jamera login</h1>
    <form>
      <input name="account" type="number" placeholder="Account number" autocomplete="username" required />
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required />
      <button type="submit">Log in</button>
    </form>
    <div class="status" data-role="status">Idle.</div>
    <div class="error" data-role="error"></div>
    <div class="characters" data-role="characters" hidden></div>
  `;

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
  // Disable the form while the client is mid-flight; re-enable on
  // disconnected/character_list so the user can retry/cancel.
  const formDisabled = state === 'logging_in' || state === 'entering_game' || state === 'in_game';
  ui.accountInput.disabled = formDisabled;
  ui.passwordInput.disabled = formDisabled;
  ui.loginButton.disabled = formDisabled;
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
