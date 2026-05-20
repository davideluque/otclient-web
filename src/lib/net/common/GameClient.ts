import { Connection } from './Connection';
import { PacketDispatcher } from './PacketDispatcher';
import { generateXteaKey, type XteaKey } from './xtea';
import type { InputPacket } from './InputPacket';
import type { OutputPacket } from './OutputPacket';
import type {
  GameProtocol,
  CharacterInfo,
  LoginResponse,
} from './types';

export type GameClientState =
  | 'disconnected'
  | 'logging_in'
  | 'character_list'
  | 'entering_game'
  | 'in_game';

export interface GameClientEvents {
  onStateChange?: (state: GameClientState) => void;
  onCharacterList?: (characters: CharacterInfo[], premiumDays: number, motd?: string) => void;
  onLoginError?: (message: string) => void;
  onGamePacket?: (packet: InputPacket) => void;
  onDisconnect?: () => void;
}

/**
 * High-level game client that manages the login flow and game connection.
 * Protocol-agnostic: receives a GameProtocol implementation via constructor
 * injection rather than importing version-specific builders/parsers directly.
 */
export class GameClient {
  private loginConn: Connection;
  private gameConn: Connection | null = null;
  private xteaKey: XteaKey | null = null;
  private state: GameClientState = 'disconnected';
  private events: GameClientEvents;
  private dispatcher: PacketDispatcher;
  private protocol: GameProtocol;
  private accountNumber = 0;
  private password = '';

  constructor(proxyUrl: string, events: GameClientEvents, protocol: GameProtocol) {
    this.loginConn = new Connection(proxyUrl);
    this.events = events;
    this.dispatcher = new PacketDispatcher();
    this.protocol = protocol;
  }

  getState(): GameClientState {
    return this.state;
  }

  getDispatcher(): PacketDispatcher {
    return this.dispatcher;
  }

  /**
   * Step 1: Connect to login server and request character list.
   */
  async login(accountNumber: number, password: string): Promise<void> {
    this.accountNumber = accountNumber;
    this.password = password;
    this.setState('logging_in');

    this.loginConn.setPacketHandler((packet) => {
      this.handleLoginResponse(packet);
    });

    this.loginConn.setErrorHandler((err) => {
      this.events.onLoginError?.(err);
      this.setState('disconnected');
    });

    try {
      await this.loginConn.connect('/login');
      const loginPacket = this.protocol.login.buildLoginRequest(accountNumber, password);
      this.loginConn.send(loginPacket);
    } catch {
      this.setState('disconnected');
    }
  }

  /**
   * Step 2: Select a character and connect to the game server.
   */
  async selectCharacter(character: CharacterInfo): Promise<void> {
    this.setState('entering_game');
    this.loginConn.disconnect();

    this.gameConn = new Connection(`ws://${character.worldIp}:8090`);

    this.gameConn.setPacketHandler((packet) => {
      this.dispatcher.dispatch(packet);
    });

    this.gameConn.setCloseHandler(() => {
      this.setState('disconnected');
      this.events.onDisconnect?.();
    });

    this.gameConn.setErrorHandler((err) => {
      this.events.onLoginError?.(err);
      this.setState('disconnected');
    });

    try {
      await this.gameConn.connect('/game');
      const gamePacket = this.protocol.login.buildGameLogin(
        this.accountNumber,
        character.name,
        this.password,
      );
      this.gameConn.send(gamePacket);
      if (this.protocol.config.useXTEA) {
        // XTEA was introduced in Tibia 8.0+; the key is generated here so
        // the protocol implementation can negotiate it before encrypted
        // game packets start flowing.
        this.xteaKey = generateXteaKey();
        this.gameConn.setXteaKey(this.xteaKey);
      }
      this.setState('in_game');
    } catch {
      this.setState('disconnected');
    }
  }

  disconnect(): void {
    this.loginConn.disconnect();
    this.gameConn?.disconnect();
    this.setState('disconnected');
  }

  /**
   * Send a packet to the game server. Throws if not currently `in_game`
   * — silent no-ops would hide the most common caller bug (firing
   * packets before the login handshake completes). Honours
   * `protocol.config.useXTEA` so 8.x implementations get encrypted
   * payloads automatically.
   */
  send(packet: OutputPacket): void {
    if (this.state !== 'in_game') {
      throw new Error(`Cannot send packet: client state is ${this.state}`);
    }
    if (!this.gameConn) {
      // Defense in depth: the state machine guarantees gameConn is set
      // whenever state is in_game, but spelling out a distinct error
      // makes any future state/connection desync easier to spot.
      throw new Error('Cannot send packet: game connection is not initialized');
    }
    this.gameConn.send(packet, this.protocol.config.useXTEA);
  }

  private handleLoginResponse(packet: InputPacket): void {
    const response = this.protocol.login.parseLoginResponse(packet);

    if (this.protocol.login.isLoginError(response)) {
      this.events.onLoginError?.(response.message);
      this.setState('disconnected');
      return;
    }

    const loginResp = response as LoginResponse;
    this.setState('character_list');
    this.events.onCharacterList?.(
      loginResp.characters,
      loginResp.premiumDays,
      loginResp.motd,
    );
  }

  private setState(state: GameClientState): void {
    this.state = state;
    this.events.onStateChange?.(state);
  }
}
