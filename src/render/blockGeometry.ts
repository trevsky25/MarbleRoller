// Geometry for custom-level blocks: boxes and ramp wedges with world-planar
// UVs (2-unit tile repeat, matching MBG interior texgen scale), producing
// both render arrays and collision surfaces.
import * as THREE from "three";
import { CollisionSurface } from "../collision/collisionSurface";
import { LevelBlock, SurfaceDef } from "../editor/customLevel";

const TILE_SIZE = 2; // world units per texture repeat, like MBG interiors

export interface BlockArrays {
  positions: number[];
  normals: number[];
  uvs: number[];
}

// Local-space (unrotated, centered at origin, z from 0..sz) triangle list
// for a block. Faces are emitted as CCW triangles viewed from outside.
function blockTriangles(block: LevelBlock): { v: [number, number, number][]; quads: number[][] } {
  const hx = block.sx / 2;
  const hy = block.sy / 2;
  const z0 = 0;
  const z1 = block.sz;

  if (block.shape === "box") {
    const v: [number, number, number][] = [
      [-hx, -hy, z0], // 0
      [hx, -hy, z0], // 1
      [hx, hy, z0], // 2
      [-hx, hy, z0], // 3
      [-hx, -hy, z1], // 4
      [hx, -hy, z1], // 5
      [hx, hy, z1], // 6
      [-hx, hy, z1], // 7
    ];
    const quads = [
      [4, 5, 6, 7], // top
      [3, 2, 1, 0], // bottom
      [0, 1, 5, 4], // -y
      [2, 3, 7, 6], // +y
      [1, 2, 6, 5], // +x
      [3, 0, 4, 7], // -x
    ];
    return { v, quads };
  }

  // Ramp: rises along +x (rotate to orient). Slope from z0 at -x to z1 at +x.
  const v: [number, number, number][] = [
    [-hx, -hy, z0], // 0
    [hx, -hy, z0], // 1
    [hx, hy, z0], // 2
    [-hx, hy, z0], // 3
    [hx, -hy, z1], // 4
    [hx, hy, z1], // 5
  ];
  const quads = [
    [0, 1, 4], // -y side triangle
    [2, 3, 5], // +y side triangle
    [3, 2, 1, 0], // bottom
    [1, 2, 5, 4], // +x back wall
    [0, 4, 5, 3], // slope face (outward up/-x)
  ];
  return { v, quads };
}

function faceUV(nx: number, ny: number, nz: number, px: number, py: number, pz: number): [number, number] {
  // world-planar mapping by dominant axis
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (az >= ax && az >= ay) return [px / TILE_SIZE, py / TILE_SIZE];
  if (ax >= ay) return [py / TILE_SIZE, pz / TILE_SIZE];
  return [px / TILE_SIZE, pz / TILE_SIZE];
}

function rotatePoint(x: number, y: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [-y, x];
    case 2:
      return [-x, -y];
    case 3:
      return [y, -x];
    default:
      return [x, y];
  }
}

// Emit a block into render arrays and a collision surface (world space).
export function emitBlock(
  block: LevelBlock,
  surface: SurfaceDef,
  arrays: BlockArrays,
  collision: CollisionSurface,
): void {
  const { v, quads } = blockTriangles(block);

  // world-space transform
  const world = v.map(([x, y, z]) => {
    const [rx, ry] = rotatePoint(x, y, block.rot);
    return [rx + block.x, ry + block.y, z + block.z] as [number, number, number];
  });

  const emitTri = (i0: number, i1: number, i2: number): void => {
    const p0 = world[i0]!;
    const p1 = world[i1]!;
    const p2 = world[i2]!;
    // face normal
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0];
    const wy = p2[1] - p0[1];
    const wz = p2[2] - p0[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len;
    ny /= len;
    nz /= len;

    for (const p of [p0, p1, p2]) {
      arrays.positions.push(p[0], p[1], p[2]);
      arrays.normals.push(nx, ny, nz);
      const [u, vv] = faceUV(nx, ny, nz, p[0], p[1], p[2]);
      arrays.uvs.push(u, vv);

      collision.addPoint(p[0], p[1], p[2]);
      collision.addNormal(nx, ny, nz);
      collision.indices.push(collision.indices.length);
    }
  };

  for (const quad of quads) {
    if (quad.length === 3) {
      emitTri(quad[0]!, quad[1]!, quad[2]!);
    } else {
      emitTri(quad[0]!, quad[1]!, quad[2]!);
      emitTri(quad[0]!, quad[2]!, quad[3]!);
    }
  }
}

// Standalone geometry for editor previews (single block, world space).
export function blockPreviewGeometry(block: LevelBlock): THREE.BufferGeometry {
  const arrays: BlockArrays = { positions: [], normals: [], uvs: [] };
  const scratch = new CollisionSurface();
  emitBlock(block, { id: "", label: "", texture: "", friction: 1, restitution: 1, force: 0 }, arrays, scratch);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arrays.positions), 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(arrays.normals), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(arrays.uvs), 2));
  return geometry;
}
