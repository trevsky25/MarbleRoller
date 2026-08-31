// Marble physics simulation, ported faithfully from MBHaxe's Marble.hx (MIT,
// RandomityGuy) — the same constants, force model, contact solver, and
// continuous-collision testMove. Multiplayer, pathed interiors, powerups,
// and audio hooks are stubbed for later slices.
import { Vec3, Quat } from "../math/vec3";
import { Bounds } from "../math/bounds";
import { CollisionWorld, CollisionInfo, CollisionEntity } from "../collision/collisionWorld";
import { CollisionSurface } from "../collision/collisionSurface";
import { pointInTriangle } from "../collision/collisionMath";

export interface Move {
  d: { x: number; y: number };
  jump: boolean;
  powerup: boolean;
}

export type MarbleMode = "start" | "play" | "finish";

export interface TimeState {
  timeSinceLoad: number;
  currentAttemptTime: number;
  dt: number;
}

interface TestMoveFoundContact {
  v: [Vec3, Vec3, Vec3];
  n: Vec3;
}

interface TestMoveResult {
  position: Vec3;
  t: number;
  found: boolean;
  foundContacts: TestMoveFoundContact[];
  lastContactPos: Vec3 | null;
}

export interface MarbleCameraLike {
  cameraYaw: number;
}

export class Marble {
  velocity = new Vec3();
  omega = new Vec3();
  position = new Vec3();
  rotation = new Quat();

  radius = 0.2;

  // The exact MBG constants (Marble.hx)
  maxRollVelocity = 15;
  angularAcceleration = 75;
  jumpImpulse = 7.5;
  kineticFriction = 0.7;
  staticFriction = 1.1;
  brakingAcceleration = 30;
  gravity = 20;
  airAccel = 5;
  maxDotSlide = 0.5;
  minBounceVel = 0.1;
  minBounceSpeed = 3;
  bounceKineticFriction = 0.2;
  bounceRestitution = 0.5;
  mass = 1;

  mode: MarbleMode = "play";
  currentUp = new Vec3(0, 0, 1);
  contacts: CollisionInfo[] = [];
  bestContact: CollisionInfo | null = null;
  lastContactNormal = new Vec3(0, 0, 1);

  outOfBounds = false;

  camera: MarbleCameraLike;
  collisionWorld: CollisionWorld;

  private _bounceYet = false;
  private _slipAmount = 0;
  private _contactTime = 0;
  private _totalTime = 0;
  private _firstTick = true;

  prevPos = new Vec3();

  // Event hooks for later audio/particles
  onJump: (() => void) | null = null;
  onBounce: ((speed: number) => void) | null = null;
  private jumpedThisTick = false;

  constructor(collisionWorld: CollisionWorld, camera: MarbleCameraLike) {
    this.collisionWorld = collisionWorld;
    this.camera = camera;
  }

  private findContacts(): void {
    this.contacts = [];
    this.collisionWorld.sphereIntersection(this.position, this.radius, this.contacts);
  }

  getMarbleAxis(): [Vec3, Vec3, Vec3] {
    // Mirror-conjugated form of MBHaxe's getMarbleAxis for our right-handed
    // world: base motion dir (0,-1,0) rotated by -yaw about Z, and the cross
    // products swap order. (Gravity orientation quat is identity until
    // gravity modifiers arrive.)
    const yaw = -this.camera.cameraYaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let motiondir = new Vec3(0 * cos - -1 * sin, 0 * sin + -1 * cos, 0);
    const updir = this.currentUp;
    const sidedir = updir.cross(motiondir);
    sidedir.normalize();
    motiondir = sidedir.cross(updir);
    return [sidedir, motiondir, updir];
  }

