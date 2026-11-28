import { loadSpellSlots, spellByWords } from '../spells';
import { slots } from './mapping';

export const glyphs = ['✕','○','□','△','R1','R2'];
export const layers = ['Base', 'L1', 'L2', 'L1 + L2'];
const key = 'jamera.controllerSpells';
export function loadBindings(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (Array.isArray(value) && value.length === layers.length * slots.length
      && value.every((word) => word === '' || typeof word === 'string' && spellByWords(word))) return value;
  } catch { /* Use the current touch slots on first use or invalid data. */ }
  return [...loadSpellSlots(), 'exana pox', 'utamo vita', 'utani hur', ...Array<string>(18).fill('')];
}
export function saveBindings(value: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* In-memory bindings survive this session. */ }
}

const repeatKey = 'jamera.controllerRepeat';
export function loadRepeatSlots(): boolean[] {
  const count = layers.length * slots.length;
  try {
    const values = JSON.parse(localStorage.getItem(repeatKey) ?? 'null');
    if (Array.isArray(values) && values.length === count && values.every(v => typeof v === 'boolean')) return values;
  } catch { /* Old profiles and unavailable storage default to edge-triggered casting. */ }
  return Array<boolean>(count).fill(false);
}
export function saveRepeatSlots(values: readonly boolean[]): void {
  try { localStorage.setItem(repeatKey,JSON.stringify(values)); } catch { /* Keep the session preference. */ }
}
