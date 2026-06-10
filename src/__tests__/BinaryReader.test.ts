import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../lib/BinaryReader';
import { ParseError } from '../lib/parseError';

function makeBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('BinaryReader', () => {
  it('reads U8', () => {
    const reader = new BinaryReader(makeBuffer([0x42]));
    expect(reader.getU8()).toBe(0x42);
    expect(reader.position).toBe(1);
  });

  it('reads U16 little-endian', () => {
    const reader = new BinaryReader(makeBuffer([0x34, 0x12]));
    expect(reader.getU16()).toBe(0x1234);
  });

  it('reads U32 little-endian', () => {
    const reader = new BinaryReader(makeBuffer([0x78, 0x56, 0x34, 0x12]));
    expect(reader.getU32()).toBe(0x12345678);
  });

  it('reads a length-prefixed string', () => {
    // U16 length = 3, then "abc"
    const reader = new BinaryReader(makeBuffer([0x03, 0x00, 0x61, 0x62, 0x63]));
    expect(reader.getString()).toBe('abc');
    expect(reader.position).toBe(5);
  });

  it('reads empty string', () => {
    const reader = new BinaryReader(makeBuffer([0x00, 0x00]));
    expect(reader.getString()).toBe('');
    expect(reader.position).toBe(2);
  });

  it('tracks position across sequential reads', () => {
    const reader = new BinaryReader(makeBuffer([0x01, 0x02, 0x00, 0x03, 0x00, 0x00, 0x00]));
    reader.getU8();   // 1 byte  → pos 1
    reader.getU16();  // 2 bytes → pos 3
    reader.getU32();  // 4 bytes → pos 7
    expect(reader.position).toBe(7);
  });

  it('skip advances position', () => {
    const reader = new BinaryReader(makeBuffer([0x00, 0x00, 0x00, 0x42]));
    reader.skip(3);
    expect(reader.getU8()).toBe(0x42);
  });

  it('reports buffer length', () => {
    const reader = new BinaryReader(makeBuffer([0x01, 0x02, 0x03]));
    expect(reader.length).toBe(3);
  });
});

describe('BinaryReader bounds checking', () => {
  it('throws ParseError when reading past the end', () => {
    const reader = new BinaryReader(makeBuffer([0x01]));
    reader.getU8();
    expect(() => reader.getU8()).toThrowError(ParseError);
    expect(() => reader.getU16()).toThrowError(/[Tt]runcated/);
    expect(() => reader.getU32()).toThrowError(ParseError);
  });

  it('throws ParseError on a string whose declared length exceeds the buffer', () => {
    // Declared length 0xFFFF, only 2 bytes of payload follow.
    const reader = new BinaryReader(makeBuffer([0xff, 0xff, 0x41, 0x42]));
    expect(() => reader.getString()).toThrowError(ParseError);
  });

  it('throws ParseError on skip past the end and on negative skip', () => {
    const reader = new BinaryReader(makeBuffer([0x01, 0x02]));
    expect(() => reader.skip(3)).toThrowError(ParseError);
    expect(() => reader.skip(-1)).toThrowError(ParseError);
    reader.skip(2); // exactly to the end is fine
    expect(reader.position).toBe(2);
  });
});
