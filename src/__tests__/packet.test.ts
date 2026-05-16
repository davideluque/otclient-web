import { describe, it, expect } from 'vitest';
import { InputPacket } from '../lib/net/common/InputPacket';
import { OutputPacket } from '../lib/net/common/OutputPacket';

describe('OutputPacket', () => {
  it('writes and reads U8', () => {
    const out = new OutputPacket();
    out.addU8(0x42);
    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getU8()).toBe(0x42);
  });

  it('writes and reads U16 little-endian', () => {
    const out = new OutputPacket();
    out.addU16(0x1234);
    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getU16()).toBe(0x1234);
  });

  it('writes and reads U32 little-endian', () => {
    const out = new OutputPacket();
    out.addU32(0xdeadbeef);
    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getU32()).toBe(0xdeadbeef);
  });

  it('writes and reads string', () => {
    const out = new OutputPacket();
    out.addString('Hello Tibia!');
    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getString()).toBe('Hello Tibia!');
  });

  it('writes and reads empty string', () => {
    const out = new OutputPacket();
    out.addString('');
    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getString()).toBe('');
  });

  it('writes and reads position', () => {
    const out = new OutputPacket();
    out.addPosition(32000, 32000, 7);
    const inp = new InputPacket(out.toArrayBuffer());
    const pos = inp.getPosition();
    expect(pos.x).toBe(32000);
    expect(pos.y).toBe(32000);
    expect(pos.z).toBe(7);
  });

  it('writes and reads raw bytes', () => {
    const out = new OutputPacket();
    out.addBytes(new Uint8Array([1, 2, 3, 4]));
    const inp = new InputPacket(out.toArrayBuffer());
    const bytes = inp.getBytes(4);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('handles multiple fields sequentially', () => {
    const out = new OutputPacket();
    out.addU8(0x0a);
    out.addU16(1000);
    out.addString('player');
    out.addU32(42);

    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getU8()).toBe(0x0a);
    expect(inp.getU16()).toBe(1000);
    expect(inp.getString()).toBe('player');
    expect(inp.getU32()).toBe(42);
  });

  it('grows buffer when needed', () => {
    const out = new OutputPacket(4); // tiny initial size
    out.addU32(1);
    out.addU32(2);
    out.addU32(3);
    expect(out.length).toBe(12);

    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.getU32()).toBe(1);
    expect(inp.getU32()).toBe(2);
    expect(inp.getU32()).toBe(3);
  });
});

describe('InputPacket', () => {
  it('tracks bytes left', () => {
    const out = new OutputPacket();
    out.addU8(1);
    out.addU16(2);

    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.bytesLeft).toBe(3);
    inp.getU8();
    expect(inp.bytesLeft).toBe(2);
    inp.getU16();
    expect(inp.bytesLeft).toBe(0);
  });

  it('peeks without advancing', () => {
    const out = new OutputPacket();
    out.addU8(0x42);
    out.addU16(0x1234);

    const inp = new InputPacket(out.toArrayBuffer());
    expect(inp.peekU8()).toBe(0x42);
    expect(inp.peekU8()).toBe(0x42); // still same
    expect(inp.position).toBe(0);

    inp.getU8();
    expect(inp.peekU16()).toBe(0x1234);
    expect(inp.position).toBe(1);
  });

  it('skips bytes', () => {
    const out = new OutputPacket();
    out.addU8(1);
    out.addU8(2);
    out.addU8(42);

    const inp = new InputPacket(out.toArrayBuffer());
    inp.skip(2);
    expect(inp.getU8()).toBe(42);
  });

  it('supports offset constructor parameter', () => {
    const out = new OutputPacket();
    out.addU16(0); // padding
    out.addU8(42);

    const inp = new InputPacket(out.toArrayBuffer(), 2);
    expect(inp.getU8()).toBe(42);
  });
});
