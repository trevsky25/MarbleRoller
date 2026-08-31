// Builds a renderable THREE.Group and a collision entity from a parsed .dif
// interior. Geometry logic (fan triangulation, texgen UVs, smooth-normal
// vertex buckets, texture path resolution, friction material table) ported
// from MBHaxe's DifBuilder.hx (MIT, RandomityGuy).
//
// Coordinates are raw Torque space (right-handed, Z-up), which matches
// Three.js's right-handed projection directly. (MBHaxe negates x throughout
// only to compensate for Heaps' left-handed projection — verified against
// the original game's level previews.) The physics core is chirality-
// agnostic; only the input axes and camera math carry the sign conjugation.
import * as THREE from "three";
import type { Dif, Interior, Point3F } from "../torque/dif";
import { ResourceIndex, dirname } from "../assets/resourceIndex";
import { CollisionEntity } from "../collision/collisionWorld";
import { CollisionSurface } from "../collision/collisionSurface";
import { MaterialEnhancer } from "./materialEnhancer";

interface BuilderTriangle {
  texture: string;
  i1: number;
  i2: number;
  i3: number;
  n1: Point3F;
  n2: Point3F;
  n3: Point3F;
  uv1: { x: number; y: number };
  uv2: { x: number; y: number };
  uv3: { x: number; y: number };
}

interface VertexBucket {
  referenceNormal: Point3F;
  triangleIndices: number[];
  normals: Point3F[];
}

const SMOOTHING_THRESHOLD = Math.cos(Math.PI / 12);

// Physics properties per material name (DifBuilder.materialDict, MBG subset)
const MATERIAL_PHYSICS: Record<string, { friction: number; restitution: number; force?: number }> = {
  friction_none: { friction: 0.01, restitution: 0.5 },
  friction_low: { friction: 0.2, restitution: 0.5 },
  friction_high: { friction: 1.5, restitution: 0.5 },
  friction_ramp_yellow: { friction: 2.0, restitution: 1.0 },
  oilslick: { friction: 0.05, restitution: 0.5 },
  "base.slick": { friction: 0.05, restitution: 0.5 },
  "ice.slick": { friction: 0.05, restitution: 0.5 },
  grass: { friction: 1.5, restitution: 0.35 },
  ice1: { friction: 0.03, restitution: 0.95 },
  rug: { friction: 6.0, restitution: 0.5 },
  tarmac: { friction: 0.35, restitution: 0.7 },
  carpet: { friction: 6.0, restitution: 0.5 },
  sand: { friction: 4.0, restitution: 0.1 },
  water: { friction: 6.0, restitution: 0.0 },
  floor_bounce: { friction: 0.2, restitution: 0.0, force: 15 },
};

function add(a: Point3F, b: Point3F): Point3F {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Point3F, s: number): Point3F {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Point3F, b: Point3F): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function stripTexName(tex: string): string {
  let dotpos = tex.lastIndexOf(".");
  const slashpos = tex.lastIndexOf("/") + 1;
  if (dotpos === -1) dotpos = tex.length;
  return tex.substring(slashpos, dotpos);
}

export interface BuiltInterior {
  group: THREE.Group;
  collider: CollisionEntity;
}

