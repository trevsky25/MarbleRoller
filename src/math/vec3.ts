// Vector/quaternion math mirroring h3d.Vector / h3d.Quat semantics from Heaps
// so the physics port (from MBHaxe, MIT) stays line-for-line comparable:
// add/sub/multiply/cross return NEW vectors; load/set/scale/normalize mutate.
export class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(v: Vec3): Vec3 {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vec3): Vec3 {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  multiply(s: number): Vec3 {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  cross(v: Vec3): Vec3 {
    return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  distance(v: Vec3): number {
    return this.sub(v).length();
  }

  distanceSq(v: Vec3): number {
    return this.sub(v).lengthSq();
  }

  normalized(): Vec3 {
    const len = this.length();
    return len === 0 ? new Vec3(this.x, this.y, this.z) : this.multiply(1 / len);
  }

  normalize(): void {
    const len = this.length();
    if (len !== 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
  }

  load(v: Vec3): void {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
  }

  set(x = 0, y = 0, z = 0): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  scale(s: number): void {
    this.x *= s;
    this.y *= s;
    this.z *= s;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  equals(v: Vec3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
}

// Hamilton-product quaternion matching h3d.Quat.
export class Quat {
  x = 0;
  y = 0;
  z = 0;
  w = 1;

  identity(): void {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.w = 1;
  }

  // Euler XYZ init, exactly as h3d.Quat.initRotation.
  initRotation(ax: number, ay: number, az: number): void {
    const sinX = Math.sin(ax * 0.5);
    const cosX = Math.cos(ax * 0.5);
    const sinY = Math.sin(ay * 0.5);
    const cosY = Math.cos(ay * 0.5);
    const sinZ = Math.sin(az * 0.5);
    const cosZ = Math.cos(az * 0.5);
    const cosYZ = cosY * cosZ;
    const sinYZ = sinY * sinZ;
    this.x = sinX * cosYZ - cosX * sinYZ;
    this.y = cosX * sinY * cosZ + sinX * cosY * sinZ;
    this.z = cosX * cosY * sinZ - sinX * sinY * cosZ;
    this.w = cosX * cosYZ + sinX * sinYZ;
  }

  initRotateAxis(x: number, y: number, z: number, a: number): void {
    const sin = Math.sin(a / 2);
    const cos = Math.cos(a / 2);
    this.x = x * sin;
    this.y = y * sin;
    this.z = z * sin;
    this.w = cos * Math.sqrt(x * x + y * y + z * z);
    this.normalize();
  }

  normalize(): void {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (len > 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
      this.w /= len;
    }
  }

  // this = q1 * q2 (h3d.Quat.multiply)
  multiply(q1: Quat, q2: Quat): void {
    const x2 = q1.x * q2.w + q1.w * q2.x + q1.y * q2.z - q1.z * q2.y;
    const y2 = q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x;
    const z2 = q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w;
    const w2 = q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z;
    this.x = x2;
    this.y = y2;
    this.z = z2;
    this.w = w2;
  }

  rotateVec(v: Vec3): Vec3 {
    // q * v * q^-1
    const qv = new Vec3(this.x, this.y, this.z);
    const uv = qv.cross(v);
    const uuv = qv.cross(uv);
    return v.add(uv.multiply(2 * this.w)).add(uuv.multiply(2));
  }

  clone(): Quat {
    const q = new Quat();
    q.x = this.x;
    q.y = this.y;
    q.z = this.z;
    q.w = this.w;
    return q;
  }
}