  private getExternalForces(dt: number, m: Move): Vec3 {
    if (this.mode === "finish") return this.velocity.multiply(-16);
    const gWorkGravityDir = this.currentUp.multiply(-1);
    const A = gWorkGravityDir.multiply(this.gravity);

    if (this.contacts.length !== 0 && this.mode !== "start") {
      let contactForce = 0;
      const contactNormal = new Vec3();
      let forceObjectCount = 0;
      let seenForceObject = false;

      for (const contact of this.contacts) {
        // level geometry force surfaces (e.g. floor_bounce); one per tick,
        // matching MBHaxe's dedup-by-otherObject behavior
        if (contact.force !== 0 && !seenForceObject) {
          forceObjectCount++;
          contactNormal.load(contactNormal.add(contact.normal));
          contactForce += contact.force;
          seenForceObject = true;
        }
      }

      if (forceObjectCount !== 0) {
        contactNormal.normalize();
        let a = contactForce / this.mass;
        const dot = this.velocity.dot(contactNormal);
        if (a > dot) {
          if (dot > 0) a -= dot;
          A.load(A.add(contactNormal.multiply(a / dt)));
        }
      }
    }
    if (this.contacts.length === 0 && this.mode !== "start") {
      const [sideDir, motionDir] = this.getMarbleAxis();
      A.load(A.add(sideDir.multiply(m.d.x).add(motionDir.multiply(m.d.y)).multiply(this.airAccel)));
    }
    return A;
  }

  private computeMoveForces(m: Move, aControl: Vec3, desiredOmega: Vec3): boolean {
    const R = this.currentUp.multiply(this.radius);
    const rollVelocity = this.omega.cross(R);
    const [sideDir, motionDir] = this.getMarbleAxis();
    const currentYVelocity = rollVelocity.dot(motionDir);
    const currentXVelocity = rollVelocity.dot(sideDir);
    const mv = m.d;

    let desiredYVelocity = this.maxRollVelocity * mv.y;
    let desiredXVelocity = this.maxRollVelocity * mv.x;

    if (desiredYVelocity !== 0 || desiredXVelocity !== 0) {
      if (currentYVelocity > desiredYVelocity && desiredYVelocity > 0) {
        desiredYVelocity = currentYVelocity;
      } else if (currentYVelocity < desiredYVelocity && desiredYVelocity < 0) {
        desiredYVelocity = currentYVelocity;
      }
      if (currentXVelocity > desiredXVelocity && desiredXVelocity > 0) {
        desiredXVelocity = currentXVelocity;
      } else if (currentXVelocity < desiredXVelocity && desiredXVelocity < 0) {
        desiredXVelocity = currentXVelocity;
      }
      const rsq = R.lengthSq();
      const crossP = R.cross(motionDir.multiply(desiredYVelocity).add(sideDir.multiply(desiredXVelocity))).multiply(
        1 / rsq,
      );
      desiredOmega.load(crossP);
      aControl.load(desiredOmega.sub(this.omega));
      const aScalar = aControl.length();
      if (aScalar > this.angularAcceleration) {
        aControl.scale(this.angularAcceleration / aScalar);
      }
      return false;
    }
    return true;
  }

