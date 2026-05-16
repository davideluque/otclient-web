/**
 * XTEA cipher for OT 7.6 game packet encryption.
 * 32 rounds, little-endian, operates on 8-byte blocks.
 * Key is 4 × U32 values exchanged during login.
 */

const ROUNDS = 32;
const DELTA = 0x9E3779B9;

export type XteaKey = [number, number, number, number];

/**
 * Encrypt data in-place using XTEA. Data length must be a multiple of 8.
 * Pads with zeros if needed and returns the (possibly padded) buffer.
 */
export function xteaEncrypt(data: Uint8Array, key: XteaKey): Uint8Array {
  const padded = padToBlock(data);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  for (let i = 0; i < padded.length; i += 8) {
    let v0 = view.getUint32(i, true);
    let v1 = view.getUint32(i + 4, true);
    let sum = 0;

    for (let r = 0; r < ROUNDS; r++) {
      v0 = (v0 + ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]))) >>> 0;
      sum = (sum + DELTA) >>> 0;
      v1 = (v1 + ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]))) >>> 0;
    }

    view.setUint32(i, v0, true);
    view.setUint32(i + 4, v1, true);
  }

  return padded;
}

/**
 * Decrypt data in-place using XTEA. Data length must be a multiple of 8.
 */
export function xteaDecrypt(data: Uint8Array, key: XteaKey): void {
  if (data.length % 8 !== 0) {
    throw new Error(`XTEA decrypt: data length ${data.length} is not a multiple of 8`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < data.length; i += 8) {
    let v0 = view.getUint32(i, true);
    let v1 = view.getUint32(i + 4, true);
    let sum = (DELTA * ROUNDS) >>> 0;

    for (let r = 0; r < ROUNDS; r++) {
      v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + key[(sum >>> 11) & 3]))) >>> 0;
      sum = (sum - DELTA) >>> 0;
      v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + key[sum & 3]))) >>> 0;
    }

    view.setUint32(i, v0, true);
    view.setUint32(i + 4, v1, true);
  }
}

/** Generate a random XTEA key. */
export function generateXteaKey(): XteaKey {
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return [arr[0], arr[1], arr[2], arr[3]];
}

function padToBlock(data: Uint8Array): Uint8Array {
  const remainder = data.length % 8;
  if (remainder === 0) return data;
  const padded = new Uint8Array(data.length + (8 - remainder));
  padded.set(data);
  return padded;
}
