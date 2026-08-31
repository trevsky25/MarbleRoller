// Ported from MBHaxe collision/CollisionSurface.hx (MIT).
// This slice supports static, identity-transform entities only (interiors at
// their baked world position); pathed-interior transforms come later.
import { Vec3 } from "../math/vec3";
import { Bounds } from "../math/bounds";
import { pointInTriangle } from "./collisionMath";

export interface RayIntersectionData {
  point: Vec3;
  normal: Vec3;
  object: CollisionSurface;
  t: number;
}

export interface CollisionTriangle {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  n: Vec3;
}

export class CollisionSurface {
  boundingBox = new Bounds();
  points: number[] = [];
  normals: number[] = [];
  indices: number[] = [];
  friction = 1;
  restitution = 1;
  force = 0;
  // dedup key used by grid searches (mirrors MBHaxe's `key`)
  key = 0;

  getPoint(idx: number): Vec3 {
    return new Vec3(this.points[idx * 3]!, this.points[idx * 3 + 1]!, this.points[idx * 3 + 2]!);
  }

  getNormal(idx: number): Vec3 {
    return new Vec3(this.normals[idx * 3]!, this.normals[idx * 3 + 1]!, this.normals[idx * 3 + 2]!);
  }

  addPoint(x: number, y: number, z: number): void {
    this.points.push(x, y, z);
  }

  addNormal(x: number, y: number, z: number): void {
    this.normals.push(x, y, z);
  }

  getTriangle(idx: number): CollisionTriangle {
    const p1 = this.indices[idx]!;
    const p2 = this.indices[idx + 1]!;
    const p3 = this.indices[idx + 2]!;
    return { v0: this.getPoint(p1), v1: this.getPoint(p2), v2: this.getPoint(p3), n: this.getNormal(p1) };
  }

  generateBoundingBox(): void {
    const bb = new Bounds();
    for (let i = 0; i < this.points.length; i += 3) {
      bb.addPos(this.points[i]!, this.points[i + 1]!, this.points[i + 2]!);
    }
    this.boundingBox = bb;
  }

  rayCast(rayOrigin: Vec3, rayDirection: Vec3, intersections: RayIntersectionData[], bestT: number): number {
    let i = 0;
    while (i < this.indices.length) {
      const p1 = this.getPoint(this.indices[i]!);
      const p2 = this.getPoint(this.indices[i + 1]!);
      const p3 = this.getPoint(this.indices[i + 2]!);
      const n = this.getNormal(this.indices[i]!);
      const d = -p1.dot(n);

      const t = -(rayOrigin.dot(n) + d) / rayDirection.dot(n);
      const ip = rayOrigin.add(rayDirection.multiply(t));
      if (t >= 0 && pointInTriangle(ip, p1, p2, p3)) {
        if (t < bestT) {
          bestT = t;
          intersections.push({ point: ip, normal: n, object: this, t });
        }
      }
      i += 3;
    }
    return bestT;
  }
}