  private velocityCancel(surfaceSlide: boolean, noBounce: boolean): void {
    const SurfaceDotThreshold = 0.0001;
    let looped = false;
    let itersIn = 0;
    let done: boolean;
    do {
      done = true;
      itersIn++;
      for (const contact of this.contacts) {
        const sVel = this.velocity.sub(contact.velocity);
        const surfaceDot = contact.normal.dot(sVel);

        if ((!looped && surfaceDot < 0.0) || surfaceDot < -SurfaceDotThreshold) {
          const velLen = this.velocity.length();
          const surfaceVel = contact.normal.multiply(surfaceDot);

          if (!this._bounceYet) {
            this._bounceYet = true;
            this.onBounce?.(-surfaceDot);
          }

          if (noBounce) {
            this.velocity.load(this.velocity.sub(surfaceVel));
          } else {
            // (marble-marble branch omitted: contact.collider is always null
            // for level geometry in this slice)
            if (contact.velocity.length() === 0.0 && !surfaceSlide && surfaceDot > -this.maxDotSlide * velLen) {
              this.velocity.load(this.velocity.sub(surfaceVel));
              this.velocity.normalize();
              this.velocity.load(this.velocity.multiply(velLen));
              surfaceSlide = true;
            } else if (surfaceDot >= -this.minBounceVel) {
              this.velocity.load(this.velocity.sub(surfaceVel));
            } else {
              let restitution = this.bounceRestitution;
              restitution *= contact.restitution;

              const velocityAdd = surfaceVel.multiply(-(1 + restitution));
              const vAtC = sVel.add(this.omega.cross(contact.normal.multiply(-this.radius)));
              const normalVel = -contact.normal.dot(sVel);

              vAtC.load(vAtC.sub(contact.normal.multiply(contact.normal.dot(sVel))));

              const vAtCMag = vAtC.length();
              if (vAtCMag !== 0.0) {
                const friction = this.bounceKineticFriction * contact.friction;

                let angVMagnitude = (friction * 5 * normalVel) / (2 * this.radius);
                if (vAtCMag / this.radius < angVMagnitude) angVMagnitude = vAtCMag / this.radius;

                const vAtCDir = vAtC.multiply(1 / vAtCMag);

                const deltaOmega = contact.normal.cross(vAtCDir).multiply(angVMagnitude);
                this.omega.load(this.omega.add(deltaOmega));

                this.velocity.load(this.velocity.sub(deltaOmega.cross(contact.normal.multiply(this.radius))));
              }
              this.velocity.load(this.velocity.add(velocityAdd));
            }
          }
          done = false;
        }
      }
      looped = true;
      if (itersIn > 6) {
        for (const contact of this.contacts) {
          contact.velocity.set(0, 0, 0);
        }
        if (noBounce) done = true;
      }
    } while (!done && itersIn < 1e4);

    if (this.velocity.lengthSq() < 625.0) {
      let gotOne = false;
      let dir = new Vec3(0, 0, 0);
      for (const contact of this.contacts) {
        const dir2 = dir.add(contact.normal);
        if (dir2.lengthSq() < 0.01) {
          dir2.load(dir2.add(contact.normal));
        }
        dir = dir2;
        dir.normalize();
        gotOne = true;
      }
      if (gotOne) {
        dir.normalize();
        let soFar = 0.0;
        for (const contact of this.contacts) {
          const dist = this.radius - contact.contactDistance;
          const timeToSeparate = 0.1;
          const vel = this.velocity.sub(contact.velocity);
          const outVel = vel.add(dir.multiply(soFar)).dot(contact.normal);
          if (dist > timeToSeparate * outVel) {
            soFar += (dist - outVel * timeToSeparate) / timeToSeparate / contact.normal.dot(dir);
          }
        }
        if (soFar < -25.0) soFar = -25.0;
        if (soFar > 25.0) soFar = 25.0;
        this.velocity.load(this.velocity.add(dir.multiply(soFar)));
      }
    }
  }

