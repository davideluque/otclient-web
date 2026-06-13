import type { InputPacket } from './net/common/InputPacket';
import type { PacketDispatcher } from './net/common/PacketDispatcher';
import type { GameProtocol, MapTile, MapCreature } from './net/common/types';
import type { ResolvedTile } from './tileMap';
import type { ThingType } from './dat';
import { DatAttr } from './dat';
import { directionFromStepDelta } from './player';

export interface WorldCreature {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  direction: number;
  health: number;
  speed: number;
  outfit: MapCreature['outfit'];
  /** Light emitted by the creature (torch in hand, fire fields…); 0 = none. */
  lightLevel: number;
  /** 7.6 palette index for the creature's light tint. */
  lightColor: number;
  /** performance.now()-style stamp of the last confirmed step (for walk animation). */
  lastMoveAt?: number;
  /**
   * Tile the last confirmed step departed from (same z) — the renderer
   * interpolates screen positions from here to (x, y) over the step
   * duration. Unset (or a >1-tile delta / z change) means teleport: snap.
   */
  fromX?: number;
  fromY?: number;
}

/**
 * Maintains the live game world state: tiles, creatures, and player position.
 * Registers handlers on the PacketDispatcher to receive server updates.
 */
export class GameWorld {
  /** Live tiles indexed by "x:y:z". */
  private tiles = new Map<string, MapTile>();

  /** Creatures indexed by creature ID. */
  private creatures = new Map<number, WorldCreature>();

  /** The local player's creature ID (set by SelfAppear). */
  playerCreatureId = 0;

  /** Player position. */
  playerX = 0;
  playerY = 0;
  playerZ = 7;

  /**
   * Count of confirmed self steps (position actually changed). The walk
   * controller uses this to attribute confirmations to its outstanding
   * sends — with one-step lookahead there can be two in flight, and
   * position snapshots alone can't tell how many landed.
   */
  selfSteps = 0;

  /** Callback when map or creatures change. */
  onChange: (() => void) | null = null;

  /**
   * Bumped whenever tile contents change (not on creature-only updates).
   * Lets the renderer skip full repaints for creature moves, which fire
   * `onChange` far more often than the map actually changes.
   */
  tileRevision = 0;

  /**
   * Bumped whenever creature state changes (position, direction, health,
   * outfit, speed, appear/disappear) — the creature-layer counterpart of
   * tileRevision, so the renderer can key its repaints on both.
   */
  creatureRevision = 0;

  /**
   * Ambient world light from 0x82: level 0–255 (the server's day/night
   * cycle; ~250 full day, ~40 night) and a 7.6 palette color index.
   * Defaults to full daylight until the server says otherwise — the
   * 0x82 always arrives right after login.
   */
  worldLight = { level: 250, color: 0xd7 };

  /**
   * While true, syncSelfCreature records no glide origin. Set by
   * handleFloorChange and cleared in a microtask: the 0x65–0x68 resync
   * slices embedded in (and trailing) a floor-change message dispatch
   * synchronously in the same task, so exactly the transition's syncs
   * snap and the first real step afterwards glides again.
   */
  private snapSelfSync = false;

  private protocol: GameProtocol;

  /** Client-ID → ThingType, for stack-order classification of items. */
  private datIndex: Map<number, ThingType> | null = null;

  constructor(protocol: GameProtocol) {
    this.protocol = protocol;
  }

  /**
   * Lets the world classify items into the server's stack sections
   * (ground / top items / down items) when inserting 0x6A adds. Without
   * it, adds fall back to the down-item section — right for the common
   * runtime adds (splashes, corpses, dropped loot).
   */
  setDatIndex(index: Map<number, ThingType>): void {
    this.datIndex = index;
  }

  // ── Tile stack helpers ─────────────────────────────────────────────
  // `tile.things` mirrors the server stack exactly (otserv
  // Tile::__getIndexOfThing order: ground, top items, creatures, down
  // items), so wire stack positions index it directly. The items/
  // creatures views are rebuilt after every mutation.

  private static syncTileViews(tile: MapTile): void {
    tile.items = [];
    tile.creatures = [];
    for (const t of tile.things) {
      if (t.kind === 'item') tile.items.push(t.item);
      else tile.creatures.push(t.creature);
    }
  }

