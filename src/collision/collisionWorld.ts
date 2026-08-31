// Collision entity + world, ported from MBHaxe collision/CollisionEntity.hx
// and CollisionWorld.hx (MIT). Static identity-transform entities only for
// now (interiors baked in world space); pathed interiors come later.
import { Vec3 } from "../math/vec3";
import { Bounds } from "../math/bounds";
import { Grid } from "./grid";
import { CollisionSurface, RayIntersectionData } from "./collisionSurface";
import { triangleSphereIntersection } from "./collisionMath";

export class CollisionInfo {
  point = new Vec3();
  normal = new Vec3();
  velocity = new Vec3();
  // marble-marble collider; null for level geometry (matches MBHaxe)
  collider: CollisionEntity | null = null;
  friction = 1;
  normalForce = 0;
  restitution = 1;
  contactDistance = 0;
  force = 0;
}

export class CollisionEntity {
  boundingBox = new Bounds();
  surfaces: CollisionSurface[] = [];
  velocity = new Vec3();
  isCollideable = true;
  private grid: Grid | null = null;

  addSurface(surface: CollisionSurface): void {
    if (surface.points.length > 0) this.surfaces.push(surface);
  }

  finalize(): void {
    const bbox = new Bounds();
    for (const surface of this.surfaces) bbox.add(surface.boundingBox);
    this.boundingBox = bbox.clone();
    this.grid = new Grid(bbox);
    for (const surface of this.surfaces) this.grid.insert(surface);
    this.grid.build();
  }

  boundingSearchSurfaces(searchbox: Bounds, found: CollisionSurface[]): void {
    this.grid?.boundingSearch(searchbox, found);
  }

  // Sphere-vs-entity contact generation (CollisionEntity.sphereIntersection).
  sphereIntersection(position: Vec3, radiusIn: number, contacts: CollisionInfo[]): void {
    const radius = radiusIn + 0.001;

    const sphereBounds = new Bounds();
    sphereBounds.addSpherePos(position.x, position.y, position.z, radius * 1.1);
    const surfaces: CollisionSurface[] = [];
    this.boundingSearchSurfaces(sphereBounds, surfaces);

    for (const surface of surfaces) {
      let i = 0;
      while (i < surface.indices.length) {
        const tri = surface.getTriangle(i);

        const closest = new Vec3();
        const normal = new Vec3();
        const res = triangleSphereIntersection(tri.v0, tri.v1, tri.v2, tri.n, position, radius, closest, normal);
        if (res) {
          const contactDist = closest.distanceSq(position);
          if (contactDist <= radius * radius) {
            if (position.sub(closest).dot(tri.n) > 0) {
              normal.normalize();
              const cinfo = new CollisionInfo();
              cinfo.normal.load(normal);
              cinfo.point.load(closest);
              cinfo.collider = null;
              cinfo.velocity.load(this.velocity);
              cinfo.contactDistance = Math.sqrt(contactDist);
              cinfo.restitution = surface.restitution;
              cinfo.force = surface.force;
              cinfo.friction = surface.friction;
              contacts.push(cinfo);
            }
          }
        }
        i += 3;
      }
    }
  }

  rayCast(rayOrigin: Vec3, rayDirection: Vec3, results: RayIntersectionData[], bestT: number): number {
    if (this.grid === null) return bestT;
    const intersections = this.grid.rayCast(rayOrigin, rayDirection, bestT);
    for (const i of intersections) {
      i.normal.normalize();
      if (i.t < bestT) {
        bestT = i.t;
        results.push(i);
      }
    }
    return bestT;
  }
}

export class CollisionWorld {
  entities: CollisionEntity[] = [];

  addEntity(entity: CollisionEntity): void {
    this.entities.push(entity);
  }

  // Broadphase is a plain entity-bbox scan; behaviorally equivalent to
  // MBHaxe's GridBroadphase output for the small entity counts we have.
  boundingSearch(bounds: Bounds, found: CollisionEntity[]): void {
    for (const entity of this.entities) {
      if (entity.boundingBox.collide(bounds)) found.push(entity);
    }
  }

  sphereIntersection(position: Vec3, radius: number, contacts: CollisionInfo[]): void {
    const box = new Bounds();
    box.addSpherePos(position.x, position.y, position.z, radius);
    for (const entity of this.entities) {
      if (entity.boundingBox.collide(box) && entity.isCollideable) {
        entity.sphereIntersection(position, radius, contacts);
      }
    }
  }

  rayCast(rayStart: Vec3, rayDirection: Vec3, rayLength: number): RayIntersectionData[] {
    const bounds = new Bounds();
    bounds.addPos(rayStart.x, rayStart.y, rayStart.z);
    bounds.addPos(
      rayStart.x + rayDirection.x * rayLength,
      rayStart.y + rayDirection.y * rayLength,
      rayStart.z + rayDirection.z * rayLength,
    );
    const found: CollisionEntity[] = [];
    this.boundingSearch(bounds, found);

    const results: RayIntersectionData[] = [];
    for (const entity of found) {
      entity.rayCast(rayStart, rayDirection, results, rayLength);
    }
    return results;
  }
}