  private applyContactForces(dt: number, m: Move, isCentered: boolean, aControl: Vec3, desiredOmega: Vec3, A: Vec3): Vec3 {
    const a = new Vec3();
    this._slipAmount = 0;
    const gWorkGravityDir = this.currentUp.multiply(-1);
    let bestSurface = -1;
    let bestNormalForce = 0.0;
    for (let i = 0; i < this.contacts.length; i++) {
      const contact = this.contacts[i]!;
      if (contact.collider === null) {
        contact.normalForce = -contact.normal.dot(A);
        if (contact.normalForce > bestNormalForce) {
          bestNormalForce = contact.normalForce;
          bestSurface = i;
        }
      }
    }
    this.bestContact = bestSurface !== -1 ? this.contacts[bestSurface]! : null;
    const canJump = bestSurface !== -1;
    if (canJump && m.jump) {
      const bestContact = this.bestContact!;
      const velDifference = this.velocity.sub(bestContact.velocity);
      let sv = bestContact.normal.dot(velDifference);
      if (sv < 0) sv = 0;
      if (sv < this.jumpImpulse) {
        this.velocity.load(this.velocity.add(bestContact.normal.multiply(this.jumpImpulse - sv)));
        if (!this.jumpedThisTick) {
          this.jumpedThisTick = true;
          this.onJump?.();
        }
      }
    }
    for (const contact of this.contacts) {
      const normalForce2 = -contact.normal.dot(A);
      if (normalForce2 > 0 && contact.normal.dot(this.velocity.sub(contact.velocity)) <= 0.0001) {
        A.set(A.x + contact.normal.x * normalForce2, A.y + contact.normal.y * normalForce2, A.z + contact.normal.z * normalForce2);
      }
    }
    if (bestSurface !== -1 && this.mode !== "finish") {
      const bestContact = this.bestContact!;
      const vAtC = this.velocity
        .add(this.omega.cross(bestContact.normal.multiply(-this.radius)))
        .sub(bestContact.velocity);
      const vAtCMag = vAtC.length();
      let slipping = false;
      const aFriction = new Vec3(0, 0, 0);
      const AFriction = new Vec3(0, 0, 0);
      if (vAtCMag !== 0) {
        slipping = true;
        let friction = 0.0;
        if (this.mode !== "start") friction = this.kineticFriction * bestContact.friction;
        let angAMagnitude = (5 * friction * bestNormalForce) / (2 * this.radius);
        let AMagnitude = bestNormalForce * friction;
        const totalDeltaV = (angAMagnitude * this.radius + AMagnitude) * dt;
        if (totalDeltaV > vAtCMag) {
          const fraction = vAtCMag / totalDeltaV;
          angAMagnitude *= fraction;
          AMagnitude *= fraction;
          slipping = false;
        }
        const vAtCDir = vAtC.multiply(1 / vAtCMag);
        aFriction.load(bestContact.normal.cross(vAtCDir).multiply(angAMagnitude));
        AFriction.load(vAtCDir.multiply(-AMagnitude));
        this._slipAmount = vAtCMag - totalDeltaV;
      }
      if (!slipping) {
        const R = gWorkGravityDir.multiply(-this.radius);
        const aadd = R.cross(A).multiply(1 / R.lengthSq());
        if (isCentered) {
          const nextOmega = this.omega.add(a.multiply(dt));
          aControl = desiredOmega.sub(nextOmega);
          const aScalar = aControl.length();
          if (aScalar > this.brakingAcceleration) {
            aControl = aControl.multiply(this.brakingAcceleration / aScalar);
          }
        }
        const Aadd = aControl.cross(bestContact.normal.multiply(-this.radius)).multiply(-1);
        const aAtCMag = aadd.cross(bestContact.normal.multiply(-this.radius)).add(Aadd).length();
        let friction2 = 0.0;
        if (this.mode !== "start") friction2 = this.staticFriction * bestContact.friction;

        if (aAtCMag > friction2 * bestNormalForce) {
          friction2 = 0;
          if (this.mode !== "start") friction2 = this.kineticFriction * bestContact.friction;
          Aadd.load(Aadd.multiply((friction2 * bestNormalForce) / aAtCMag));
        }
        A.load(A.add(Aadd));
        a.load(a.add(aadd));
      }
      A.load(A.add(AFriction));
      a.load(a.add(aFriction));

      this.lastContactNormal = bestContact.normal;
    }
    a.load(a.add(aControl));
    if (this.mode === "finish") {
      a.set();
    }
    return a;
  }

