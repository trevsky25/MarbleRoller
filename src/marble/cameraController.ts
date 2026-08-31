// Chase camera, ported from MBHaxe's CameraController.hx (MIT): smoothed
// yaw/pitch orbit, the same lerp curve, pitch clamps, and the wall-clipping
// raycast pushback.
import * as THREE from "three";
import { Vec3, Quat } from "../math/vec3";
import { CollisionWorld } from "../collision/collisionWorld";
import { RayIntersectionData } from "../collision/collisionSurface";
import { settings } from "../game/settings";

const CAMERA_DISTANCE = 2.5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class CameraController {
  cameraYaw = 0;
  cameraPitch = 0.45;
  nextCameraYaw = 0;
  nextCameraPitch = 0.45;

  // MBHaxe default cameraSensitivity = 0.6; user-adjustable via Options
  get sensitivity(): number {
    return settings.mouseSensitivity;
  }

  private collisionWorld: CollisionWorld;
  private camera: THREE.PerspectiveCamera;

  constructor(camera: THREE.PerspectiveCamera, collisionWorld: CollisionWorld) {
    this.camera = camera;
    this.collisionWorld = collisionWorld;
  }

  // Pointer-lock mouse deltas (CameraController.orbit)
  orbit(deltaX: number, deltaY: number): void {
    const factor = lerp(1 / 1000, 1 / 200, this.sensitivity);
    this.nextCameraYaw += deltaX * factor;
    this.nextCameraPitch += deltaY * factor * (settings.invertY ? -1 : 1);
  }

  // Direct rotation in radians (arrow-key camera controls)
  rotate(yawDelta: number, pitchDelta: number): void {
    this.nextCameraYaw += yawDelta;
    this.nextCameraPitch += pitchDelta;
  }

  update(dt: number, marblePosition: Vec3, marbleRadius: number, marbleUp: Vec3): void {
    const lerpt = 1 - Math.pow(0.5, dt / 0.016);

    this.nextCameraPitch = Math.max(-Math.PI / 2 + Math.PI / 4, Math.min(Math.PI / 2 - 0.0001, this.nextCameraPitch));

    this.cameraYaw = lerp(this.cameraYaw, this.nextCameraYaw, lerpt);
    this.cameraPitch = lerp(this.cameraPitch, this.nextCameraPitch, lerpt);
    this.cameraPitch = Math.max(-Math.PI / 2 + Math.PI / 4, Math.min(Math.PI / 2 - 0.0001, this.cameraPitch));

    // Mirror-conjugated from MBHaxe for our right-handed world: base
    // direction (-1,0,0), negated pitch/yaw rotation angles.
    const up = new Vec3(0, 0, 1);
    let directionVector = new Vec3(-1, 0, 0);
    let cameraVerticalTranslation = new Vec3(0, 0, 0.3);

    const q1 = new Quat();
    q1.initRotateAxis(0, 1, 0, -this.cameraPitch);
    directionVector = q1.rotateVec(directionVector);
    cameraVerticalTranslation = q1.rotateVec(cameraVerticalTranslation);
    q1.initRotateAxis(0, 0, 1, -this.cameraYaw);
    directionVector = q1.rotateVec(directionVector);
    cameraVerticalTranslation = q1.rotateVec(cameraVerticalTranslation);

    let camPos = marblePosition.sub(directionVector.multiply(CAMERA_DISTANCE));
    let camTarget = marblePosition.add(cameraVerticalTranslation);
    let camUp = up;

    // Wall-clip pushback (up to 3 surfaces)
    const closeness = 0.1;
    const rayCastOrigin = marblePosition.add(marbleUp.multiply(marbleRadius));
    const processedShapes: object[] = [];
    for (let i = 0; i < 3; i++) {
      let rayCastDirection = camPos.sub(rayCastOrigin);
      rayCastDirection = rayCastDirection.add(rayCastDirection.normalized().multiply(2));
      const rayCastLen = rayCastDirection.length();

      const results = this.collisionWorld.rayCast(rayCastOrigin, rayCastDirection.normalized(), rayCastLen);

      let firstHit: RayIntersectionData | null = null;
      let firstHitDistance = 1e8;
      for (const result of results) {
        if (!processedShapes.includes(result.object) && (firstHit === null || rayCastOrigin.distance(result.point) < firstHitDistance)) {
          firstHit = result;
          firstHitDistance = rayCastOrigin.distance(result.point);
        }
      }
      if (firstHit !== null) {
        processedShapes.push(firstHit.object);
        if (firstHitDistance < CAMERA_DISTANCE) {
          const normal = firstHit.normal.multiply(-1);
          const planeD = firstHit.point.dot(firstHit.normal);
          const dist = camPos.dot(firstHit.normal) - planeD;
          const projected = camPos.sub(firstHit.normal.multiply(dist));

          if (dist >= closeness) continue;

          camPos = projected.add(normal.multiply(-closeness));

          const forwardVec = marblePosition.sub(camPos).normalized();
          const rightVec = camUp.cross(forwardVec).normalized();
          const upVec = forwardVec.cross(rightVec);

          camTarget = marblePosition.add(upVec.multiply(0.3));
          camUp = upVec;
          continue;
        }
      }
      break;
    }

    this.camera.up.set(camUp.x, camUp.y, camUp.z);
    this.camera.position.set(camPos.x, camPos.y, camPos.z);
    this.camera.lookAt(camTarget.x, camTarget.y, camTarget.z);
  }
}
