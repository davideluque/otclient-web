import { describe, it, expect, vi } from 'vitest';
import { GameClient } from '../lib/net/common/GameClient';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { InputPacket } from '../lib/net/common/InputPacket';

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
