// Minimal AABB matching the h3d.col.Bounds operations the physics port uses.
export class Bounds {
  xMin = 1e20;
  yMin = 1e20;
  zMin = 1e20;
  xMax = -1e20;
  yMax = -1e20;
  zMax = -1e20;

  addPos(x: number, y: number, z: number): void {
    if (x < this.xMin) this.xMin = x;
    if (y < this.yMin) this.yMin = y;
    if (z < this.zMin) this.zMin = z;
    if (x > this.xMax) this.xMax = x;
    if (y > this.yMax) this.yMax = y;
    if (z > this.zMax) this.zMax = z;
  }

  addSpherePos(x: number, y: number, z: number, r: number): void {
    this.addPos(x - r, y - r, z - r);
    this.addPos(x + r, y + r, z + r);
  }

  add(other: Bounds): void {
    this.addPos(other.xMin, other.yMin, other.zMin);
    this.addPos(other.xMax, other.yMax, other.zMax);
  }

  collide(other: Bounds): boolean {
    return (
      this.xMin <= other.xMax &&
      this.xMax >= other.xMin &&
      this.yMin <= other.yMax &&
      this.yMax >= other.yMin &&
      this.zMin <= other.zMax &&
      this.zMax >= other.zMin
    );
  }

  containsBounds(other: Bounds): boolean {
    return (
      this.xMin <= other.xMin &&
      this.xMax >= other.xMax &&
      this.yMin <= other.yMin &&
      this.yMax >= other.yMax &&
      this.zMin <= other.zMin &&
      this.zMax >= other.zMax
    );
  }

  get xSize(): number {
    return this.xMax - this.xMin;
  }

  get ySize(): number {
    return this.yMax - this.yMin;
  }

  get zSize(): number {
    return this.zMax - this.zMin;
  }

  clone(): Bounds {
    const b = new Bounds();
    b.xMin = this.xMin;
    b.yMin = this.yMin;
    b.zMin = this.zMin;
    b.xMax = this.xMax;
    b.yMax = this.yMax;
    b.zMax = this.zMax;
    return b;
  }
}