function buildTriangles(geo: Interior, collider: CollisionEntity): BuilderTriangle[] {
  const triangles: BuilderTriangle[] = [];
  const vertexBuckets = new Map<number, VertexBucket[]>();

  for (const surface of geo.surfaces) {
    let planeIndex = surface.planeIndex;
    const planeFlipped = (planeIndex & 0x8000) === 0x8000;
    if (planeFlipped) planeIndex &= ~0x8000;
    const plane = geo.planes[planeIndex];
    if (plane === undefined) continue;
    let normal = geo.normals[plane.normalIndex];
    if (normal === undefined) continue;
    if (planeFlipped) normal = scale(normal, -1);
    const texture = geo.materialList[surface.textureIndex] ?? "NULL";
    const texgen = geo.texGenEQs[surface.texGenIndex];
    if (texgen === undefined) continue;

    const colliderSurface = new CollisionSurface();
    const materialName = stripTexName(texture).toLowerCase();
    const physics = MATERIAL_PHYSICS[materialName];
    if (physics !== undefined) {
      colliderSurface.friction = physics.friction;
      colliderSurface.restitution = physics.restitution;
      colliderSurface.force = physics.force ?? 0;
    }

    for (let k = surface.windingStart + 2; k < surface.windingStart + surface.windingCount; k++) {
      let i1: number, i2: number, i3: number;
      if ((k - (surface.windingStart + 2)) % 2 === 0) {
        i1 = geo.windings[k]!;
        i2 = geo.windings[k - 1]!;
        i3 = geo.windings[k - 2]!;
      } else {
        i1 = geo.windings[k - 2]!;
        i2 = geo.windings[k - 1]!;
        i3 = geo.windings[k]!;
      }
      const p1 = geo.points[i1]!;
      const p2 = geo.points[i2]!;
      const p3 = geo.points[i3]!;

      const uvOf = (p: Point3F) => ({
        x: p.x * texgen.planeX.x + p.y * texgen.planeX.y + p.z * texgen.planeX.z + texgen.planeX.d,
        y: p.x * texgen.planeY.x + p.y * texgen.planeY.y + p.z * texgen.planeY.z + texgen.planeY.d,
      });

      triangles.push({
        texture,
        i1,
        i2,
        i3,
        n1: normal,
        n2: normal,
        n3: normal,
        uv1: uvOf(p1),
        uv2: uvOf(p2),
        uv3: uvOf(p3),
      });

      colliderSurface.addPoint(p1.x, p1.y, p1.z);
      colliderSurface.addPoint(p2.x, p2.y, p2.z);
      colliderSurface.addPoint(p3.x, p3.y, p3.z);
      colliderSurface.addNormal(normal.x, normal.y, normal.z);
      colliderSurface.addNormal(normal.x, normal.y, normal.z);
      colliderSurface.addNormal(normal.x, normal.y, normal.z);
      colliderSurface.indices.push(colliderSurface.indices.length);
      colliderSurface.indices.push(colliderSurface.indices.length);
      colliderSurface.indices.push(colliderSurface.indices.length);

      for (const v of [i1, i2, i3]) {
        let buckets = vertexBuckets.get(v);
        if (buckets === undefined) {
          buckets = [];
          vertexBuckets.set(v, buckets);
        }
        let bucket: VertexBucket | null = null;
        for (const candidate of buckets) {
          if (dot(normal, candidate.referenceNormal) > SMOOTHING_THRESHOLD) {
            bucket = candidate;
            break;
          }
        }
        if (bucket === null) {
          bucket = { referenceNormal: normal, triangleIndices: [], normals: [] };
          buckets.push(bucket);
        }
        bucket.triangleIndices.push(triangles.length - 1);
        bucket.normals.push(normal);
      }
    }

    colliderSurface.generateBoundingBox();
    collider.addSurface(colliderSurface);
  }

  // Average normals within each bucket for smooth shading.
  for (const [pointIndex, buckets] of vertexBuckets) {
    for (const bucket of buckets) {
      let avgNormal: Point3F = { x: 0, y: 0, z: 0 };
      for (const n of bucket.normals) avgNormal = add(avgNormal, n);
      avgNormal = scale(avgNormal, 1 / bucket.normals.length);
      for (const index of bucket.triangleIndices) {
        const tri = triangles[index]!;
        if (tri.i1 === pointIndex) tri.n1 = avgNormal;
        if (tri.i2 === pointIndex) tri.n2 = avgNormal;
        if (tri.i3 === pointIndex) tri.n3 = avgNormal;
      }
    }
  }

  return triangles;
}

