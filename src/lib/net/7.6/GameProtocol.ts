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
import { parseMapDescription } from './mapParser';
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
 * Jamera and other server variants override individual fields via the
 * constructor argument.
 */
export const DEFAULT_76_CONFIG: ProtocolConfig = {
  version: 760,
  clientVersion: 760,
  useRSA: false,
  useXTEA: true,
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

    const { clientVersion } = this.config;
    this.login = {
      buildLoginRequest: (accountNumber, password, xteaKey) =>
        buildLoginPacket(accountNumber, password, xteaKey, clientVersion),
      buildGameLogin: (accountNumber, characterName, password, xteaKey) =>
        buildGameLoginPacket(accountNumber, characterName, password, xteaKey, clientVersion),
      parseLoginResponse,
      isLoginError,
    };

    this.map = {
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
