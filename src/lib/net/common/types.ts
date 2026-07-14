import type { InputPacket } from './InputPacket';
import type { OutputPacket } from './OutputPacket';

// ─── Shape types (data shapes exchanged with callers) ──────────────────────

export interface CharacterInfo {
  name: string;
  worldName: string;
  worldIp: string;
  worldPort: number;
}

export interface LoginResponse {
  motd?: string;
  characters: CharacterInfo[];
  premiumDays: number;
}

export interface LoginError {
  message: string;
}

export interface MapTileItem {
  id: number;
  count?: number;
}

export interface MapCreature {
  id: number;
  name: string;
  health: number;
  direction: number;
  outfit: {
    lookType: number;
    head: number;
    body: number;
    legs: number;
    feet: number;
  };
  lightLevel: number;
  lightColor: number;
  speed: number;
}

/** One entry in a tile's wire-ordered stack. */
export type MapThing =
  | { kind: 'item'; item: MapTileItem }
  | { kind: 'creature'; creature: MapCreature };

export interface MapTile {
  x: number;
  y: number;
  z: number;
  /**
   * The stack in SERVER order — ground, top items, creatures, down
   * items (otserv Tile::__getIndexOfThing). Wire stack positions in
   * 0x6B/0x6C/0x6D index into this array directly; mutate it only
   * through GameWorld's stack helpers, which keep the views below in
   * sync.
   */
  things: MapThing[];
  /** Derived view of things — items in stack order. Do not mutate. */
  items: MapTileItem[];
  /** Derived view of things — creatures in stack order. Do not mutate. */
  creatures: MapCreature[];
}

export interface CreatureMoveEvent {
  type: 'move';
  creatureId: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  fromStack: number;
  toX: number;
  toY: number;
  toZ: number;
}

export interface CreatureTurnEvent {
  type: 'turn';
  creatureId: number;
  direction: number;
}

export interface CreatureHealthEvent {
  type: 'health';
  creatureId: number;
  healthPercent: number;
}

export interface CreatureLightEvent {
  type: 'light';
  creatureId: number;
  lightLevel: number;
  lightColor: number;
}

export interface CreatureSpeedEvent {
  type: 'speed';
  creatureId: number;
  speed: number;
}

export interface CreatureOutfitEvent {
  type: 'outfit';
  creatureId: number;
  lookType: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
}

export type CreatureEvent =
  | CreatureMoveEvent
  | CreatureTurnEvent
  | CreatureHealthEvent
  | CreatureLightEvent
  | CreatureSpeedEvent
  | CreatureOutfitEvent;

export interface ChatMessage {
  senderName: string;
  messageType: number;
  text: string;
  position?: { x: number; y: number; z: number };
  channelId?: number;
  timestamp: number;
}

export interface ChatChannelInfo {
  id: number;
  name: string;
}

