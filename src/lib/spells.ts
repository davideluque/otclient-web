/**
 * Known 7.6 spells — the registry feeding the spell bar and the slot
 * customizer. Icons are curated emoji (7.6 has no spell sprites in the
 * .dat; the client book used a fixed bitmap we don't ship), words are
 * what actually gets said on cast.
 */

export interface SpellDef {
  /** The incantation — also the unique id. */
  words: string;
  name: string;
  icon: string;
  /** Client-side recast throttle. */
  cooldownMs: number;
}

export const SPELLS: readonly SpellDef[] = [
  { words: 'exura', name: 'Light Healing', icon: '💚', cooldownMs: 1000 },
  { words: 'exura gran', name: 'Intense Healing', icon: '💖', cooldownMs: 1000 },
  { words: 'exura vita', name: 'Ultimate Healing', icon: '✨', cooldownMs: 2000 },
  { words: 'exana pox', name: 'Antidote', icon: '🧪', cooldownMs: 1000 },
  { words: 'utevo lux', name: 'Light', icon: '🕯️', cooldownMs: 2000 },
  { words: 'utevo gran lux', name: 'Great Light', icon: '💡', cooldownMs: 2000 },
  { words: 'utani hur', name: 'Haste', icon: '💨', cooldownMs: 2000 },
  { words: 'utani gran hur', name: 'Strong Haste', icon: '🌪️', cooldownMs: 2000 },
  { words: 'utamo vita', name: 'Magic Shield', icon: '🔮', cooldownMs: 2000 },
  { words: 'exori', name: 'Berserk', icon: '⚔️', cooldownMs: 4000 },
  { words: 'exori mort', name: 'Death Strike', icon: '💀', cooldownMs: 2000 },
  { words: 'exori vis', name: 'Energy Strike', icon: '⚡', cooldownMs: 2000 },
  { words: 'exori flam', name: 'Flame Strike', icon: '🔥', cooldownMs: 2000 },
  { words: 'exevo flam hur', name: 'Fire Wave', icon: '🌊', cooldownMs: 4000 },
  { words: 'exevo vis hur', name: 'Energy Wave', icon: '🌩️', cooldownMs: 4000 },
  { words: 'exani tera', name: 'Magic Rope', icon: '🪢', cooldownMs: 1000 },
] as const;

export function spellByWords(words: string): SpellDef | undefined {
  return SPELLS.find((s) => s.words === words);
}

/** The right-side slot configuration, persisted per browser. */
export const SPELL_SLOT_COUNT = 3;
export const DEFAULT_SLOTS: readonly string[] = ['exura', 'exura vita', 'utevo lux'];
const STORAGE_KEY = 'jamera.spellSlots';

export function loadSpellSlots(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw) && raw.length === SPELL_SLOT_COUNT && raw.every((w) => spellByWords(String(w)))) {
      return raw.map(String);
    }
  } catch { /* fall through to defaults */ }
  return [...DEFAULT_SLOTS];
}

export function saveSpellSlots(slots: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slots.slice(0, SPELL_SLOT_COUNT)));
  } catch { /* storage blocked — session-only config */ }
}