// Texture lookup ported from DifBuilder: search the dif's directory and up to
// two parents, with the name as-is, then .jpg/.png/.bmp.
export function resolveInteriorTexture(index: ResourceIndex, difPath: string, materialName: string): string | null {
  if (materialName === "NULL") return null;
  let tex = materialName;
  const slash = tex.lastIndexOf("/");
  if (slash !== -1) tex = tex.substring(slash + 1);

  const dirs: string[] = [];
  let dir = dirname(difPath);
  for (let i = 0; i < 3; i++) {
    dirs.push(dir);
    dir = dirname(dir);
  }

  for (const d of dirs) {
    if (index.exists(`${d}/${tex}`)) return `${d}/${tex}`;
  }

  const dotPos = tex.lastIndexOf(".");
  const base = dotPos === -1 ? tex : tex.substring(0, dotPos);
  for (const d of dirs) {
    for (const ext of ["jpg", "png", "bmp"]) {
      const candidate = `${d}/${base}.${ext}`;
      if (index.exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function buildInterior(
  dif: Dif,
  difPath: string,
  index: ResourceIndex,
  transform?: THREE.Matrix4,
  enhancer?: MaterialEnhancer,
): Promise<BuiltInterior> {
  const geo = dif.interiors[0];
  if (geo === undefined) throw new Error(`${difPath} contains no interiors`);

  const collider = new CollisionEntity();
  const triangles = buildTriangles(geo, collider);
  // Bake the mission's instance transform into the collision geometry (the
  // collision layer only supports identity-transform static entities).
  if (transform !== undefined) {
    const normalMat = new THREE.Matrix3().getNormalMatrix(transform);
    const v = new THREE.Vector3();
    for (const surface of collider.surfaces) {
      for (let i = 0; i < surface.points.length; i += 3) {
        v.set(surface.points[i]!, surface.points[i + 1]!, surface.points[i + 2]!).applyMatrix4(transform);
        surface.points[i] = v.x;
        surface.points[i + 1] = v.y;
        surface.points[i + 2] = v.z;
      }
      for (let i = 0; i < surface.normals.length; i += 3) {
        v.set(surface.normals[i]!, surface.normals[i + 1]!, surface.normals[i + 2]!).applyMatrix3(normalMat).normalize();
        surface.normals[i] = v.x;
        surface.normals[i + 1] = v.y;
        surface.normals[i + 2] = v.z;
      }
      surface.generateBoundingBox();
    }
  }
  collider.finalize();

  const byTexture = new Map<string, BuilderTriangle[]>();
  for (const tri of triangles) {
    let group = byTexture.get(tri.texture);
    if (group === undefined) {
      group = [];
      byTexture.set(tri.texture, group);
    }
    group.push(tri);
  }

  const textureLoader = new THREE.TextureLoader();
  const group = new THREE.Group();

  for (const [textureName, tris] of byTexture) {
    const positions = new Float32Array(tris.length * 9);
    const normals = new Float32Array(tris.length * 9);
    const uvs = new Float32Array(tris.length * 6);

    let p = 0;
    let u = 0;
    for (const tri of tris) {
      for (const [pi, n, uv] of [
        [tri.i1, tri.n1, tri.uv1],
        [tri.i2, tri.n2, tri.uv2],
        [tri.i3, tri.n3, tri.uv3],
      ] as const) {
        const pt = geo.points[pi]!;
        positions[p] = pt.x;
        normals[p++] = n.x;
        positions[p] = pt.y;
        normals[p++] = n.y;
        positions[p] = pt.z;
        normals[p++] = n.z;
        uvs[u++] = uv.x;
        uvs[u++] = uv.y;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

    let texture: THREE.Texture | null = null;
    const texPath = resolveInteriorTexture(index, difPath, textureName);
    if (texPath !== null) {
      const url = index.resolve(texPath);
      if (url !== null) {
        texture = textureLoader.load(url);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
      }
    } else {
      console.warn(`Unable to resolve texture "${textureName}" for ${difPath}`);
    }
    const material =
      enhancer !== undefined
        ? enhancer.createMaterial(stripTexName(textureName), texture)
        : (() => {
            const m = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide });
            if (texture !== null) m.map = texture;
            else m.color.set(0x888888);
            return m;
          })();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = textureName;
    group.add(mesh);
  }

  if (transform !== undefined) {
    group.applyMatrix4(transform);
  }

  return { group, collider };
}
