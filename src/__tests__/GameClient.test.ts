import { describe, it, expect } from 'vitest';
import { GameClient } from '../lib/net/common/GameClient';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { OutputPacket } from '../lib/net/common/OutputPacket';

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
