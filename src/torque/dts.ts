// Torque .dts shape parser (file versions 19-24, the "new" memory-buffer
// format — every MBG shape is v24). Ported from MBHaxe's dts/ package
// (MIT, RandomityGuy).
import { BinaryReader } from "./binaryReader";

export interface DtsNode {
  name: number;
  parent: number;
  firstObject: number;
  firstChild: number;
  nextSibling: number;
}

export interface DtsObjectEntry {
  name: number;
  numMeshes: number;
  firstMesh: number;
  node: number;
  nextSibling: number;
  firstDecal: number;
}

export interface DtsPrimitive {
  firstElement: number;
  numElements: number;
  matIndex: number;
}

export const TSDrawPrimitive = {
  Triangles: 0 << 30,
  Strip: 1 << 30,
  Fan: 2 << 30,
  Indexed: 1 << 29,
  NoMaterial: 1 << 28,
  MaterialMask: ~((1 << 30) | (2 << 30) | (1 << 29) | (1 << 28)),
  TypeMask: (1 << 30) | (2 << 30),
} as const;

export interface DtsMesh {
  meshType: number;
  numFrames: number;
  numMatFrames: number;
  parent: number;
  vertices: { x: number; y: number; z: number }[];
  uv: { x: number; y: number }[];
  normals: { x: number; y: number; z: number }[];
  primitives: DtsPrimitive[];
  indices: number[];
  vertsPerFrame: number;
  type: number;
}

export interface DtsDetail {
  name: number;
  subShape: number;
  objectDetail: number;
  size: number;
}

export interface DtsSubShape {
  firstNode: number;
  firstObject: number;
  numNodes: number;
  numObjects: number;
}

export interface DtsShape {
  fileVersion: number;
  matNames: string[];
  matFlags: number[];
  radius: number;
  center: { x: number; y: number; z: number };
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
  nodes: DtsNode[];
  objects: DtsObjectEntry[];
  subShapes: DtsSubShape[];
  defaultRotations: { x: number; y: number; z: number; w: number }[];
  defaultTranslations: { x: number; y: number; z: number }[];
  detailLevels: DtsDetail[];
  meshes: (DtsMesh | null)[];
  names: string[];
}

// Multi-width stream reader over the DTS memory buffer (dts/DtsAlloc.hx).
class DtsAlloc {
  private buf: BinaryReader;
  index32: number;
  index16: number;
  index8: number;
  private lastGuardValue = 0;

  constructor(buf: BinaryReader, start32: number, start16: number, start8: number) {
    this.buf = buf;
    this.index32 = start32;
    this.index16 = start32 + start16 * 4;
    this.index8 = start32 + start8 * 4;
  }

  readS32(): number {
    this.buf.seek(this.index32);
    const val = this.buf.readInt32();
    this.index32 += 4;
    return val;
  }

  readF32(): number {
    this.buf.seek(this.index32);
    const val = this.buf.readFloat();
    this.index32 += 4;
    return val;
  }

  readPoint2F(): { x: number; y: number } {
    return { x: this.readF32(), y: this.readF32() };
  }

  readPoint3F(): { x: number; y: number; z: number } {
    const x = this.readF32();
    const y = this.readF32();
    const z = this.readF32();
    return { x, y, z };
  }

  readU16(): number {
    this.buf.seek(this.index16);
    const val = this.buf.readUInt16();
    this.index16 += 2;
    return val;
  }

  readS16(): number {
    let val = this.readU16();
    if (val > 32767) val -= 65536;
    return val;
  }

  readU8(): number {
    this.buf.seek(this.index8);
    const val = this.buf.readByte();
    this.index8 += 1;
    return val;
  }

  readQuat16(): { x: number; y: number; z: number; w: number } {
    return { x: this.readS16(), y: this.readS16(), z: this.readS16(), w: this.readS16() };
  }

  guard(): void {
    const guard32 = this.readS32();
    const guard16 = this.readU16();
    const guard8 = this.readU8();
    if (!(guard32 === guard16 && guard16 === guard8 && guard8 === this.lastGuardValue)) {
      throw new Error(
        `DTS guard fail! Expected ${this.lastGuardValue} but got ${guard32}/${guard16}/${guard8}`,
      );
    }
    this.lastGuardValue++;
  }
}

