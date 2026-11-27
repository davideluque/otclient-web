import { describe, expect, it } from 'vitest';
import { idle, mapFrame, type Button, type Mode } from '../lib/gamepad/mapping';
import { Direction } from '../lib/player';

const bindings = Array.from({length: 24}, (_, i) => String(i));
function driver() {
  let state = idle();
  return (buttons: Button[] | null, mode: Mode = 'game', now = 0, x = 0) => {
    state = mapFrame(state, buttons && { pressed: new Set(buttons), left: [x, 0], right: [0, 0] }, mode, bindings, now);
    return state;
  };
}
describe('controller mapping', () => {
  it.each([[[], '0'], [['l1'], '6'], [['l2'], '12'], [['l1','l2'], '18']] as [Button[], string][])(
    'casts once on a new press with modifiers %j', (mods, words) => {
      const frame = driver();
      frame([]);
      expect(frame([...mods, 'cross']).actions).toEqual([{cast: words}]);
      expect(frame(['cross']).actions).toEqual([]);
      expect(frame(['l1', 'cross']).actions).toEqual([]);
    });
  it('requires release after activation, mode changes and reconnection', () => {
    const frame = driver();
    expect(frame(['cross','up']).held).toBeNull();
    frame([]);
    expect(frame(['up','cross']).held).toBe(Direction.North);
    expect(frame(['up','cross'], 'ui').actions).toEqual([]);
    expect(frame(['up','cross'], 'game').held).toBeNull();
    expect(frame(null).held).toBeNull();
    expect(frame(['cross','up']).actions).toEqual([]);
    expect(frame([], 'game', 0, .1).held).toBeNull();
    expect(frame([], 'game', 0, .6).held).toBe(Direction.East);
  });
  it('repeats UI navigation after a delay and suppresses game actions', () => {
    const frame = driver();
    frame([], 'ui');
    expect(frame(['right','r3'], 'ui').actions).toEqual([{focus: Direction.East}]);
    expect(frame(['right'], 'ui', 250).actions).toEqual([]);
    expect(frame(['right'], 'ui', 380).actions).toEqual([{focus: Direction.East}]);
    expect(frame(['cross'], 'ui').actions).toEqual(['activate']);
    expect(frame(['circle'], 'ui').actions).toEqual(['back']);
  });
});
