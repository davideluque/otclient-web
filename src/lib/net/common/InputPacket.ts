import { ParseError } from '../../parseError';

/**
 * Reads typed fields from an OT protocol packet buffer.
 * All multi-byte integers are little-endian.
 */
export class InputPacket {
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer, offset = 0) {
    this.view = new DataView(buffer);
    this.offset = offset;
  }

  get position(): number {
    return this.offset;
  }

  get bytesLeft(): number {
    return this.view.byteLength - this.offset;
  }

  /**
   * Bounds check before every read/skip: packets come off the wire, so a
   * malformed or truncated frame must fail as a controlled ParseError the
   * dispatcher can attribute, not a native RangeError from DataView.
   */
  private require(bytes: number): void {
    if (bytes < 0 || this.offset + bytes > this.view.byteLength) {
      throw new ParseError(
        `Truncated packet: need ${bytes} byte(s) at offset ${this.offset}, ` +
        `but only ${this.view.byteLength - this.offset} remain`,
      );
    }
  }

  getU8(): number {
    this.require(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  getU16(): number {
    this.require(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  getU32(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  getString(): string {
    const len = this.getU16();
    this.require(len);
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  getPosition(): { x: number; y: number; z: number } {
    return {
      x: this.getU16(),
      y: this.getU16(),
      z: this.getU8(),
    };
  }

  /** Read raw bytes into a new Uint8Array. */
  getBytes(length: number): Uint8Array {
    this.require(length);
    const bytes = new Uint8Array(this.view.buffer, this.offset, length);
    this.offset += length;
    return new Uint8Array(bytes);
  }

  skip(n: number): void {
    this.require(n);
    this.offset += n;
  }

  /** Peek at the next byte without advancing. */
  peekU8(): number {
    this.require(1);
    return this.view.getUint8(this.offset);
  }

  /** Peek at the next U16 without advancing. */
  peekU16(): number {
    this.require(2);
    return this.view.getUint16(this.offset, true);
  }
}
