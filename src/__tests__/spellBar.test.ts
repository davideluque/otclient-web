// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpellBar } from '../lib/spellBar';

afterEach(() => {
  document.body.replaceChildren();
});

describe('createSpellBar (arc layout)', () => {
  const spells = [
    { id: 'a', label: 'a', cooldownMs: 1000 },
    { id: 'b', label: 'b', cooldownMs: 1000 },
    { id: 'c', label: 'c', cooldownMs: 1000 },
  ];

  it('fans slots over the quarter circle: slot 1 left of the anchor, last above it', () => {
    const bar = createSpellBar({ spells, onCast: vi.fn() });
    const btns = [...bar.el.querySelectorAll<HTMLButtonElement>('button')];
    expect(btns).toHaveLength(3);

    // anchorCenter 32 + R 104 − half-button 28, rounded.
    expect(btns[0].style.right).toBe('108px'); // straight left
    expect(btns[0].style.bottom).toBe('4px');
    expect(btns[1].style.right).toBe('78px'); // 45° midpoint
    expect(btns[1].style.bottom).toBe('78px');
    expect(btns[2].style.right).toBe('4px'); // straight above
    expect(btns[2].style.bottom).toBe('108px');
    bar.destroy();
  });

  it('puts a single slot at the 45° midpoint', () => {
    const bar = createSpellBar({ spells: spells.slice(0, 1), onCast: vi.fn() });
    const btn = bar.el.querySelector('button') as HTMLButtonElement;
    expect(btn.style.right).toBe('78px');
    expect(btn.style.bottom).toBe('78px');
    bar.destroy();
  });

  it('still casts and sweeps cooldowns from arc buttons', () => {
    const onCast = vi.fn();
    const bar = createSpellBar({ spells, onCast });
    const btn = bar.el.querySelector('button') as HTMLButtonElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCast).toHaveBeenCalledWith('a');
    // On cooldown now — a second press is swallowed.
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onCast).toHaveBeenCalledTimes(1);
    bar.destroy();
  });
});
