import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameProtocol } from '../lib/net/7.6/GameProtocol';
import { PacketDispatcher } from '../lib/net/common/PacketDispatcher';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';
import { registerWireSkips } from '../lib/net/7.6/wireSkips';
import {
  GameWorld,
  MAGIC_EFFECT_TTL_MS,
  ANIMATED_TEXT_TTL_MS,
  DISTANCE_SHOT_TTL_MS,
  TARGET_SQUARE_TTL_MS,
} from '../lib/GameWorld';

const protocol = new GameProtocol();

/**
 * Real dispatcher with the wire skips registered FIRST — the world's
 * handlers must override the effect skips (last-write-wins), the same
 * ordering main.ts uses.
 */
function makeWorld(): { world: GameWorld; dispatcher: PacketDispatcher } {
  const world = new GameWorld(protocol);
  const dispatcher = new PacketDispatcher();
  registerWireSkips(dispatcher, protocol);
  world.registerHandlers(dispatcher);
  return { world, dispatcher };
}

/** 0x82 WorldLight — a world-handled opcode batched behind the effect. */
function addTrailingWorldLight(out: OutputPacket): void {
  out.addU8(0x82);
  out.addU8(40);
  out.addU8(0xd7);
}

function expectTrailingParsed(world: GameWorld): void {
  expect(world.worldLight).toEqual({ level: 40, color: 0xd7 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameWorld combat-effect packets', () => {
  it('0x83 stores a magic effect and consumes the frame exactly', () => {
    const { world, dispatcher } = makeWorld();
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    let changes = 0;
    world.onChange = () => { changes++; };

    const out = new OutputPacket();
    out.addU8(0x83);
    out.addPosition(100, 200, 7);
    out.addU8(13);
    addTrailingWorldLight(out);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(world.magicEffects).toEqual([
      { x: 100, y: 200, z: 7, effectId: 13, startedAt: 5000 },
    ]);
    expectTrailingParsed(world);
    expect(changes).toBe(2); // one per opcode in the frame
  });

  it('0x84 stores an animated text and consumes the frame exactly', () => {
    const { world, dispatcher } = makeWorld();
    vi.spyOn(performance, 'now').mockReturnValue(5000);

    const out = new OutputPacket();
    out.addU8(0x84);
    out.addPosition(100, 200, 7);
    out.addU8(180);
    out.addString('120');
    addTrailingWorldLight(out);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(world.animatedTexts).toEqual([
      { x: 100, y: 200, z: 7, color: 180, text: '120', startedAt: 5000 },
    ]);
    expectTrailingParsed(world);
  });

  it('0x85 stores a distance shot and consumes the frame exactly', () => {
    const { world, dispatcher } = makeWorld();
    vi.spyOn(performance, 'now').mockReturnValue(5000);

    const out = new OutputPacket();
    out.addU8(0x85);
    out.addPosition(100, 200, 7);
    out.addPosition(103, 198, 7);
    out.addU8(4);
    addTrailingWorldLight(out);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    expect(world.distanceShots).toEqual([
      { fromX: 100, fromY: 200, fromZ: 7, toX: 103, toY: 198, toZ: 7, missileId: 4, startedAt: 5000 },
    ]);
    expectTrailingParsed(world);
  });

  it('0x86 sets the target square, replacing any previous one', () => {
    const { world, dispatcher } = makeWorld();
    vi.spyOn(performance, 'now').mockReturnValue(5000);

    const first = new OutputPacket();
    first.addU8(0x86);
    first.addU32(9);
    first.addU8(0);
    addTrailingWorldLight(first);
    dispatcher.dispatch(new InputPacket(first.toArrayBuffer()));

    expect(world.targetSquare).toEqual({ creatureId: 9, color: 0, until: 5000 + TARGET_SQUARE_TTL_MS });
    expectTrailingParsed(world);

    const second = new OutputPacket();
    second.addU8(0x86);
    second.addU32(11);
    second.addU8(0);
    dispatcher.dispatch(new InputPacket(second.toArrayBuffer()));

    expect(world.targetSquare?.creatureId).toBe(11);
  });
});

describe('GameWorld.pruneEffects', () => {
  it('keeps effects inside their lifetime and drops expired ones', () => {
    const { world, dispatcher } = makeWorld();
    vi.spyOn(performance, 'now').mockReturnValue(5000);

    const out = new OutputPacket();
    out.addU8(0x83);
    out.addPosition(100, 200, 7);
    out.addU8(13);
    out.addU8(0x84);
    out.addPosition(100, 200, 7);
    out.addU8(180);
    out.addString('120');
    out.addU8(0x85);
    out.addPosition(100, 200, 7);
    out.addPosition(103, 198, 7);
    out.addU8(4);
    out.addU8(0x86);
    out.addU32(9);
    out.addU8(0);
    dispatcher.dispatch(new InputPacket(out.toArrayBuffer()));

    // Shots (300ms) die first, everything else lives on.
    world.pruneEffects(5000 + DISTANCE_SHOT_TTL_MS);
    expect(world.distanceShots).toHaveLength(0);
    expect(world.magicEffects).toHaveLength(1);
    expect(world.animatedTexts).toHaveLength(1);
    expect(world.targetSquare).not.toBeNull();

    // One tick before the 1000ms lifetimes: still live.
    world.pruneEffects(5000 + MAGIC_EFFECT_TTL_MS - 1);
    expect(world.magicEffects).toHaveLength(1);
    expect(world.animatedTexts).toHaveLength(1);
    expect(world.targetSquare).not.toBeNull();

    world.pruneEffects(5000 + Math.max(MAGIC_EFFECT_TTL_MS, ANIMATED_TEXT_TTL_MS, TARGET_SQUARE_TTL_MS));
    expect(world.magicEffects).toHaveLength(0);
    expect(world.animatedTexts).toHaveLength(0);
    expect(world.targetSquare).toBeNull();
  });

  it('prunes per entry, not per array', () => {
    const { world, dispatcher } = makeWorld();
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(5000);

    const first = new OutputPacket();
    first.addU8(0x83);
    first.addPosition(100, 200, 7);
    first.addU8(13);
    dispatcher.dispatch(new InputPacket(first.toArrayBuffer()));

    nowSpy.mockReturnValue(5600);
    const second = new OutputPacket();
    second.addU8(0x83);
    second.addPosition(101, 200, 7);
    second.addU8(14);
    dispatcher.dispatch(new InputPacket(second.toArrayBuffer()));

    world.pruneEffects(5000 + MAGIC_EFFECT_TTL_MS);
    expect(world.magicEffects.map((e) => e.effectId)).toEqual([14]);
  });
});