  private testMove(velocity: Vec3, position: Vec3, deltaT: number, radius: number): TestMoveResult {
    if (velocity.length() < 0.001) {
      return { position, t: deltaT, found: false, foundContacts: [], lastContactPos: null };
    }
    const searchbox = new Bounds();
    searchbox.addSpherePos(position.x, position.y, position.z, this.radius);
    searchbox.addSpherePos(
      position.x + velocity.x * deltaT,
      position.y + velocity.y * deltaT,
      position.z + velocity.z * deltaT,
      this.radius,
    );

    const foundObjs: CollisionEntity[] = [];
    this.collisionWorld.boundingSearch(searchbox, foundObjs);

    let finalT = deltaT;
    let found = false;
    let lastContactPos = new Vec3();
    const testTriangles: TestMoveFoundContact[] = [];

    const relVel = velocity; // static geometry only: entity velocity is zero

    for (const obj of foundObjs) {
      if (!obj.isCollideable) continue;

      const boundThing = new Bounds();
      boundThing.addSpherePos(position.x, position.y, position.z, radius * 2);
      boundThing.addSpherePos(
        position.x + relVel.x * deltaT * 5,
        position.y + relVel.y * deltaT * 5,
        position.z + relVel.z * deltaT * 5,
        radius * 2,
      );

      let currentFinalPos = position.add(relVel.multiply(finalT));
      const surfaces: CollisionSurface[] = [];
      obj.boundingSearchSurfaces(boundThing, surfaces);

      for (const surface of surfaces) {
        currentFinalPos = position.add(relVel.multiply(finalT));

        let i = 0;
        while (i < surface.indices.length) {
          const tri = surface.getTriangle(i);
          const v0 = tri.v0;
          const v = tri.v1;
          const v2 = tri.v2;
          const surfaceNormal = tri.n;
          const surfaceD = -surfaceNormal.dot(v0);

          // Wrong direction or won't touch the plane this step
          if (surfaceNormal.dot(relVel) > -0.001 || surfaceNormal.dot(currentFinalPos) + surfaceD > radius) {
            i += 3;
            continue;
          }

          testTriangles.push({ v: [v0.clone(), v.clone(), v2.clone()], n: surfaceNormal.clone() });

          // Time until collision with the plane
          const collisionTime = (radius - position.dot(surfaceNormal) - surfaceD) / surfaceNormal.dot(relVel);

          if (collisionTime >= 0.000001 && finalT >= collisionTime) {
            const collisionPoint = position.add(relVel.multiply(collisionTime));
            if (pointInTriangle(collisionPoint, v0, v, v2)) {
              finalT = collisionTime;
              currentFinalPos = position.add(relVel.multiply(finalT));
              found = true;
              lastContactPos = currentFinalPos.clone();
              i += 3;
              continue;
            }
          }

          // Edge collisions
          const triangleVerts = [v0.clone(), v.clone(), v2.clone()] as const;
          const lastVert = v2.clone();
          const radSq = radius * radius;
          for (let iter = 0; iter < 3; iter++) {
            const thisVert = triangleVerts[iter]!;

            const vertDiff = lastVert.sub(thisVert);
            const posDiff = position.sub(thisVert);

            const velRejection = vertDiff.cross(relVel);
            const posRejection = vertDiff.cross(posDiff);

            let a = velRejection.lengthSq();
            let b = 2 * posRejection.dot(velRejection);
            let c = posRejection.lengthSq() - vertDiff.lengthSq() * radSq;

            let discriminant = b * b - 4 * a * c;

            if (a === 0.0 || discriminant < 0.0) {
              lastVert.load(thisVert);
              continue;
            }

            let oneOverTwoA = 0.5 / a;
            let discriminantSqrt = Math.sqrt(discriminant);

            let edgeCollisionTime = (-b + discriminantSqrt) * oneOverTwoA;
            let edgeCollisionTime2 = (-b - discriminantSqrt) * oneOverTwoA;

            if (edgeCollisionTime2 < edgeCollisionTime) {
              const temp = edgeCollisionTime2;
              edgeCollisionTime2 = edgeCollisionTime;
              edgeCollisionTime = temp;
            }

            if (edgeCollisionTime2 <= 0.0001 || finalT <= edgeCollisionTime) {
              lastVert.load(thisVert);
              continue;
            }

            if (edgeCollisionTime >= 0.000001) {
              const edgeLen = vertDiff.length();
              const relativeCollisionPos = position.add(relVel.multiply(edgeCollisionTime)).sub(thisVert);
              const distanceAlongEdge = relativeCollisionPos.dot(vertDiff) / edgeLen;

              if (-radius > distanceAlongEdge || edgeLen + radius < distanceAlongEdge) {
                lastVert.load(thisVert);
                continue;
              }

              if (distanceAlongEdge >= 0.0 && distanceAlongEdge <= edgeLen) {
                finalT = edgeCollisionTime;
                currentFinalPos = position.add(relVel.multiply(finalT));
                lastContactPos = vertDiff.multiply(distanceAlongEdge / edgeLen).add(thisVert);
                lastVert.load(thisVert);
                found = true;
                continue;
              }
            }

            // Corner collision (thisVert)
            a = relVel.lengthSq();
            let posVertDiff = position.sub(thisVert);
            b = 2 * posVertDiff.dot(relVel);
            c = posVertDiff.lengthSq() - radSq;
            discriminant = b * b - 4 * a * c;

            if (a !== 0.0 && discriminant >= 0.0) {
              oneOverTwoA = 0.5 / a;
              discriminantSqrt = Math.sqrt(discriminant);

              edgeCollisionTime = (-b + discriminantSqrt) * oneOverTwoA;
              edgeCollisionTime2 = (-b - discriminantSqrt) * oneOverTwoA;

              if (edgeCollisionTime2 < edgeCollisionTime) {
                const temp = edgeCollisionTime2;
                edgeCollisionTime2 = edgeCollisionTime;
                edgeCollisionTime = temp;
              }

              if (edgeCollisionTime2 > 0.0001 && finalT > edgeCollisionTime) {
                if (edgeCollisionTime <= 0.0 && edgeCollisionTime > -0.0001) edgeCollisionTime = 0.0;

                if (edgeCollisionTime >= 0.000001) {
                  finalT = edgeCollisionTime;
                  currentFinalPos = position.add(relVel.multiply(finalT));
                  lastContactPos = thisVert;
                  found = true;
                }
              }
            }

            // The other corner (lastVert)
            posVertDiff = position.sub(lastVert);
            b = 2 * posVertDiff.dot(relVel);
            c = posVertDiff.lengthSq() - radSq;
            discriminant = b * b - 4 * a * c;

            if (a === 0.0 || discriminant < 0.0) {
              lastVert.load(thisVert);
              continue;
            }

            oneOverTwoA = 0.5 / a;
            discriminantSqrt = Math.sqrt(discriminant);

            edgeCollisionTime = (-b + discriminantSqrt) * oneOverTwoA;
            edgeCollisionTime2 = (-b - discriminantSqrt) * oneOverTwoA;

            if (edgeCollisionTime2 < edgeCollisionTime) {
              const temp = edgeCollisionTime2;
              edgeCollisionTime2 = edgeCollisionTime;
              edgeCollisionTime = temp;
            }

            if (edgeCollisionTime2 <= 0.0001 || finalT <= edgeCollisionTime) {
              lastVert.load(thisVert);
              continue;
            }

            if (edgeCollisionTime <= 0.0 && edgeCollisionTime > -0.0001) edgeCollisionTime = 0;

            if (edgeCollisionTime < 0.000001) {
              lastVert.load(thisVert);
              continue;
            }

            finalT = edgeCollisionTime;
            currentFinalPos = position.add(relVel.multiply(finalT));
            lastVert.load(thisVert);
            found = true;
          }

          i += 3;
        }
      }
    }

    const deltaPosition = velocity.multiply(finalT);
    const finalPosition = position.add(deltaPosition);

    return { position: finalPosition, t: finalT, found, foundContacts: testTriangles, lastContactPos };
  }

