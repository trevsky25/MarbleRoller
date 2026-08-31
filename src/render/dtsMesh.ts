// Builds a THREE.Group (and optional collision surfaces) from a parsed .dts
// shape. Geometry assembly (node transforms, strip/fan decoding, winding
// fixes, material flags) ported from MBHaxe's DtsObject.hx (MIT).
import * as THREE from "three";
import { DtsShape, DtsMesh, TSDrawPrimitive } from "../torque/dts";
import { ResourceIndex, dirname } from "../assets/resourceIndex";
import { CollisionSurface } from "../collision/collisionSurface";
import { MaterialEnhancer } from "./materialEnhancer";
import { customTextureFor } from "./customTextures";

export interface BuiltDtsShape {
  group: THREE.Group;
  // world-space collision surfaces (baked through the shape transform)
  collisionSurfaces: CollisionSurface[];
  // local-space AABB of the visible geometry
  localBounds: THREE.Box3;
}

interface MaterialGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
}

// node-local transform from the shape's default pose
function nodeMatrix(shape: DtsShape, nodeIndex: number): THREE.Matrix4 {
  const rotation = shape.defaultRotations[nodeIndex]!;
  const translation = shape.defaultTranslations[nodeIndex]!;
  const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
  q.normalize();
  // Torque Quat16s store the INVERSE rotation
  q.conjugate();
  const mat = new THREE.Matrix4();
  mat.makeRotationFromQuaternion(q);
  mat.setPosition(translation.x, translation.y, translation.z);
  return mat;
}

function nodeWorldMatrix(shape: DtsShape, nodeIndex: number, cache: Map<number, THREE.Matrix4>): THREE.Matrix4 {
  const cached = cache.get(nodeIndex);
  if (cached !== undefined) return cached;
  const local = nodeMatrix(shape, nodeIndex);
  const parent = shape.nodes[nodeIndex]!.parent;
  let world: THREE.Matrix4;
  if (parent === -1) {
    world = local;
  } else {
    world = new THREE.Matrix4().multiplyMatrices(nodeWorldMatrix(shape, parent, cache), local);
  }
  cache.set(nodeIndex, world);
  return world;
}

// Decode a mesh's primitives into per-material triangle soup.
function generateMaterialGeometry(shape: DtsShape, dtsMesh: DtsMesh): MaterialGeometry[] {
  const materialGeometry: MaterialGeometry[] = shape.matNames.map(() => ({ positions: [], normals: [], uvs: [] }));
  if (materialGeometry.length === 0 && dtsMesh.primitives.length > 0) {
    materialGeometry.push({ positions: [], normals: [], uvs: [] });
  }

  const verts = dtsMesh.vertices;
  const norms = dtsMesh.normals;

  function addTriangleFromIndices(i1: number, i2: number, i3: number, materialIndex: number): void {
    const v1 = verts[i1]!;
    const v2 = verts[i2]!;
    const v3 = verts[i3]!;
    // flip if the face normal disagrees with all vertex normals
    const abx = v2.x - v1.x;
    const aby = v2.y - v1.y;
    const abz = v2.z - v1.z;
    const acx = v3.x - v1.x;
    const acy = v3.y - v1.y;
    const acz = v3.z - v1.z;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const n1 = norms[i1]!;
    const n2 = norms[i2]!;
    const n3 = norms[i3]!;
    const dot1 = nx * n1.x + ny * n1.y + nz * n1.z;
    const dot2 = nx * n2.x + ny * n2.y + nz * n2.z;
    const dot3 = nx * n3.x + ny * n3.y + nz * n3.z;
    if (dot1 < 0 && dot2 < 0 && dot3 < 0) {
      const temp = i1;
      i1 = i3;
      i3 = temp;
    }

    const geometrydata = materialGeometry[materialIndex] ?? materialGeometry[0]!;
    for (const index of [i1, i2, i3]) {
      const v = verts[index]!;
      const n = norms[index]!;
      const uv = dtsMesh.uv[index] ?? { x: 0, y: 0 };
      geometrydata.positions.push(v.x, v.y, v.z);
      geometrydata.normals.push(n.x, n.y, n.z);
      geometrydata.uvs.push(uv.x, uv.y);
    }
  }

  for (const primitive of dtsMesh.primitives) {
    const materialIndex = primitive.matIndex & TSDrawPrimitive.MaterialMask;
    const drawType = primitive.matIndex & TSDrawPrimitive.TypeMask;

    if (drawType === TSDrawPrimitive.Triangles) {
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements; i += 3) {
        addTriangleFromIndices(dtsMesh.indices[i]!, dtsMesh.indices[i + 1]!, dtsMesh.indices[i + 2]!, materialIndex);
      }
    } else if (drawType === TSDrawPrimitive.Strip) {
      let k = 0;
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements - 2; i++) {
        let i1 = dtsMesh.indices[i]!;
        const i2 = dtsMesh.indices[i + 1]!;
        let i3 = dtsMesh.indices[i + 2]!;
        if (k % 2 === 0) {
          const temp = i1;
          i1 = i3;
          i3 = temp;
        }
        addTriangleFromIndices(i1, i2, i3, materialIndex);
        k++;
      }
    } else if (drawType === TSDrawPrimitive.Fan) {
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements - 2; i++) {
        addTriangleFromIndices(dtsMesh.indices[primitive.firstElement]!, dtsMesh.indices[i + 1]!, dtsMesh.indices[i + 2]!, materialIndex);
      }
    }
  }

  return materialGeometry;
}

