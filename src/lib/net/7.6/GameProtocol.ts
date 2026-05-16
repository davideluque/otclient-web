import type {
  GameProtocol as GameProtocolSpec,
  LoginProtocol,
  MapProtocol,
  CreatureProtocol,
  ChatProtocol,
  ServerOpcodes,
  ClientOpcodes,
  ProtocolConfig,
} from '../common/types';
import {
  buildLoginPacket,
  buildGameLoginPacket,
  parseLoginResponse,
  isLoginError,
} from './loginProtocol';
import { parseMapDescription, parsePosition } from './mapParser';
import {
  parseCreatureMove,
  parseCreatureTurn,
  parseCreatureHealth,
  parseCreatureLight,
  parseCreatureSpeed,
  parseCreatureOutfit,
} from './creatureParser';
import {
  parseCreatureSpeak,
  buildSayPacket,
  buildChannelMessagePacket,
  buildPrivateMessagePacket,
  buildWhisperPacket,
  buildYellPacket,
} from './chatProtocol';
import { ServerOp, ClientOp } from './opcodes';

/**
 * Default config for the canonical OT 7.6 protocol.
 *
 * 7.6 has no RSA and no XTEA — those came in later Tibia versions. Server
 * variants (e.g. jamera) override individual fields via the constructor:
 * jamera bumps `clientVersion` to 761 but stays on the no-encryption
 * defaults. File signatures default to zeros — real values should be
 * plumbed from the asset loaders once .dat/.spr/.pic load is wired up.
 */
export const DEFAULT_76_CONFIG: ProtocolConfig = {
  version: 760,
  clientVersion: 760,
  useRSA: false,
  useXTEA: false,
};

/**
 * OT 7.6 implementation of the version-agnostic GameProtocol contract.
 * Wraps the free parser/builder functions in this directory into a single
 * injectable object so callers (GameClient, GameWorld, ChatManager, ChatUI)
 * never import from 7.6/ directly.
 */
export class GameProtocol implements GameProtocolSpec {
  readonly config: ProtocolConfig;
  readonly login: LoginProtocol;
  readonly map: MapProtocol;
  readonly creature: CreatureProtocol;
  readonly chat: ChatProtocol;
  readonly serverOpcodes: ServerOpcodes = ServerOp;
  readonly clientOpcodes: ClientOpcodes = ClientOp;

  constructor(config: Partial<ProtocolConfig> = {}) {
    this.config = { ...DEFAULT_76_CONFIG, ...config };

    if (this.config.useRSA) {
      // RSA is not implemented yet; failing here prevents the silent
      // privacy leak where a caller asks for RSA and gets plaintext.
      throw new Error(
        'GameProtocol: useRSA: true is not yet implemented for 7.6 — would silently send credentials in plaintext. Set useRSA: false or wait for the RSA implementation.',
      );
    }

    const { clientVersion, datSignature, sprSignature, picSignature } = this.config;
    const signatures = {
      dat: datSignature ?? 0,
      spr: sprSignature ?? 0,
      pic: picSignature ?? 0,
    };
    this.login = {
      buildLoginRequest: (accountNumber, password) =>
        buildLoginPacket(accountNumber, password, clientVersion, signatures),
      buildGameLogin: (accountNumber, characterName, password) =>
        buildGameLoginPacket(accountNumber, characterName, password, clientVersion),
      parseLoginResponse,
      isLoginError,
    };

    this.map = {
      parsePosition,
      parseDescription: parseMapDescription,
    };

    this.creature = {
      parseMove: parseCreatureMove,
      parseTurn: parseCreatureTurn,
      parseHealth: parseCreatureHealth,
      parseLight: parseCreatureLight,
      parseSpeed: parseCreatureSpeed,
      parseOutfit: parseCreatureOutfit,
    };

    this.chat = {
      parseSpeak: parseCreatureSpeak,
      buildSay: buildSayPacket,
      buildChannelMessage: buildChannelMessagePacket,
      buildPrivateMessage: buildPrivateMessagePacket,
      buildWhisper: buildWhisperPacket,
      buildYell: buildYellPacket,
    };
  }
}
