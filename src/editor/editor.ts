// The custom level editor: fly camera, cursor-ray placement of textured
// blocks/ramps and game shapes, hover-delete, save/export, and test-play
// handoff. Runs as its own mode instead of the game loop.
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
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

type Tool =
  | { kind: "select" }
  | { kind: "block"; shape: "box" | "ramp"; size: BlockSizeDef }
  | { kind: "item"; datablock: string }
  | { kind: "delete" };

const GRID_STEP = 0.5;

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

    // Axis-arrows gizmo for moving selected objects, snapped to the grid
    this.transformControls = new TransformControls(camera, renderer.domElement);
    this.transformControls.setMode("translate");
    this.transformControls.setTranslationSnap(GRID_STEP);
    this.transformControls.setSize(0.85);
    const tcAny = this.transformControls as unknown as { getHelper?: () => THREE.Object3D };
    scene.add(tcAny.getHelper !== undefined ? tcAny.getHelper() : (this.transformControls as unknown as THREE.Object3D));
    this.transformControls.addEventListener("dragging-changed", (e: { value?: unknown }) => {
      this.tcDragging = e.value === true;
      if (!this.tcDragging) this.commitTransform();
    });

    this.panel = document.createElement("div");
    this.panel.style.cssText = PANEL_CSS;
    document.body.appendChild(this.panel);

    this.statusDiv = document.createElement("div");
    this.statusDiv.style.cssText =
      "position:absolute;left:10px;bottom:10px;color:#fff;font:600 14px 'Baloo 2',sans-serif;" +
      "-webkit-text-stroke:3px rgba(20,20,30,0.8);paint-order:stroke fill;pointer-events:none;z-index:15;";
    this.statusDiv.textContent =
      "LMB place · Alt+click or Select tool to move (drag arrows / arrow keys / PgUp-PgDn) · X delete · C copy · R rotate · RMB-drag look · WASD fly";
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

  // Editor block meshes carry origin-local geometry (rotation baked) and a
  // real mesh position, so the gizmo sits on the block and moves are cheap.
  private localBlockGeometry(block: LevelBlock): THREE.BufferGeometry {
    return blockPreviewGeometry({ ...block, x: 0, y: 0, z: 0 });
  }

  private addBlockMesh(block: LevelBlock): void {
    const mesh = new THREE.Mesh(this.localBlockGeometry(block), this.blockMaterial(block.surface));
    mesh.position.set(block.x, block.y, block.z);
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
      btn.onmouseenter = () => {
        btn.style.filter = "brightness(1.18)";
        btn.style.transform = "translateX(2px)";
      };
      btn.onmouseleave = () => {
        btn.style.filter = "";
        btn.style.transform = "";
      };
      btn.onclick = () => {
        onClick();
        this.buildPanel();
      };
      return btn;
    };

    this.panel.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = `Editing: ${this.level.name}`;
    title.style.cssText = "font-weight:800;font-size:18px;margin-bottom:2px;";
    this.panel.appendChild(title);

    const badge = document.createElement("div");
    badge.textContent = "CUSTOM SANDBOX — official levels can't be edited";
    badge.style.cssText =
      "font:600 10.5px 'Baloo 2',sans-serif;color:#0d2c4d;background:#ffe37a;border-radius:6px;" +
      "padding:2px 6px;margin-bottom:6px;display:inline-block;";
    this.panel.appendChild(badge);

    section("Tools");
    this.panel.appendChild(
      chip("🖱 Select / Move", this.tool.kind === "select", () => (this.tool = { kind: "select" })),
    );

    // Selection details: axis steppers for precise grid movement
    const { block: selBlock, item: selItem } = this.selectedData();
    if (selBlock !== null || selItem !== null) {
      const box = document.createElement("div");
      box.style.cssText =
        "margin:6px 0;padding:8px;border-radius:10px;background:rgba(20,50,90,0.45);border:2px solid #33ff77;";
      const what = document.createElement("div");
      what.textContent =
        selBlock !== null
          ? `${selBlock.shape === "ramp" ? "Ramp" : "Block"} ${selBlock.sx}×${selBlock.sy}×${selBlock.sz} · ${surfaceById(selBlock.surface).label}`
          : (selItem?.datablock ?? "");
      what.style.cssText = "font:800 13px 'Baloo 2',sans-serif;color:#7dffab;margin-bottom:4px;";
      box.appendChild(what);

      const pos = selBlock ?? selItem!;
      const axisRow = (label: string, value: number, dx: number, dy: number, dz: number): HTMLDivElement => {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:5px;margin:3px 0;";
        const lab = document.createElement("div");
        lab.textContent = label;
        lab.style.cssText = "width:16px;font:800 14px 'Baloo 2',sans-serif;color:#ffe37a;";
        const minus = document.createElement("button");
        minus.textContent = "−";
        const plus = document.createElement("button");
        plus.textContent = "+";
        for (const b of [minus, plus]) {
          b.style.cssText =
            "width:30px;height:26px;cursor:pointer;border-radius:7px;border:2px solid #2c5d94;" +
            "background:rgba(255,255,255,0.25);color:#fff;font:800 15px 'Baloo 2',sans-serif;";
          b.onmouseenter = () => (b.style.background = "rgba(255,227,122,0.55)");
          b.onmouseleave = () => (b.style.background = "rgba(255,255,255,0.25)");
        }
        const val = document.createElement("div");
        val.textContent = value.toFixed(1);
        val.style.cssText = "flex:1;text-align:center;font:600 14px 'Baloo 2',sans-serif;color:#fff;";
        minus.onclick = () => this.moveSelected(-dx, -dy, -dz);
        plus.onclick = () => this.moveSelected(dx, dy, dz);
        row.append(lab, minus, val, plus);
        return row;
      };
      box.appendChild(axisRow("X", pos.x, GRID_STEP, 0, 0));
      box.appendChild(axisRow("Y", pos.y, 0, GRID_STEP, 0));
      box.appendChild(axisRow("Z", pos.z, 0, 0, GRID_STEP));

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:5px;margin-top:5px;";
      const mkBtn = (label: string, onClick: () => void): HTMLButtonElement => {
        const b = document.createElement("button");
        b.textContent = label;
        b.style.cssText =
          "flex:1;padding:5px;cursor:pointer;border-radius:8px;border:2px solid #2c5d94;" +
          "background:rgba(255,255,255,0.25);color:#fff;font:700 13px 'Baloo 2',sans-serif;";
        b.onmouseenter = () => (b.style.background = "rgba(255,227,122,0.55)");
        b.onmouseleave = () => (b.style.background = "rgba(255,255,255,0.25)");
        b.onclick = onClick;
        return b;
      };
      btnRow.appendChild(mkBtn("⟳ Rotate", () => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }))));
      btnRow.appendChild(mkBtn("⧉ Copy", () => this.duplicateSelected()));
      btnRow.appendChild(mkBtn("🗑 Delete", () => this.selected !== null && this.deleteObject(this.selected)));
      box.appendChild(btnRow);
      this.panel.appendChild(box);
    }

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
      swatch.onmouseenter = () => {
        swatch.style.transform = "scale(1.08)";
        swatch.style.boxShadow = "0 0 8px rgba(255,227,122,0.9)";
        surfLabel.textContent = surface.label;
      };
      swatch.onmouseleave = () => {
        swatch.style.transform = "";
        swatch.style.boxShadow = "";
        surfLabel.textContent = this.currentSurface.label;
      };
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
      // R also rotates the selected object
      const { block, item } = this.selectedData();
      if (block !== null) {
        block.rot = (block.rot + 1) % 4;
        const mesh = this.selected as THREE.Mesh;
        mesh.geometry.dispose();
        mesh.geometry = this.localBlockGeometry(block);
        this.selectedOutline?.update();
      } else if (item !== null && this.selected !== null) {
        item.rot = (item.rot + 1) % 4;
        this.selected.rotation.z = (item.rot * Math.PI) / 2;
      }
    }
    if (e.code === "KeyX" || e.code === "Delete") {
      if (this.selected !== null) this.deleteObject(this.selected);
      else if (this.hovered !== null) this.deleteObject(this.hovered);
    }
    if (e.code === "Escape") {
      if (this.selected !== null) this.select(null);
      else {
        this.tool = { kind: "select" };
        this.buildPanel();
      }
    }
    if (e.code === "KeyC" && !e.repeat && this.selected !== null) this.duplicateSelected();

    // Arrow keys nudge the selection on the grid; PageUp/Down for height
    if (this.selected !== null) {
      const step = GRID_STEP;
      if (e.code === "ArrowLeft") {
        this.moveSelected(-step, 0, 0);
        e.preventDefault();
      } else if (e.code === "ArrowRight") {
        this.moveSelected(step, 0, 0);
        e.preventDefault();
      } else if (e.code === "ArrowUp") {
        this.moveSelected(0, step, 0);
        e.preventDefault();
      } else if (e.code === "ArrowDown") {
        this.moveSelected(0, -step, 0);
        e.preventDefault();
      } else if (e.code === "PageUp") {
        this.moveSelected(0, 0, step);
        e.preventDefault();
      } else if (e.code === "PageDown") {
        this.moveSelected(0, 0, -step);
        e.preventDefault();
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private updateCursor(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.cursorNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 2) {
      this.looking = true;
      return;
    }
    if (e.button !== 0) return;
    this.updateCursor(e);

    // Resize handles take priority when the cursor is over one
    if (this.selected !== null && this.resizeHandles.length > 0) {
      this.raycaster.setFromCamera(this.cursorNdc, this.camera);
      const handleHits = this.raycaster.intersectObjects(
        this.resizeHandles.filter((h) => h.mesh.parent !== null).map((h) => h.mesh),
        false,
      );
      const first = handleHits[0];
      if (first !== undefined) {
        this.startResize(first.object.userData.resizeFace as "x+" | "x-" | "y+" | "y-" | "z+" | "z-");
        return;
      }
    }

    // Clicks on the gizmo belong to TransformControls
    if (this.tcDragging || (this.transformControls.axis !== null && this.selected !== null)) return;

    if (this.tool.kind === "select" || e.altKey) {
      const hit = this.cursorHit();
      this.select(hit?.object ?? null);
      return;
    }
    this.placeAtCursor();
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.looking = false;
    if (e.button === 0 && this.resizing !== null) {
      this.resizing = null;
      this.buildPanel();
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.looking) {
      this.yaw -= e.movementX * 0.004;
      this.pitch -= e.movementY * 0.004;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }
    this.updateCursor(e);
    if (this.resizing !== null) this.applyResize();
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
    } else if (this.tool.kind === "item") {
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
    if (this.selected === obj) this.select(null);
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

    this.updateResizeHandles();

    // While dragging the gizmo or a resize handle: skip hover/ghost
    if (this.tcDragging || this.resizing !== null) {
      if (this.tcDragging) this.setCursor("move");
      // resizing keeps the directional cursor it started with
      this.selectedOutline?.update();
      this.ghost?.removeFromParent();
      this.ghost = null;
      this.graphics.render();
      return;
    }
    if (this.looking) this.setCursor("grabbing");

    // Resize-handle hover: grow the handle and show a directional cursor
    let handleHover: { mesh: THREE.Mesh; face: string } | null = null;
    if (this.selected !== null && this.resizeHandles.length > 0 && !this.looking) {
      this.raycaster.setFromCamera(this.cursorNdc, this.camera);
      const handleHits = this.raycaster.intersectObjects(
        this.resizeHandles.filter((h) => h.mesh.parent !== null).map((h) => h.mesh),
        false,
      );
      const first = handleHits[0];
      if (first !== undefined) {
        handleHover = this.resizeHandles.find((h) => h.mesh === first.object) ?? null;
      }
    }
    this.setHandleHover(handleHover);

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

    // Cursor affordances: resize handles > gizmo > selectable > placement
    if (!this.looking) {
      if (handleHover !== null) {
        const { block } = this.selectedData();
        if (block !== null) {
          this.setCursor(this.resizeCursorFor(handleHover.mesh, this.faceWorldDir(block, handleHover.face)));
        }
      } else if (this.transformControls.axis !== null && this.selected !== null) {
        this.setCursor("move");
      } else if (this.tool.kind === "select") {
        this.setCursor(newHovered !== null ? "pointer" : "default");
      } else if (this.tool.kind === "block" || this.tool.kind === "item") {
        this.setCursor("crosshair");
      } else {
        this.setCursor("default");
      }
    }

    this.graphics.render();
  }

  private hoverOutline: THREE.BoxHelper | null = null;
  private transformControls!: TransformControls;
  private tcDragging = false;
  private selected: THREE.Object3D | null = null;
  private selectedOutline: THREE.BoxHelper | null = null;

  // ---------- drag-resize handles ----------

  // face key: which local face the handle stretches
  private resizeHandles: { mesh: THREE.Mesh; face: "x+" | "x-" | "y+" | "y-" | "z+" | "z-" }[] = [];
  private resizing: {
    face: "x+" | "x-" | "y+" | "y-" | "z+" | "z-";
    axisDir: THREE.Vector3;
    axisOrigin: THREE.Vector3;
    t0: number;
    start: LevelBlock;
  } | null = null;
  private hoveredHandle: { mesh: THREE.Mesh; face: string } | null = null;
  private activeCursor = "";

  private setCursor(cursor: string): void {
    if (cursor === this.activeCursor) return;
    this.activeCursor = cursor;
    this.renderer.domElement.style.cursor = cursor;
  }

  // Pick the directional resize cursor matching the axis direction on screen.
  private resizeCursorFor(handle: THREE.Mesh, axisDir: THREE.Vector3): string {
    const p0 = handle.position.clone().project(this.camera);
    const p1 = handle.position.clone().add(axisDir).project(this.camera);
    const dx = p1.x - p0.x;
    const dy = -(p1.y - p0.y); // screen y grows downward
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 180;
    if (angle < 22.5 || angle >= 157.5) return "ew-resize";
    if (angle < 67.5) return "nwse-resize";
    if (angle < 112.5) return "ns-resize";
    return "nesw-resize";
  }

  private setHandleHover(handle: { mesh: THREE.Mesh; face: string } | null): void {
    if (this.hoveredHandle === handle) return;
    if (this.hoveredHandle !== null) {
      this.hoveredHandle.mesh.scale.setScalar(1);
      (this.hoveredHandle.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    }
    this.hoveredHandle = handle;
    if (handle !== null) {
      handle.mesh.scale.setScalar(1.45);
      (handle.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    }
  }

  private static rotXY(x: number, y: number, rot: number): [number, number] {
    switch (((rot % 4) + 4) % 4) {
      case 1:
        return [-y, x];
      case 2:
        return [-x, -y];
      case 3:
        return [y, -x];
      default:
        return [x, y];
    }
  }

  private ensureResizeHandles(): void {
    if (this.resizeHandles.length > 0) return;
    const faces: ("x+" | "x-" | "y+" | "y-" | "z+" | "z-")[] = ["x+", "x-", "y+", "y-", "z+", "z-"];
    for (const face of faces) {
      const color = face.startsWith("x") ? 0xff5544 : face.startsWith("y") ? 0x44cc55 : 0x4488ff;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.34),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
      );
      mesh.renderOrder = 999;
      mesh.userData.resizeFace = face;
      this.resizeHandles.push({ mesh, face });
    }
  }

  // Position handles at the face centers of the selected block (world space).
  private updateResizeHandles(): void {
    const { block } = this.selectedData();
    if (block === null || this.tcDragging) {
      for (const h of this.resizeHandles) h.mesh.removeFromParent();
      return;
    }
    this.ensureResizeHandles();
    const zc = block.z + block.sz / 2;
    for (const h of this.resizeHandles) {
      let lx = 0;
      let ly = 0;
      let z = zc;
      if (h.face === "x+") lx = block.sx / 2 + 0.3;
      else if (h.face === "x-") lx = -block.sx / 2 - 0.3;
      else if (h.face === "y+") ly = block.sy / 2 + 0.3;
      else if (h.face === "y-") ly = -block.sy / 2 - 0.3;
      else if (h.face === "z+") z = block.z + block.sz + 0.3;
      else z = block.z - 0.3;
      const [wx, wy] = Editor.rotXY(lx, ly, block.rot);
      h.mesh.position.set(block.x + wx, block.y + wy, z);
      if (h.mesh.parent === null) this.scene.add(h.mesh);
    }
  }

  // world direction a face's handle drags along
  private faceWorldDir(block: LevelBlock, face: string): THREE.Vector3 {
    if (face === "z+" || face === "z-") return new THREE.Vector3(0, 0, face === "z+" ? 1 : -1);
    const local: [number, number] =
      face === "x+" ? [1, 0] : face === "x-" ? [-1, 0] : face === "y+" ? [0, 1] : [0, -1];
    const [wx, wy] = Editor.rotXY(local[0], local[1], block.rot);
    return new THREE.Vector3(wx, wy, 0);
  }

  // parameter of the closest point on line (origin + t*dir) to the cursor ray
  private axisParamAtCursor(origin: THREE.Vector3, dir: THREE.Vector3): number {
    this.raycaster.setFromCamera(this.cursorNdc, this.camera);
    const rayOrigin = this.raycaster.ray.origin;
    const rayDir = this.raycaster.ray.direction;
    const w0 = new THREE.Vector3().subVectors(origin, rayOrigin);
    const a = dir.dot(dir);
    const b = dir.dot(rayDir);
    const c = rayDir.dot(rayDir);
    const d = dir.dot(w0);
    const e = rayDir.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-6) return 0;
    return (b * e - c * d) / denom;
  }

  private startResize(face: "x+" | "x-" | "y+" | "y-" | "z+" | "z-"): void {
    const { block } = this.selectedData();
    if (block === null) return;
    const handle = this.resizeHandles.find((h) => h.face === face);
    if (handle === undefined) return;
    const axisDir = this.faceWorldDir(block, face);
    const axisOrigin = handle.mesh.position.clone();
    this.resizing = {
      face,
      axisDir,
      axisOrigin,
      t0: this.axisParamAtCursor(axisOrigin, axisDir),
      start: { ...block },
    };
  }

  private applyResize(): void {
    if (this.resizing === null || this.selected === null) return;
    const { block } = this.selectedData();
    if (block === null) return;
    const r = this.resizing;
    const t = this.axisParamAtCursor(r.axisOrigin, r.axisDir);
    // outward positive; snap growth to the grid
    let d = Math.round((t - r.t0) / GRID_STEP) * GRID_STEP;

    const face = r.face;
    const start = r.start;
    if (face === "z+") {
      block.sz = Math.max(GRID_STEP, start.sz + d);
    } else if (face === "z-") {
      d = Math.min(d, start.sz - GRID_STEP);
      block.sz = Math.max(GRID_STEP, start.sz + d);
      block.z = Math.max(0, start.z - d);
    } else {
      const dim = face.startsWith("x") ? "sx" : "sy";
      const newSize = Math.max(GRID_STEP, start[dim] + d);
      const grow = newSize - start[dim];
      block[dim] = newSize;
      // face moves outward: center shifts by half the growth along the face dir
      const local: [number, number] =
        face === "x+" ? [grow / 2, 0] : face === "x-" ? [-grow / 2, 0] : face === "y+" ? [0, grow / 2] : [0, -grow / 2];
      const [wx, wy] = Editor.rotXY(local[0], local[1], start.rot);
      block.x = start.x + wx;
      block.y = start.y + wy;
    }

    const mesh = this.selected as THREE.Mesh;
    mesh.geometry.dispose();
    mesh.geometry = this.localBlockGeometry(block);
    mesh.position.set(block.x, block.y, block.z);
    this.selectedOutline?.update();
    this.updateResizeHandles();
  }

  // ---------- selection & movement ----------

  private select(obj: THREE.Object3D | null): void {
    this.selected = obj;
    this.selectedOutline?.removeFromParent();
    this.selectedOutline = null;
    if (obj !== null) {
      this.transformControls.attach(obj);
      this.selectedOutline = new THREE.BoxHelper(obj, 0x33ff77);
      this.scene.add(this.selectedOutline);
    } else {
      this.transformControls.detach();
    }
    this.buildPanel();
  }

  private selectedData(): { block: LevelBlock | null; item: LevelItem | null } {
    return {
      block: (this.selected?.userData.block as LevelBlock | undefined) ?? null,
      item: (this.selected?.userData.item as LevelItem | undefined) ?? null,
    };
  }

  // After a gizmo drag: fold the mesh's position delta into the level data.
  private commitTransform(): void {
    if (this.selected === null) return;
    const { block, item } = this.selectedData();
    const snap = (v: number): number => Math.round(v / GRID_STEP) * GRID_STEP;
    if (block !== null) {
      block.x = snap(this.selected.position.x);
      block.y = snap(this.selected.position.y);
      block.z = snap(Math.max(0, this.selected.position.z));
      this.selected.position.set(block.x, block.y, block.z);
    } else if (item !== null) {
      item.x = snap(this.selected.position.x);
      item.y = snap(this.selected.position.y);
      item.z = snap(Math.max(0, this.selected.position.z));
      this.selected.position.set(item.x, item.y, item.z);
    }
    this.selectedOutline?.update();
    this.buildPanel();
  }

  private moveSelected(dx: number, dy: number, dz: number): void {
    if (this.selected === null) return;
    const { block, item } = this.selectedData();
    if (block !== null) {
      block.x += dx;
      block.y += dy;
      block.z = Math.max(0, block.z + dz);
      this.selected.position.set(block.x, block.y, block.z);
    } else if (item !== null) {
      item.x += dx;
      item.y += dy;
      item.z = Math.max(0, item.z + dz);
      this.selected.position.set(item.x, item.y, item.z);
    }
    this.selectedOutline?.update();
    this.buildPanel();
  }

  private duplicateSelected(): void {
    const { block, item } = this.selectedData();
    if (block !== null) {
      const copy: LevelBlock = { ...block, x: block.x + block.sx, y: block.y };
      this.level.blocks.push(copy);
      this.addBlockMesh(copy);
      this.select(this.blockMeshes[this.blockMeshes.length - 1]!);
    } else if (item !== null) {
      const copy: LevelItem = { ...item, x: item.x + 2 };
      this.level.items.push(copy);
      void this.addItemVisual(copy).then(() => {
        const obj = this.itemGroups[this.itemGroups.length - 1];
        if (obj !== undefined) this.select(obj);
      });
    }
  }
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