function skipSequence(br: BinaryReader, fileVersion: number): void {
  br.readInt32(); // nameIndex
  if (fileVersion > 21) br.readInt32(); // flags
  br.readInt32(); // numKeyFrames
  br.readFloat(); // duration
  if (fileVersion < 22) {
    br.readByte();
    br.readByte();
    br.readByte();
  }
  br.readInt32(); // priority
  br.readInt32(); // firstGroundFrame
  br.readInt32(); // numGroundFrames
  if (fileVersion > 21) {
    br.readInt32(); // baseRotation
    br.readInt32(); // baseTranslation
    br.readInt32(); // baseScale
    br.readInt32(); // baseObjectState
    br.readInt32(); // baseDecalState
  } else {
    br.readInt32();
    br.readInt32();
    br.readInt32();
  }
  br.readInt32(); // firstTrigger
  br.readInt32(); // numTriggers
  br.readInt32(); // toolBegin
  for (let i = 0; i < 8; i++) {
    // 8 bit sets: rotation/translation/scale/decal/ifl/vis/frame/matFrame
    br.readInt32(); // dummy
    const numWords = br.readInt32();
    for (let j = 0; j < numWords; j++) br.readInt32();
  }
}

function readMesh(shape: DtsShape, ar: DtsAlloc, version: number): DtsMesh | null {
  const meshType = ar.readS32() & 7;
  if (meshType === 4) return null; // null mesh
  if (meshType !== 0 && meshType !== 1) {
    throw new Error(`Unsupported DTS mesh type ${meshType}`);
  }

  const mesh: DtsMesh = {
    meshType,
    numFrames: 0,
    numMatFrames: 0,
    parent: -1,
    vertices: [],
    uv: [],
    normals: [],
    primitives: [],
    indices: [],
    vertsPerFrame: 0,
    type: 0,
  };

  ar.guard();

  mesh.numFrames = ar.readS32();
  mesh.numMatFrames = ar.readS32();
  mesh.parent = ar.readS32();
  // bounds, center, radius
  for (let i = 0; i < 10; i++) ar.readF32();

  const numVerts = ar.readS32();
  if (mesh.parent < 0) {
    for (let i = 0; i < numVerts; i++) mesh.vertices.push(ar.readPoint3F());
  } else {
    mesh.vertices = shape.meshes[mesh.parent]!.vertices;
  }

  const tVerts = ar.readS32();
  if (mesh.parent < 0) {
    for (let i = 0; i < tVerts; i++) mesh.uv.push(ar.readPoint2F());
  } else {
    mesh.uv = shape.meshes[mesh.parent]!.uv;
  }

  if (mesh.parent < 0) {
    for (let i = 0; i < numVerts; i++) mesh.normals.push(ar.readPoint3F());
    if (version > 21) {
      for (let i = 0; i < numVerts; i++) ar.readU8(); // encoded normals
    }
  } else {
    mesh.normals = shape.meshes[mesh.parent]!.normals;
  }

  const numPrimitives = ar.readS32();
  for (let i = 0; i < numPrimitives; i++) {
    mesh.primitives.push({ firstElement: ar.readU16(), numElements: ar.readU16(), matIndex: ar.readS32() });
  }

  const numIndices = ar.readS32();
  for (let i = 0; i < numIndices; i++) mesh.indices.push(ar.readS16());

  const numMIndices = ar.readS32();
  for (let i = 0; i < numMIndices; i++) ar.readS16();

  mesh.vertsPerFrame = ar.readS32();
  mesh.type = ar.readS32();

  ar.guard();

  if (meshType === 1) {
    // Skinned mesh: skip the skinning data (none of the shapes we render
    // animate their skins in this slice).
    const numSkinVerts = ar.readS32();
    if (mesh.parent < 0) {
      for (let i = 0; i < numSkinVerts * 3 * 2; i++) ar.readF32(); // verts + normals
      for (let i = 0; i < numSkinVerts; i++) ar.readU8();
      const numTransforms = ar.readS32();
      for (let i = 0; i < numTransforms * 16; i++) ar.readF32();
      let sz = ar.readS32();
      for (let i = 0; i < sz * 3; i++) ar.readS32(); // vertexIndices, boneIndices, weights
      sz = ar.readS32();
      for (let i = 0; i < sz; i++) ar.readS32(); // nodeIndices
    } else {
      ar.readS32();
      ar.readS32();
      ar.readS32();
    }
    ar.guard();
  }

  return mesh;
}

