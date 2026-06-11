/**
 * The spell registry feeding the spell bar and the hotkeys menu —
 * generated from the SERVER's data/spells/spells.xml (jameraServer76),
 * so words match what this server actually accepts (e.g. its Energy
 * Wave is "exevo mort hur", and "exori mort" is Force Strike here).
 *
 * Icons are the tibia.com spell library images (static.tibia.com
 * /images/library/<slug>.png) shipped under /assets/spells/; spells
 * without an official image (custom or house spells) fall back to the
 * emoji in `icon`.
 */

export interface SpellDef {
  /** The incantation — also the unique id. Cast by saying these words. */
  words: string;
  name: string;
  /** Emoji fallback when no library image exists for this spell. */
  icon: string;
  /** Client-side recast throttle. */
  cooldownMs: number;
  /** Conjure spells produce runes/ammo (need blank rune or hands free). */
  conjure?: boolean;
}

/**
 * Spell names with a downloaded tibia.com library image (58 of 72 —
 * custom spells like Berserk Paladin, long-removed ones like Force
 * Strike, and the house commands have no official image).
 */
const ICON_SLUGS: ReadonlySet<string> = new Set<string>([
  'animatedead', 'berserk', 'cancelinvisibility', 'challenge', 'chameleon',
  'conjurearrow', 'conjurebolt', 'conjureexplosivearrow', 'conjurepoisonedarrow',
  'conjurepowerbolt', 'convincecreature', 'creatureillusion', 'desintegrate',
  'destroyfield', 'enchantstaff', 'energybeam', 'energybomb', 'energyfield',
  'energystrike', 'energywall', 'energywave', 'explosion', 'findperson',
  'fireball', 'firebomb', 'firefield', 'firewall', 'firewave', 'flamestrike',
  'food', 'greatenergybeam', 'greatfireball', 'greatlight', 'haste',
  'healfriend', 'heavymagicmissile', 'intensehealing', 'intensehealingrune',
  'levitate', 'light', 'lighthealing', 'lightmagicmissile', 'magicrope',
  'magicshield', 'magicwall', 'masshealing', 'paralyze', 'poisonbomb',
  'poisonfield', 'poisonwall', 'soulfire', 'stronghaste', 'suddendeath',
  'summoncreature', 'ultimatehealing', 'ultimatehealingrune', 'ultimatelight',
  'wildgrowth',
]);

/** Slug used both for the asset filename and the tibia.com library URL. */
export function spellSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

/** /assets/spells/<slug>.png when the library image exists, else null. */
export function spellIconUrl(def: SpellDef): string | null {
  const slug = spellSlug(def.name);
  return ICON_SLUGS.has(slug) ? `/assets/spells/${slug}.png` : null;
}

