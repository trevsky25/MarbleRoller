// Torque .dif interior parser.
// Faithful port of MBHaxe's dif/ package (MIT, RandomityGuy), which in turn
// derives from the DIF format documentation of the Torque engine.
import { BinaryReader } from "./binaryReader";

export interface Point3F {
  x: number;
  y: number;
  z: number;
}

export interface PlaneF {
  x: number;
  y: number;
  z: number;
  d: number;
}

export interface Box3F {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface SphereF {
  originX: number;
  originY: number;
  originZ: number;
  radius: number;
}

export interface QuatF {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface DifPlane {
  normalIndex: number;
  planeDistance: number;
}

export interface TexGenEQ {
  planeX: PlaneF;
  planeY: PlaneF;
}

export interface BSPNode {
  planeIndex: number;
  frontIndex: number;
  backIndex: number;
  isFrontLeaf: boolean;
  isFrontSolid: boolean;
  isBackLeaf: boolean;
  isBackSolid: boolean;
}

export interface BSPSolidLeaf {
  surfaceStart: number;
  surfaceCount: number;
}

export interface WindingIndex {
  windingStart: number;
  windingCount: number;
}

export interface DifEdge {
  pointIndex0: number;
  pointIndex1: number;
  surfaceIndex0: number;
  surfaceIndex1: number;
}

export interface Zone {
  portalStart: number;
  portalCount: number;
  surfaceStart: number;
  surfaceCount: number;
  staticMeshStart: number;
  staticMeshCount: number;
}

export interface Portal {
  planeIndex: number;
  triFanCount: number;
  triFanStart: number;
  zoneFront: number;
  zoneBack: number;
}

export interface Surface {
  windingStart: number;
  windingCount: number;
  planeIndex: number;
  textureIndex: number;
  texGenIndex: number;
  surfaceFlags: number;
  fanMask: number;
  lightMapFinalWord: number;
  lightMapTexGenXD: number;
  lightMapTexGenYD: number;
  lightCount: number;
  lightStateInfoStart: number;
  mapOffsetX: number;
  mapOffsetY: number;
  mapSizeX: number;
  mapSizeY: number;
  brushId: number;
}

export interface NullSurface {
  windingStart: number;
  planeIndex: number;
  surfaceFlags: number;
  windingCount: number;
}

export interface LightMap {
  lightmap: number[];
  lightdirmap: number[];
  keepLightMap: number;
}

export interface AnimatedLight {
  nameIndex: number;
  stateIndex: number;
  stateCount: number;
  flags: number;
  duration: number;
}

export interface LightState {
  red: number;
  green: number;
  blue: number;
  activeTime: number;
  dataIndex: number;
  dataCount: number;
}

export interface StateData {
  surfaceIndex: number;
  mapIndex: number;
  lightStateIndex: number;
}

export interface ConvexHull {
  hullStart: number;
  hullCount: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  surfaceStart: number;
  surfaceCount: number;
  planeStart: number;
  polyListPlaneStart: number;
  polyListPointStart: number;
  polyListStringStart: number;
  staticMesh: boolean;
}

export interface CoordBin {
  binStart: number;
  binCount: number;
}

export interface TexMatrix {
  T: number;
  N: number;
  B: number;
}

export interface PolyhedronEdge {
  pointIndex0: number;
  pointIndex1: number;
  faceIndex0: number;
  faceIndex1: number;
}

export interface Polyhedron {
  pointList: Point3F[];
  planeList: PlaneF[];
  edgeList: PolyhedronEdge[];
}

export interface DifTrigger {
  name: string;
  datablock: string;
  properties: Map<string, string>;
  polyhedron: Polyhedron;
  offset: Point3F;
}

export interface WayPoint {
  position: Point3F;
  rotation: QuatF;
  msToNext: number;
  smoothingType: number;
}

export interface InteriorPathFollower {
  name: string;
  datablock: string;
  interiorResIndex: number;
  offset: Point3F;
  properties: Map<string, string>;
  triggerIds: number[];
  wayPoints: WayPoint[];
  totalMS: number;
}

export interface GameEntity {
  datablock: string;
  gameClass: string;
  position: Point3F;
  properties: Map<string, string>;
}

export interface DifVersion {
  difVersion: number;
  interiorVersion: number;
  interiorType: string;
}

export interface Interior {
  detailLevel: number;
  minPixels: number;
  boundingBox: Box3F;
  boundingSphere: SphereF;
  hasAlarmState: number;
  numLightStateEntries: number;
  normals: Point3F[];
  planes: DifPlane[];
  points: Point3F[];
  pointVisibilities: number[];
  texGenEQs: TexGenEQ[];
  bspNodes: BSPNode[];
  bspSolidLeaves: BSPSolidLeaf[];
  materialListVersion: number;
  materialList: string[];
  windings: number[];
  windingIndices: WindingIndex[];
  edges: DifEdge[];
  zones: Zone[];
  zoneSurfaces: number[];
  zoneStaticMeshes: number[];
  zonePortalList: number[];
  portals: Portal[];
  surfaces: Surface[];
  normalLMapIndices: number[];
  alarmLMapIndices: number[];
  nullSurfaces: NullSurface[];
  lightMaps: LightMap[];
  solidLeafSurfaces: number[];
  animatedLights: AnimatedLight[];
  lightStates: LightState[];
  stateDatas: StateData[];
  stateDataFlags: number;
  stateDataBuffers: number[];
  nameBuffer: number[];
  numSubObjects: number;
  convexHulls: ConvexHull[];
  convexHullEmitStrings: number[];
  hullIndices: number[];
  hullPlaneIndices: number[];
  hullEmitStringIndices: number[];
  hullSurfaceIndices: number[];
  polyListPlanes: number[];
  polyListPoints: number[];
  polyListStrings: number[];
  coordBins: CoordBin[];
  coordBinIndices: number[];
  coordBinMode: number;
  baseAmbientColor: number[];
  alarmAmbientColor: number[];
  numStaticMeshes: number;
  texNormals: Point3F[];
  texMatrices: TexMatrix[];
  texMatIndices: number[];
  extendedLightMapData: number;
  lightMapBorderSize: number;
}

export interface Dif {
  difVersion: number;
  previewIncluded: number;
  interiors: Interior[];
  subObjects: Interior[];
  triggers: DifTrigger[];
  interiorPathfollowers: InteriorPathFollower[];
  gameEntities: GameEntity[] | null;
}

// --- primitive readers ---

function readPoint3F(io: BinaryReader): Point3F {
  return { x: io.readFloat(), y: io.readFloat(), z: io.readFloat() };
}

function readPlaneF(io: BinaryReader): PlaneF {
  return { x: io.readFloat(), y: io.readFloat(), z: io.readFloat(), d: io.readFloat() };
}

function readQuatF(io: BinaryReader): QuatF {
  return { x: io.readFloat(), y: io.readFloat(), z: io.readFloat(), w: io.readFloat() };
}

function readBox3F(io: BinaryReader): Box3F {
  return {
    minX: io.readFloat(),
    minY: io.readFloat(),
    minZ: io.readFloat(),
    maxX: io.readFloat(),
    maxY: io.readFloat(),
    maxZ: io.readFloat(),
  };
}

function readSphereF(io: BinaryReader): SphereF {
  return { originX: io.readFloat(), originY: io.readFloat(), originZ: io.readFloat(), radius: io.readFloat() };
}

function readArray<T>(io: BinaryReader, readItem: (io: BinaryReader) => T): T[] {
  const len = io.readInt32();
  const arr: T[] = [];
  for (let i = 0; i < len; i++) arr.push(readItem(io));
  return arr;
}

// Torque's "alternate encoding" arrays: high bit of length signals an extra
// parameter word, and the test decides which of the two readers each element
// uses. Ported exactly from MBHaxe ReaderExtensions.readArrayAs.
function readArrayAs<T>(
  io: BinaryReader,
  test: (signed: boolean, param: number) => boolean,
  failMethod: (io: BinaryReader) => T,
  passMethod: (io: BinaryReader) => T,
): T[] {
  let length = io.readInt32();
  let signed = false;
  let param = 0;

  if ((length & 0x80000000) !== 0) {
    length ^= 0x80000000;
    signed = true;
    param = io.readInt32();
  }

  const array: T[] = [];
  for (let i = 0; i < length; i++) {
    array.push(test(signed, param) ? passMethod(io) : failMethod(io));
  }
  return array;
}

function readArrayFlags<T>(io: BinaryReader, readItem: (io: BinaryReader) => T): T[] {
  const length = io.readInt32();
  io.readInt32(); // flags
  const array: T[] = [];
  for (let i = 0; i < length; i++) array.push(readItem(io));
  return array;
}

function readDictionary(io: BinaryReader): Map<string, string> {
  const len = io.readInt32();
  const dict = new Map<string, string>();
  for (let i = 0; i < len; i++) {
    const name = io.readStr();
    const value = io.readStr();
    dict.set(name, value);
  }
  return dict;
}

function readColorF(io: BinaryReader): number[] {
  return [io.readByte(), io.readByte(), io.readByte(), io.readByte()];
}

// Embedded PNG: scan for the IEND chunk footer.
const PNG_FOOTER = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

function readPNG(io: BinaryReader): number[] {
  const data: number[] = [];
  for (;;) {
    data.push(io.readByte());
    if (data.length >= 8) {
      let match = true;
      for (let i = 0; i < 8; i++) {
        if (data[i + (data.length - 8)] !== PNG_FOOTER[i]) {
          match = false;
          break;
        }
      }
      if (match) break;
    }
  }
  return data;
}

// --- struct readers ---

function readDifPlane(io: BinaryReader): DifPlane {
  return { normalIndex: io.readUInt16(), planeDistance: io.readFloat() };
}

function readTexGenEQ(io: BinaryReader): TexGenEQ {
  return { planeX: readPlaneF(io), planeY: readPlaneF(io) };
}

function readBSPNode(io: BinaryReader, version: DifVersion): BSPNode {
  const planeIndex = io.readUInt16();
  let frontIndex: number;
  let backIndex: number;
  let isFrontLeaf = false;
  let isFrontSolid = false;
  let isBackLeaf = false;
  let isBackSolid = false;
  if (version.interiorVersion >= 14) {
    frontIndex = io.readInt32();
    backIndex = io.readInt32();
    if ((frontIndex & 0x80000) !== 0) {
      frontIndex = (frontIndex & ~0x80000) | 0x8000;
      isFrontLeaf = true;
    }
    if ((frontIndex & 0x40000) !== 0) {
      frontIndex = (frontIndex & ~0x40000) | 0x4000;
      isFrontSolid = true;
    }
    if ((backIndex & 0x80000) !== 0) {
      backIndex = (backIndex & ~0x80000) | 0x8000;
      isBackLeaf = true;
    }
    if ((backIndex & 0x40000) !== 0) {
      backIndex = (backIndex & ~0x40000) | 0x4000;
      isBackSolid = true;
    }
  } else {
    frontIndex = io.readUInt16();
    backIndex = io.readUInt16();
    if ((frontIndex & 0x8000) !== 0) isFrontLeaf = true;
    if ((frontIndex & 0x4000) !== 0) isFrontSolid = true;
    if ((backIndex & 0x8000) !== 0) isBackLeaf = true;
    if ((backIndex & 0x4000) !== 0) isBackSolid = true;
  }
  return { planeIndex, frontIndex, backIndex, isFrontLeaf, isFrontSolid, isBackLeaf, isBackSolid };
}

function readBSPSolidLeaf(io: BinaryReader): BSPSolidLeaf {
  return { surfaceStart: io.readInt32(), surfaceCount: io.readUInt16() };
}

function readWindingIndex(io: BinaryReader): WindingIndex {
  return { windingStart: io.readInt32(), windingCount: io.readInt32() };
}

function readEdge(io: BinaryReader): DifEdge {
  return {
    pointIndex0: io.readInt32(),
    pointIndex1: io.readInt32(),
    surfaceIndex0: io.readInt32(),
    surfaceIndex1: io.readInt32(),
  };
}

function readZone(io: BinaryReader, version: DifVersion): Zone {
  const ret: Zone = {
    portalStart: io.readUInt16(),
    portalCount: io.readUInt16(),
    surfaceStart: io.readInt32(),
    surfaceCount: io.readInt32(),
    staticMeshStart: 0,
    staticMeshCount: 0,
  };
  if (version.interiorVersion >= 12) {
    ret.staticMeshStart = io.readInt32();
    ret.staticMeshCount = io.readInt32();
  }
  return ret;
}

function readPortal(io: BinaryReader): Portal {
  return {
    planeIndex: io.readUInt16(),
    triFanCount: io.readUInt16(),
    triFanStart: io.readInt32(),
    zoneFront: io.readUInt16(),
    zoneBack: io.readUInt16(),
  };
}

class DifTypeError extends Error {}

function readSurface(io: BinaryReader, version: DifVersion, interior: Interior): Surface {
  const windingStart = io.readInt32();
  if (interior.windings.length <= windingStart) throw new DifTypeError("DIF Type Error");

  const windingCount = version.interiorVersion >= 13 ? io.readInt32() : io.readByte();
  if (windingStart + windingCount > interior.windings.length) throw new DifTypeError("DIF Type Error");

  const planeIndex = io.readUInt16();
  const planeIndexTemp = planeIndex & ~0x8000;
  if ((planeIndexTemp & ~0x8000) >= interior.planes.length) throw new DifTypeError("DIF Type Error");

  const textureIndex = io.readUInt16();
  if (textureIndex >= interior.materialList.length) throw new DifTypeError("DIF Type Error");

  const texGenIndex = io.readInt32();
  if (texGenIndex >= interior.texGenEQs.length) throw new DifTypeError("DIF Type Error");

  const surfaceFlags = io.readByte();
  const fanMask = io.readInt32();
  const lightMapFinalWord = io.readUInt16();
  const lightMapTexGenXD = io.readFloat();
  const lightMapTexGenYD = io.readFloat();
  const lightCount = io.readUInt16();
  const lightStateInfoStart = io.readInt32();

  let mapOffsetX: number, mapOffsetY: number, mapSizeX: number, mapSizeY: number;
  if (version.interiorVersion >= 13) {
    mapOffsetX = io.readInt32();
    mapOffsetY = io.readInt32();
    mapSizeX = io.readInt32();
    mapSizeY = io.readInt32();
  } else {
    mapOffsetX = io.readByte();
    mapOffsetY = io.readByte();
    mapSizeX = io.readByte();
    mapSizeY = io.readByte();
  }

  let brushId = 0;
  if (version.interiorType !== "tge" && version.interiorType !== "mbg") {
    io.readByte();
    if (version.interiorVersion >= 2 && version.interiorVersion <= 5) brushId = io.readInt32();
  }

  return {
    windingStart,
    windingCount,
    planeIndex,
    textureIndex,
    texGenIndex,
    surfaceFlags,
    fanMask,
    lightMapFinalWord,
    lightMapTexGenXD,
    lightMapTexGenYD,
    lightCount,
    lightStateInfoStart,
    mapOffsetX,
    mapOffsetY,
    mapSizeX,
    mapSizeY,
    brushId,
  };
}

function readNullSurface(io: BinaryReader, version: DifVersion): NullSurface {
  const windingStart = io.readInt32();
  const planeIndex = io.readUInt16();
  const surfaceFlags = io.readByte();
  const windingCount = version.interiorVersion >= 13 ? io.readInt32() : io.readByte();
  return { windingStart, planeIndex, surfaceFlags, windingCount };
}

function readLightMap(io: BinaryReader, version: DifVersion): LightMap {
  const lightmap = readPNG(io);
  let lightdirmap: number[] = [];
  if (version.interiorType !== "mbg" && version.interiorType !== "tge") {
    lightdirmap = readPNG(io);
  }
  const keepLightMap = io.readByte();
  return { lightmap, lightdirmap, keepLightMap };
}

function readAnimatedLight(io: BinaryReader): AnimatedLight {
  return {
    nameIndex: io.readInt32(),
    stateIndex: io.readInt32(),
    stateCount: io.readUInt16(),
    flags: io.readUInt16(),
    duration: io.readInt32(),
  };
}

function readLightState(io: BinaryReader): LightState {
  return {
    red: io.readByte(),
    green: io.readByte(),
    blue: io.readByte(),
    activeTime: io.readInt32(),
    dataIndex: io.readInt32(),
    dataCount: io.readUInt16(),
  };
}

function readStateData(io: BinaryReader): StateData {
  return { surfaceIndex: io.readInt32(), mapIndex: io.readInt32(), lightStateIndex: io.readUInt16() };
}

function readConvexHull(io: BinaryReader, version: DifVersion): ConvexHull {
  const ret: ConvexHull = {
    hullStart: io.readInt32(),
    hullCount: io.readUInt16(),
    minX: io.readFloat(),
    minY: io.readFloat(),
    minZ: io.readFloat(),
    maxX: io.readFloat(),
    maxY: io.readFloat(),
    maxZ: io.readFloat(),
    surfaceStart: io.readInt32(),
    surfaceCount: io.readUInt16(),
    planeStart: io.readInt32(),
    polyListPlaneStart: io.readInt32(),
    polyListPointStart: io.readInt32(),
    polyListStringStart: io.readInt32(),
    staticMesh: false,
  };
  if (version.interiorVersion >= 12) ret.staticMesh = io.readByte() > 0;
  return ret;
}

function readCoordBin(io: BinaryReader): CoordBin {
  return { binStart: io.readInt32(), binCount: io.readInt32() };
}

function readTexMatrix(io: BinaryReader): TexMatrix {
  return { T: io.readInt32(), N: io.readInt32(), B: io.readInt32() };
}

function readPolyhedron(io: BinaryReader): Polyhedron {
  return {
    pointList: readArray(io, readPoint3F),
    planeList: readArray(io, readPlaneF),
    edgeList: readArray(io, (r) => ({
      // Constructor order in MBHaxe: (faceIndex0, faceIndex1, pointIndex0, pointIndex1)
      faceIndex0: r.readInt32(),
      faceIndex1: r.readInt32(),
      pointIndex0: r.readInt32(),
      pointIndex1: r.readInt32(),
    })),
  };
}

function readTrigger(io: BinaryReader): DifTrigger {
  return {
    name: io.readStr(),
    datablock: io.readStr(),
    properties: readDictionary(io),
    polyhedron: readPolyhedron(io),
    offset: readPoint3F(io),
  };
}

function readWayPoint(io: BinaryReader): WayPoint {
  return {
    position: readPoint3F(io),
    rotation: readQuatF(io),
    msToNext: io.readInt32(),
    smoothingType: io.readInt32(),
  };
}

function readInteriorPathFollower(io: BinaryReader): InteriorPathFollower {
  return {
    name: io.readStr(),
    datablock: io.readStr(),
    interiorResIndex: io.readInt32(),
    offset: readPoint3F(io),
    properties: readDictionary(io),
    triggerIds: readArray(io, (r) => r.readInt32()),
    wayPoints: readArray(io, readWayPoint),
    totalMS: io.readInt32(),
  };
}

function readGameEntity(io: BinaryReader): GameEntity {
  return {
    datablock: io.readStr(),
    gameClass: io.readStr(),
    position: readPoint3F(io),
    properties: readDictionary(io),
  };
}

// ForceField and AISpecialNode aren't used by MBG levels but occupy space in
// the stream, so they must still be read past correctly.
function skipForceField(io: BinaryReader): null {
  io.readInt32(); // forceFieldFileVersion
  io.readStr(); // name
  readArray(io, (r) => r.readStr()); // triggers
  readBox3F(io);
  readSphereF(io);
  readArray(io, readPoint3F); // normals
  readArray(io, readDifPlane); // planes
  readArray(io, (r) => readBSPNode(r, { difVersion: 44, interiorVersion: 0, interiorType: "?" }));
  readArray(io, readBSPSolidLeaf);
  readArray(io, (r) => r.readInt32()); // windings
  readArray(io, (r) => {
    // FFSurface
    r.readInt32(); // windingStart
    r.readByte(); // windingCount
    r.readUInt16(); // planeIndex
    r.readInt32(); // surfaceFlags
    r.readInt32(); // fanMask
    return null;
  });
  readArray(io, (r) => r.readInt32()); // solidLeafSurfaces
  readColorF(io);
  return null;
}

function skipAISpecialNode(io: BinaryReader): null {
  io.readStr();
  readPoint3F(io);
  return null;
}

function skipVehicleCollision(io: BinaryReader, version: DifVersion): null {
  io.readInt32(); // vehicleCollisionFileVersion
  readArray(io, (r) => readConvexHull(r, version));
  readArray(io, (r) => r.readByte());
  readArray(io, (r) => r.readInt32());
  readArray(io, (r) => r.readUInt16());
  readArray(io, (r) => r.readInt32());
  readArray(io, (r) => r.readInt32());
  readArray(io, (r) => r.readUInt16());
  readArray(io, (r) => r.readInt32());
  readArray(io, (r) => r.readByte());
  readArray(io, (r) => readNullSurface(r, { difVersion: 44, interiorVersion: 0, interiorType: "?" }));
  readArray(io, readPoint3F);
  readArray(io, readDifPlane);
  readArray(io, (r) => r.readInt32());
  readArray(io, readWindingIndex);
  return null;
}

function readInterior(io: BinaryReader, version: DifVersion): Interior {
  if (version.interiorType === "?") version.interiorType = "tgea";

  version.interiorVersion = io.readInt32();

  const it = {} as Interior;
  it.detailLevel = io.readInt32();
  it.minPixels = io.readInt32();
  it.boundingBox = readBox3F(io);
  it.boundingSphere = readSphereF(io);
  it.hasAlarmState = io.readByte();
  it.numLightStateEntries = io.readInt32();
  it.normals = readArray(io, readPoint3F);
  it.planes = readArray(io, readDifPlane);
  it.points = readArray(io, readPoint3F);
  if (version.interiorVersion === 4) {
    it.pointVisibilities = [];
  } else {
    it.pointVisibilities = readArray(io, (r) => r.readByte());
  }
  it.texGenEQs = readArray(io, readTexGenEQ);
  it.bspNodes = readArray(io, (r) => readBSPNode(r, version));
  it.bspSolidLeaves = readArray(io, readBSPSolidLeaf);
  it.materialListVersion = io.readByte();
  it.materialList = readArray(io, (r) => r.readStr());
  it.windings = readArrayAs(
    io,
    (_signed, param) => param > 0,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.windingIndices = readArray(io, readWindingIndex);
  if (version.interiorVersion >= 12) {
    it.edges = readArray(io, readEdge);
  } else {
    it.edges = [];
  }
  it.zones = readArray(io, (r) => readZone(r, version));
  it.zoneSurfaces = readArrayAs(
    io,
    () => false,
    (r) => r.readUInt16(),
    (r) => r.readUInt16(),
  );
  if (version.interiorVersion >= 12) {
    it.zoneStaticMeshes = readArray(io, (r) => r.readInt32());
  } else {
    it.zoneStaticMeshes = [];
  }
  it.zonePortalList = readArrayAs(
    io,
    () => false,
    (r) => r.readUInt16(),
    (r) => r.readUInt16(),
  );
  it.portals = readArray(io, readPortal);

  // TGE vs TGEA surface format detection: try reading surfaces as the
  // current type; on a type error rewind and retry as TGE.
  const pos = io.tell();
  try {
    it.surfaces = readArray(io, (r) => readSurface(r, version, it));
    if (version.interiorType === "?") version.interiorType = "tge";
  } catch {
    if (version.interiorType === "tgea") version.interiorType = "tge";
    io.seek(pos);
    try {
      it.surfaces = readArray(io, (r) => readSurface(r, version, it));
    } catch {
      it.surfaces = it.surfaces ?? [];
    }
  }

  if (version.interiorVersion >= 2 && version.interiorVersion <= 5) {
    // edges2
    readArray(io, (r) => {
      r.readInt32();
      r.readInt32();
      r.readInt32();
      if (version.interiorVersion >= 3) r.readInt32();
      return null;
    });
    if (version.interiorVersion >= 4 && version.interiorVersion <= 5) {
      readArray(io, readPoint3F); // normals2
      readArrayAs(
        io,
        (alt, param) => alt && param === 0,
        (r) => r.readUInt16(),
        (r) => r.readByte(),
      ); // normalIndices
    }
  }

  if (version.interiorVersion === 4) {
    it.normalLMapIndices = readArray(io, (r) => r.readByte());
    it.alarmLMapIndices = [];
  } else if (version.interiorVersion >= 13) {
    it.normalLMapIndices = readArray(io, (r) => r.readInt32());
    it.alarmLMapIndices = readArray(io, (r) => r.readInt32());
  } else {
    it.normalLMapIndices = readArray(io, (r) => r.readByte());
    it.alarmLMapIndices = readArray(io, (r) => r.readByte());
  }

  it.nullSurfaces = readArray(io, (r) => readNullSurface(r, version));
  if (version.interiorVersion !== 4) {
    it.lightMaps = readArray(io, (r) => readLightMap(r, version));
    if (it.lightMaps.length > 0 && version.interiorType === "mbg") {
      version.interiorType = "tge";
    }
  } else {
    it.lightMaps = [];
  }
  it.solidLeafSurfaces = readArrayAs(
    io,
    (alt) => alt,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.animatedLights = readArray(io, readAnimatedLight);
  it.lightStates = readArray(io, readLightState);

  if (version.interiorVersion === 4) {
    it.stateDatas = [];
    it.stateDataFlags = 0;
    it.stateDataBuffers = [];
    it.nameBuffer = [];
    it.numSubObjects = 0;
  } else {
    it.stateDatas = readArray(io, readStateData);
    it.stateDataBuffers = readArrayFlags(io, (r) => r.readByte());
    it.nameBuffer = readArray(io, (r) => r.readByte());
    it.stateDataFlags = 0;
    it.numSubObjects = io.readInt32();
  }

  it.convexHulls = readArray(io, (r) => readConvexHull(r, version));
  it.convexHullEmitStrings = readArray(io, (r) => r.readByte());
  it.hullIndices = readArrayAs(
    io,
    (alt) => alt,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.hullPlaneIndices = readArrayAs(
    io,
    () => true,
    (r) => r.readUInt16(),
    (r) => r.readUInt16(),
  );
  it.hullEmitStringIndices = readArrayAs(
    io,
    (alt) => alt,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.hullSurfaceIndices = readArrayAs(
    io,
    (alt) => alt,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.polyListPlanes = readArrayAs(
    io,
    () => true,
    (r) => r.readUInt16(),
    (r) => r.readUInt16(),
  );
  it.polyListPoints = readArrayAs(
    io,
    (alt) => alt,
    (r) => r.readInt32(),
    (r) => r.readUInt16(),
  );
  it.polyListStrings = readArray(io, (r) => r.readByte());

  it.coordBins = [];
  for (let i = 0; i < 256; i++) it.coordBins.push(readCoordBin(io));

  it.coordBinIndices = readArrayAs(
    io,
    () => true,
    (r) => r.readUInt16(),
    (r) => r.readUInt16(),
  );
  it.coordBinMode = io.readInt32();

  if (version.interiorVersion === 4) {
    it.baseAmbientColor = [0, 0, 0, 255];
    it.alarmAmbientColor = [0, 0, 0, 255];
    it.extendedLightMapData = 0;
    it.lightMapBorderSize = 0;
    it.numStaticMeshes = 0;
    it.texNormals = [];
    it.texMatrices = [];
    it.texMatIndices = [];
  } else {
    it.baseAmbientColor = readColorF(io);
    it.alarmAmbientColor = readColorF(io);
    it.numStaticMeshes = 0;
    if (version.interiorVersion >= 10) {
      it.numStaticMeshes = io.readInt32();
    }
    if (version.interiorVersion >= 11) {
      it.texNormals = readArray(io, readPoint3F);
      it.texMatrices = readArray(io, readTexMatrix);
      it.texMatIndices = readArray(io, (r) => r.readInt32());
    } else {
      io.readInt32();
      io.readInt32();
      io.readInt32();
      it.texNormals = [];
      it.texMatrices = [];
      it.texMatIndices = [];
    }
    it.extendedLightMapData = io.readInt32();
    it.lightMapBorderSize = 0;
    if (it.extendedLightMapData > 0) {
      it.lightMapBorderSize = io.readInt32();
      io.readInt32();
    }
  }

  return it;
}

export function parseDif(buffer: ArrayBuffer): Dif {
  const io = new BinaryReader(buffer);
  const version: DifVersion = { difVersion: 44, interiorVersion: 0, interiorType: "?" };
  version.difVersion = io.readInt32();

  const difVersion = version.difVersion;
  const previewIncluded = io.readByte();
  const interiors = readArray(io, (r) => readInterior(r, version));
  const subObjects = readArray(io, (r) => readInterior(r, version));
  const triggers = readArray(io, readTrigger);
  const interiorPathfollowers = readArray(io, readInteriorPathFollower);
  readArray(io, skipForceField);
  readArray(io, skipAISpecialNode);
  const readVehicleCollision = io.readInt32();
  if (readVehicleCollision === 1) skipVehicleCollision(io, version);
  const readGameEntities = io.readInt32();
  let gameEntities: GameEntity[] | null = null;
  if (readGameEntities === 2) gameEntities = readArray(io, readGameEntity);

  return { difVersion, previewIncluded, interiors, subObjects, triggers, interiorPathfollowers, gameEntities };
}
