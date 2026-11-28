import { Direction } from '../player';
import { directionFromKnob } from '../joystick';

export const slots = ['cross', 'circle', 'square', 'triangle', 'r1', 'r2'] as const;
export const buttons = [...slots, 'l1', 'l2', 'options', 'create', 'l3', 'r3', 'up', 'right', 'down', 'left'] as const;
export type Button = typeof buttons[number];
export interface Snapshot {
  pressed: ReadonlySet<Button>;
  left: readonly [number, number];
  right: readonly [number, number];
}
export type Mode = 'game' | 'ui';
export type Action = 'activate' | 'back' | 'menu' | 'sheet' | 'next' | 'stop'
  | { cast: string } | { focus: Direction };
export interface Mapping {
  actions: Action[];
  mode: Mode;
  connected: boolean;
  pressed: ReadonlySet<Button>;
  direction: Direction | null;
  held: Direction | null;
  blockDirection: boolean;
  repeatAt: number;
  /** Bits for the six slots armed by a fresh press on this layer. */
  repeatingSlots: number;
  retryCastAt: number;
  layer: number;
}
export function idle(): Mapping {
  return { actions: [], mode: 'ui', connected: false, pressed: new Set(), direction: null,
    held: null, blockDirection: false, repeatAt: 0, repeatingSlots: 0, retryCastAt: 0, layer: 0 };
}
export function mapFrame(prev: Mapping, pad: Snapshot | null, mode: Mode, bindings: readonly string[], now: number, repeatSlots?: readonly boolean[]): Mapping {
  if (!pad) return idle();
  const { pressed } = pad;
  const layer = Number(pressed.has('l1')) + 2 * Number(pressed.has('l2'));
  const dpad = (['up', 'right', 'down', 'left'] as const).findIndex((b) => pressed.has(b));
  const direction = dpad < 0 ? directionFromKnob(...pad.left, 1, prev.direction) : dpad as Direction;
  const transition = !prev.connected || prev.mode !== mode;
  const blockDirection = direction !== null && (transition || prev.blockDirection);
  const held = mode === 'game' && !blockDirection ? direction : null;
  const actions: Action[] = [];
  const edge = (b: Button) => !transition && pressed.has(b) && !prev.pressed.has(b);
  let repeatAt = prev.repeatAt;
  let repeatingSlots = 0;
  if (mode === 'ui') {
    if (edge('create')) actions.push('sheet');
    else if (edge('circle')) actions.push('back');
    else if (edge('cross')) actions.push('activate');
    else if (direction !== null && !blockDirection && (direction !== prev.direction || now >= repeatAt)) {
      actions.push({ focus: direction });
      repeatAt = now + (direction !== prev.direction ? 380 : 150);
    }
  } else if (edge('options')) actions.push('menu');
  else if (edge('create')) actions.push('sheet');
  else {
    if (edge('l3')) actions.push('stop');
    else if (edge('r3')) actions.push('next');
    slots.forEach((button, i) => {
      const slot = layer * slots.length + i;
      const words = bindings[slot];
      if (!words || !pressed.has(button)) return;
      const first = edge(button);
      const armed = !transition && prev.layer === layer && (prev.repeatingSlots & (1 << i)) !== 0;
      if (repeatSlots?.[slot] && (first || armed)) repeatingSlots |= 1 << i;
      if (first || (armed && repeatSlots?.[slot] && now >= prev.retryCastAt)) actions.push({ cast: words });
    });
  }
  const opensOverlay = actions.includes('menu') || actions.includes('sheet');
  // This limits local retries. The shared combat binding owns actual spell cooldowns.
  const retryCastAt = !repeatingSlots ? 0 : now >= prev.retryCastAt ? now + 120 : prev.retryCastAt;
  return { repeatingSlots, retryCastAt, mode, connected: true, pressed, direction, held: opensOverlay ? null : held, blockDirection, repeatAt, layer, actions };
}
