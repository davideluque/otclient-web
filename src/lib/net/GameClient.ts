import { Connection } from './Connection';
import { PacketDispatcher } from './PacketDispatcher';
import { buildLoginPacket, buildGameLoginPacket, parseLoginResponse, isLoginError } from './loginProtocol';
import type { CharacterInfo, LoginResponse } from './loginProtocol';
import { generateXteaKey } from './xtea';
import type { XteaKey } from './xtea';
import type { InputPacket } from './InputPacket';

export type GameClientState = 'disconnected' | 'logging_in' | 'character_list' | 'entering_game' | 'in_game';

export interface GameClientEvents {
  onStateChange?: (state: GameClientState) => void;
  onCharacterList?: (characters: CharacterInfo[], premiumDays: number, motd?: string) => void;
  onLoginError?: (message: string) => void;
  onGamePacket?: (packet: InputPacket) => void;
  onDisconnect?: () => void;
}

/**
 * High-level game client that manages the login flow and game connection.
 */
export class GameClient {
  private loginConn: Connection;
  private gameConn: Connection | null = null;
  private xteaKey: XteaKey = [0, 0, 0, 0];
  private state: GameClientState = 'disconnected';
  private events: GameClientEvents;
  private dispatcher: PacketDispatcher;
  private accountNumber = 0;
  private password = '';

  constructor(proxyUrl: string, events: GameClientEvents) {
    this.loginConn = new Connection(proxyUrl);
    this.events = events;
    this.dispatcher = new PacketDispatcher();
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
    this.xteaKey = generateXteaKey();
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
      const loginPacket = buildLoginPacket(accountNumber, password, this.xteaKey);
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
    this.xteaKey = generateXteaKey();

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
      const gamePacket = buildGameLoginPacket(
        this.accountNumber,
        character.name,
        this.password,
        this.xteaKey,
      );
      this.gameConn.send(gamePacket);
      this.gameConn.setXteaKey(this.xteaKey);
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

  private handleLoginResponse(packet: InputPacket): void {
    const response = parseLoginResponse(packet);

    if (isLoginError(response)) {
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