// Well-known chat constants matching OT 7.6 wire codes. These are
// pragmatically shared across most OT versions; if a future version's wire
// codes diverge, expose per-version values on `GameProtocol.chat` instead of
// importing this constant from caller code.
// 7.6 SpeakClasses, verified against the jamera server's const76.h —
// these are NOT the 8.x values (8.x shifted Channel to 0x07 and the
// monster classes to 0x0d/0x0e; using those against a 7.6 server
// misparses every channel and monster message).
export const MessageType = {
  Say: 0x01,
  Whisper: 0x02,
  Yell: 0x03,
  PrivateFrom: 0x04,
  // 7.6 has a single private speak class for both directions.
  PrivateTo: 0x04,
  Channel: 0x05, // yellow
  RuleViolationChannel: 0x06,
  RuleViolationAnswer: 0x07,
  RuleViolationContinue: 0x08,
  Broadcast: 0x09,
  ChannelRed: 0x0a, // #c
  PrivateRed: 0x0b, // @name@
  ChannelOrange: 0x0c,
  ChannelRedAnonymous: 0x0e, // #d — sent with an empty sender name
  MonsterSay: 0x10,
  MonsterYell: 0x11,
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ChannelId = {
  Default: 0,
  GameChat: 7,
  Trade: 5,
  RLChat: 6,
  Help: 8,
  Private: 0xffff,
} as const;
export type ChannelId = (typeof ChannelId)[keyof typeof ChannelId];

// ─── Configuration ─────────────────────────────────────────────────────────

export interface ProtocolConfig {
  /** Protocol version, e.g. 760 for OT 7.6. */
  version: number;
  /** Value sent in the login packet's client-version field. May differ from version (e.g. jamera expects 761). */
  clientVersion: number;
  /**
   * Whether the login packet's credential block is RSA-encrypted.
   * Tracked as intent; the canonical 7.6 builder ships plaintext for now —
   * a real RSA gate will land alongside an implementation in a later PR.
   */
  useRSA: boolean;
  /** Whether game packets are XTEA-encrypted. Enforced by GameClient. OT 7.6 has no XTEA. */
  useXTEA: boolean;
  /**
   * U32 signatures for Tibia.dat / Tibia.spr / Tibia.pic that 7.6 servers
   * may validate against the client's claimed asset versions. Defaults to
   * zeros — jamera and some forks ignore them. Real values should be
   * plumbed in from the asset loaders.
   */
  datSignature?: number;
  sprSignature?: number;
  picSignature?: number;
}

// ─── Sub-protocol interfaces ───────────────────────────────────────────────

export interface LoginProtocol {
  buildLoginRequest(accountNumber: number, password: string): OutputPacket;
  buildGameLogin(accountNumber: number, characterName: string, password: string): OutputPacket;
  parseLoginResponse(packet: InputPacket): LoginResponse | LoginError;
  isLoginError(response: LoginResponse | LoginError): response is LoginError;
}

export interface MapProtocol {
  /**
   * Consume the 5-byte position prefix `(U16 x, U16 y, U8 z)` that the
   * server prepends to the initial map description (opcode 0x64). Movement
   * updates (opcodes 0x65–0x68) do not carry this prefix — only call this
   * for the initial frame.
   */
  parsePosition(packet: InputPacket): { x: number; y: number; z: number };

  /**
   * Parse one wire item (U16 client ID + count byte when the .dat flags
   * the type as stackable/splash/fluid).
   */
  parseItem(packet: InputPacket): MapTileItem;

  /**
   * Parse the things of one non-empty tile slot into `tile`, consuming
   * the trailing skip marker. Returns the marker's carried skip count.
   */
  parseTileSlot(packet: InputPacket, tile: MapTile): number;

  /**
   * Parse one creature block — the payload following a 0x61 (known) or
   * 0x62 (unknown) thing marker; the marker itself must already be
   * consumed. `isNew` is the 0x62 form (removeKnown ID + name).
   */
  parseCreature(packet: InputPacket, isNew: boolean): MapCreature;

  /**
   * Parse the floor blocks of a floor-change frame (0xBE/0xBF): floors
   * written back-to-back with one shared skip counter, each shifted by
   * its perspective offset. Consumes exactly width×height cells per
   * floor — floor-change frames continue with more opcodes after.
   */
  parseFloorStream(
    packet: InputPacket,
    startX: number, startY: number,
    floors: ReadonlyArray<{ z: number; offset: number }>,
    width: number, height: number,
  ): MapTile[];

  /**
   * Parse a rectangular map region across all currently-visible floors,
   * based on `playerZ` (the server sends 8 layers above ground or 5
   * layers underground). A single skip counter carries tiles across
   * floor boundaries — do not call this once per floor.
   */
  parseDescription(
    packet: InputPacket,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerZ: number,
  ): MapTile[];
}

export interface CreatureProtocol {
  parseMove(packet: InputPacket): CreatureMoveEvent;
  parseTurn(packet: InputPacket): CreatureTurnEvent;
  parseHealth(packet: InputPacket): CreatureHealthEvent;
  parseLight(packet: InputPacket): CreatureLightEvent;
  parseSpeed(packet: InputPacket): CreatureSpeedEvent;
  parseOutfit(packet: InputPacket): CreatureOutfitEvent;
}

/**
 * Walk direction on the wire: 0 north, 1 east, 2 south, 3 west —
 * deliberately value-compatible with lib/player's Direction so app code
 * can pass it straight through.
 */
export type WalkDirection = 0 | 1 | 2 | 3;

/** A world coordinate as carried on the wire (U16 x, U16 y, U8 z). */
export interface WirePosition {
  x: number;
  y: number;
  z: number;
}

export interface ActionsProtocol {
  /** 0x8C — ask the server to describe the thing at a position. */
  buildLookAt(pos: WirePosition, spriteId: number, stackPos: number): OutputPacket;
  /** 0x82 — use the item at a position (ladders, doors, sewer grates...). */
  buildUseItem(pos: WirePosition, spriteId: number, stackPos: number, index?: number): OutputPacket;
  /** 0x14 — clean logout; the server saves the character and closes. */
  buildLogout(): OutputPacket;
  /** 0xA0 fight/chase/secure modes (fight: 1=off 2=bal 3=def). */
  buildFightModes(fightMode: 1 | 2 | 3, chase: boolean, secure: boolean): OutputPacket;
  /** 0xDC add a player to the VIP list by name. */
  buildAddVip(name: string): OutputPacket;
  /** 0xDD remove a VIP by guid (from the 0xD2 state entry). */
  buildRemoveVip(guid: number): OutputPacket;
  /** 0xA1 — set the attacked creature; id 0 stops attacking. */
  buildAttack(creatureId: number): OutputPacket;
  /**
   * ThrowItem — move a thing between map tiles, open containers, and
   * equipment slots (see virtualPosition.ts for the carried-thing
   * addressing). `count` is the amount moved for stackables, 1
   * otherwise. The server silently drops the packet when `to` equals
   * `from` byte-for-byte.
   */
  buildMoveThing(from: WirePosition, spriteId: number, fromStackPos: number, to: WirePosition, count: number): OutputPacket;
  /**
   * UseItemEx — use `from` on `to` (rope, shovel, runes). Both ends are
   * full pos + spriteId + stackpos triples; either may be a virtual
   * container/inventory position (virtualPosition.ts).
   */
  buildUseItemWith(from: WirePosition, fromSpriteId: number, fromStackPos: number, to: WirePosition, toSpriteId: number, toStackPos: number): OutputPacket;
  /** Offer an item to a visible player. */
  buildRequestTrade(from: WirePosition, spriteId: number, stackPos: number, playerId: number): OutputPacket;
  /** Inspect an item in either side of the active trade. */
  buildLookInTrade(counterOffer: boolean, index: number): OutputPacket;
  /** Accept the currently displayed pair of offers. */
  buildAcceptTrade(): OutputPacket;
  /** Cancel the active trade. */
  buildCloseTrade(): OutputPacket;
  /** Save a writable book/document window. */
  buildUpdateTextWindow(windowId: number, text: string): OutputPacket;
  /** Save a house guest/subowner/door access list. */
  buildUpdateHouseWindow(listId: number, windowId: number, text: string): OutputPacket;
}

/** One open container window, as described by a 0x6E. */
export interface ContainerOpenEvent {
  /** Window id 0–15; the server reuses it in every follow-up packet. */
  containerId: number;
  /** Client id of the container item itself (bag, corpse, depot…). */
  containerItemId: number;
  name: string;
  capacity: number;
  /** True when the container sits inside another — enables the up arrow. */
  hasParent: boolean;
  /** Slot order as sent: slot 0 first (most recently added). */
  items: MapTileItem[];
}

export interface ContainersProtocol {
  /** 0x6E — a container window opened (or was re-described in place). */
  parseOpen(packet: InputPacket): ContainerOpenEvent;
  /** 0x6F — the server closed a window; returns the container id. */
  parseClose(packet: InputPacket): number;
  /** 0x70 — item added. No slot on the wire: it goes in at slot 0. */
  parseAddItem(packet: InputPacket): { containerId: number; item: MapTileItem };
  /** 0x71 — the item at a slot was replaced. */
  parseUpdateItem(packet: InputPacket): { containerId: number; slot: number; item: MapTileItem };
  /** 0x72 — the item at a slot was removed. */
  parseRemoveItem(packet: InputPacket): { containerId: number; slot: number };
  /** 0x87 — ask the server to close a container window. */
  buildClose(containerId: number): OutputPacket;
  /** 0x88 — ask for the parent container, re-using the same window id. */
  buildUp(containerId: number): OutputPacket;
}

export interface PlayerStats {
  health: number;
  maxHealth: number;
  capacity: number;
  experience: number;
  level: number;
  levelPercent: number;
  mana: number;
  maxMana: number;
  magicLevel: number;
  magicLevelPercent: number;
  soul: number;
}

export interface SkillValue {
  level: number;
  percent: number;
}

/** The seven 7.6 skills, in 0xA1 wire order. */
export interface PlayerSkills {
  fist: SkillValue;
  club: SkillValue;
  sword: SkillValue;
  axe: SkillValue;
  distance: SkillValue;
  shielding: SkillValue;
  fishing: SkillValue;
}

export interface PlayerProtocol {
  /** Parse a 0xA0 player-stats payload. */
  parseStats(packet: InputPacket): PlayerStats;
  /** Parse a 0xA1 player-skills payload. */
  parseSkills(packet: InputPacket): PlayerSkills;
}

/** A one-shot effect (spell hit, poof, teleport flash) at a position. */
export interface MagicEffectEvent {
  x: number;
  y: number;
  z: number;
  /** 1-based .dat effect id: the ThingType is dat.effects[effectId - 1]. */
  effectId: number;
}

/** Floating on-screen text (damage/heal numbers, exp) at a position. */
export interface AnimatedTextEvent {
  x: number;
  y: number;
  z: number;
  /** Index into the 216-color Tibia palette (see tibiaColorToHex). */
  color: number;
  text: string;
}

/** A projectile (arrow, rune flare) flying between two positions. */
export interface DistanceShotEvent {
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  /** 1-based .dat missile id: the ThingType is dat.missiles[missileId - 1]. */
  missileId: number;
}

/** A colored square flashed around a creature (0 = black: attack target). */
export interface CreatureSquareEvent {
  creatureId: number;
  /** Index into the 216-color Tibia palette. */
  color: number;
}

export interface EffectsProtocol {
  /** Parse a 0x83 magic-effect payload. */
  parseMagicEffect(packet: InputPacket): MagicEffectEvent;
  /** Parse a 0x84 animated-text payload. */
  parseAnimatedText(packet: InputPacket): AnimatedTextEvent;
  /** Parse a 0x85 distance-shot payload. */
  parseDistanceShot(packet: InputPacket): DistanceShotEvent;
  /** Parse a 0x86 creature-square payload. */
  parseCreatureSquare(packet: InputPacket): CreatureSquareEvent;
}

export interface MovementProtocol {
  /** Build the client→server packet for one step in `direction`. */
  buildMove(direction: WalkDirection): OutputPacket;
  /**
   * Build the autowalk packet for a whole route (tap-to-walk). The
   * server walks the steps on its own, confirming each one exactly
   * like manual moves. Directions are first-step-first.
   */
  buildAutoWalk(route: WalkDirection[]): OutputPacket;
}

export interface ChatProtocol {
  parseSpeak(packet: InputPacket): ChatMessage;
  parseChannelOpen(packet: InputPacket): ChatChannelInfo;
  parseChannelClose(packet: InputPacket): number;
  buildSay(text: string): OutputPacket;
  buildChannelMessage(channelId: number, text: string): OutputPacket;
  buildPrivateMessage(recipientName: string, text: string): OutputPacket;
  buildWhisper(text: string): OutputPacket;
  buildYell(text: string): OutputPacket;
}

// Server→client opcode values. Names are stable across versions; numeric
// values vary, so callers should reference these by name via the protocol.
export interface ServerOpcodes {
  readonly LoginError: number;
  readonly LoginMotd: number;
  readonly LoginCharacterList: number;
  readonly SelfAppear: number;
  readonly GMActions: number;
  readonly LoginQueue: number;
  readonly Ping: number;
  readonly ReloginWindow: number;
  readonly MapDescription: number;
  readonly MoveNorth: number;
  readonly MoveEast: number;
  readonly MoveSouth: number;
  readonly MoveWest: number;
  readonly TileUpdate: number;
  readonly TileAddThing: number;
  readonly TileTransformThing: number;
  readonly TileRemoveThing: number;
  readonly InventorySet: number;
  readonly InventoryClear: number;
  readonly CreatureMove: number;
  readonly CreatureSquare: number;
  readonly CreatureHealth: number;
  readonly CreatureLight: number;
  readonly CreatureOutfit: number;
  readonly CreatureSpeed: number;
  readonly CreatureSkull: number;
  readonly CreatureShield: number;
  readonly ContainerOpen: number;
  readonly ContainerClose: number;
  readonly ContainerAddItem: number;
  readonly ContainerUpdateItem: number;
  readonly ContainerRemoveItem: number;
  readonly TradeRequest: number;
  readonly TradeRequestAck: number;
  readonly TradeClose: number;
  readonly TextWindow: number;
  readonly HouseWindow: number;
  readonly WorldLight: number;
  readonly PlayerStats: number;
  readonly PlayerSkills: number;
  readonly Icons: number;
  readonly VipState: number;
  readonly VipLogin: number;
  readonly VipLogout: number;
  readonly CancelTarget: number;
  readonly TextMessage: number;
  readonly CancelWalk: number;
  readonly FloorChangeUp: number;
  readonly FloorChangeDown: number;
  readonly CreatureSpeak: number;
  readonly ChannelsDialog: number;
  readonly ChannelOpen: number;
  readonly PrivateChannelOpen: number;
  readonly RuleViolationsChannel: number;
  readonly RuleViolationRemove: number;
  readonly RuleViolationCancel: number;
  readonly RuleViolationLock: number;
  readonly PrivateChannelCreate: number;
  readonly ChannelClose: number;
  readonly MagicEffect: number;
  readonly AnimatedText: number;
  readonly DistanceShot: number;
}

export interface ClientOpcodes {
  readonly LoginServerRequest: number;
  readonly GameServerRequest: number;
  readonly Logout: number;
  readonly Ping: number;
  readonly AutoWalk: number;
  readonly SetFightModes: number;
  readonly AddVip: number;
  readonly RemoveVip: number;
  readonly MoveNorth: number;
  readonly MoveEast: number;
  readonly MoveSouth: number;
  readonly MoveWest: number;
  readonly StopAutoWalk: number;
  readonly MoveNorthEast: number;
  readonly MoveSouthEast: number;
  readonly MoveSouthWest: number;
  readonly MoveNorthWest: number;
  readonly TurnNorth: number;
  readonly TurnEast: number;
  readonly TurnSouth: number;
  readonly TurnWest: number;
  readonly Say: number;
  readonly RequestTrade: number;
  readonly LookInTrade: number;
  readonly AcceptTrade: number;
  readonly CloseTrade: number;
  readonly UpdateTextWindow: number;
  readonly UpdateHouseWindow: number;
}

// ─── Top-level protocol ────────────────────────────────────────────────────

/**
 * The version-agnostic surface for one OT protocol implementation.
 * Callers (GameClient, GameWorld, ChatManager, ChatUI) receive a GameProtocol
 * instance via constructor injection rather than importing version-specific
 * parser/builder functions directly.
 */
export interface GameProtocol {
  readonly config: ProtocolConfig;
  readonly login: LoginProtocol;
  readonly map: MapProtocol;
  readonly creature: CreatureProtocol;
  readonly chat: ChatProtocol;
  readonly movement: MovementProtocol;
  readonly player: PlayerProtocol;
  readonly actions: ActionsProtocol;
  readonly containers: ContainersProtocol;
  readonly effects: EffectsProtocol;
  readonly serverOpcodes: ServerOpcodes;
  readonly clientOpcodes: ClientOpcodes;
}
