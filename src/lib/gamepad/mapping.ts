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
  layer: number;
}
export function idle(): Mapping {
  return { actions: [], mode: 'ui', connected: false, pressed: new Set(), direction: null,
    held: null, blockDirection: false, repeatAt: 0, layer: 0 };
}
export function mapFrame(prev: Mapping, pad: Snapshot | null, mode: Mode, bindings: readonly string[], now: number): Mapping {
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
      const words = bindings[layer * slots.length + i];
      if (words && edge(button)) actions.push({ cast: words });
    });
  }
  const opensOverlay = actions.includes('menu') || actions.includes('sheet');
  return { mode, connected: true, pressed, direction, held: opensOverlay ? null : held, blockDirection, repeatAt, layer, actions };
}