  private nudgeToContacts(position: Vec3, radius: number, foundContacts: TestMoveFoundContact[]): Vec3 {
    let it = 0;
    let prevResolved = 0;
    do {
      let resolved = 0;
      for (const testTri of foundContacts) {
        // Wrong side of the triangle
        if (testTri.n.dot(position) - testTri.n.dot(testTri.v[0]) < 0) continue;

        const t1 = testTri.v[1].sub(testTri.v[0]);
        const t2 = testTri.v[2].sub(testTri.v[0]);
        const tarea = Math.abs(t1.cross(t2).length()) / 2.0;

        // Triangle too small to collide with
        if (tarea < 0.001) continue;

        const t = testTri.v[0].sub(position).dot(testTri.n) / testTri.n.lengthSq();
        const intersect = position.add(testTri.n.multiply(t));

        if (pointInTriangle(intersect, testTri.v[0], testTri.v[1], testTri.v[2])) {
          const separatingDistance = position.sub(intersect).normalized();
          const distToContactPlane = intersect.distance(position);
          if (radius - 0.005 - distToContactPlane > 0.0001) {
            position.load(position.add(separatingDistance.multiply(radius - distToContactPlane - 0.005)));
            resolved++;
          }
        }
      }
      if (resolved === 0 && prevResolved === 0) break;
      prevResolved = resolved;
      it++;
    } while (it < 10);
    return position;
  }

