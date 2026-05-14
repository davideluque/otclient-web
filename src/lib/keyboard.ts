import { Direction } from './player';

// --- Key bindings ---

/** Map from key name (KeyboardEvent.key) to a game action. */
export type KeyAction = { type: 'move'; dir: Direction } | { type: 'toggle'; id: string };

const DEFAULT_BINDINGS: Record<string, KeyAction> = {
  // Arrow keys
  ArrowUp:    { type: 'move', dir: Direction.North },
  ArrowRight: { type: 'move', dir: Direction.East },
  ArrowDown:  { type: 'move', dir: Direction.South },
  ArrowLeft:  { type: 'move', dir: Direction.West },

  // WASD
  w: { type: 'move', dir: Direction.North },
  d: { type: 'move', dir: Direction.East },
  s: { type: 'move', dir: Direction.South },
  a: { type: 'move', dir: Direction.West },
  W: { type: 'move', dir: Direction.North },
  D: { type: 'move', dir: Direction.East },
  S: { type: 'move', dir: Direction.South },
  A: { type: 'move', dir: Direction.West },

  // Toggles
  n: { type: 'toggle', id: 'night' },
  N: { type: 'toggle', id: 'night' },
};

// --- Keyboard input handler ---

export interface KeyboardHandle {
  /** The currently held movement direction, or null. */
  readonly heldDirection: Direction | null;
  /** Remove all listeners. */
  destroy(): void;
}

export interface KeyboardOptions {
  /** Custom bindings. Merged on top of defaults — pass a partial map to
   *  override specific keys while keeping the rest. */
  bindings?: Record<string, KeyAction>;
  /** Fires on toggle actions (e.g. night mode). */
  onToggle?: (id: string) => void;
}

/**
 * Create a keyboard input handler. Tracks which movement direction is
 * currently held (last-pressed wins for simultaneous keys). Calls
 * `onToggle` for non-movement bindings.
 *
 * Returns a handle whose `heldDirection` can be polled each frame
 * (same pattern as the joystick's `onChange`).
 */
export function createKeyboard(opts: KeyboardOptions = {}): KeyboardHandle {
  const bindings = { ...DEFAULT_BINDINGS, ...opts.bindings };

  // Track which movement keys are currently pressed. Last-pressed wins
  // when multiple are held — matches how most games handle WASD.
  const heldKeys = new Set<string>();
  let heldDirection: Direction | null = null;

  // Ordered stack of pressed movement keys — most recent at end.
  const moveStack: string[] = [];

  function recalcDirection() {
    // Walk the stack from most recent → oldest. First match wins.
    for (let i = moveStack.length - 1; i >= 0; i--) {
      const action = bindings[moveStack[i]];
      if (action?.type === 'move') {
        heldDirection = action.dir;
        return;
      }
    }
    heldDirection = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    // Ignore keys when an input/textarea is focused (e.g. chat).
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const action = bindings[e.key];
    if (!action) return;

    if (action.type === 'move') {
      if (!heldKeys.has(e.key)) {
        heldKeys.add(e.key);
        moveStack.push(e.key);
      }
      recalcDirection();
      e.preventDefault();
    } else if (action.type === 'toggle') {
      // Ignore key repeat — toggles should fire once per press.
      if (e.repeat) return;
      opts.onToggle?.(action.id);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (!heldKeys.has(e.key)) return;
    heldKeys.delete(e.key);
    const idx = moveStack.indexOf(e.key);
    if (idx !== -1) moveStack.splice(idx, 1);
    recalcDirection();
  }

  // Clear all held keys when the window loses focus — prevents stuck
  // directions when alt-tabbing or switching apps.
  function onBlur() {
    heldKeys.clear();
    moveStack.length = 0;
    heldDirection = null;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    get heldDirection() { return heldDirection; },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
