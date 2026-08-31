// Little-endian binary reader over an ArrayBuffer.
// Ported from MBHaxe dif/io/BytesReader.hx (MIT, RandomityGuy).
export class BinaryReader {
  private view: DataView;
  private position = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  readInt32(): number {
    const v = this.view.getInt32(this.position, true);
    this.position += 4;
    return v;
  }

  // MBHaxe's BytesReader reads unsigned 16-bit for both readInt16 and
  // readUInt16 (haxe Bytes.getUInt16); keep that behavior.
  readUInt16(): number {
    const v = this.view.getUint16(this.position, true);
    this.position += 2;
    return v;
  }

  readByte(): number {
    const v = this.view.getUint8(this.position);
    this.position += 1;
    return v;
  }

  readStr(): string {
    const len = this.readByte();
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.readByte());
    return s;
  }

  readFloat(): number {
    const v = this.view.getFloat32(this.position, true);
    this.position += 4;
    return v;
  }

  tell(): number {
    return this.position;
  }

  seek(pos: number): void {
    this.position = pos;
  }

  get length(): number {
    return this.view.byteLength;
  }
}