  /**
   * The server's topOrder for an item: ground 0, ground border 1,
   * on-bottom 2, on-top 3; 4 = regular down item. Unknown IDs (no dat
   * yet) classify as down items.
   */
  private topOrder(clientId: number): number {
    const thing = this.datIndex?.get(clientId);
    if (!thing) return 4;
    if (thing.attrs.has(DatAttr.Ground)) return 0;
    if (thing.attrs.has(DatAttr.GroundBorder)) return 1;
    if (thing.attrs.has(DatAttr.OnBottom)) return 2;
    if (thing.attrs.has(DatAttr.OnTop)) return 3;
    return 4;
  }

  /** Index where the creature section starts (first creature, or the
   *  boundary between top items and down items). */
  private creatureSectionStart(tile: MapTile): number {
    let i = 0;
    for (const t of tile.things) {
      if (t.kind === 'creature') return i;
      if (this.topOrder(t.item.id) >= 4) return i;
      i++;
    }
    return i;
  }

  /** Index just past the last creature (where down items begin). */
  private downSectionStart(tile: MapTile): number {
    let i = this.creatureSectionStart(tile);
    while (i < tile.things.length && tile.things[i].kind === 'creature') i++;
    return i;
  }

  /** Mirror of otserv creatures.insert(begin): newest creature first. */
  private insertCreature(tile: MapTile, creature: MapCreature): void {
    tile.things.splice(this.creatureSectionStart(tile), 0, { kind: 'creature', creature });
    GameWorld.syncTileViews(tile);
  }

  /** Mirror of otserv Tile::__addThing for items. */
  private insertItem(tile: MapTile, item: MapTile['items'][number]): void {
    const order = this.topOrder(item.id);
    if (order >= 4) {
      // downItems.insert(begin): newest down item right after creatures.
      tile.things.splice(this.downSectionStart(tile), 0, { kind: 'item', item });
    } else {
      // Top section: insert before the first top item with a HIGHER
      // topOrder (otserv keeps topItems sorted by it); ground replaces
      // slot 0 territory by ordering naturally.
      const boundary = this.creatureSectionStart(tile);
      let at = 0;
      while (at < boundary) {
        const t = tile.things[at];
        if (t.kind === 'item' && this.topOrder(t.item.id) > order) break;
        at++;
      }
      tile.things.splice(at, 0, { kind: 'item', item });
    }
    GameWorld.syncTileViews(tile);
  }

  /** Remove the stack entry at a wire stack position. Returns it. */
  private removeAtStackPos(tile: MapTile, stackPos: number): MapTile['things'][number] | undefined {
    // splice() treats negative starts as from-the-end — a -1 from a
    // failed findIndex would silently eat the LAST stack entry.
    if (stackPos < 0 || stackPos >= tile.things.length) return undefined;
    const [removed] = tile.things.splice(stackPos, 1);
    if (removed) GameWorld.syncTileViews(tile);
    return removed;
  }

  /** Remove a creature from a tile's stack by id (server order kept). */
  private removeCreatureFromTile(tile: MapTile, creatureId: number): MapCreature | undefined {
    const i = tile.things.findIndex((t) => t.kind === 'creature' && t.creature.id === creatureId);
    if (i === -1) return undefined;
    const removed = tile.things.splice(i, 1)[0];
    GameWorld.syncTileViews(tile);
    return removed.kind === 'creature' ? removed.creature : undefined;
  }

  registerHandlers(dispatcher: PacketDispatcher): void {
    const op = this.protocol.serverOpcodes;
    dispatcher.on(op.MapDescription, (p) => this.handleMapDescription(p));
    dispatcher.on(op.MoveNorth, (p) => this.handleMoveNorth(p));
    dispatcher.on(op.MoveEast, (p) => this.handleMoveEast(p));
    dispatcher.on(op.MoveSouth, (p) => this.handleMoveSouth(p));
    dispatcher.on(op.MoveWest, (p) => this.handleMoveWest(p));
    dispatcher.on(op.CreatureMove, (p) => this.handleCreatureMove(p));
    dispatcher.on(op.SelfAppear, (p) => this.handleSelfAppear(p));
    dispatcher.on(op.TileUpdate, (p) => this.handleTileUpdate(p));
    dispatcher.on(op.TileAddThing, (p) => this.handleTileAddThing(p));
    dispatcher.on(op.TileTransformThing, (p) => this.handleTileTransformThing(p));
    dispatcher.on(op.TileRemoveThing, (p) => this.handleTileRemoveThing(p));
    dispatcher.on(op.CreatureHealth, (p) => this.handleCreatureHealth(p));
    dispatcher.on(op.CreatureOutfit, (p) => this.handleCreatureOutfit(p));
    dispatcher.on(op.CreatureSpeed, (p) => this.handleCreatureSpeed(p));
    dispatcher.on(op.FloorChangeUp, (p) => this.handleFloorChange(p, -1));
    dispatcher.on(op.FloorChangeDown, (p) => this.handleFloorChange(p, +1));
    // Registered after registerWireSkips, so these override the skips
    // (PacketDispatcher.on is a Map.set) — same pattern as the chat
    // binding.
    dispatcher.on(op.WorldLight, (p) => this.handleWorldLight(p));
    dispatcher.on(op.CreatureLight, (p) => this.handleCreatureLight(p));
  }

