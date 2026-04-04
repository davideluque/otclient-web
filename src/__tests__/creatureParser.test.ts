import { describe, it, expect } from 'vitest';
import {
  parseCreatureMove,
  parseCreatureTurn,
  parseCreatureHealth,
  parseCreatureLight,
  parseCreatureSpeed,
  parseCreatureOutfit,
} from '../lib/net/creatureParser';
import { InputPacket } from '../lib/net/InputPacket';
import { OutputPacket } from '../lib/net/OutputPacket';

describe('creatureParser', () => {
  it('parses creature move', () => {
    const out = new OutputPacket();
    out.addPosition(100, 200, 7); // from
    out.addU8(1); // stack index
    out.addPosition(101, 200, 7); // to

    const event = parseCreatureMove(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('move');
    expect(event.fromX).toBe(100);
    expect(event.toX).toBe(101);
    expect(event.fromStack).toBe(1);
  });

  it('parses creature turn', () => {
    const out = new OutputPacket();
    out.addU32(12345);
    out.addU8(2); // south

    const event = parseCreatureTurn(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('turn');
    expect(event.creatureId).toBe(12345);
    expect(event.direction).toBe(2);
  });

  it('parses creature health', () => {
    const out = new OutputPacket();
    out.addU32(555);
    out.addU8(75);

    const event = parseCreatureHealth(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('health');
    expect(event.creatureId).toBe(555);
    expect(event.healthPercent).toBe(75);
  });

  it('parses creature light', () => {
    const out = new OutputPacket();
    out.addU32(999);
    out.addU8(5);
    out.addU8(215);

    const event = parseCreatureLight(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('light');
    expect(event.creatureId).toBe(999);
    expect(event.lightLevel).toBe(5);
    expect(event.lightColor).toBe(215);
  });

  it('parses creature speed', () => {
    const out = new OutputPacket();
    out.addU32(777);
    out.addU16(220);

    const event = parseCreatureSpeed(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('speed');
    expect(event.creatureId).toBe(777);
    expect(event.speed).toBe(220);
  });

  it('parses creature outfit with lookType', () => {
    const out = new OutputPacket();
    out.addU32(111);
    out.addU16(128); // lookType
    out.addU8(10);   // head
    out.addU8(20);   // body
    out.addU8(30);   // legs
    out.addU8(40);   // feet

    const event = parseCreatureOutfit(new InputPacket(out.toArrayBuffer()));
    expect(event.type).toBe('outfit');
    expect(event.creatureId).toBe(111);
    expect(event.lookType).toBe(128);
    expect(event.head).toBe(10);
    expect(event.feet).toBe(40);
  });

  it('parses invisible creature outfit (lookType 0)', () => {
    const out = new OutputPacket();
    out.addU32(222);
    out.addU16(0); // invisible

    const event = parseCreatureOutfit(new InputPacket(out.toArrayBuffer()));
    expect(event.lookType).toBe(0);
    expect(event.head).toBe(0);
  });
});
