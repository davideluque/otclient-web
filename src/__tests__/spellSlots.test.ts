// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, SPELLS, loadSpellSlots, saveSpellSlots, spellByWords } from '../lib/spells';
import { createSpellCustomizer } from '../lib/spellCustomizer';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('spell registry + slot persistence', () => {
  it('every registry entry has icon, name, words, cooldown', () => {
    expect(SPELLS.length).toBeGreaterThanOrEqual(12);
    for (const s of SPELLS) {
      expect(s.words.length).toBeGreaterThan(2);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.cooldownMs).toBeGreaterThan(0);
    }
    expect(spellByWords('exura')?.name).toBe('Light Healing');
  });

  it('round-trips slots and falls back to defaults on garbage', () => {
    saveSpellSlots(['exori', 'utani hur', 'utamo vita']);
    expect(loadSpellSlots()).toEqual(['exori', 'utani hur', 'utamo vita']);
    localStorage.setItem('jamera.spellSlots', '["not a spell","x","y"]');
    expect(loadSpellSlots()).toEqual([...DEFAULT_SLOTS]);
    localStorage.setItem('jamera.spellSlots', '{broken');
    expect(loadSpellSlots()).toEqual([...DEFAULT_SLOTS]);
  });
});

describe('createSpellCustomizer', () => {
  it('cycles a slot through the registry and reports the new set', () => {
    const onChange = vi.fn();
    const c = createSpellCustomizer({ initial: [...DEFAULT_SLOTS], onChange });
    c.open();
    const firstRow = document.querySelector('.spell-customizer .slot') as HTMLButtonElement;
    expect(firstRow.textContent).toContain('Light Healing'); // exura
    firstRow.click();
    const idx = SPELLS.findIndex((s) => s.words === 'exura');
    const expected = SPELLS[(idx + 1) % SPELLS.length];
    expect(firstRow.textContent).toContain(expected.name);
    expect(onChange).toHaveBeenCalledWith([expected.words, DEFAULT_SLOTS[1], DEFAULT_SLOTS[2]]);
    c.destroy();
    expect(document.querySelector('.spell-customizer')).toBeNull();
  });
});