// Find the texture file for a material name in the shape's directory
// (any of the extensions Torque supports), honoring skin overrides.
function resolveDtsTexture(
  index: ResourceIndex,
  dtsPath: string,
  matName: string,
  matNameOverride: Map<string, string>,
): string | null {
  const name = matNameOverride.get(matName) ?? matName;
  const dir = dirname(dtsPath);
  const base = name.includes(".") && /\.(png|jpg|jpeg|bmp)$/i.test(name) ? name.replace(/\.(png|jpg|jpeg|bmp)$/i, "") : name;
  for (const ext of ["png", "jpg", "jpeg", "bmp"]) {
    const candidate = `${dir}/${base}.${ext}`;
    if (index.exists(candidate)) return candidate;
  }
  if (index.exists(`${dir}/${name}`)) return `${dir}/${name}`;
  return null;
}

const MATERIAL_FLAG_TRANSLUCENT = 4;
const MATERIAL_FLAG_ADDITIVE = 8;
const MATERIAL_FLAG_SUBTRACTIVE = 16;
const MATERIAL_FLAG_SELF_ILLUMINATING = 32;

export interface DtsBuildOptions {
  // material-name remapping, e.g. base.gem -> red.gem (skins)
  matNameOverride?: Map<string, string>;
  // generate collision surfaces from "col*"-named objects, baked through
  // this world transform
  collisionTransform?: THREE.Matrix4 | null;
  // physics properties applied to all generated collision surfaces
  friction?: number;
  restitution?: number;
  force?: number;
  enhancer?: MaterialEnhancer;
}

export function buildDtsShape(
  shape: DtsShape,
  dtsPath: string,
  index: ResourceIndex,
  textureLoader: THREE.TextureLoader,
  options: DtsBuildOptions = {},
): BuiltDtsShape {
  const matNameOverride = options.matNameOverride ?? new Map<string, string>();
  const group = new THREE.Group();
  const collisionSurfaces: CollisionSurface[] = [];
  const localBounds = new THREE.Box3();

  // Build materials
  const materials: THREE.Material[] = shape.matNames.map((matName, i) => {
    const flags = shape.matFlags[i]!;
    let texture: THREE.Texture | null = customTextureFor(dtsPath, matName);
    const texPath = texture !== null ? null : resolveDtsTexture(index, dtsPath, matName, matNameOverride);
    if (texPath !== null) {
      const url = index.resolve(texPath);
      if (url !== null) {
        texture = textureLoader.load(url);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
      }
    } else if (texture === null) {
      console.warn(`DTS: unable to resolve material "${matName}" for ${dtsPath}`);
    }
    const material =
      options.enhancer !== undefined
        ? (options.enhancer.createMaterial(matName, texture) as THREE.MeshPhongMaterial | THREE.MeshStandardMaterial)
        : (() => {
            const m = new THREE.MeshPhongMaterial();
            if (texture !== null) m.map = texture;
            return m;
          })();
    material.side = THREE.FrontSide;
    if ((flags & MATERIAL_FLAG_TRANSLUCENT) !== 0) {
      material.transparent = true;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
    }
    if ((flags & MATERIAL_FLAG_ADDITIVE) !== 0) material.blending = THREE.AdditiveBlending;
    if ((flags & MATERIAL_FLAG_SUBTRACTIVE) !== 0) material.blending = THREE.SubtractiveBlending;
    if ((flags & MATERIAL_FLAG_SELF_ILLUMINATING) !== 0) {
      material.emissive.set(0xffffff);
      material.emissiveMap = material.map;
      material.color.set(0x000000);
    }
    return material;
  });
  if (materials.length === 0) materials.push(new THREE.MeshPhongMaterial({ color: 0xffffff }));

  // Use the highest detail level's subshape (detail 0)
  const detail = shape.detailLevels[0];
  const subShape = detail !== undefined ? shape.subShapes[detail.subShape]! : shape.subShapes[0]!;
  const nodeCache = new Map<number, THREE.Matrix4>();

  const nodeStart = subShape.firstNode;
  const nodeEnd = subShape.firstNode + subShape.numNodes;

  for (let i = 0; i < shape.nodes.length; i++) {
    if (i < nodeStart || (subShape.numNodes > 0 && i >= nodeEnd)) continue;
    const objects = shape.objects.filter((object) => object.node === i);
    const worldMat = nodeWorldMatrix(shape, i, nodeCache);
    const normalMat = new THREE.Matrix3().getNormalMatrix(worldMat);

    for (const object of objects) {
      const objectName = shape.names[object.name] ?? "";
      const isCollisionObject = objectName.toLowerCase().startsWith("col");

      for (let j = object.firstMesh; j < object.firstMesh + object.numMeshes; j++) {
        if (j >= shape.meshes.length) continue;
        const mesh = shape.meshes[j];
        if (mesh === null || mesh === undefined) continue;
        if (mesh.parent >= 0) continue;
        if (mesh.vertices.length === 0) continue;

        if (isCollisionObject) {
          if (options.collisionTransform !== undefined && options.collisionTransform !== null) {
            const fullMat = new THREE.Matrix4().multiplyMatrices(options.collisionTransform, worldMat);
            const surfaces = buildCollisionSurfaces(mesh, fullMat, options);
            collisionSurfaces.push(...surfaces);
          }
          continue;
        }

        const geometries = generateMaterialGeometry(shape, mesh);
        for (let k = 0; k < geometries.length; k++) {
          const geo = geometries[k]!;
          if (geo.positions.length === 0) continue;

          const geometry = new THREE.BufferGeometry();
          const positions = new Float32Array(geo.positions);
          const normals = new Float32Array(geo.normals);
          // bake the node transform into the vertices
          for (let p = 0; p < positions.length; p += 3) {
            const v = new THREE.Vector3(positions[p]!, positions[p + 1]!, positions[p + 2]!).applyMatrix4(worldMat);
            positions[p] = v.x;
            positions[p + 1] = v.y;
            positions[p + 2] = v.z;
            localBounds.expandByPoint(v);
            const n = new THREE.Vector3(normals[p]!, normals[p + 1]!, normals[p + 2]!).applyMatrix3(normalMat).normalize();
            normals[p] = n.x;
            normals[p + 1] = n.y;
            normals[p + 2] = n.z;
          }
          geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
          geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geo.uvs), 2));

          const threeMesh = new THREE.Mesh(geometry, materials[k] ?? materials[0]!);
          threeMesh.castShadow = true;
          group.add(threeMesh);
        }
      }
    }
  }

  return { group, collisionSurfaces, localBounds };
}