  /** 0x82 — ambient light: the server's day/night cycle. */
  private handleWorldLight(packet: InputPacket): void {
    this.worldLight = { level: packet.getU8(), color: packet.getU8() };
    this.onChange?.();
  }

  /** 0x8D — a creature's emitted light changed (torch lit/burned out). */
  private handleCreatureLight(packet: InputPacket): void {
    const ev = this.protocol.creature.parseLight(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (!wc) return; // unknown creature — nothing on screen changes
    wc.lightLevel = ev.lightLevel;
    wc.lightColor = ev.lightColor;
    this.creatureRevision++;
    this.onChange?.();
  }

  getTile(x: number, y: number, z: number): MapTile | undefined {
    return this.tiles.get(`${x}:${y}:${z}`);
  }

  getCreature(id: number): WorldCreature | undefined {
    return this.creatures.get(id);
  }

  getAllCreatures(): WorldCreature[] {
    return [...this.creatures.values()];
  }

  /**
   * Yield live tiles in the region in the shape `renderTileRegion`
   * consumes (the `TileSource` interface). Wire-side item IDs are
   * already the client-side dat IDs, so `clientId` maps 1:1 from
   * `item.id`. `flags` and `floorChange` are absent on the wire —
   * synthesised as `0` / `undefined`; `renderTile` reads neither.
   *
   * Creatures aren't yielded here — they need outfit-tint rendering
   * via `renderPlayer`, which is its own concern (separate PR).
   */
  *tilesInRegion(
    x1: number, y1: number, x2: number, y2: number, z: number,
  ): Generator<ResolvedTile> {
    // Row-major (y outer), matching TileMap.tilesInRegion: sprites stack
    // in insertion order, so southern rows must paint after northern ones
    // for 2.5D overlap (trees, wall tops) to layer correctly.
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const tile = this.tiles.get(`${x}:${y}:${z}`);
        if (!tile) continue;
        yield {
          x: tile.x,
          y: tile.y,
          z: tile.z,
          flags: 0,
          items: tile.items.map((item) => ({
            clientId: item.id,
            count: item.count,
          })),
        };
      }
    }
  }

  private setTile(tile: MapTile): void {
    this.tiles.set(`${tile.x}:${tile.y}:${tile.z}`, tile);
    this.tileRevision++;
    if (tile.creatures.length > 0) this.creatureRevision++;

    // Register any creatures on this tile. KNOWN-form creatures (0x62)
    // carry no name on the wire — the server expects the client to
    // remember it. Floor changes re-describe the player as KNOWN (going
    // down there isn't even a 0x6D), so clobbering the stored name here
    // is exactly the "my name disappears when I go down" bug.
    for (const c of tile.creatures) {
      const known = this.creatures.get(c.id);
      this.creatures.set(c.id, {
        id: c.id,
        name: c.name || known?.name || '',
        x: tile.x,
        y: tile.y,
        z: tile.z,
        direction: c.direction,
        health: c.health,
        speed: c.speed,
        outfit: c.outfit,
        lightLevel: c.lightLevel,
        lightColor: c.lightColor,
      });
    }
  }


  /**
   * 0x69 — replace one tile's full contents. An empty-marker payload
   * (high byte 0xFF) means the tile is now empty.
   */
  private handleTileUpdate(packet: InputPacket): void {
    const pos = this.protocol.map.parsePosition(packet);
    if ((packet.peekU16() & 0xff00) === 0xff00) {
      packet.getU16();
      this.tiles.delete(`${pos.x}:${pos.y}:${pos.z}`);
      this.tileRevision++;
      this.onChange?.();
      return;
    }
    const tile: MapTile = { x: pos.x, y: pos.y, z: pos.z, things: [], items: [], creatures: [] };
    this.protocol.map.parseTileSlot(packet, tile);
    this.setTile(tile);
    this.onChange?.();
  }

  /** 0x6A — a thing (item or creature) appeared on a tile. */
  private handleTileAddThing(packet: InputPacket): void {
    const pos = this.protocol.map.parsePosition(packet);
    // Mutate the existing tile in place rather than routing through
    // setTile: setTile re-registers every creature on the tile, which
    // would overwrite health/speed/outfit updates applied to the
    // registry since the tile was first parsed.
    let tile = this.getTile(pos.x, pos.y, pos.z);
    if (!tile) {
      tile = { x: pos.x, y: pos.y, z: pos.z, things: [], items: [], creatures: [] };
      this.tiles.set(`${pos.x}:${pos.y}:${pos.z}`, tile);
    }

    const peek = packet.peekU16();
    if (peek === 0x61 || peek === 0x62) {
      packet.getU16(); // consume the known/unknown creature marker
      // 0x61 is the UNKNOWN long form in 7.6 (verified against the
      // server's AddCreature), 0x62 the known short form.
      const creature = this.protocol.map.parseCreature(packet, peek === 0x61);
      this.insertCreature(tile, creature);
      this.creatureRevision++;
      // KNOWN form carries no name — preserve the remembered one.
      const known = this.creatures.get(creature.id);
      this.creatures.set(creature.id, {
        id: creature.id,
        name: creature.name || known?.name || '',
        x: pos.x, y: pos.y, z: pos.z,
        direction: creature.direction,
        health: creature.health,
        speed: creature.speed,
        outfit: creature.outfit,
        lightLevel: creature.lightLevel,
        lightColor: creature.lightColor,
      });
    } else {
      // Insert by the server's stack priority (top items by topOrder,
      // down items at the front of the down section) so later wire
      // stack positions resolve against the same order the server used.
      this.insertItem(tile, this.protocol.map.parseItem(packet));
    }
    this.tileRevision++;
    this.onChange?.();
  }

  /**
   * 0x6B — transform the thing at a stack position: either an item
   * changing type, or (marked by U16 0x63) a creature turning.
   */
  private handleTileTransformThing(packet: InputPacket): void {
    const pos = this.protocol.map.parsePosition(packet);
    const stackPos = packet.getU8();
    if (packet.peekU16() === 0x63) {
      packet.getU16();
      const turn = this.protocol.creature.parseTurn(packet);
      const wc = this.creatures.get(turn.creatureId);
      if (wc) wc.direction = turn.direction;
      this.creatureRevision++;
      const tile = this.getTile(pos.x, pos.y, pos.z);
      const tc = tile?.creatures.find((c) => c.id === turn.creatureId);
      if (tc) tc.direction = turn.direction;
      this.onChange?.();
      return;
    }
    const item = this.protocol.map.parseItem(packet);
    const tile = this.getTile(pos.x, pos.y, pos.z);
    if (tile) {
      const target = tile.things[stackPos];
      if (target && target.kind === 'item') {
        tile.things[stackPos] = { kind: 'item', item };
      } else {
        // Stale stack position (shouldn't happen with the exact stack
        // model) — fall back to a priority insert rather than dropping.
        this.insertItem(tile, item);
      }
      GameWorld.syncTileViews(tile);
      this.tileRevision++;
    }
    this.onChange?.();
  }

  /**
   * 0x6C — remove the thing at a stack position (item or creature).
   * This is how creatures die on the wire: the server removes the
   * creature and adds its corpse (0x6A) — the stack position must
   * resolve exactly, or the corpse-for-creature swap removes the wrong
   * thing and the dead creature lingers at 0 hp.
   */
  private handleTileRemoveThing(packet: InputPacket): void {
    const pos = this.protocol.map.parsePosition(packet);
    const stackPos = packet.getU8();
    const tile = this.getTile(pos.x, pos.y, pos.z);
    if (tile) {
      const removed = this.removeAtStackPos(tile, stackPos);
      if (removed?.kind === 'creature') {
        this.creatures.delete(removed.creature.id);
        this.creatureRevision++;
      }
      this.tileRevision++;
    }
    this.onChange?.();
  }

  /** 0x8C — creature health percent changed. */
  private handleCreatureHealth(packet: InputPacket): void {
    const ev = this.protocol.creature.parseHealth(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (wc) {
      wc.health = ev.healthPercent;
      this.creatureRevision++;
    }
    this.onChange?.();
  }

  /** 0x8E — creature outfit changed (or went invisible: lookType 0). */
  private handleCreatureOutfit(packet: InputPacket): void {
    const ev = this.protocol.creature.parseOutfit(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (wc) {
      wc.outfit = { lookType: ev.lookType, head: ev.head, body: ev.body, legs: ev.legs, feet: ev.feet };
      this.creatureRevision++;
    }
    this.onChange?.();
  }

  /** 0x8F — creature speed changed. */
  private handleCreatureSpeed(packet: InputPacket): void {
    const ev = this.protocol.creature.parseSpeed(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (wc) wc.speed = ev.speed;
    this.onChange?.();
  }

  private handleSelfAppear(packet: InputPacket): void {
    this.playerCreatureId = packet.getU32();
    // Skip draw speed and canReportBugs
    packet.skip(2 + 1);
  }

  private handleMapDescription(packet: InputPacket): void {
    // The initial 0x64 frame is prefixed with the player's position; later
    // movement updates (0x65-0x68) are not.
    const pos = this.protocol.map.parsePosition(packet);
    this.playerX = pos.x;
    this.playerY = pos.y;
    this.playerZ = pos.z;

    // 18x14 visible area around the player, across all visible floors.
    const startX = this.playerX - 8;
    const startY = this.playerY - 6;
    const endX = this.playerX + 9;
    const endY = this.playerY + 7;

    const tiles = this.protocol.map.parseDescription(packet, startX, startY, endX, endY, this.playerZ);
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  /**
   * The server never sends CreatureMove for the player's own steps — the
   * 0x65–0x68 row updates ARE the confirmation. Relocate the player's
   * creature (registry + tile lists) whenever the player position moves.
   * Floor-change frames count their own confirmation; their embedded
   * row-resync slices are camera realignment, not additional walked steps.
   */
  private syncSelfCreature(oldX: number, oldY: number, oldZ: number): void {
    const self = this.creatures.get(this.playerCreatureId);
    if (!self) return;
    if (!this.snapSelfSync && (this.playerX !== oldX || this.playerY !== oldY || this.playerZ !== oldZ)) {
      this.selfSteps++;
    }
    const facing = directionFromStepDelta(this.playerX - oldX, this.playerY - oldY, self.direction);
    const fromTile = this.getTile(oldX, oldY, oldZ);
    const toTile = this.getTile(this.playerX, this.playerY, this.playerZ);
    if (fromTile && toTile) {
      const mc = this.removeCreatureFromTile(fromTile, this.playerCreatureId);
      if (mc) {
        mc.direction = facing;
        this.insertCreature(toTile, mc);
      }
    }
    // Missing destination tile: leave the MapCreature where it is — the
    // registry below still tracks the true position, and dropping the
    // creature entirely would erase the player from the tile model.
    // Interpolation origin only for true single-tile steps on the same
    // floor — floor changes (including their same-z resync slices, see
    // snapSelfSync) and teleports must snap, not glide.
    const isStep = !this.snapSelfSync
      && oldZ === this.playerZ
      && Math.abs(this.playerX - oldX) <= 1 && Math.abs(this.playerY - oldY) <= 1;
    self.fromX = isStep ? oldX : undefined;
    self.fromY = isStep ? oldY : undefined;
    self.x = this.playerX;
    self.y = this.playerY;
    self.z = this.playerZ;
    self.direction = facing;
    self.lastMoveAt = performance.now();
    this.creatureRevision++;
  }

  private handleMoveNorth(packet: InputPacket): void {
    const oldX = this.playerX;
    const oldY = this.playerY;
    this.playerY--;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY - 6,
      this.playerX + 9, this.playerY - 6,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.syncSelfCreature(oldX, oldY, this.playerZ);
    this.onChange?.();
  }

  private handleMoveEast(packet: InputPacket): void {
    const oldX = this.playerX;
    const oldY = this.playerY;
    this.playerX++;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX + 9, this.playerY - 6,
      this.playerX + 9, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.syncSelfCreature(oldX, oldY, this.playerZ);
    this.onChange?.();
  }

  private handleMoveSouth(packet: InputPacket): void {
    const oldX = this.playerX;
    const oldY = this.playerY;
    this.playerY++;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY + 7,
      this.playerX + 9, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.syncSelfCreature(oldX, oldY, this.playerZ);
    this.onChange?.();
  }

  private handleMoveWest(packet: InputPacket): void {
    const oldX = this.playerX;
    const oldY = this.playerY;
    this.playerX--;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY - 6,
      this.playerX - 8, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.syncSelfCreature(oldX, oldY, this.playerZ);
    this.onChange?.();
  }

  /**
   * 0xBE / 0xBF — the player moved a floor. The frame carries newly
   * visible floor blocks (verified against the server's MoveUpCreature /
   * MoveDownCreature) followed by 0x65–0x68 resync slices that the
   * regular move handlers consume.
   *
   * Position math: the same screen centre maps to a different world
   * coordinate on the new floor (perspective offset), so going up is
   * (x+1, y+1, z-1) and down (x-1, y-1, z+1) — the embedded west+north
   * (up) or east+south (down) slices then walk x/y back to the player's
   * true coordinate while topping up the shifted view edge.
   */
  private handleFloorChange(packet: InputPacket, dz: -1 | 1): void {
    const oldX = this.playerX;
    const oldY = this.playerY;
    const oldZ = this.playerZ;
    const newZ = oldZ + dz;
    const startX = oldX - 8;
    const startY = oldY - 6;

    let floors: Array<{ z: number; offset: number }> = [];
    if (dz === -1) {
      if (newZ === 7) {
        // Surfacing: floors 5..0 become visible (7 and 6 already known).
        floors = [5, 4, 3, 2, 1, 0].map((z) => ({ z, offset: 8 - z }));
      } else if (newZ > 7) {
        // Still underground: one new floor scrolls into the z-2..z+2 window.
        floors = [{ z: oldZ - 3, offset: 3 }];
      }
      // Above-ground up (e.g. 6 → 5): every floor is already known.
    } else {
      if (newZ === 8) {
        // Going underground: the surface stack is replaced by z 8..10.
        floors = [
          { z: newZ, offset: -1 },
          { z: newZ + 1, offset: -2 },
          { z: newZ + 2, offset: -3 },
        ];
      } else if (newZ > 8 && newZ < 14) {
        floors = [{ z: newZ + 2, offset: -3 }];
      }
    }

    if (floors.length > 0) {
      const tiles = this.protocol.map.parseFloorStream(packet, startX, startY, floors, 18, 14);
      for (const tile of tiles) this.setTile(tile);
    }

    this.playerX = oldX - dz; // up: +1, down: -1 (covered offset)
    this.playerY = oldY - dz;
    this.playerZ = newZ;
    // The floor-change frame is one confirmed self step. The trailing
    // row updates only resync the shifted viewport, so syncSelfCreature
    // suppresses their counter increments while snapSelfSync is true.
    this.selfSteps++;
    // The transition's trailing 0x65–0x68 resync slices arrive in this
    // same synchronous dispatch — none of them are steps to glide.
    this.snapSelfSync = true;
    queueMicrotask(() => { this.snapSelfSync = false; });
    const selfC = this.creatures.get(this.playerCreatureId);
    if (selfC) { selfC.fromX = undefined; selfC.fromY = undefined; }
    this.tileRevision++;
    this.onChange?.();
  }

  private handleCreatureMove(packet: InputPacket): void {
    const event = this.protocol.creature.parseMove(packet);
    const fromTile = this.getTile(event.fromX, event.fromY, event.fromZ);
    this.creatureRevision++;
    if (fromTile && fromTile.creatures.length > 0) {
      // fromStack indexes the wire-ordered stack directly. If it
      // doesn't land on a creature (a desync we shouldn't see with the
      // exact stack model), fall back to the tile's first creature
      // rather than dropping the move.
      const at = fromTile.things[event.fromStack]?.kind === 'creature'
        ? event.fromStack
        : fromTile.things.findIndex((t) => t.kind === 'creature');
      const entry = this.removeAtStackPos(fromTile, at);
      if (!entry || entry.kind !== 'creature') {
        this.onChange?.();
        return;
      }
      const creature = entry.creature;
      creature.direction = directionFromStepDelta(
        event.toX - event.fromX, event.toY - event.fromY, creature.direction,
      );
      const wc = this.creatures.get(creature.id);
      if (wc) {
        const isStep = event.fromZ === event.toZ
          && Math.abs(event.toX - event.fromX) <= 1 && Math.abs(event.toY - event.fromY) <= 1;
        wc.fromX = isStep ? event.fromX : undefined;
        wc.fromY = isStep ? event.fromY : undefined;
        wc.x = event.toX;
        wc.y = event.toY;
        wc.z = event.toZ;
        wc.direction = creature.direction;
        wc.lastMoveAt = performance.now();
      }
      // Add creature to destination tile (front of its creature section,
      // matching the server's creatures.insert(begin)).
      const toTile = this.getTile(event.toX, event.toY, event.toZ);
      if (toTile) {
        this.insertCreature(toTile, creature);
      }
    }
    this.onChange?.();
  }
}
