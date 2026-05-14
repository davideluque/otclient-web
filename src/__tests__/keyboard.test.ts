/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createKeyboard } from '../lib/keyboard';
import { Direction } from '../lib/player';
import type { KeyboardHandle } from '../lib/keyboard';

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}
function release(key: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

describe('createKeyboard', () => {
  let kb: KeyboardHandle;

  afterEach(() => kb?.destroy());

  it('arrow keys set heldDirection', () => {
    kb = createKeyboard();
    press('ArrowUp');
    expect(kb.heldDirection).toBe(Direction.North);
    release('ArrowUp');
    expect(kb.heldDirection).toBeNull();
  });

  it('WASD keys set heldDirection', () => {
    kb = createKeyboard();
    press('a');
    expect(kb.heldDirection).toBe(Direction.West);
    release('a');
    press('d');
    expect(kb.heldDirection).toBe(Direction.East);
    release('d');
  });

  it('last-pressed wins when multiple held', () => {
    kb = createKeyboard();
    press('ArrowUp');
    press('ArrowRight');
    expect(kb.heldDirection).toBe(Direction.East); // last pressed
    release('ArrowRight');
    expect(kb.heldDirection).toBe(Direction.North); // falls back
    release('ArrowUp');
    expect(kb.heldDirection).toBeNull();
  });

  it('fires onToggle for toggle bindings', () => {
    const toggles: string[] = [];
    kb = createKeyboard({ onToggle: (id) => toggles.push(id) });
    press('n');
    expect(toggles).toEqual(['night']);
  });

  it('clears direction on blur', () => {
    kb = createKeyboard();
    press('w');
    expect(kb.heldDirection).toBe(Direction.North);
    window.dispatchEvent(new Event('blur'));
    expect(kb.heldDirection).toBeNull();
  });

  it('supports custom bindings', () => {
    kb = createKeyboard({
      bindings: { z: { type: 'move', dir: Direction.South } },
    });
    press('z');
    expect(kb.heldDirection).toBe(Direction.South);
    release('z');
  });

  it('ignores unmapped keys', () => {
    kb = createKeyboard();
    press('x');
    expect(kb.heldDirection).toBeNull();
  });
});
