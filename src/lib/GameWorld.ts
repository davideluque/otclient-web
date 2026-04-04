import type { InputPacket } from './net/InputPacket';
import type { PacketDispatcher } from './net/PacketDispatcher';
import { ServerOp } from './net/opcodes';
import { parseMapDescription } from './net/mapParser';
import type { MapTile, MapCreature } from './net/mapParser';
import { parseCreatureMove } from './net/creatureParser';

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

  registerHandlers(dispatcher: PacketDispatcher): void {
    dispatcher.on(ServerOp.MapDescription, (p) => this.handleMapDescription(p));
    dispatcher.on(ServerOp.MoveNorth, (p) => this.handleMoveNorth(p));
    dispatcher.on(ServerOp.MoveEast, (p) => this.handleMoveEast(p));
    dispatcher.on(ServerOp.MoveSouth, (p) => this.handleMoveSouth(p));
    dispatcher.on(ServerOp.MoveWest, (p) => this.handleMoveWest(p));
    dispatcher.on(ServerOp.CreatureMove, (p) => this.handleCreatureMove(p));
    dispatcher.on(ServerOp.SelfAppear, (p) => this.handleSelfAppear(p));
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
    // Full map around player: 18x14 tiles, floors 0-7
    const startX = this.playerX - 8;
    const startY = this.playerY - 6;
    const endX = this.playerX + 9;
    const endY = this.playerY + 7;

    const tiles = parseMapDescription(packet, startX, startY, endX, endY, this.playerZ);
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleMoveNorth(packet: InputPacket): void {
    this.playerY--;
    const tiles = parseMapDescription(
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
    const tiles = parseMapDescription(
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
    const tiles = parseMapDescription(
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
    const tiles = parseMapDescription(
      packet,
      this.playerX - 8, this.playerY - 6,
      this.playerX - 8, this.playerY + 7,
      this.playerZ,
    );
    for (const tile of tiles) this.setTile(tile);
    this.onChange?.();
  }

  private handleCreatureMove(packet: InputPacket): void {
    const event = parseCreatureMove(packet);
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
