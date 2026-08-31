// Geometric collision tests, ported from MBHaxe collision/Collision.hx (MIT).
import { Vec3 } from "../math/vec3";

export function pointInTriangle(point: Vec3, v0: Vec3, v1: Vec3, v2: Vec3): boolean {
  const u = v1.sub(v0);
  const v = v2.sub(v0);
  const w = point.sub(v0);

  const vw = v.cross(w);
  const vu = v.cross(u);

  if (vw.dot(vu) < 0.0) return false;

  const uw = u.cross(w);
  const uv = u.cross(v);

  if (uw.dot(uv) < 0.0) return false;

  const d = uv.length();
  const r = vw.length() / d;
  const t = uw.length() / d;

  return r + t <= 1;
}

export function closestPtPointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3, outP: Vec3): void {
  const ab = b.sub(a);
  const ac = c.sub(a);
  const ap = p.sub(a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0.0 && d2 <= 0.0) {
    outP.load(a);
    return;
  }
  const bp = p.sub(b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0.0 && d4 <= d3) {
    outP.load(b);
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    const v = d1 / (d1 - d3);
    outP.load(a.add(ab.multiply(v)));
    return;
  }
  const cp = p.sub(c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0.0 && d5 <= d6) {
    outP.load(c);
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    const w = d2 / (d2 - d6);
    outP.load(a.add(ac.multiply(w)));
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0.0 && d4 - d3 >= 0.0 && d5 - d6 >= 0.0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    outP.load(b.add(c.sub(b).multiply(w)));
    return;
  }
  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  outP.load(a.add(ab.multiply(v)).add(ac.multiply(w)));
}

// Sphere-vs-triangle: true if the sphere at P (radius r) touches the triangle;
// fills `point` with the closest point and `normal` with the contact normal.
export function triangleSphereIntersection(
  v0: Vec3,
  v1: Vec3,
  v2: Vec3,
  _n: Vec3,
  P: Vec3,
  r: number,
  point: Vec3,
  normal: Vec3,
): boolean {
  closestPtPointTriangle(P, v0, v1, v2, point);
  const v = point.sub(P);
  if (v.dot(v) <= r * r) {
    normal.load(P.sub(point));
    normal.normalize();
    return true;
  }
  return false;
}

export function capsuleSphereNearestOverlap(
  a0: Vec3,
  a1: Vec3,
  radA: number,
  b: Vec3,
  radB: number,
): { result: boolean; t: number } {
  const V = a1.sub(a0);
  const A0B = a0.sub(b);
  const d1 = A0B.dot(V);
  const d2 = A0B.dot(A0B);
  const d3 = V.dot(V);
  const R2 = (radA + radB) * (radA + radB);
  if (d2 < R2) return { result: true, t: 0.0 };
  if (d3 < 0.01) return { result: false, t: 0.0 };

  const b24ac = Math.sqrt(d1 * d1 - d2 * d3 + d3 * R2);
  const t1 = (-d1 - b24ac) / d3;
  if (t1 > 0 && t1 < 1.0) return { result: true, t: t1 };
  const t2 = (-d1 + b24ac) / d3;
  if (t2 > 0 && t2 < 1.0) return { result: true, t: t2 };
  if (t1 < 0 && t2 > 0) return { result: true, t: 0.0 };
  return { result: false, t: 0.0 };
}
