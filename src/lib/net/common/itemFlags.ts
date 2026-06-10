/**
 * Wire-format item knowledge derived from the client .dat file.
 *
 * The 7.6 server appends a count/subtype byte after an item's U16 client
 * ID when the item type is stackable, a splash, or a fluid container
 * (see the server's NetworkMessage::AddItem). The client can't parse any
 * item off the wire without knowing which IDs that applies to — and that
 * knowledge lives in the .dat attributes.
 *
 * Module-level singleton on purpose: there is exactly one dat per page,
 * and threading the lookup through every protocol parser signature would
 * be plumbing for its own sake. jamera populates it as soon as the asset
 * bundle's .dat parses (long before a human finishes typing credentials).
 */

import type { DatFile } from '../../dat';
import { DatAttr } from '../../dat';

let countedIds: Set<number> | null = null;

export function setItemWireFlags(dat: DatFile): void {
  const ids = new Set<number>();
  for (const thing of dat.items) {
    if (
      thing.attrs.has(DatAttr.Stackable) ||
      thing.attrs.has(DatAttr.FluidContainer) ||
      thing.attrs.has(DatAttr.Splash)
    ) {
      ids.add(thing.id);
    }
  }
  countedIds = ids;
}

/** True when the wire form of `clientId` carries a trailing count byte. */
export function itemHasCountByte(clientId: number): boolean {
  return countedIds?.has(clientId) ?? false;
}

/** Whether setItemWireFlags has run — parsers misalign on stackables until then. */
export function itemWireFlagsReady(): boolean {
  return countedIds !== null;
}

/** Test helper: return to the unloaded state. */
export function resetItemWireFlags(): void {
  countedIds = null;
}
