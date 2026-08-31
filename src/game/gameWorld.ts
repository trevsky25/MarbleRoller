// The gameplay orchestrator: loads a mission, spawns interiors/shapes/
// triggers, and runs MBG's attempt state machine (Ready-Set-Go, timer,
// gems, powerups, out-of-bounds, finish). Logic ported from MBHaxe's
// MarbleWorld.hx (MIT) with multiplayer/replay/rewind paths omitted.
import * as THREE from "three";
import { ResourceIndex } from "../assets/resourceIndex";
import { MisParser, MisElement, fieldOf, parseVector3, parseRotation, parseNumber, parseBoolean } from "../torque/misParser";
import { parseDif } from "../torque/dif";
import { parseDts } from "../torque/dts";
import { buildInterior } from "../render/interiorMesh";
import { buildDtsShape } from "../render/dtsMesh";
import { shapeDefForDataBlock, ShapeDef, GEM_COLORS } from "./shapeRegistry";
import { CollisionWorld, CollisionEntity } from "../collision/collisionWorld";
import { Marble, Move, TimeState } from "../marble/marble";
import { CameraController } from "../marble/cameraController";
import { Hud } from "./hud";
import { Vec3 } from "../math/vec3";
import { MaterialEnhancer } from "../render/materialEnhancer";
import { CustomLevelData, surfaceById } from "../editor/customLevel";
import { BlockArrays, emitBlock } from "../render/blockGeometry";
import { CollisionSurface } from "../collision/collisionSurface";

interface ShapeInstance {
  def: ShapeDef;
  element: MisElement | null;
  group: THREE.Group;
  position: Vec3;
  worldBounds: THREE.Box3;
  pickedUp: boolean;
  hiddenUntil: number; // timeSinceLoad at which a picked-up powerup reappears
  rotate: boolean;
  timeBonus: number; // seconds, for timeTravel
  pickUpName: string;
}

interface TriggerInstance {
  kind: "inBounds" | "outOfBounds" | "help";
  bounds: THREE.Box3;
  text: string;
  marbleInside: boolean;
}

const READY_TIME = 0.5;
const SET_TIME = 2;
const GO_TIME = 3.5;
const CLEAR_TEXT_TIME = 5.5;
const POWERUP_RESPAWN_TIME = 7;

function quatYaw(q: THREE.Quaternion): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

export class GameWorld {
  scene: THREE.Scene;
  collisionWorld = new CollisionWorld();
  marble: Marble;
  cameraController: CameraController;
  hud: Hud;
  index: ResourceIndex;

  missionTitle = "";
  startHelpText: string | null = null;

  private shapes: ShapeInstance[] = [];
  private triggers: TriggerInstance[] = [];
  private textureLoader = new THREE.TextureLoader();

  timeState: TimeState = { timeSinceLoad: 0, currentAttemptTime: 0, dt: 0 };
  gameplayClock = 0;
  bonusTime = 0;
  totalGems = 0;
  gemCount = 0;
  finishTime: number | null = null;
  outOfBounds = false;
  private oobStartTime = 0;

  heldPowerup: ShapeInstance | null = null;

  private spawnPosition = new Vec3(0, 0, 5);
  private spawnYaw = Math.PI / 2;

  private endPadPosition: Vec3 | null = null;
  private endPadUp = new Vec3(0, 0, 1);
  private endPadRadius = 1.7;
  private inFinishArea = false;

  private worldMinZ = Infinity;

  // sun configuration parsed from the mission, applied by the caller
  sunDirection: Vec3 | null = null;
  sunColor: THREE.Color | null = null;
  ambientColor: THREE.Color | null = null;

  private enhancer: MaterialEnhancer | undefined;
  private shapeColliderEntity = new CollisionEntity();
  private lastStartPad: { position: Vec3; yaw: number } | null = null;

  // Spawn one game shape (pad/sign/gem/powerup) by datablock name. Shared by
  // the .mis loader and custom levels.
  async spawnShape(
    dataBlock: string,
    elementName: string,
    position: Vec3,
    quat: THREE.Quaternion,
    scaleIn: Vec3,
    opts: { rotate?: boolean; timeBonus?: number | null; element?: MisElement | null } = {},
  ): Promise<void> {
    const def = shapeDefForDataBlock(dataBlock, elementName);
    if (def === null) return;

    const scale = new Vec3(scaleIn.x || 0.0001, scaleIn.y || 0.0001, scaleIn.z || 0.0001);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(position.x, position.y, position.z),
      quat,
      new THREE.Vector3(scale.x, scale.y, scale.z),
    );