  advancePhysics(timeState: TimeState, m: Move): void {
    let timeRemaining = timeState.dt;
    let it = 0;

    this._bounceYet = false;
    this.jumpedThisTick = false;

    const oldPos = this.position.clone();

    do {
      if (timeRemaining <= 0) break;

      let timeStep = 0.004;
      if (timeRemaining < timeStep) timeStep = timeRemaining;

      it++;

      this.findContacts();

      if (this._firstTick) {
        this.contacts = [];
        this._firstTick = false;
      }

      const aControl = new Vec3();
      const desiredOmega = new Vec3();
      const isCentered = this.computeMoveForces(m, aControl, desiredOmega);

      this.velocityCancel(isCentered, false);
      const A = this.getExternalForces(timeStep, m);
      const a = this.applyContactForces(timeStep, m, isCentered, aControl, desiredOmega, A);

      if (Number.isNaN(A.lengthSq())) A.set(0, 0, 0);
      if (Number.isNaN(a.lengthSq())) a.set(0, 0, 0);

      this.velocity.set(this.velocity.x + A.x * timeStep, this.velocity.y + A.y * timeStep, this.velocity.z + A.z * timeStep);
      this.omega.set(this.omega.x + a.x * timeStep, this.omega.y + a.y * timeStep, this.omega.z + a.z * timeStep);
      if (this.mode === "start") {
        this.velocity.x = 0;
        this.velocity.y = 0;
      }
      this.velocityCancel(isCentered, true);
      this._totalTime += timeStep;
      if (this.contacts.length !== 0) this._contactTime += timeStep;

      const pos = this.position.clone();
      this.prevPos = pos.clone();

      let tdiff = timeStep;

      const finalPosData = this.testMove(this.velocity, pos, timeStep, this.radius);
      if (finalPosData.found) {
        const diff = timeStep - finalPosData.t;
        this.velocity = this.velocity.sub(A.multiply(diff));
        this.omega = this.omega.sub(a.multiply(diff));
        timeStep = finalPosData.t;
        tdiff = diff;
      }
      const expectedPos = finalPosData.position;
      const newPos = this.nudgeToContacts(expectedPos.clone(), this.radius, finalPosData.foundContacts);

      if (this.velocity.lengthSq() > 1e-8) {
        const posDiff = newPos.sub(expectedPos);
        if (posDiff.lengthSq() > 1e-8) {
          const velDiffProj = this.velocity.multiply(posDiff.dot(this.velocity) / this.velocity.lengthSq());
          const expectedProjPos = expectedPos.add(velDiffProj);
          const updatedTimestep = expectedProjPos.sub(pos).length() / this.velocity.length();

          const tDiff = updatedTimestep - timeStep;
          if (tDiff > 0) {
            this.velocity = this.velocity.sub(A.multiply(tDiff));
            this.omega = this.omega.sub(a.multiply(tDiff));
            timeStep = updatedTimestep;
          }
        }
      }

      const rot = this.rotation;
      const quat = new Quat();
      quat.initRotation(this.omega.x * timeStep, this.omega.y * timeStep, this.omega.z * timeStep);
      quat.multiply(quat, rot);
      this.rotation = quat;

      this.position.load(newPos);

      timeRemaining -= timeStep;

      if (tdiff === 0 || it > 10) break;
    } while (true);
  }

  update(timeState: TimeState, move: Move): void {
    this.advancePhysics(timeState, move);
  }
}
