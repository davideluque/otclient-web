import { describe, it, expect } from 'vitest';
import { xteaEncrypt, xteaDecrypt, generateXteaKey } from '../lib/net/common/xtea';
import type { XteaKey } from '../lib/net/common/xtea';

const TEST_KEY: XteaKey = [0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210];

describe('XTEA', () => {
  it('encrypts and decrypts round-trip (8 bytes)', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const encrypted = xteaEncrypt(new Uint8Array(original), TEST_KEY);
    expect(encrypted.length).toBe(8);
    // Encrypted should differ from original
    expect(Array.from(encrypted)).not.toEqual(Array.from(original));
    // Decrypt in place
    xteaDecrypt(encrypted, TEST_KEY);
    expect(Array.from(encrypted)).toEqual(Array.from(original));
  });

  it('encrypts and decrypts round-trip (16 bytes)', () => {
    const original = new Uint8Array(16);
    for (let i = 0; i < 16; i++) original[i] = i * 3;

    const encrypted = xteaEncrypt(new Uint8Array(original), TEST_KEY);
    expect(encrypted.length).toBe(16);
    xteaDecrypt(encrypted, TEST_KEY);
    expect(Array.from(encrypted)).toEqual(Array.from(original));
  });

  it('pads data to 8-byte boundary', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5]); // 5 bytes
    const encrypted = xteaEncrypt(original, TEST_KEY);
    expect(encrypted.length).toBe(8); // padded to 8
  });

  it('throws on decrypt with non-aligned data', () => {
    const data = new Uint8Array(5);
    expect(() => xteaDecrypt(data, TEST_KEY)).toThrow('not a multiple of 8');
  });

  it('produces different ciphertext with different keys', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const key1: XteaKey = [1, 2, 3, 4];
    const key2: XteaKey = [5, 6, 7, 8];

    const enc1 = xteaEncrypt(new Uint8Array(data), key1);
    const enc2 = xteaEncrypt(new Uint8Array(data), key2);

    expect(Array.from(enc1)).not.toEqual(Array.from(enc2));
  });

  it('decrypts to zeros for zero input', () => {
    const data = new Uint8Array(8); // all zeros
    const encrypted = xteaEncrypt(new Uint8Array(data), TEST_KEY);
    xteaDecrypt(encrypted, TEST_KEY);
    expect(Array.from(encrypted)).toEqual(Array.from(data));
  });

  it('generateXteaKey returns 4 values', () => {
    const key = generateXteaKey();
    expect(key).toHaveLength(4);
    expect(typeof key[0]).toBe('number');
    expect(typeof key[3]).toBe('number');
  });
});
