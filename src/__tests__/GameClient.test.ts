import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { GameClient } from '../lib/net/common/GameClient';
import { Connection } from '../lib/net/common/Connection';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { InputPacket } from '../lib/net/common/InputPacket';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = 'blob';
  readyState = MockWebSocket.CONNECTING;
  closeCount = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  close(): void {
    this.closeCount++;
    this.readyState = MockWebSocket.CLOSED;
  }

  emitClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  send(data: unknown): void {
    this.sent.push(data);
  }
}

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

describe('Connection.connect', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces an existing socket without letting stale close events clear the new socket', async () => {
    const conn = new Connection('ws://proxy');

    const firstConnect = conn.connect('/login');
    const first = MockWebSocket.instances[0];
    first.open();
    await firstConnect;

    const secondConnect = conn.connect('/login');
    const second = MockWebSocket.instances[1];
    expect(first.closeCount).toBe(1);
    second.open();
    await secondConnect;

    first.emitClose();

    const packet = new OutputPacket();
    packet.addU8(0x1e);
    conn.send(packet);

    expect(first.sent).toHaveLength(0);
    expect(second.sent).toHaveLength(1);
  });
});

describe('GameClient credential retention', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops the stored password once the game login packet is sent', async () => {
    const client = new GameClient('ws://proxy', {}, new GameProtocol());
    // @ts-expect-error driving private state for the test
    client.state = 'character_list';
    // @ts-expect-error seeding the credentials login() would have stored
    client.password = 'hunter2';

    const selecting = client.selectCharacter({
      name: 'Trinity', worldName: 'Jamera', worldIp: '127.0.0.1', worldPort: 7172,
    });
    MockWebSocket.instances.at(-1)!.open();
    await selecting;

    expect(client.getState()).toBe('in_game');
    // @ts-expect-error reading private state for the test
    expect(client.password).toBe('');
  });

  it('drops the stored password on any transition to disconnected', () => {
    const client = new GameClient('ws://proxy', {}, new GameProtocol());
    // @ts-expect-error seeding private state for the test
    client.password = 'hunter2';

    client.disconnect();

    // @ts-expect-error reading private state for the test
    expect(client.password).toBe('');
  });
});

describe('GameClient.getProtocol', () => {
  it('returns the injected protocol instance', () => {
    const protocol = new GameProtocol();
    const client = new GameClient('ws://test', {}, protocol);
    expect(client.getProtocol()).toBe(protocol);
  });
});

describe('GameClient auto-pong', () => {
  it('responds to server Ping (0x1E) with a client Pong on the game socket', () => {
    const protocol = new GameProtocol();
    const client = new GameClient('ws://test', {}, protocol);

    // Stub the game socket with a send-capture mock; the real Connection
    // would require a live WS and isn't available in this env anyway.
    const send = vi.fn();
    // @ts-expect-error driving private state for the test
    client.gameConn = { send };

    // Server-sent Ping packet: one byte, the opcode itself.
    const pingFromServer = new InputPacket(new Uint8Array([protocol.serverOpcodes.Ping]).buffer);
    client.getDispatcher().dispatch(pingFromServer);

    expect(send).toHaveBeenCalledTimes(1);
    const [packet, encrypt] = send.mock.calls[0];
    expect(packet).toBeInstanceOf(OutputPacket);
    expect((packet as OutputPacket).toUint8Array()[0]).toBe(protocol.clientOpcodes.Ping);
    // 7.6 has no XTEA so encrypt should be false.
    expect(encrypt).toBe(false);
  });

  it('no-ops if gameConn is not set yet (Ping arrives before selectCharacter completes)', () => {
    const protocol = new GameProtocol();
    const client = new GameClient('ws://test', {}, protocol);

    const pingFromServer = new InputPacket(new Uint8Array([protocol.serverOpcodes.Ping]).buffer);
    // Should not throw even though gameConn is null.
    expect(() => client.getDispatcher().dispatch(pingFromServer)).not.toThrow();
  });
});

describe('GameClient.selectCharacter', () => {
  it('routes the game-phase Connection through the constructor proxyUrl, not character.worldIp', () => {
    // Regression guard: previously the game phase derived its URL from
    // `character.worldIp` (the OT server's view of itself), which in a
    // browser via WS proxy is never reachable — Docker bridge IPs,
    // private LAN IPs, etc. The fix routes the game phase through the
    // same proxy as login; this test would catch any re-introduction.
    const proxy = 'ws://my-proxy:8090';
    const client = new GameClient(proxy, {}, new GameProtocol());
    // @ts-expect-error driving the state machine for the test
    client.state = 'character_list';

    const character = {
      name: 'Trinity',
      worldName: 'Jamera',
      worldIp: '172.25.0.3',
      worldPort: 7172,
    };
    // selectCharacter creates gameConn synchronously, then awaits
    // gameConn.connect('/game') which rejects in this test env. We
    // don't care about the rejection — only that gameConn was
    // constructed with the proxy URL, not a derived `ws://${worldIp}…`.
    void client.selectCharacter(character).catch(() => {});

    // @ts-expect-error reading private fields for the test
    const conn = client.gameConn;
    expect(conn).not.toBeNull();
    // @ts-expect-error Connection.proxyUrl is private
    expect(conn.proxyUrl).toBe(proxy);
    // @ts-expect-error confirming the docker-internal worldIp didn't leak
    expect(conn.proxyUrl).not.toContain(character.worldIp);
  });
});

describe('Connection malformed-packet resilience', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function frame(...payload: number[]): Uint8Array {
    return new Uint8Array([payload.length & 0xff, payload.length >> 8, ...payload]);
  }

  it('drops a frame whose handler overreads (ParseError) and still delivers the next frame', async () => {
    const conn = new Connection('ws://proxy');
    const seen: number[] = [];
    conn.setPacketHandler((p) => {
      const opcode = p.getU8();
      seen.push(opcode);
      if (opcode === 0x01) p.getU32(); // overread: frame only has 1 byte
    });

    const connecting = conn.connect('/login');
    const ws = MockWebSocket.instances[0];
    ws.open();
    await connecting;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Two frames in one WS message: the malformed 0x01, then a valid 0x02.
    const data = new Uint8Array([...frame(0x01), ...frame(0x02)]);
    ws.onmessage?.({ data: data.buffer } as MessageEvent);
    warn.mockRestore();

    expect(seen).toEqual([0x01, 0x02]);
  });
});