export function parseDts(buffer: ArrayBuffer): DtsShape {
  const br = new BinaryReader(buffer);

  let fileVersion = br.readUInt16();
  br.readUInt16(); // exporterVersion
  fileVersion &= 0xff;

  if (fileVersion > 24 || fileVersion < 19) {
    throw new Error(`Unsupported DTS version ${fileVersion} (only 19-24 supported)`);
  }

  const sizeMemBuffer = br.readInt32();
  const start16 = br.readInt32();
  const start8 = br.readInt32();
  const start32 = br.tell();

  br.seek(br.tell() + sizeMemBuffer * 4);

  const numSequences = br.readInt32();
  for (let i = 0; i < numSequences; i++) skipSequence(br, fileVersion);

  // Material list
  br.readByte(); // matStreamType
  const numMaterials = br.readInt32();
  const matNames: string[] = [];
  const matFlags: number[] = [];
  for (let i = 0; i < numMaterials; i++) {
    matNames.push(br.readStr().replace(/\x00/g, ""));
  }
  for (let i = 0; i < numMaterials; i++) matFlags.push(br.readInt32());
  for (let i = 0; i < numMaterials * 3; i++) br.readInt32(); // reflectance/bump/detail maps
  if (fileVersion === 25) for (let i = 0; i < numMaterials; i++) br.readInt32();
  for (let i = 0; i < numMaterials * 2; i++) br.readFloat(); // detail scales, reflection amounts

  // Assemble from the memory buffer
  const ar = new DtsAlloc(new BinaryReader(buffer), start32, start16, start8);

  const shape = {
    fileVersion,
    matNames,
    matFlags,
  } as DtsShape;

  const numNodes = ar.readS32();
  const numObjects = ar.readS32();
  ar.readS32(); // numDecals
  const numSubShapes = ar.readS32();
  const numIflMaterials = ar.readS32();

  let numNodeRots: number;
  let numNodeTrans: number;
  let numNodeUniformScales: number;
  let numNodeAlignedScales: number;
  let numNodeArbitraryScales: number;
  if (fileVersion < 22) {
    numNodeRots = numNodeTrans = ar.readS32() - numNodes;
    numNodeUniformScales = numNodeAlignedScales = numNodeArbitraryScales = 0;
  } else {
    numNodeRots = ar.readS32();
    numNodeTrans = ar.readS32();
    numNodeUniformScales = ar.readS32();
    numNodeAlignedScales = ar.readS32();
    numNodeArbitraryScales = ar.readS32();
  }
  let numGroundFrames = 0;
  if (fileVersion > 23) numGroundFrames = ar.readS32();
  const numObjectStates = ar.readS32();
  const numDecalStates = ar.readS32();
  const numTriggers = ar.readS32();
  const numDetails = ar.readS32();
  const numMeshes = ar.readS32();
  if (fileVersion < 23) ar.readS32(); // numSkins
  const numNames = ar.readS32();
  ar.readF32(); // smallestVisibleSize
  ar.readS32(); // smallestVisibleDL

  ar.guard();

  shape.radius = ar.readF32();
  ar.readF32(); // radiusTube
  shape.center = ar.readPoint3F();
  shape.bounds = {
    minX: ar.readF32(),
    minY: ar.readF32(),
    minZ: ar.readF32(),
    maxX: ar.readF32(),
    maxY: ar.readF32(),
    maxZ: ar.readF32(),
  };

  ar.guard();

  shape.nodes = [];
  for (let i = 0; i < numNodes; i++) {
    shape.nodes.push({
      name: ar.readS32(),
      parent: ar.readS32(),
      firstObject: ar.readS32(),
      firstChild: ar.readS32(),
      nextSibling: ar.readS32(),
    });
  }
  ar.guard();

  shape.objects = [];
  for (let i = 0; i < numObjects; i++) {
    shape.objects.push({
      name: ar.readS32(),
      numMeshes: ar.readS32(),
      firstMesh: ar.readS32(),
      node: ar.readS32(),
      nextSibling: ar.readS32(),
      firstDecal: ar.readS32(),
    });
  }
  ar.guard();
  ar.guard();

  for (let i = 0; i < numIflMaterials * 5; i++) ar.readS32();
  ar.guard();

  shape.subShapes = [];
  for (let i = 0; i < numSubShapes; i++) {
    shape.subShapes.push({ firstNode: 0, firstObject: 0, numNodes: 0, numObjects: 0 });
  }
  for (let i = 0; i < numSubShapes; i++) shape.subShapes[i]!.firstNode = ar.readS32();
  for (let i = 0; i < numSubShapes; i++) shape.subShapes[i]!.firstObject = ar.readS32();
  for (let i = 0; i < numSubShapes; i++) ar.readS32(); // firstDecal
  ar.guard();
  for (let i = 0; i < numSubShapes; i++) shape.subShapes[i]!.numNodes = ar.readS32();
  for (let i = 0; i < numSubShapes; i++) shape.subShapes[i]!.numObjects = ar.readS32();
  for (let i = 0; i < numSubShapes; i++) ar.readS32(); // numDecals
  ar.guard();

  if (fileVersion < 16) {
    const num = ar.readS32();
    for (let i = 0; i < num; i++) ar.readS32();
  }

  shape.defaultRotations = [];
  shape.defaultTranslations = [];
  for (let i = 0; i < numNodes; i++) {
    shape.defaultRotations.push(ar.readQuat16());
    shape.defaultTranslations.push(ar.readPoint3F());
  }

  for (let i = 0; i < numNodeTrans; i++) ar.readPoint3F();
  for (let i = 0; i < numNodeRots; i++) ar.readQuat16();
  ar.guard();

  if (fileVersion > 21) {
    for (let i = 0; i < numNodeUniformScales; i++) ar.readF32();
    for (let i = 0; i < numNodeAlignedScales; i++) ar.readPoint3F();
    for (let i = 0; i < numNodeArbitraryScales; i++) ar.readPoint3F();
    for (let i = 0; i < numNodeArbitraryScales; i++) ar.readQuat16();
    ar.guard();
  }

  if (fileVersion > 23) {
    for (let i = 0; i < numGroundFrames; i++) ar.readPoint3F();
    for (let i = 0; i < numGroundFrames; i++) ar.readQuat16();
    ar.guard();
  }

  for (let i = 0; i < numObjectStates; i++) {
    ar.readF32();
    ar.readS32();
    ar.readS32();
  }
  ar.guard();

  for (let i = 0; i < numDecalStates; i++) ar.readS32();
  ar.guard();

  for (let i = 0; i < numTriggers * 2; i++) ar.readS32();
  ar.guard();

  shape.detailLevels = [];
  for (let i = 0; i < numDetails; i++) {
    const d: DtsDetail = {
      name: ar.readS32(),
      subShape: ar.readS32(),
      objectDetail: ar.readS32(),
      size: ar.readF32(),
    };
    ar.readF32(); // avgError
    ar.readF32(); // maxError
    ar.readS32(); // polyCount
    shape.detailLevels.push(d);
  }
  ar.guard();

  shape.meshes = [];
  for (let i = 0; i < numMeshes; i++) {
    shape.meshes.push(readMesh(shape, ar, fileVersion));
  }
  ar.guard();

  shape.names = [];
  for (let i = 0; i < numNames; i++) {
    let str = "";
    for (;;) {
      const charCode = ar.readU8();
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    shape.names.push(str);
  }
  ar.guard();

  return shape;
}
