// The custom level editor: fly camera, cursor-ray placement of textured
// blocks/ramps and game shapes, hover-delete, save/export, and test-play
// handoff. Runs as its own mode instead of the game loop.
import * as THREE from "three";
import { ResourceIndex } from "../assets/resourceIndex";
import { Graphics } from "../render/graphics";
import { parseDts } from "../torque/dts";
import { buildDtsShape } from "../render/dtsMesh";
import { blockPreviewGeometry } from "../render/blockGeometry";
import {
  CustomLevelData,
  LevelBlock,
  LevelItem,
  SURFACES,
  surfaceById,
  saveCustomLevel,
  exportLevelFile,
} from "./customLevel";

interface BlockSizeDef {
  label: string;
  sx: number;
  sy: number;
  sz: number;
}

const BLOCK_SIZES: BlockSizeDef[] = [
  { label: "Platform 4×4", sx: 4, sy: 4, sz: 1 },
  { label: "Platform 8×8", sx: 8, sy: 8, sz: 1 },
  { label: "Small 2×2", sx: 2, sy: 2, sz: 1 },
  { label: "Cube 2×2×2", sx: 2, sy: 2, sz: 2 },
  { label: "Wall 4×0.5×2", sx: 4, sy: 0.5, sz: 2 },
  { label: "Beam 8×1×0.5", sx: 8, sy: 1, sz: 0.5 },
];

const ITEMS: { datablock: string; label: string }[] = [
  { datablock: "StartPad", label: "Start Pad" },
  { datablock: "EndPad", label: "End Pad" },
  { datablock: "GemItem", label: "Gem" },
  { datablock: "SuperJumpItem", label: "Super Jump" },
  { datablock: "SuperSpeedItem", label: "Super Speed" },
  { datablock: "TimeTravelItem", label: "Time Travel" },
  { datablock: "SignFinish", label: "Finish Sign" },
];

const PANEL_CSS =
  "position:absolute;top:0;right:0;bottom:0;width:240px;overflow-y:auto;z-index:15;" +
  "background:linear-gradient(180deg,rgba(70,130,190,0.95),rgba(45,95,150,0.95));" +
  "border-left:4px solid #2c5d94;padding:12px;pointer-events:auto;" +
  "font-family:'Baloo 2','Trebuchet MS',sans-serif;color:#fff;";

type Tool = { kind: "block"; shape: "box" | "ramp"; size: BlockSizeDef } | { kind: "item"; datablock: string } | { kind: "delete" };

export class Editor {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private index: ResourceIndex;
  private graphics: Graphics;
  private renderer: THREE.WebGLRenderer;

  level: CustomLevelData;

  private yaw = Math.PI / 2;
  private pitch = -0.4;
  private cameraPos = new THREE.Vector3(0, -14, 10);
  private keys = new Set<string>();
  private looking = false;
  private cursorNdc = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();

  private blocksGroup = new THREE.Group();
  private itemsGroup = new THREE.Group();
  private blockMeshes: THREE.Mesh[] = [];
  private itemGroups: THREE.Object3D[] = [];
  private groundPlane: THREE.Mesh;
  private ghost: THREE.Object3D | null = null;
  private hovered: THREE.Object3D | null = null;

  private tool: Tool = { kind: "block", shape: "box", size: BLOCK_SIZES[0]! };
  private currentSurface = SURFACES[0]!;
  private toolRot = 0;

  private panel: HTMLDivElement;
  private statusDiv: HTMLDivElement;
  private materialCache = new Map<string, THREE.MeshLambertMaterial>();
  private itemTemplateCache = new Map<string, THREE.Group>();
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    index: ResourceIndex,
    graphics: Graphics,
    level: CustomLevelData,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.index = index;
    this.graphics = graphics;
    this.level = level;

    scene.add(this.blocksGroup);
    scene.add(this.itemsGroup);

