// 16x16 XY spatial grid over an entity's surfaces.
// Ported from MBHaxe collision/Grid.hx (MIT).
import { Vec3 } from "../math/vec3";
import { Bounds } from "../math/bounds";
import { CollisionSurface, RayIntersectionData } from "./collisionSurface";

const CELL_SIZE = 16;

export class Grid {
  bounds: Bounds;
  cellSizeX: number;
  cellSizeY: number;

  private cells: number[][] = [];
  private surfaces: CollisionSurface[] = [];
  private searchKey = 0;

  constructor(bounds: Bounds) {
    this.bounds = bounds.clone();
    this.cellSizeX = this.bounds.xSize / CELL_SIZE;
    this.cellSizeY = this.bounds.ySize / CELL_SIZE;
    for (let i = 0; i < CELL_SIZE * CELL_SIZE; i++) this.cells.push([]);
  }

  insert(surface: CollisionSurface): void {
    if (!this.bounds.containsBounds(surface.boundingBox)) {
      throw new Error("Surface is not contained in the grid's bounds");
    }
    this.surfaces.push(surface);
  }

  build(): void {
    for (let i = 0; i < CELL_SIZE; i++) {
      const minX = this.bounds.xMin + i * this.cellSizeX;
      const maxX = this.bounds.xMin + (i + 1) * this.cellSizeX;
      for (let j = 0; j < CELL_SIZE; j++) {
        const minY = this.bounds.yMin + j * this.cellSizeY;
        const maxY = this.bounds.yMin + (j + 1) * this.cellSizeY;

        for (let idx = 0; idx < this.surfaces.length; idx++) {
          const bb = this.surfaces[idx]!.boundingBox;
          if (bb.xMin <= maxX && bb.xMax >= minX && bb.yMin <= maxY && bb.yMax >= minY) {
            this.cells[16 * i + j]!.push(idx);
          }
        }
      }
    }
  }

  boundingSearch(searchbox: Bounds, foundSurfaces: CollisionSurface[]): void {
    const queryMinX = Math.max(searchbox.xMin, this.bounds.xMin);
    const queryMinY = Math.max(searchbox.yMin, this.bounds.yMin);
    const queryMaxX = Math.min(searchbox.xMax, this.bounds.xMax);
    const queryMaxY = Math.min(searchbox.yMax, this.bounds.yMax);
    let xStart = Math.floor((queryMinX - this.bounds.xMin) / this.cellSizeX);
    let yStart = Math.floor((queryMinY - this.bounds.yMin) / this.cellSizeY);
    let xEnd = Math.ceil((queryMaxX - this.bounds.xMin) / this.cellSizeX);
    let yEnd = Math.ceil((queryMaxY - this.bounds.yMin) / this.cellSizeY);

    if (xStart < 0) xStart = 0;
    if (yStart < 0) yStart = 0;
    if (xEnd > CELL_SIZE) xEnd = CELL_SIZE;
    if (yEnd > CELL_SIZE) yEnd = CELL_SIZE;

    this.searchKey++;

    for (let i = xStart; i < xEnd; i++) {
      for (let j = yStart; j < yEnd; j++) {
        for (const surfIdx of this.cells[16 * i + j]!) {
          const surf = this.surfaces[surfIdx]!;
          if (surf.key === this.searchKey) continue;
          surf.key = this.searchKey;
          if (searchbox.containsBounds(surf.boundingBox) || searchbox.collide(surf.boundingBox)) {
            foundSurfaces.push(surf);
          }
        }
      }
    }
  }

  rayCast(origin: Vec3, direction: Vec3, bestT: number): RayIntersectionData[] {
    const cellX = (origin.x - this.bounds.xMin) / this.cellSizeX;
    const cellY = (origin.y - this.bounds.yMin) / this.cellSizeY;
    const dest = origin.add(direction.multiply(bestT));
    const destCellX = (dest.x - this.bounds.xMin) / this.cellSizeX;
    const destCellY = (dest.y - this.bounds.yMin) / this.cellSizeY;

    let X = Math.floor(cellX);
    let Y = Math.floor(cellY);
    const destX = clamp(Math.max(Math.floor(destCellX), 0), 0, CELL_SIZE);
    const destY = clamp(Math.max(Math.floor(destCellY), 0), 0, CELL_SIZE);
    if (X < 0 || X >= CELL_SIZE || Y < 0 || Y >= CELL_SIZE) return [];

    let stepX: number, outX: number;
    let stepY: number, outY: number;
    const cb = new Vec3();
    if (direction.x > 0) {
      stepX = 1;
      outX = destX;
      if (outX === X) outX = Math.min(CELL_SIZE, outX + 1);
      cb.x = this.bounds.xMin + (X + 1) * this.cellSizeX;
    } else {
      stepX = -1;
      outX = destX - 1;
      cb.x = this.bounds.xMin + X * this.cellSizeX;
    }
    if (direction.y > 0) {
      stepY = 1;
      outY = destY;
      if (outY === Y) outY = Math.min(CELL_SIZE, outY + 1);
      cb.y = this.bounds.yMin + (Y + 1) * this.cellSizeY;
    } else {
      stepY = -1;
      outY = destY - 1;
      cb.y = this.bounds.yMin + Y * this.cellSizeY;
    }

    const tmax = new Vec3(1000000, 1000000, 0);
    const tdelta = new Vec3();
    if (direction.x !== 0) {
      const rxr = 1.0 / direction.x;
      tmax.x = (cb.x - origin.x) * rxr;
      tdelta.x = this.cellSizeX * stepX * rxr;
    }
    if (direction.y !== 0) {
      const ryr = 1.0 / direction.y;
      tmax.y = (cb.y - origin.y) * ryr;
      tdelta.y = this.cellSizeY * stepY * ryr;
    }

    this.searchKey++;
    const results: RayIntersectionData[] = [];
    for (;;) {
      const cell = this.cells[16 * X + Y]!;
      for (const idx of cell) {
        const surf = this.surfaces[idx]!;
        if (surf.key === this.searchKey) continue;
        surf.key = this.searchKey;
        bestT = surf.rayCast(origin, direction, results, bestT);
      }
      if (tmax.x < tmax.y) {
        X += stepX;
        if (X === outX) break;
        tmax.x += tdelta.x;
      } else {
        Y += stepY;
        if (Y === outY) break;
        tmax.y += tdelta.y;
      }
    }
    return results;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
