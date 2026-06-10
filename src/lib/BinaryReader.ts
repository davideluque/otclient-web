import { ParseError } from './parseError';

export class BinaryReader {
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.view.byteLength;
  }

  /**
   * Bounds check before every read/skip: asset files are user-supplied,
   * so truncated or length-lying input must surface as a controlled
   * ParseError, not a native RangeError from inside DataView.
   */
  private require(bytes: number): void {
    if (bytes < 0 || this.offset + bytes > this.view.byteLength) {
      throw new ParseError(
        `Truncated input: need ${bytes} byte(s) at offset ${this.offset}, ` +
        `but only ${this.view.byteLength - this.offset} remain`,
      );
    }
  }

  getU8(): number {
    this.require(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  getU16(): number {
    this.require(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  getU32(): number {
    this.require(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  getString(): string {
    const len = this.getU16();
    this.require(len);
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  skip(bytes: number): void {
    this.require(bytes);
    this.offset += bytes;
  }
}
