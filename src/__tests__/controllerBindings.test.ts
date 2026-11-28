// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { loadBindings, saveBindings } from '../lib/gamepad/bindings';
import { createControllerHUD } from '../lib/gamepad/hud';
import { saveSpellSlots } from '../lib/spells';
afterEach(() => localStorage.clear());
it('seeds 24 independent slots from the current touch layout', () => {
  saveSpellSlots(['utani hur','exura','exura gran']);
  const words = loadBindings();
  expect(words).toHaveLength(24);
  expect(words.slice(0,3)).toEqual(['utani hur','exura','exura gran']);
  words[23] = 'exori';
  saveBindings(words);
  expect(loadBindings()[23]).toBe('exori');
  expect(JSON.parse(localStorage.getItem('jamera.spellSlots')!)).toHaveLength(3);
});

it('displays the registry artwork and shared cooldown, then clears an empty layer', () => {
  const hud = createControllerHUD();
  const bindings = loadBindings();
  hud.update(0, bindings, () => 20, 10);
  const first = hud.el.querySelector('li')!;
  expect(first.querySelector('img')?.alt).toBe('Light Healing');
  expect(first.dataset.cooling).toBe('true');
  hud.update(0, bindings, () => 20, 21);
  expect(first.dataset.cooling).toBe('false');
  hud.update(1, bindings, () => 0, 21);
  expect(first.querySelector('img')).toBeNull();
  expect(first.textContent).toContain('—');
  hud.destroy();
});
