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
  Ping: 0x1e,

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

  // Creature
  CreatureMove: 0x6d,
  ContainerOpen: 0x6e,
  ContainerClose: 0x6f,

  // World/Player
  WorldLight: 0x82,
  PlayerStats: 0xa0,
  PlayerSkills: 0xa1,

  // Chat
  CreatureSpeak: 0xaa,

  // Effects
  MagicEffect: 0x83,
  AnimatedText: 0x84,
  DistanceShot: 0x85,
} as const;
