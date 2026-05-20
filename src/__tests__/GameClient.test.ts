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
