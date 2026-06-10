import { createCombatModes, type CombatModesHandle, type CombatModesState } from '../combatModes';
import { telemetry } from './telemetry';
import type { GameClient } from '../net/common/GameClient';

/**
 * Live combat modes: every change sends 0xA0 (fight/chase/secure) and
 * persists to localStorage; the saved state is restored and re-sent on
 * every login so the server matches what the buttons show.
 */
export interface CombatModesBindingHandle {
  readonly modes: CombatModesHandle;
  destroy(): void;
}

const STORAGE_KEY = 'jamera.combatModes';

function load(): Partial<CombatModesState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<CombatModesState>;
  } catch {
    return {};
  }
}

export function bindCombatModes(client: GameClient, parent: HTMLElement = document.body): CombatModesBindingHandle {
  const send = (state: CombatModesState): void => {
    try {
      client.send(client.getProtocol().actions.buildFightModes(state.fightMode, state.chase, state.secure));
      telemetry('fight-modes', { ...state });
    } catch (e) {
      console.warn('[jamera] fight modes send failed:', e instanceof Error ? e.message : e);
    }
  };

  const modes = createCombatModes({
    initial: load(),
    onChange: (state) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch { /* storage full/blocked — modes still work for the session */ }
      send(state);
    },
  }, parent);

  // Sync the server with the restored state at bind time (login).
  send(modes.state);

  return {
    modes,
    destroy: () => modes.destroy(),
  };
}
