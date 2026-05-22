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
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
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
