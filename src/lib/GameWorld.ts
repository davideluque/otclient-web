import type { InputPacket } from './net/common/InputPacket';
import type { PacketDispatcher } from './net/common/PacketDispatcher';
import type { GameProtocol, MapTile, MapCreature } from './net/common/types';
import type { ResolvedTile } from './tileMap';

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

  /** Callback when map or creatures change. */
  onChange: (() => void) | null = null;

  /**
   * Bumped whenever tile contents change (not on creature-only updates).
   * Lets the renderer skip full repaints for creature moves, which fire
   * `onChange` far more often than the map actually changes.
   */
  tileRevision = 0;

  private protocol: GameProtocol;

  constructor(protocol: GameProtocol) {
    this.protocol = protocol;
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

    // Register any creatures on this tile
    for (const c of tile.creatures) {
      this.creatures.set(c.id, {
        id: c.id,
        name: c.name,
        x: tile.x,
        y: tile.y,
        z: tile.z,
        direction: c.direction,
        health: c.health,
        speed: c.speed,
        outfit: c.outfit,
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
    const tile: MapTile = { x: pos.x, y: pos.y, z: pos.z, items: [], creatures: [] };
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
      tile = { x: pos.x, y: pos.y, z: pos.z, items: [], creatures: [] };
      this.tiles.set(`${pos.x}:${pos.y}:${pos.z}`, tile);
    }

    const peek = packet.peekU16();
    if (peek === 0x61 || peek === 0x62) {
      packet.getU16(); // consume the known/unknown creature marker
      // 0x61 is the UNKNOWN long form in 7.6 (verified against the
      // server's AddCreature), 0x62 the known short form.
      const creature = this.protocol.map.parseCreature(packet, peek === 0x61);
      tile.creatures.push(creature);
      this.creatures.set(creature.id, {
        id: creature.id,
        name: creature.name,
        x: pos.x, y: pos.y, z: pos.z,
        direction: creature.direction,
        health: creature.health,
        speed: creature.speed,
        outfit: creature.outfit,
      });
    } else {
      // The server inserts by stack priority; pushing approximates the
      // paint order well enough for the current renderer.
      tile.items.push(this.protocol.map.parseItem(packet));
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
      const tile = this.getTile(pos.x, pos.y, pos.z);
      const tc = tile?.creatures.find((c) => c.id === turn.creatureId);
      if (tc) tc.direction = turn.direction;
      this.onChange?.();
      return;
    }
    const item = this.protocol.map.parseItem(packet);
    const tile = this.getTile(pos.x, pos.y, pos.z);
    if (tile) {
      // Our tile model splits items and creatures, so the wire stack
      // position (which interleaves them) maps approximately: positions
      // inside the item list replace in place, anything else appends.
      if (stackPos < tile.items.length) tile.items[stackPos] = item;
      else tile.items.push(item);
      this.tileRevision++;
    }
    this.onChange?.();
  }

  /** 0x6C — remove the thing at a stack position (item or creature). */
  private handleTileRemoveThing(packet: InputPacket): void {
    const pos = this.protocol.map.parsePosition(packet);
    const stackPos = packet.getU8();
    const tile = this.getTile(pos.x, pos.y, pos.z);
    if (tile) {
      if (stackPos < tile.items.length) {
        tile.items.splice(stackPos, 1);
      } else {
        // Same approximation as transform: a stack position beyond the
        // item list refers to one of the tile's creatures.
        const ci = stackPos - tile.items.length;
        const [removed] = tile.creatures.splice(ci, 1);
        if (removed) this.creatures.delete(removed.id);
      }
      this.tileRevision++;
    }
    this.onChange?.();
  }

  /** 0x8C — creature health percent changed. */
  private handleCreatureHealth(packet: InputPacket): void {
    const ev = this.protocol.creature.parseHealth(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (wc) wc.health = ev.healthPercent;
    this.onChange?.();
  }

  /** 0x8E — creature outfit changed (or went invisible: lookType 0). */
  private handleCreatureOutfit(packet: InputPacket): void {
    const ev = this.protocol.creature.parseOutfit(packet);
    const wc = this.creatures.get(ev.creatureId);
    if (wc) {
      wc.outfit = { lookType: ev.lookType, head: ev.head, body: ev.body, legs: ev.legs, feet: ev.feet };
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

  private handleMoveNorth(packet: InputPacket): void {
    this.playerY--;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY - 6,
      this.playerX + 9, this.playerY - 6,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleMoveEast(packet: InputPacket): void {
    this.playerX++;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX + 9, this.playerY - 6,
      this.playerX + 9, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleMoveSouth(packet: InputPacket): void {
    this.playerY++;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY + 7,
      this.playerX + 9, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleMoveWest(packet: InputPacket): void {
    this.playerX--;
    const tiles = this.protocol.map.parseDescription(
      packet,
      this.playerX - 8, this.playerY - 6,
      this.playerX - 8, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleCreatureMove(packet: InputPacket): void {
    const event = this.protocol.creature.parseMove(packet);
    const fromTile = this.getTile(event.fromX, event.fromY, event.fromZ);
    if (fromTile && fromTile.creatures.length > event.fromStack) {
      // Remove creature from source tile
      const [creature] = fromTile.creatures.splice(event.fromStack, 1);
      const wc = this.creatures.get(creature.id);
      if (wc) {
        wc.x = event.toX;
        wc.y = event.toY;
        wc.z = event.toZ;
      }
      // Add creature to destination tile
      const toTile = this.getTile(event.toX, event.toY, event.toZ);
      if (toTile) {
        toTile.creatures.push(creature);
      }
    }
    this.onChange?.();
  }
}
