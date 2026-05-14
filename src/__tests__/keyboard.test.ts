/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createKeyboard } from '../lib/keyboard';
import { Direction } from '../lib/player';
import type { KeyboardHandle } from '../lib/keyboard';

function press(code: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
}
function release(code: string) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
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

  it('WASD keys set heldDirection (physical key position)', () => {
    kb = createKeyboard();
    press('KeyA');
    expect(kb.heldDirection).toBe(Direction.West);
    release('KeyA');
    press('KeyD');
    expect(kb.heldDirection).toBe(Direction.East);
    release('KeyD');
  });

  it('last-pressed wins when multiple held', () => {
    kb = createKeyboard();
    press('ArrowUp');
    press('ArrowRight');
    expect(kb.heldDirection).toBe(Direction.East);
    release('ArrowRight');
    expect(kb.heldDirection).toBe(Direction.North);
    release('ArrowUp');
    expect(kb.heldDirection).toBeNull();
  });

  it('fires onToggle for toggle bindings', () => {
    const toggles: string[] = [];
    kb = createKeyboard({ onToggle: (id) => toggles.push(id) });
    press('KeyN');
    expect(toggles).toEqual(['night']);
  });

  it('ignores toggle on key repeat', () => {
    const toggles: string[] = [];
    kb = createKeyboard({ onToggle: (id) => toggles.push(id) });
    press('KeyN');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', repeat: true }));
    expect(toggles).toEqual(['night']);
  });

  it('clears direction on blur', () => {
    kb = createKeyboard();
    press('KeyW');
    expect(kb.heldDirection).toBe(Direction.North);
    window.dispatchEvent(new Event('blur'));
    expect(kb.heldDirection).toBeNull();
  });

  it('supports custom bindings', () => {
    kb = createKeyboard({
      bindings: { KeyZ: { type: 'move', dir: Direction.South } },
    });
    press('KeyZ');
    expect(kb.heldDirection).toBe(Direction.South);
    release('KeyZ');
  });

  it('ignores unmapped keys', () => {
    kb = createKeyboard();
    press('KeyX');
    expect(kb.heldDirection).toBeNull();
  });
});