    const grid = new THREE.GridHelper(80, 80, 0x4477aa, 0x89b7dd);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const planeGeo = new THREE.PlaneGeometry(2000, 2000);
    this.groundPlane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ visible: false }));
    scene.add(this.groundPlane);

    this.panel = document.createElement("div");
    this.panel.style.cssText = PANEL_CSS;
    document.body.appendChild(this.panel);

    this.statusDiv = document.createElement("div");
    this.statusDiv.style.cssText =
      "position:absolute;left:10px;bottom:10px;color:#fff;font:600 14px 'Baloo 2',sans-serif;" +
      "-webkit-text-stroke:3px rgba(20,20,30,0.8);paint-order:stroke fill;pointer-events:none;z-index:15;";
    this.statusDiv.textContent =
      "LMB place · hover + X delete · RMB-drag look · WASD move · Q/E down/up · R rotate · Shift fast";
    document.body.appendChild(this.statusDiv);

    this.buildPanel();
    this.rebuildFromLevel();
    this.attachEvents();
  }

  // ---------- content ----------

  private blockMaterial(surfaceId: string): THREE.MeshLambertMaterial {
    let mat = this.materialCache.get(surfaceId);
    if (mat === undefined) {
      const surface = surfaceById(surfaceId);
      mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      const url = this.index.resolve(surface.texture);
      if (url !== null) {
        const tex = new THREE.TextureLoader().load(url);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        mat.map = tex;
      }
      this.materialCache.set(surfaceId, mat);
    }
    return mat;
  }

  private async itemTemplate(datablock: string): Promise<THREE.Group | null> {
    const cached = this.itemTemplateCache.get(datablock);
    if (cached !== undefined) return cached;
    const dtsPath = ITEM_DTS_PATHS[datablock];
    if (dtsPath === undefined) return null;
    try {
      const buffer = await this.index.loadArrayBuffer(dtsPath);
      const shape = parseDts(buffer);
      const built = buildDtsShape(shape, dtsPath, this.index, new THREE.TextureLoader(), {});
      this.itemTemplateCache.set(datablock, built.group);
      return built.group;
    } catch {
      return null;
    }
  }

  private addBlockMesh(block: LevelBlock): void {
    const geometry = blockPreviewGeometry(block);
    const mesh = new THREE.Mesh(geometry, this.blockMaterial(block.surface));
    mesh.userData.block = block;
    this.blocksGroup.add(mesh);
    this.blockMeshes.push(mesh);
  }

  private async addItemVisual(item: LevelItem): Promise<void> {
    const template = await this.itemTemplate(item.datablock);
    let obj: THREE.Object3D;
    if (template !== null) {
      obj = template.clone(true);
    } else {
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: 0xff00ff }));
    }
    obj.position.set(item.x, item.y, item.z);
    obj.rotation.z = (item.rot * Math.PI) / 2;
    obj.userData.item = item;
    this.itemsGroup.add(obj);
    this.itemGroups.push(obj);
  }

  private rebuildFromLevel(): void {
    for (const mesh of this.blockMeshes) mesh.removeFromParent();
    for (const obj of this.itemGroups) obj.removeFromParent();
    this.blockMeshes = [];
    this.itemGroups = [];
    for (const block of this.level.blocks) this.addBlockMesh(block);
    for (const item of this.level.items) void this.addItemVisual(item);
  }

  // ---------- UI panel ----------

  private buildPanel(): void {
    const section = (label: string): HTMLDivElement => {
      const div = document.createElement("div");
      div.textContent = label;
      div.style.cssText = "font-weight:800;font-size:16px;margin:10px 0 4px;color:#ffe37a;";
      this.panel.appendChild(div);
      return div;
    };
    const chip = (label: string, selected: boolean, onClick: () => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.dataset.chip = "1";
      btn.style.cssText =
        `display:block;width:100%;margin:3px 0;padding:5px 10px;cursor:pointer;text-align:left;` +
        `border-radius:9px;border:2px solid ${selected ? "#ffe37a" : "#2c5d94"};` +
        `background:${selected ? "rgba(255,227,122,0.35)" : "rgba(255,255,255,0.15)"};` +
        `font:600 14px 'Baloo 2',sans-serif;color:#fff;`;
      btn.onclick = () => {
        onClick();
        this.buildPanel();
      };
      return btn;
    };

    this.panel.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = `Editing: ${this.level.name}`;
    title.style.cssText = "font-weight:800;font-size:18px;margin-bottom:4px;";
    this.panel.appendChild(title);

    section("Blocks");
    for (const size of BLOCK_SIZES) {
      const selected = this.tool.kind === "block" && this.tool.shape === "box" && this.tool.size === size;
      this.panel.appendChild(chip(size.label, selected, () => (this.tool = { kind: "block", shape: "box", size })));
    }
    const rampSelected = this.tool.kind === "block" && this.tool.shape === "ramp";
    this.panel.appendChild(
      chip("Ramp 4×4×2", rampSelected, () => (this.tool = { kind: "block", shape: "ramp", size: { label: "Ramp", sx: 4, sy: 4, sz: 2 } })),
    );

    section("Surface");
    const swatchWrap = document.createElement("div");
    swatchWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;";
    for (const surface of SURFACES) {
      const swatch = document.createElement("div");
      const url = this.index.resolve(surface.texture);
      const selected = surface.id === this.currentSurface.id;
      swatch.title = surface.label;
      swatch.style.cssText =
        `height:34px;border-radius:8px;cursor:pointer;background:#557 center/cover;` +
        `border:3px solid ${selected ? "#ffe37a" : "#2c5d94"};` +
        (url !== null ? `background-image:url("${url}");` : "");
      swatch.onclick = () => {
        this.currentSurface = surface;
        this.buildPanel();
      };
      swatchWrap.appendChild(swatch);
    }
    this.panel.appendChild(swatchWrap);
    const surfLabel = document.createElement("div");
    surfLabel.textContent = this.currentSurface.label;
    surfLabel.style.cssText = "font:600 13px 'Baloo 2',sans-serif;color:#dceeff;margin-top:3px;text-align:center;";
    this.panel.appendChild(surfLabel);

    section("Items");
    for (const item of ITEMS) {
      const selected = this.tool.kind === "item" && this.tool.datablock === item.datablock;
      this.panel.appendChild(chip(item.label, selected, () => (this.tool = { kind: "item", datablock: item.datablock })));
    }

    section("Level");
    const action = (label: string, onClick: () => void): void => {
      const btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText =
        "display:block;width:100%;margin:4px 0;padding:8px 10px;cursor:pointer;border-radius:999px;" +
        "border:3px solid #a06a12;background:linear-gradient(180deg,#fff3b0,#f5bd2e);" +
        "font:800 16px 'Baloo 2',sans-serif;color:#5b3a06;";
      btn.onclick = onClick;
      this.panel.appendChild(btn);
    };
    action("▶ Play Test", () => {
      this.save();
      const params = new URLSearchParams(window.location.search);
      params.delete("edit");
      params.delete("mis");
      params.set("custom", this.level.name);
      window.location.search = params.toString();
    });
    action("Save", () => {
      this.save();
      this.statusFlash("Saved!");
    });
    action("Export JSON", () => exportLevelFile(this.level));
    action("Exit to Home", () => {
      this.save();
      const params = new URLSearchParams(window.location.search);
      params.delete("edit");
      params.delete("custom");
      window.location.search = params.toString();
    });

    const counts = document.createElement("div");
    counts.textContent = `${this.level.blocks.length} blocks · ${this.level.items.length} items`;
    counts.style.cssText = "font:600 13px 'Baloo 2',sans-serif;color:#dceeff;margin-top:6px;text-align:center;";
    this.panel.appendChild(counts);
  }

  private statusFlash(text: string): void {
    const prev = this.statusDiv.textContent;
    this.statusDiv.textContent = text;
    setTimeout(() => (this.statusDiv.textContent = prev), 1200);
  }

  save(): void {
    saveCustomLevel(this.level);
  }

  // ---------- input ----------

  private attachEvents(): void {
    const canvas = this.renderer.domElement;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose(): void {
    this.disposed = true;
    const canvas = this.renderer.domElement;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.panel.remove();
    this.statusDiv.remove();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "KeyR" && !e.repeat) {
      this.toolRot = (this.toolRot + 1) % 4;
    }
    if ((e.code === "KeyX" || e.code === "Delete") && this.hovered !== null) {
      this.deleteObject(this.hovered);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) {
      this.looking = true;
    } else if (e.button === 0) {
      this.placeAtCursor();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.looking = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.looking) {
      this.yaw -= e.movementX * 0.004;
      this.pitch -= e.movementY * 0.004;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.cursorNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  };

  private onContextMenu = (e: Event): void => e.preventDefault();

  // ---------- placement ----------

  private cursorHit(): { point: THREE.Vector3; object: THREE.Object3D | null } | null {
    this.raycaster.setFromCamera(this.cursorNdc, this.camera);
    const targets: THREE.Object3D[] = [...this.blockMeshes, ...this.itemGroups, this.groundPlane];
    const hits = this.raycaster.intersectObjects(targets, true);
    const hit = hits[0];
    if (hit === undefined) return null;
    let obj: THREE.Object3D | null = hit.object;
    while (obj !== null && obj.userData.block === undefined && obj.userData.item === undefined && obj !== this.groundPlane) {
      obj = obj.parent;
    }
    return { point: hit.point, object: obj === this.groundPlane ? null : obj };
  }

  private snap(v: number): number {
    return Math.round(v * 2) / 2;
  }

  private ghostBlock(): LevelBlock | null {
    const hit = this.cursorHit();
    if (hit === null) return null;
    if (this.tool.kind !== "block") return null;
    return {
      shape: this.tool.shape,
      x: this.snap(hit.point.x),
      y: this.snap(hit.point.y),
      z: this.snap(Math.max(0, hit.point.z)),
      sx: this.tool.size.sx,
      sy: this.tool.size.sy,
      sz: this.tool.size.sz,
      rot: this.toolRot,
      surface: this.currentSurface.id,
    };
  }

  private placeAtCursor(): void {
    if (this.tool.kind === "delete") {
      if (this.hovered !== null) this.deleteObject(this.hovered);
      return;
    }
    const hit = this.cursorHit();
    if (hit === null) return;

    if (this.tool.kind === "block") {
      const block = this.ghostBlock();
      if (block === null) return;
      this.level.blocks.push(block);
      this.addBlockMesh(block);
      this.buildPanel();
    } else {
      const item: LevelItem = {
        datablock: this.tool.datablock,
        x: this.snap(hit.point.x),
        y: this.snap(hit.point.y),
        z: this.snap(hit.point.z),
        rot: this.toolRot,
      };
      this.level.items.push(item);
      void this.addItemVisual(item);
      this.buildPanel();
    }
  }

  private clearHover(): void {
    this.hoverOutline?.removeFromParent();
    this.hoverOutline = null;
    this.hovered = null;
  }

  private deleteObject(obj: THREE.Object3D): void {
    const block = obj.userData.block as LevelBlock | undefined;
    const item = obj.userData.item as LevelItem | undefined;
    if (block !== undefined) {
      this.level.blocks = this.level.blocks.filter((b) => b !== block);
      this.blockMeshes = this.blockMeshes.filter((m) => m !== obj);
      obj.removeFromParent();
    }
    if (item !== undefined) {
      this.level.items = this.level.items.filter((i) => i !== item);
      this.itemGroups = this.itemGroups.filter((g) => g !== obj);
      obj.removeFromParent();
    }
    this.clearHover();
    this.buildPanel();
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    if (this.disposed) return;

    // Fly camera
    const speed = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 24 : 9) * dt;
    const forward = new THREE.Vector3(Math.cos(this.pitch) * Math.cos(this.yaw), Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch));
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 0, 1)).normalize();
    if (this.keys.has("KeyW")) this.cameraPos.addScaledVector(forward, speed);
    if (this.keys.has("KeyS")) this.cameraPos.addScaledVector(forward, -speed);
    if (this.keys.has("KeyD")) this.cameraPos.addScaledVector(right, speed);
    if (this.keys.has("KeyA")) this.cameraPos.addScaledVector(right, -speed);
    if (this.keys.has("KeyE")) this.cameraPos.z += speed;
    if (this.keys.has("KeyQ")) this.cameraPos.z -= speed;

    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(this.cameraPos);
    this.camera.lookAt(this.cameraPos.clone().add(forward));

    // Hover highlight (wireframe outline; materials are shared across blocks)
    const hit = this.cursorHit();
    const newHovered = hit?.object ?? null;
    if (newHovered !== this.hovered) {
      this.hovered = newHovered;
      this.hoverOutline?.removeFromParent();
      this.hoverOutline = null;
      if (this.hovered !== null) {
        this.hoverOutline = new THREE.BoxHelper(this.hovered, 0xffcc33);
        this.scene.add(this.hoverOutline);
      }
    } else if (this.hoverOutline !== null && this.hovered !== null) {
      this.hoverOutline.update();
    }

    // Ghost preview
    this.ghost?.removeFromParent();
    this.ghost = null;
    if (this.tool.kind === "block") {
      const block = this.ghostBlock();
      if (block !== null) {
        const mesh = new THREE.Mesh(
          blockPreviewGeometry(block),
          new THREE.MeshBasicMaterial({ color: 0x7fff9e, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        this.ghost = mesh;
        this.scene.add(mesh);
      }
    } else if (this.tool.kind === "item" && hit !== null) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.1, 24),
        new THREE.MeshBasicMaterial({ color: 0x7fff9e, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      marker.rotation.x = Math.PI / 2;
      marker.position.set(this.snap(hit.point.x), this.snap(hit.point.y), this.snap(hit.point.z) + 0.05);
      this.ghost = marker;
      this.scene.add(marker);
    }

    this.graphics.render();
  }

  private hoverOutline: THREE.BoxHelper | null = null;
}

const ITEM_DTS_PATHS: Record<string, string> = {
  StartPad: "data/shapes/pads/startarea.dts",
  EndPad: "data/shapes/pads/endarea.dts",
  GemItem: "data/shapes/items/gem.dts",
  SuperJumpItem: "data/shapes/items/superjump.dts",
  SuperSpeedItem: "data/shapes/items/superspeed.dts",
  TimeTravelItem: "data/shapes/items/timetravel.dts",
  SignFinish: "data/shapes/signs/finishlinesign.dts",
};