    // Gem color skin: random per MBG behavior
    let matNameOverride = def.matNameOverride;
    if (def.kind === "gem") {
      const color = GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)]!;
      matNameOverride = new Map([["base.gem", `${color}.gem`]]);
    }

    const dtsBuffer = await this.index.loadArrayBuffer(def.dtsPath);
    const dtsShape = parseDts(dtsBuffer);
    const built = buildDtsShape(dtsShape, def.dtsPath, this.index, this.textureLoader, {
      matNameOverride: matNameOverride ?? new Map(),
      collisionTransform: def.kind === "startPad" || def.kind === "endPad" || def.kind === "sign" ? matrix : null,
      enhancer: this.enhancer,
    });

    built.group.applyMatrix4(matrix);
    this.scene.add(built.group);
    for (const surface of built.collisionSurfaces) this.shapeColliderEntity.addSurface(surface);

    const worldBounds = built.localBounds.clone().applyMatrix4(matrix);

    const instance: ShapeInstance = {
      def,
      element: opts.element ?? null,
      group: built.group,
      position,
      worldBounds,
      pickedUp: false,
      hiddenUntil: 0,
      rotate: opts.rotate ?? false,
      timeBonus: 5,
      pickUpName: def.pickUpName ?? "",
    };

    if (def.kind === "timeTravel") {
      if (opts.timeBonus !== null && opts.timeBonus !== undefined) instance.timeBonus = opts.timeBonus;
      instance.pickUpName = `${instance.timeBonus} second Time Travel bonus`;
    }

    this.shapes.push(instance);

    if (def.kind === "gem") this.totalGems++;
    if (def.kind === "startPad") {
      this.lastStartPad = { position, yaw: quatYaw(quat) };
    }
    if (def.kind === "endPad") {
      this.endPadPosition = position;
      const up = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      this.endPadUp = new Vec3(up.x, up.y, up.z);
      this.endPadRadius = 1.7 * Math.max(scale.x, scale.y);
    }
  }

  private finalizeShapeColliders(): void {
    if (this.shapeColliderEntity.surfaces.length > 0) {
      this.shapeColliderEntity.finalize();
      this.collisionWorld.addEntity(this.shapeColliderEntity);
    }
  }

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, index: ResourceIndex, enhancer?: MaterialEnhancer) {
    this.scene = scene;
    this.index = index;
    this.enhancer = enhancer;
    this.cameraController = new CameraController(camera, this.collisionWorld);
    this.marble = new Marble(this.collisionWorld, this.cameraController);
    this.hud = new Hud(index, enhancer?.enabled ?? false);
  }

  async load(misPath: string): Promise<void> {
    const url = this.index.resolve(misPath);
    if (url === null) throw new Error(`Mission not found: ${misPath}`);
    const text = await (await fetch(url)).text();
    const misFile = new MisParser(text).parse();

    // Flatten the SimGroup tree
    const elements: MisElement[] = [];
    const walk = (el: MisElement): void => {
      elements.push(el);
      for (const child of el.children) walk(child);
    };
    walk(misFile.root);

    // Mission info
    const missionInfo = elements.find((e) => e.type === "ScriptObject" && e.name === "MissionInfo");
    if (missionInfo !== undefined) {
      this.missionTitle = fieldOf(missionInfo, "name") ?? "";
      this.startHelpText = fieldOf(missionInfo, "starthelptext");
    }

    // Marble attribute overrides
    for (const [attr, value] of misFile.marbleAttributes) {
      const num = parseNumber(value);
      switch (attr) {
        case "maxrollvelocity":
          this.marble.maxRollVelocity = num;
          break;
        case "angularacceleration":
          this.marble.angularAcceleration = num;
          break;
        case "jumpimpulse":
          this.marble.jumpImpulse = num;
          break;
        case "kineticfriction":
          this.marble.kineticFriction = num;
          break;
        case "staticfriction":
          this.marble.staticFriction = num;
          break;
        case "brakingacceleration":
          this.marble.brakingAcceleration = num;
          break;
        case "gravity":
          this.marble.gravity = num;
          break;
        case "airaccel":
          this.marble.airAccel = num;
          break;
        case "bouncerestitution":
          this.marble.bounceRestitution = num;
          break;
        default:
          break;
      }
    }

    // Sun
    const sun = elements.find((e) => e.type === "Sun");
    if (sun !== undefined) {
      const dir = parseVector3(fieldOf(sun, "direction"));
      this.sunDirection = dir;
      const colorParts = (fieldOf(sun, "color") ?? "1 1 1 1").split(" ").map(parseFloat);
      const ambientParts = (fieldOf(sun, "ambient") ?? "0.4 0.4 0.5 1").split(" ").map(parseFloat);
      this.sunColor = new THREE.Color(colorParts[0] ?? 1, colorParts[1] ?? 1, colorParts[2] ?? 1);
      this.ambientColor = new THREE.Color(ambientParts[0] ?? 0.4, ambientParts[1] ?? 0.4, ambientParts[2] ?? 0.5);
    }

    // Interiors
    for (const el of elements) {
      if (el.type !== "InteriorInstance") continue;
      let interiorFile = fieldOf(el, "interiorfile") ?? "";
      interiorFile = interiorFile.replace(/^~\//, "").replace(/^\.\//, "");
      if (!interiorFile.startsWith("data/")) interiorFile = `data/${interiorFile}`;
      if (!this.index.exists(interiorFile)) {
        console.warn(`Missing interior: ${interiorFile}`);
        continue;
      }
      const position = parseVector3(fieldOf(el, "position"));
      const rotation = parseRotation(fieldOf(el, "rotation"));
      const scale = parseVector3(fieldOf(el, "scale"));
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x, position.y, position.z),
        new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
        new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1),
      );

      const buffer = await this.index.loadArrayBuffer(interiorFile);
      const dif = parseDif(buffer);
      const built = await buildInterior(dif, interiorFile, this.index, matrix, this.enhancer);
      this.scene.add(built.group);
      this.collisionWorld.addEntity(built.collider);
      this.worldMinZ = Math.min(this.worldMinZ, built.collider.boundingBox.zMin);
    }

    // Static shapes and items
    for (const el of elements) {
      if (el.type !== "StaticShape" && el.type !== "Item") continue;
      const dataBlock = fieldOf(el, "datablock") ?? "";

      const position = parseVector3(fieldOf(el, "position"));
      const rotation = parseRotation(fieldOf(el, "rotation"));
      const scale = parseVector3(fieldOf(el, "scale"));
      const quat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);

      let timeBonus: number | null = null;
      const tb = fieldOf(el, "timebonus");
      const tp = fieldOf(el, "timepenalty");
      if (tb !== null) timeBonus = parseNumber(tb) / 1000;
      else if (tp !== null) timeBonus = -parseNumber(tp) / 1000;

      await this.spawnShape(dataBlock, el.name, position, quat, scale, {
        rotate: el.type === "Item" && parseBoolean(fieldOf(el, "rotate")),
        timeBonus,
        element: el,
      });
    }

    this.finalizeShapeColliders();

    // Triggers
    for (const el of elements) {
      if (el.type !== "Trigger") continue;
      const dataBlock = (fieldOf(el, "datablock") ?? "").toLowerCase();
      let kind: TriggerInstance["kind"];
      if (dataBlock === "inboundstrigger") kind = "inBounds";
      else if (dataBlock === "outofboundstrigger") kind = "outOfBounds";
      else if (dataBlock === "helptrigger") kind = "help";
      else continue;

      const position = parseVector3(fieldOf(el, "position"));
      const rotation = parseRotation(fieldOf(el, "rotation"));
      const scale = parseVector3(fieldOf(el, "scale"));
      const polyhedron = (fieldOf(el, "polyhedron") ?? "0 0 0 1 0 0 0 -1 0 0 0 1")
        .split(" ")
        .map(parseFloat)
        .filter((x) => Number.isFinite(x));
      if (polyhedron.length < 12) continue;

      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(position.x, position.y, position.z),
        new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
        new THREE.Vector3(scale.x || 1, scale.y || 1, scale.z || 1),
      );

      // polyhedron = origin + 3 edge vectors; take the AABB of its 8 corners
      const origin = new THREE.Vector3(polyhedron[0]!, polyhedron[1]!, polyhedron[2]!);
      const v1 = new THREE.Vector3(polyhedron[3]!, polyhedron[4]!, polyhedron[5]!);
      const v2 = new THREE.Vector3(polyhedron[6]!, polyhedron[7]!, polyhedron[8]!);
      const v3 = new THREE.Vector3(polyhedron[9]!, polyhedron[10]!, polyhedron[11]!);
      const bounds = new THREE.Box3();
      for (let corner = 0; corner < 8; corner++) {
        const p = origin.clone();
        if ((corner & 1) !== 0) p.add(v1);
        if ((corner & 2) !== 0) p.add(v2);
        if ((corner & 4) !== 0) p.add(v3);
        bounds.expandByPoint(p.applyMatrix4(matrix));
      }

      this.triggers.push({ kind, bounds, text: fieldOf(el, "text") ?? "", marbleInside: false });
    }

    if (this.lastStartPad !== null) {
      this.spawnPosition = new Vec3(this.lastStartPad.position.x, this.lastStartPad.position.y, this.lastStartPad.position.z + 3);
      this.spawnYaw = this.lastStartPad.yaw + Math.PI / 2;
    }

    this.hud.setGems(this.gemCount, this.totalGems);
  }

  // Load a custom (editor-built) level: block geometry + placed shapes.
  async loadCustom(data: CustomLevelData): Promise<void> {
    this.missionTitle = data.name;
    this.startHelpText = null;

    // Group render geometry by surface; one collision surface per block so
    // the per-entity grid stays effective.
    const bySurface = new Map<string, BlockArrays>();
    const blockEntity = new CollisionEntity();
    for (const block of data.blocks) {
      const surface = surfaceById(block.surface);
      let arrays = bySurface.get(surface.id);
      if (arrays === undefined) {
        arrays = { positions: [], normals: [], uvs: [] };
        bySurface.set(surface.id, arrays);
      }
      const collisionSurface = new CollisionSurface();
      collisionSurface.friction = surface.friction;
      collisionSurface.restitution = surface.restitution;
      collisionSurface.force = surface.force;
      emitBlock(block, surface, arrays, collisionSurface);
      if (collisionSurface.points.length > 0) {
        collisionSurface.generateBoundingBox();
        blockEntity.addSurface(collisionSurface);
      }
    }

    for (const [surfaceId, arrays] of bySurface) {
      if (arrays.positions.length === 0) continue;
      const surface = surfaceById(surfaceId);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arrays.positions), 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(arrays.normals), 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(arrays.uvs), 2));

      let texture: THREE.Texture | null = null;
      const url = this.index.resolve(surface.texture);
      if (url !== null) {
        texture = this.textureLoader.load(url);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
      }
      const material =
        this.enhancer !== undefined
          ? this.enhancer.createMaterial(surface.texture.substring(surface.texture.lastIndexOf("/") + 1), texture)
          : new THREE.MeshPhongMaterial({ map: texture, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    if (blockEntity.surfaces.length > 0) {
      blockEntity.finalize();
      this.collisionWorld.addEntity(blockEntity);
      this.worldMinZ = Math.min(this.worldMinZ, blockEntity.boundingBox.zMin);
    }

    // Items
    for (const item of data.items) {
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (item.rot * Math.PI) / 2);
      await this.spawnShape(item.datablock, "", new Vec3(item.x, item.y, item.z), quat, new Vec3(1, 1, 1), {
        rotate: item.datablock.toLowerCase() !== "startpad" && item.datablock.toLowerCase() !== "endpad" && !item.datablock.toLowerCase().startsWith("sign"),
      });
    }
    this.finalizeShapeColliders();

    if (this.lastStartPad !== null) {
      this.spawnPosition = new Vec3(this.lastStartPad.position.x, this.lastStartPad.position.y, this.lastStartPad.position.z + 3);
      this.spawnYaw = this.lastStartPad.yaw + Math.PI / 2;
    }

    this.hud.setGems(this.gemCount, this.totalGems);
  }

  restart(): void {
    this.timeState.currentAttemptTime = 0;
    this.gameplayClock = 0;
    this.bonusTime = 0;
    this.finishTime = null;
    this.outOfBounds = false;
    this.inFinishArea = false;
    this.gemCount = 0;
    this.heldPowerup = null;
    this.hud.setPowerup(null);
    this.hud.setGems(this.gemCount, this.totalGems);

    for (const shape of this.shapes) {
      shape.pickedUp = false;
      shape.hiddenUntil = 0;
      shape.group.visible = true;
    }
    for (const trigger of this.triggers) trigger.marbleInside = false;

    this.marble.position.load(this.spawnPosition);
    this.marble.velocity.set(0, 0, 0);
    this.marble.omega.set(0, 0, 0);
    this.marble.mode = "start";

    this.cameraController.cameraYaw = this.spawnYaw;
    this.cameraController.nextCameraYaw = this.spawnYaw;
    this.cameraController.cameraPitch = 0.45;
    this.cameraController.nextCameraPitch = 0.45;

    if (this.startHelpText !== null && this.startHelpText !== "") this.hud.displayHelp(this.startHelpText);
  }

  private usePowerup(): void {
    const powerup = this.heldPowerup;
    if (powerup === null) return;
    switch (powerup.def.kind) {
      case "superJump":
        this.marble.velocity.load(this.marble.velocity.add(this.marble.currentUp.multiply(20)));
        break;
      case "superSpeed": {
        const [sideDir] = this.marble.getMarbleAxis();
        const boostVec = sideDir.clone();
        const contactDot = sideDir.dot(this.marble.lastContactNormal);
        boostVec.load(boostVec.sub(this.marble.lastContactNormal.multiply(contactDot)));
        if (boostVec.lengthSq() > 0.01) boostVec.normalize();
        else boostVec.load(sideDir);
        this.marble.velocity.load(this.marble.velocity.add(boostVec.multiply(-25)));
        break;
      }
      default:
        // shockAbsorber/superBounce/helicopter effects arrive with the
        // powerup-state slice
        break;
    }
    this.heldPowerup = null;
    this.hud.setPowerup(null);
  }

  private checkPickups(): void {
    const marblePos = this.marble.position;
    const expansion = this.marble.radius + 0.2;
    for (const shape of this.shapes) {
      const kind = shape.def.kind;
      if (kind !== "gem" && kind !== "superJump" && kind !== "superSpeed" && kind !== "shockAbsorber" && kind !== "superBounce" && kind !== "helicopter" && kind !== "timeTravel" && kind !== "antiGravity") {
        continue;
      }
      if (shape.pickedUp) continue;
      const b = shape.worldBounds;
      if (
        marblePos.x > b.min.x - expansion &&
        marblePos.x < b.max.x + expansion &&
        marblePos.y > b.min.y - expansion &&
        marblePos.y < b.max.y + expansion &&
        marblePos.z > b.min.z - expansion &&
        marblePos.z < b.max.z + expansion
      ) {
        this.pickUp(shape);
      }
    }
  }

  private pickUp(shape: ShapeInstance): void {
    const kind = shape.def.kind;
    if (kind === "gem") {
      shape.pickedUp = true;
      shape.group.visible = false;
      this.gemCount++;
      this.hud.setGems(this.gemCount, this.totalGems);
      if (this.gemCount === this.totalGems) this.hud.displayAlert("You have all the gems, head for the finish!");
      else this.hud.displayAlert("You picked up a gem!");
      return;
    }
    if (kind === "timeTravel") {
      shape.pickedUp = true;
      shape.group.visible = false;
      this.bonusTime += shape.timeBonus;
      this.hud.displayHelp(`You got a ${shape.timeBonus} second Time Travel bonus!`);
      return;
    }
    // held powerups
    if (this.heldPowerup !== null && this.heldPowerup.def.kind === kind) return;
    shape.pickedUp = true;
    shape.group.visible = false;
    shape.hiddenUntil = this.timeState.timeSinceLoad + POWERUP_RESPAWN_TIME;
    this.heldPowerup = shape;
    this.hud.setPowerup(shape.pickUpName);
    this.hud.displayHelp(`You picked up a ${shape.pickUpName}!`);
  }

  private checkTriggers(): void {
    const marblePos = this.marble.position;
    const r = this.marble.radius;
    for (const trigger of this.triggers) {
      const b = trigger.bounds;
      const inside =
        marblePos.x + r > b.min.x &&
        marblePos.x - r < b.max.x &&
        marblePos.y + r > b.min.y &&
        marblePos.y - r < b.max.y &&
        marblePos.z + r > b.min.z &&
        marblePos.z - r < b.max.z;

      if (trigger.kind === "inBounds") {
        if (trigger.marbleInside && !inside) this.goOutOfBounds();
      } else if (trigger.kind === "outOfBounds") {
        if (inside) this.goOutOfBounds();
      } else if (trigger.kind === "help") {
        if (inside && !trigger.marbleInside && trigger.text !== "") this.hud.displayHelp(trigger.text);
      }
      trigger.marbleInside = inside;
    }
  }

  private goOutOfBounds(): void {
    if (this.outOfBounds || this.finishTime !== null) return;
    this.outOfBounds = true;
    this.oobStartTime = this.timeState.currentAttemptTime;
    this.hud.setCenterText("outofbounds");
  }

  private checkFinish(): void {
    if (this.endPadPosition === null || this.finishTime !== null) return;
    if (this.outOfBounds) return;
    const rel = this.marble.position.sub(this.endPadPosition);
    const height = rel.dot(this.endPadUp);
    const radial = rel.sub(this.endPadUp.multiply(height)).length();
    const inFinish = height >= 0 && height <= 4.8 && radial <= this.endPadRadius;
    if (inFinish && !this.inFinishArea) {
      this.touchFinish();
    }
    this.inFinishArea = inFinish;
  }

  private touchFinish(): void {
    if (this.finishTime !== null) return;
    if (this.gemCount < this.totalGems) {
      this.hud.displayAlert("You can't finish without all the gems!!");
      return;
    }
    this.finishTime = this.gameplayClock;
    this.marble.mode = "finish";
    this.hud.displayAlert(`Congratulations! You've finished in ${formatTime(this.finishTime)}!`);
  }

  update(dt: number, move: Move, restartRequested: boolean): void {
    this.timeState.dt = dt;
    this.timeState.timeSinceLoad += dt;
    this.timeState.currentAttemptTime += dt;

    if (restartRequested) {
      this.restart();
      return;
    }

    const t = this.timeState.currentAttemptTime;

    // Attempt state machine (MarbleWorld.updateGameState)
    if (!this.outOfBounds) {
      if (this.finishTime === null) {
        if (t < READY_TIME) {
          this.hud.setCenterText("none");
          this.marble.mode = "start";
        } else if (t < SET_TIME) {
          this.hud.setCenterText("ready");
          this.marble.mode = "start";
        } else if (t < GO_TIME) {
          this.hud.setCenterText("set");
          this.marble.mode = "start";
        } else if (t < CLEAR_TEXT_TIME) {
          this.hud.setCenterText("go");
          this.marble.mode = "play";
        } else {
          this.hud.setCenterText("none");
          this.marble.mode = "play";
        }
      }
    } else {
      // OOB: use-key respawns immediately, otherwise auto after 2.5s
      if (move.powerup || t - this.oobStartTime >= 2.5) {
        this.restart();
        return;
      }
    }

    // Gameplay clock (MarbleWorld.updateTimer)
    if (this.finishTime === null && t >= GO_TIME) {
      if (this.bonusTime > 0) {
        this.bonusTime -= dt;
        if (this.bonusTime < 0) {
          this.gameplayClock += -this.bonusTime;
          this.bonusTime = 0;
        }
      } else {
        this.gameplayClock += dt;
      }
    }

    if (move.powerup && !this.outOfBounds && this.finishTime === null) this.usePowerup();

    this.marble.update(this.timeState, move);

    // Fallback OOB: fell off the world
    if (Number.isFinite(this.worldMinZ) && this.marble.position.z < this.worldMinZ - 30) this.goOutOfBounds();

    if (this.finishTime === null && !this.outOfBounds && this.marble.mode === "play") {
      this.checkPickups();
      this.checkTriggers();
    }
    this.checkFinish();

    // Powerup respawns + item spin
    for (const shape of this.shapes) {
      if (shape.pickedUp && shape.hiddenUntil !== 0 && this.timeState.timeSinceLoad >= shape.hiddenUntil) {
        shape.pickedUp = false;
        shape.hiddenUntil = 0;
        shape.group.visible = true;
      }
      if (shape.rotate && shape.group.visible) {
        shape.group.rotation.z = (this.timeState.timeSinceLoad * 2 * Math.PI) / 3;
      }
    }

    this.hud.setTimer(this.finishTime ?? this.gameplayClock);

    // Camera: frozen while OOB (matches camera.oob behavior)
    if (!this.outOfBounds) {
      this.cameraController.update(dt, this.marble.position, this.marble.radius, this.marble.currentUp);
    }
  }
}

export function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds * 100) % 100);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}
