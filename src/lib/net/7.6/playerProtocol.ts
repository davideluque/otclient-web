import type { InputPacket } from '../common/InputPacket';
import type { PlayerStats, PlayerSkills } from '../common/types';

/**
 * 7.6 player-state packets, layouts verified against the server's
 * AddPlayerStats / AddPlayerSkills (protocol76.cpp).
 */

/** 0xA0 — everything the HUD needs. 20 bytes. */
export function parsePlayerStats(packet: InputPacket): PlayerStats {
  return {
    health: packet.getU16(),
    maxHealth: packet.getU16(),
    capacity: packet.getU16(),
    experience: packet.getU32(),
    level: packet.getU16(),
    levelPercent: packet.getU8(),
    mana: packet.getU16(),
    maxMana: packet.getU16(),
    magicLevel: packet.getU8(),
    magicLevelPercent: packet.getU8(),
    soul: packet.getU8(),
  };
}

/**
 * 0xA1 — seven (level, percent) byte pairs in wire order:
 * fist, club, sword, axe, distance, shielding, fishing.
 */
export function parsePlayerSkills(packet: InputPacket): PlayerSkills {
  const pair = (): { level: number; percent: number } => ({
    level: packet.getU8(),
    percent: packet.getU8(),
  });
  return {
    fist: pair(),
    club: pair(),
    sword: pair(),
    axe: pair(),
    distance: pair(),
    shielding: pair(),
    fishing: pair(),
  };
}
