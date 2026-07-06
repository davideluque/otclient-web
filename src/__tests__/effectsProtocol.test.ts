import { describe, it, expect } from 'vitest';
import {
  parseMagicEffect,
  parseAnimatedText,
  parseDistanceShot,
  parseCreatureSquare,
} from '../lib/net/7.6/effectsProtocol';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';

describe('parseMagicEffect', () => {
  it('parses position and the 1-based effect id off the wire', () => {
    const out = new OutputPacket();
    out.addPosition(32100, 32200, 7);
    out.addU8(13); // ENERGY_AREA (12) + the server's +1 offset

    const p = new InputPacket(out.toArrayBuffer());
    expect(parseMagicEffect(p)).toEqual({ x: 32100, y: 32200, z: 7, effectId: 13 });
    expect(p.bytesLeft).toBe(0);
  });
});

describe('parseAnimatedText', () => {
  it('parses position, palette color, and text', () => {
    const out = new OutputPacket();
    out.addPosition(100, 200, 6);
    out.addU8(180); // TEXTCOLOR_RED
    out.addString('120');

    const p = new InputPacket(out.toArrayBuffer());
    expect(parseAnimatedText(p)).toEqual({ x: 100, y: 200, z: 6, color: 180, text: '120' });
    expect(p.bytesLeft).toBe(0);
  });

  it('handles an empty text payload', () => {
    const out = new OutputPacket();
    out.addPosition(1, 2, 3);
    out.addU8(0);
    out.addString('');

    const p = new InputPacket(out.toArrayBuffer());
    expect(parseAnimatedText(p).text).toBe('');
    expect(p.bytesLeft).toBe(0);
  });
});

describe('parseDistanceShot', () => {
  it('parses from/to positions and the 1-based missile id', () => {
    const out = new OutputPacket();
    out.addPosition(100, 200, 7);
    out.addPosition(103, 198, 7);
    out.addU8(4); // NME_BOLT (3) + the server's +1 offset

    const p = new InputPacket(out.toArrayBuffer());
    expect(parseDistanceShot(p)).toEqual({
      fromX: 100, fromY: 200, fromZ: 7,
      toX: 103, toY: 198, toZ: 7,
      missileId: 4,
    });
    expect(p.bytesLeft).toBe(0);
  });
});

describe('parseCreatureSquare', () => {
  it('parses creature id and color', () => {
    const out = new OutputPacket();
    out.addU32(0x10000042);
    out.addU8(0); // black — the attack-target flash

    const p = new InputPacket(out.toArrayBuffer());
    expect(parseCreatureSquare(p)).toEqual({ creatureId: 0x10000042, color: 0 });
    expect(p.bytesLeft).toBe(0);
  });
});

describe('GameProtocol wiring', () => {
  it('exposes the effect parsers on protocol.effects', () => {
    const protocol = new GameProtocol();
    expect(protocol.effects.parseMagicEffect).toBe(parseMagicEffect);
    expect(protocol.effects.parseAnimatedText).toBe(parseAnimatedText);
    expect(protocol.effects.parseDistanceShot).toBe(parseDistanceShot);
    expect(protocol.effects.parseCreatureSquare).toBe(parseCreatureSquare);
  });
});
