/**
 * OT 7.6 Protocol opcodes.
 */

// --- Client → Server opcodes ---

export const ClientOp = {
  // Login server
  LoginServerRequest: 0x01,

  // Game server
  GameServerRequest: 0x0a,
  Logout: 0x14,
  Ping: 0x1e,

  // Movement
  MoveNorth: 0x65,
  MoveEast: 0x66,
  MoveSouth: 0x67,
  MoveWest: 0x68,
  StopAutoWalk: 0x69,
  MoveNorthEast: 0x6a,
  MoveSouthEast: 0x6b,
  MoveSouthWest: 0x6c,
  MoveNorthWest: 0x6d,

  // Turn
  TurnNorth: 0x6f,
  TurnEast: 0x70,
  TurnSouth: 0x71,
  TurnWest: 0x72,

  // Actions
  UseItem: 0x82,
  LookAt: 0x8c,
  Say: 0x96,
} as const;

// --- Server → Client opcodes ---

export const ServerOp = {
  // Login server responses
  LoginError: 0x0a,
  LoginMotd: 0x14,
  LoginCharacterList: 0x64,

  // Game server responses
  SelfAppear: 0x0a,
  GMActions: 0x0b,
  LoginQueue: 0x16,
  Ping: 0x1e,
  ReloginWindow: 0x28,

  // Map
  MapDescription: 0x64,
  MoveNorth: 0x65,
  MoveEast: 0x66,
  MoveSouth: 0x67,
  MoveWest: 0x68,
  TileUpdate: 0x69,
  TileAddThing: 0x6a,
  TileTransformThing: 0x6b,
  TileRemoveThing: 0x6c,

  // Inventory
  InventorySet: 0x78,
  InventoryClear: 0x79,

  // Creature
  CreatureMove: 0x6d,
  CreatureSquare: 0x86,
  CreatureHealth: 0x8c,
  CreatureLight: 0x8d,
  CreatureOutfit: 0x8e,
  CreatureSpeed: 0x8f,
  CreatureSkull: 0x90,
  CreatureShield: 0x91,

  // Containers / trade
  ContainerOpen: 0x6e,
  ContainerClose: 0x6f,
  ContainerAddItem: 0x70,
  ContainerUpdateItem: 0x71,
  ContainerRemoveItem: 0x72,
  TradeRequest: 0x7d,
  TradeRequestAck: 0x7e,
  TradeClose: 0x7f,

  // Windows
  TextWindow: 0x96,
  HouseWindow: 0x97,

  // World/Player
  WorldLight: 0x82,
  PlayerStats: 0xa0,
  PlayerSkills: 0xa1,
  Icons: 0xa2,
  CancelTarget: 0xa3,
  TextMessage: 0xb4,
  CancelWalk: 0xb5,
  FloorChangeUp: 0xbe,
  FloorChangeDown: 0xbf,

  // Chat
  CreatureSpeak: 0xaa,
  ChannelsDialog: 0xab,
  ChannelOpen: 0xac,
  PrivateChannelOpen: 0xad,
  RuleViolationsChannel: 0xae,
  RuleViolationRemove: 0xaf,
  RuleViolationCancel: 0xb0,
  RuleViolationLock: 0xb1,
  PrivateChannelCreate: 0xb2,
  ChannelClose: 0xb3,

  // Effects
  MagicEffect: 0x83,
  AnimatedText: 0x84,
  DistanceShot: 0x85,
} as const;
