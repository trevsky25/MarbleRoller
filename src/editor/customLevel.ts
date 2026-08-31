// Custom level data model: blocks + placed shapes, serialized as JSON in
// localStorage (with file export/import). Surface palette references the
// original game textures with the authentic physics from DifBuilder's
// material table.
export interface SurfaceDef {
  id: string;
  label: string;
  // "data/..."-rooted texture path
  texture: string;
  friction: number;
  restitution: number;
  force: number;
}

export const SURFACES: SurfaceDef[] = [
  { id: "blue", label: "Blue Tile", texture: "data/interiors/grid_cool.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "green", label: "Green Tile", texture: "data/interiors/grid_neutral.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "yellow", label: "Yellow Tile", texture: "data/interiors/grid_warm.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "white", label: "White", texture: "data/interiors/solid_white.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "trim", label: "Trim", texture: "data/interiors/trim_white1.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "wall", label: "Wall", texture: "data/interiors/wall_neutral1.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "caution", label: "Caution", texture: "data/interiors/stripe_caution.jpg", friction: 1, restitution: 1, force: 0 },
  { id: "ice", label: "Ice (slick)", texture: "data/interiors/friction_low.jpg", friction: 0.2, restitution: 0.5, force: 0 },
  { id: "frictionless", label: "Frictionless", texture: "data/interiors/friction_none.jpg", friction: 0.01, restitution: 0.5, force: 0 },
  { id: "grip", label: "High Grip", texture: "data/interiors/friction_high.jpg", friction: 1.5, restitution: 0.5, force: 0 },
  { id: "rampyellow", label: "Grippy Ramp", texture: "data/interiors/friction_ramp_yellow.jpg", friction: 2.0, restitution: 1.0, force: 0 },
  { id: "bouncy", label: "Bouncy", texture: "data/interiors/chevron_warm.jpg", friction: 0.2, restitution: 0, force: 15 },
];

export function surfaceById(id: string): SurfaceDef {
  return SURFACES.find((s) => s.id === id) ?? SURFACES[0]!;
}

export type BlockShape = "box" | "ramp";

export interface LevelBlock {
  shape: BlockShape;
  // center position (x, y) and bottom z
  x: number;
  y: number;
  z: number;
  // full extents
  sx: number;
  sy: number;
  sz: number;
  // yaw rotation in quarter turns (0-3), around center
  rot: number;
  surface: string;
}

export interface LevelItem {
  // datablock name fed to the shape registry (StartPad, EndPad, GemItem, ...)
  datablock: string;
  x: number;
  y: number;
  z: number;
  rot: number; // quarter turns
}

export interface CustomLevelData {
  version: 1;
  name: string;
  blocks: LevelBlock[];
  items: LevelItem[];
}

export function emptyLevel(name: string): CustomLevelData {
  return { version: 1, name, blocks: [], items: [] };
}

const STORE_PREFIX = "mbg-custom-level:";

export function listCustomLevels(): string[] {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(STORE_PREFIX)) names.push(key.substring(STORE_PREFIX.length));
  }
  names.sort();
  return names;
}

export function saveCustomLevel(level: CustomLevelData): void {
  localStorage.setItem(STORE_PREFIX + level.name, JSON.stringify(level));
}

export function loadCustomLevel(name: string): CustomLevelData | null {
  const raw = localStorage.getItem(STORE_PREFIX + name);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as CustomLevelData;
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function deleteCustomLevel(name: string): void {
  localStorage.removeItem(STORE_PREFIX + name);
}

export function exportLevelFile(level: CustomLevelData): void {
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${level.name.replace(/[^\w-]+/g, "_")}.mbglevel.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
