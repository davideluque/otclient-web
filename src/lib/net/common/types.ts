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

export interface MapTile {
  x: number;
  y: number;
  z: number;
  items: MapTileItem[];
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

// Well-known chat constants matching OT 7.6 wire codes. These are
// pragmatically shared across most OT versions; if a future version's wire
// codes diverge, expose per-version values on `GameProtocol.chat` instead of
// importing this constant from caller code.
export const MessageType = {
  Say: 0x01,
  Whisper: 0x02,
  Yell: 0x03,
  PrivateFrom: 0x04,
  PrivateTo: 0x05,
  ChannelManagement: 0x06,
  Channel: 0x07,
  ChannelHighlight: 0x08,
  Broadcast: 0x09,
  ChannelRed: 0x0a,
  PrivateRed: 0x0b,
  MonsterSay: 0x0d,
  MonsterYell: 0x0e,
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

export interface ChatProtocol {
  parseSpeak(packet: InputPacket): ChatMessage;
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
  readonly Ping: number;
  readonly MapDescription: number;
  readonly MoveNorth: number;
  readonly MoveEast: number;
  readonly MoveSouth: number;
  readonly MoveWest: number;
  readonly TileUpdate: number;
  readonly TileAddThing: number;
  readonly TileTransformThing: number;
  readonly TileRemoveThing: number;
  readonly CreatureMove: number;
  readonly ContainerOpen: number;
  readonly ContainerClose: number;
  readonly WorldLight: number;
  readonly PlayerStats: number;
  readonly PlayerSkills: number;
  readonly CreatureSpeak: number;
  readonly MagicEffect: number;
  readonly AnimatedText: number;
  readonly DistanceShot: number;
}

export interface ClientOpcodes {
  readonly LoginServerRequest: number;
  readonly GameServerRequest: number;
  readonly Logout: number;
  readonly Ping: number;
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
  readonly serverOpcodes: ServerOpcodes;
  readonly clientOpcodes: ClientOpcodes;
}