function buildCollisionSurfaces(mesh: DtsMesh, transform: THREE.Matrix4, options: DtsBuildOptions): CollisionSurface[] {
  const surface = new CollisionSurface();
  surface.friction = options.friction ?? 1;
  surface.restitution = options.restitution ?? 1;
  surface.force = options.force ?? 0;

  const normalMat = new THREE.Matrix3().getNormalMatrix(transform);
  const verts = mesh.vertices.map((v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(transform));
  const norms = mesh.normals.map((v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix3(normalMat).normalize());

  function addTri(i1: number, i2: number, i3: number): void {
    const v1 = verts[i1]!;
    const v2 = verts[i2]!;
    const v3 = verts[i3]!;
    const area = new THREE.Vector3().subVectors(v2, v1).cross(new THREE.Vector3().subVectors(v3, v1)).length() / 2;
    if (area < 0.00001) return;
    for (const idx of [i1, i2, i3]) {
      surface.addPoint(verts[idx]!.x, verts[idx]!.y, verts[idx]!.z);
      surface.addNormal(norms[idx]!.x, norms[idx]!.y, norms[idx]!.z);
      surface.indices.push(surface.indices.length);
    }
  }

  for (const primitive of mesh.primitives) {
    const drawType = primitive.matIndex & TSDrawPrimitive.TypeMask;
    if (drawType === TSDrawPrimitive.Triangles) {
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements; i += 3) {
        addTri(mesh.indices[i]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!);
      }
    } else if (drawType === TSDrawPrimitive.Strip) {
      let k = 0;
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements - 2; i++) {
        let i1 = mesh.indices[i]!;
        const i2 = mesh.indices[i + 1]!;
        let i3 = mesh.indices[i + 2]!;
        if (k % 2 === 0) {
          const temp = i1;
          i1 = i3;
          i3 = temp;
        }
        addTri(i1, i2, i3);
        k++;
      }
    } else if (drawType === TSDrawPrimitive.Fan) {
      for (let i = primitive.firstElement; i < primitive.firstElement + primitive.numElements - 2; i++) {
        addTri(mesh.indices[primitive.firstElement]!, mesh.indices[i + 1]!, mesh.indices[i + 2]!);
      }
    }
  }

  if (surface.points.length === 0) return [];
  surface.generateBoundingBox();
  return [surface];
}
