// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { loadBindings, saveBindings } from '../lib/gamepad/bindings';
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