export const SPELLS: readonly SpellDef[] = [
  // Healing & cure
  { words: 'exura', name: 'Light Healing', icon: '💚', cooldownMs: 1000 },
  { words: 'exura gran', name: 'Intense Healing', icon: '💖', cooldownMs: 1000 },
  { words: 'exura vita', name: 'Ultimate Healing', icon: '✨', cooldownMs: 2000 },
  { words: 'exura sio', name: 'Heal Friend', icon: '🤝', cooldownMs: 2000 },
  { words: 'exura gran mas res', name: 'Mass Healing', icon: '💞', cooldownMs: 4000 },
  { words: 'exana pox', name: 'Antidote', icon: '🧪', cooldownMs: 1000 },
  { words: 'exana flam', name: 'Antidote Fire', icon: '🚒', cooldownMs: 1000 },

  // Support & utility
  { words: 'utevo lux', name: 'Light', icon: '🕯️', cooldownMs: 2000 },
  { words: 'utevo gran lux', name: 'Great Light', icon: '💡', cooldownMs: 2000 },
  { words: 'utevo vis lux', name: 'Ultimate Light', icon: '🔆', cooldownMs: 2000 },
  { words: 'utani hur', name: 'Haste', icon: '💨', cooldownMs: 2000 },
  { words: 'utani gran hur', name: 'Strong Haste', icon: '🌪️', cooldownMs: 2000 },
  { words: 'utamo vita', name: 'Magic Shield', icon: '🔮', cooldownMs: 2000 },
  { words: 'utana vid', name: 'Invisibility', icon: '👻', cooldownMs: 2000 },
  { words: 'exana ina', name: 'Cancel Invisibility', icon: '👁️', cooldownMs: 2000 },
  { words: 'exani hur', name: 'Levitate', icon: '🪶', cooldownMs: 2000 },
  { words: 'exani tera', name: 'Magic Rope', icon: '🪢', cooldownMs: 1000 },
  { words: 'exiva', name: 'Find Person', icon: '🧭', cooldownMs: 2000 },
  { words: 'exeta res', name: 'Challenge', icon: '🗯️', cooldownMs: 2000 },
  { words: 'utevo res', name: 'Summon Creature', icon: '🐺', cooldownMs: 4000 },
  { words: 'utevo res ina', name: 'Creature Illusion', icon: '🎭', cooldownMs: 2000 },

  // Attack
  { words: 'exori', name: 'Berserk', icon: '⚔️', cooldownMs: 4000 },
  { words: 'exori sonu', name: 'Berserk Paladin', icon: '🏹', cooldownMs: 4000 },
  { words: 'exori mort', name: 'Force Strike', icon: '💀', cooldownMs: 2000 },
  { words: 'exori vis', name: 'Energy Strike', icon: '⚡', cooldownMs: 2000 },
  { words: 'exori flam', name: 'Flame Strike', icon: '🔥', cooldownMs: 2000 },
  { words: 'exevo flam hur', name: 'Fire Wave', icon: '🌊', cooldownMs: 4000 },
  { words: 'exevo mort hur', name: 'Energy Wave', icon: '🌩️', cooldownMs: 4000 },
  { words: 'exevo vis lux', name: 'Energy Beam', icon: '📡', cooldownMs: 4000 },
  { words: 'exevo gran vis lux', name: 'Great Energy Beam', icon: '🛰️', cooldownMs: 4000 },
  { words: 'exevo gran mas vis', name: 'Ultimate Explosion', icon: '💥', cooldownMs: 4000 },
  { words: 'exevo gran mas pox', name: 'Poison Storm', icon: '☠️', cooldownMs: 4000 },
  { words: 'exevo grav vita', name: 'Wild Growth', icon: '🌱', cooldownMs: 4000 },
  { words: 'exana mas mort', name: 'Undead Legion', icon: '🧟', cooldownMs: 4000 },

  // Conjure: ammo, food, enchantments
  { words: 'exevo con', name: 'Conjure Arrow', icon: '🏹', cooldownMs: 2000, conjure: true },
  { words: 'exevo con pox', name: 'Conjure Poisoned Arrow', icon: '🟢', cooldownMs: 2000, conjure: true },
  { words: 'exevo con flam', name: 'Conjure Explosive Arrow', icon: '🧨', cooldownMs: 2000, conjure: true },
  { words: 'exevo con mort', name: 'Conjure Bolt', icon: '🎯', cooldownMs: 2000, conjure: true },
  { words: 'exevo con vis', name: 'Conjure Power Bolt', icon: '🔩', cooldownMs: 2000, conjure: true },
  { words: 'exevo pan', name: 'Food', icon: '🍞', cooldownMs: 2000, conjure: true },
  { words: 'exeta vis', name: 'Enchant Staff', icon: '🪄', cooldownMs: 2000, conjure: true },

  // Conjure: rune spells (need a blank rune)
  { words: 'adori blank', name: 'Blank Rune', icon: '⬜', cooldownMs: 2000, conjure: true },
  { words: 'adura gran', name: 'Intense Healing Rune', icon: '🩹', cooldownMs: 2000, conjure: true },
  { words: 'adura vita', name: 'Ultimate Healing Rune', icon: '🩷', cooldownMs: 2000, conjure: true },
  { words: 'adana pox', name: 'Antidote Rune', icon: '💊', cooldownMs: 2000, conjure: true },
  { words: 'adori min vis', name: 'Light Magic Missile', icon: '🔹', cooldownMs: 2000, conjure: true },
  { words: 'adori gran', name: 'Heavy Magic Missile', icon: '🔷', cooldownMs: 2000, conjure: true },
  { words: 'adori flam', name: 'Fireball', icon: '☄️', cooldownMs: 2000, conjure: true },
  { words: 'adori gran flam', name: 'Great Fireball', icon: '🌋', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas hur', name: 'Explosion', icon: '💥', cooldownMs: 2000, conjure: true },
  { words: 'adori vita vis', name: 'Sudden Death', icon: '🪦', cooldownMs: 2000, conjure: true },
  { words: 'adevo res flam', name: 'Soulfire', icon: '🔥', cooldownMs: 2000, conjure: true },
  { words: 'adana mort', name: 'Animate Dead', icon: '🧟', cooldownMs: 2000, conjure: true },
  { words: 'adana ani', name: 'Paralyze', icon: '🥶', cooldownMs: 2000, conjure: true },
  { words: 'adeta sio', name: 'Convince Creature', icon: '🧠', cooldownMs: 2000, conjure: true },
  { words: 'adevo ina', name: 'Chameleon', icon: '🦎', cooldownMs: 2000, conjure: true },
  { words: 'adevo grav pox', name: 'Poison Field', icon: '🟩', cooldownMs: 2000, conjure: true },
  { words: 'adevo grav flam', name: 'Fire Field', icon: '🟥', cooldownMs: 2000, conjure: true },
  { words: 'adevo grav vis', name: 'Energy Field', icon: '🟨', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas grav pox', name: 'Poison Wall', icon: '🧱', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas grav flam', name: 'Fire Wall', icon: '🧱', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas grav vis', name: 'Energy Wall', icon: '🧱', cooldownMs: 2000, conjure: true },
  { words: 'adevo grav tera', name: 'Magic Wall', icon: '🪨', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas pox', name: 'Poison Bomb', icon: '💣', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas flam', name: 'Fire Bomb', icon: '💣', cooldownMs: 2000, conjure: true },
  { words: 'adevo mas vis', name: 'Energy Bomb', icon: '💣', cooldownMs: 2000, conjure: true },
  { words: 'adito grav', name: 'Destroy Field', icon: '🧹', cooldownMs: 2000, conjure: true },
  { words: 'adito tera', name: 'Desintegrate', icon: '🫥', cooldownMs: 2000, conjure: true },

  // House commands
  { words: 'aleta sio', name: 'House Guest List', icon: '🏠', cooldownMs: 1000 },
  { words: 'aleta som', name: 'House Subowner List', icon: '🏠', cooldownMs: 1000 },
  { words: 'aleta grav', name: 'House Door List', icon: '🚪', cooldownMs: 1000 },
  { words: 'alana sio', name: 'House Kick', icon: '🥾', cooldownMs: 1000 },
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
