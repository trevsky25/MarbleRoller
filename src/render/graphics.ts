// Tier 1 graphics enhancements: real-time shadows, ACES tone mapping,
// bloom, SSAO, and SMAA — all behind a runtime toggle so the classic
// (faithful) look stays available for A/B comparison against the reference.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Bounds } from "../math/bounds";

export type GraphicsMode = "classic" | "enhanced";

// Vertical gradient sky matching MBG's palette, drawn to a canvas.
function makeSkyCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0.0, "#2e6fd9");
  gradient.addColorStop(0.35, "#5ea0ef");
  gradient.addColorStop(0.52, "#a8d2fa");
  gradient.addColorStop(0.62, "#dcefff");
  gradient.addColorStop(0.75, "#b9d9f2");
  gradient.addColorStop(1.0, "#8fb8dd");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 512);
  return canvas;
}

export class Graphics {
  mode: GraphicsMode;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  private skyDome: THREE.Mesh | null = null;
  private classicBackground = new THREE.Color(0x66a5ff);

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    mode: GraphicsMode,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.mode = mode;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-0.57, -0.57, 0.57);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.buildSky();
    this.applyMode();
  }

  private buildSky(): void {
    const skyTexture = new THREE.CanvasTexture(makeSkyCanvas());
    skyTexture.colorSpace = THREE.SRGBColorSpace;

    // Dome that follows the camera; poles rotated onto the Z axis.
    const geometry = new THREE.SphereGeometry(900, 32, 24);
    const material = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(geometry, material);
    this.skyDome.rotation.x = Math.PI / 2;
    this.skyDome.renderOrder = -1000;
    this.skyDome.frustumCulled = false;

    // Image-based lighting for the PBR materials from the same gradient.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const equirect = new THREE.CanvasTexture(makeSkyCanvas());
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.colorSpace = THREE.SRGBColorSpace;
    this.scene.environment = pmrem.fromEquirectangular(equirect).texture;
    this.scene.environmentIntensity = 0.35;
    equirect.dispose();
    pmrem.dispose();
  }

  // Apply the mission's Sun element (direction, color, ambient).
  setSunFromMission(direction: { x: number; y: number; z: number }, color: THREE.Color, ambient: THREE.Color): void {
    this.missionSunDir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    this.sun.color.copy(color);
    this.ambient.color.copy(ambient);
    this.applyMode();
  }

  private missionSunDir: THREE.Vector3 | null = null;

  // Fit the sun's shadow camera around the level geometry.
  fitShadowsTo(bb: Bounds): void {
    const cx = (bb.xMin + bb.xMax) / 2;
    const cy = (bb.yMin + bb.yMax) / 2;
    const cz = (bb.zMin + bb.zMax) / 2;
    const radius = Math.max(bb.xSize, bb.ySize, bb.zSize) * 0.75 + 5;

    // Sun light travels along missionSunDir; position it opposite.
    const dir = this.missionSunDir ?? new THREE.Vector3(0.57, 0.57, -0.57);
    this.sun.position.set(cx - dir.x * radius * 2, cy - dir.y * radius * 2, cz - dir.z * radius * 2);
    this.sun.target.position.set(cx, cy, cz);

    const cam = this.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = 0.5;
    cam.far = radius * 6;
    cam.updateProjectionMatrix();
  }

  private applyMode(): void {
    const enhanced = this.mode === "enhanced";

    // Sky dome in enhanced; flat classic color otherwise
    if (this.skyDome !== null) {
      if (enhanced) {
        if (this.skyDome.parent === null) this.scene.add(this.skyDome);
        this.scene.background = null;
      } else {
        this.skyDome.removeFromParent();
        this.scene.background = this.classicBackground;
      }
    }

    this.renderer.shadowMap.enabled = enhanced;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = enhanced ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = enhanced ? 1.05 : 1.0;

    this.sun.castShadow = enhanced;
    if (enhanced) {
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.02;
      // PBR materials also receive the sky environment light, so the
      // ambient term stays modest to preserve the original saturation.
      this.ambient.intensity = 0.55;
      this.sun.intensity = 2.2;
    } else {
      this.ambient.intensity = 0.9;
      this.sun.intensity = 1.6;
    }

    // Force material recompile after shadow toggle
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });

    if (enhanced) {
      this.buildComposer();
    } else {
      this.composer?.dispose();
      this.composer = null;
    }
  }

  private buildComposer(): void {
    this.composer?.dispose();
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    const ssao = new SSAOPass(this.scene, this.camera, w, h);
    ssao.kernelRadius = 0.4;
    ssao.minDistance = 0.001;
    ssao.maxDistance = 0.1;
    this.composer.addPass(ssao);

    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.4, 0.9);
    this.composer.addPass(bloom);

    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass(w, h));
  }

  toggle(): void {
    this.mode = this.mode === "enhanced" ? "classic" : "enhanced";
    this.applyMode();
  }

  setShadowCasting(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }

  resize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  render(): void {
    if (this.skyDome !== null && this.skyDome.parent !== null) {
      this.skyDome.position.copy(this.camera.position);
    }
    if (this.mode === "enhanced" && this.composer !== null) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
