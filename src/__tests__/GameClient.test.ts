import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameClient } from '../lib/net/common/GameClient';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import type { CharacterInfo } from '../lib/net/common/types';

const realWebSocket = globalThis.WebSocket;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  binaryType: BinaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSING;
  }

  finishClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    this.sent.push(data);
  }
}

const character: CharacterInfo = {
  name: 'Trinity',
  worldName: 'Jamera',
  worldIp: '172.25.0.3',
  worldPort: 7172,
};

async function enterGame(client: GameClient): Promise<MockWebSocket> {
  const selecting = client.selectCharacter(character);
  const ws = MockWebSocket.instances.at(-1);
  expect(ws).toBeDefined();
  ws!.open();
  await selecting;
  expect(client.getState()).toBe('in_game');
  return ws!;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = realWebSocket;
});

describe('GameClient.send', () => {
  it('throws when called before login (state: disconnected)', () => {
    const client = new GameClient('ws://test', {}, new GameProtocol());
    expect(() => client.send(new OutputPacket())).toThrow(/disconnected/);
  });

  it('throws when called during character_list (no gameConn yet)', () => {
    const client = new GameClient('ws://test', {}, new GameProtocol());
    // @ts-expect-error driving private state machine for the test
    client.state = 'character_list';
    expect(() => client.send(new OutputPacket())).toThrow(/character_list/);
  });
});

describe('GameClient.getProtocol', () => {
  it('returns the injected protocol instance', () => {
    const protocol = new GameProtocol();
    const client = new GameClient('ws://test', {}, protocol);
    expect(client.getProtocol()).toBe(protocol);
  });
});

describe('GameClient.selectCharacter', () => {
  it('routes the game-phase Connection through the constructor proxyUrl, not character.worldIp', async () => {
    // Regression guard: previously the game phase derived its URL from
    // `character.worldIp` (the OT server's view of itself), which in a
    // browser via WS proxy is never reachable — Docker bridge IPs,
    // private LAN IPs, etc. The fix routes the game phase through the
    // same proxy as login; this test would catch any re-introduction.
    const proxy = 'ws://my-proxy:8090';
    const client = new GameClient(proxy, {}, new GameProtocol());
    // @ts-expect-error driving the state machine for the test
    client.state = 'character_list';

    // selectCharacter creates gameConn synchronously, then awaits
    // gameConn.connect('/game'). Inspect the constructed connection before
    // completing the mocked open.
    const selecting = client.selectCharacter(character);

    // @ts-expect-error reading private fields for the test
    const conn = client.gameConn;
    expect(conn).not.toBeNull();
    // @ts-expect-error Connection.proxyUrl is private
    expect(conn.proxyUrl).toBe(proxy);
    // @ts-expect-error confirming the docker-internal worldIp didn't leak
    expect(conn.proxyUrl).not.toContain(character.worldIp);

    const ws = MockWebSocket.instances.at(-1);
    expect(ws).toBeDefined();
    ws!.open();
    await selecting;
  });

  it('ignores stale game WebSocket close events after a same-page reconnect', async () => {
    const onDisconnect = vi.fn();
    const client = new GameClient('ws://test', { onDisconnect }, new GameProtocol());

    const firstWs = await enterGame(client);
    client.disconnect();
    expect(client.getState()).toBe('disconnected');

    await enterGame(client);
    firstWs.finishClose();

    expect(client.getState()).toBe('in_game');
    expect(onDisconnect).not.toHaveBeenCalled();
  });
});
