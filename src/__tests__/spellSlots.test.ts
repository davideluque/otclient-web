// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SLOTS, SPELLS, loadSpellSlots, saveSpellSlots, spellByWords, spellIconUrl, spellSlug } from '../lib/spells';
import { createSpellCustomizer } from '../lib/spellCustomizer';

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('spell registry + slot persistence', () => {
  it('covers the full server spell list with unique words', () => {
    // 38 instants + 34 conjures from jameraServer76's spells.xml.
    expect(SPELLS.length).toBe(72);
    expect(new Set(SPELLS.map((s) => s.words)).size).toBe(SPELLS.length);
    expect(new Set(SPELLS.map((s) => spellSlug(s.name))).size).toBe(SPELLS.length);
    for (const s of SPELLS) {
      expect(s.words.length).toBeGreaterThan(2);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.cooldownMs).toBeGreaterThan(0);
    }
    expect(spellByWords('exura')?.name).toBe('Light Healing');
    // Words must match THIS server: its Energy Wave is exevo mort hur,
    // and exevo vis hur does not exist in its spells.xml.
    expect(spellByWords('exevo mort hur')?.name).toBe('Energy Wave');
    expect(spellByWords('exevo vis hur')).toBeUndefined();
  });

  it('maps icon urls to the downloaded library assets', () => {
    const exura = spellByWords('exura')!;
    expect(spellIconUrl(exura)).toBe('/assets/spells/lighthealing.png');
    // Custom server spell with no tibia.com image → emoji fallback.
    const custom = spellByWords('exori sonu')!;
    expect(spellIconUrl(custom)).toBeNull();
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

describe('createSpellCustomizer (hotkeys menu)', () => {
  function rows(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.spell-customizer .slot')];
  }
  function picks(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('.spell-customizer .pick')];
  }

  it('opens the full picker from a slot and assigns the tapped spell', () => {
    const onChange = vi.fn();
    const c = createSpellCustomizer({ initial: [...DEFAULT_SLOTS], onChange });
    c.open();
    expect(rows()[0].textContent).toContain('Light Healing'); // exura

    rows()[0].click();
    const el = document.querySelector('.spell-customizer') as HTMLElement;
    expect(el.classList.contains('picking')).toBe(true);
    // The picker lists the whole registry.
    expect(picks().length).toBe(SPELLS.length);

    const haste = picks().find((b) => b.textContent?.includes('Haste'))!;
    haste.click();
    expect(el.classList.contains('picking')).toBe(false);
    expect(rows()[0].textContent).toContain('Haste');
    expect(onChange).toHaveBeenCalledWith(['utani hur', DEFAULT_SLOTS[1], DEFAULT_SLOTS[2]]);
    c.destroy();
    expect(document.querySelector('.spell-customizer')).toBeNull();
  });

  it('swaps slots when picking a spell already assigned elsewhere', () => {
    const onChange = vi.fn();
    const c = createSpellCustomizer({ initial: [...DEFAULT_SLOTS], onChange });
    c.open();

    // Put slot 2's spell (exura vita) on slot 1 → they swap.
    rows()[0].click();
    const target = picks().find((b) => b.textContent?.includes('Ultimate Healing') && !b.textContent?.includes('Rune'))!;
    target.click();
    expect(onChange).toHaveBeenCalledWith(['exura vita', 'exura', DEFAULT_SLOTS[2]]);
    expect(rows()[0].textContent).toContain('Ultimate Healing');
    expect(rows()[1].textContent).toContain('Light Healing');
    c.destroy();
  });

  it('escape backs out of the picker before closing the menu', () => {
    const c = createSpellCustomizer({ initial: [...DEFAULT_SLOTS], onChange: vi.fn() });
    c.open();
    rows()[0].click();
    const el = document.querySelector('.spell-customizer') as HTMLElement;
    expect(el.classList.contains('picking')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.classList.contains('picking')).toBe(false);
    expect(el.classList.contains('open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(el.classList.contains('open')).toBe(false);
    c.destroy();
  });
});
