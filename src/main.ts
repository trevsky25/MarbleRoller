import * as THREE from "three";
import { ResourceIndex } from "./assets/resourceIndex";
import { GameWorld } from "./game/gameWorld";
import { Graphics } from "./render/graphics";
import { MaterialEnhancer } from "./render/materialEnhancer";
import { Input } from "./input";
import { PauseMenu } from "./game/pauseMenu";

// Slice 3: full mission gameplay — Ready/Set/Go, timer, gems, powerups,
// OOB, finish. Pick the level with ?mis=data/missions/beginner/<name>.mis

const DEFAULT_MIS = "data/missions/beginner/movement.mis";

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const misPath = params.get("mis") ?? DEFAULT_MIS;

  const status = document.getElementById("status")!;
  status.textContent = `Loading ${misPath}…`;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x66a5ff);

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 2000);
  camera.up.set(0, 0, 1);

  const gfxParam = params.get("gfx");
  const mode = gfxParam === "classic" ? "classic" : "enhanced";
  const graphics = new Graphics(renderer, scene, camera, mode);
  const enhancer = new MaterialEnhancer(mode === "enhanced", renderer);

  const index = await ResourceIndex.load();
  const world = new GameWorld(scene, camera, index, enhancer);

  try {
    await world.load(misPath);
  } catch (e) {
    status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
    throw e;
  }

  if (world.sunDirection !== null && world.sunColor !== null && world.ambientColor !== null) {
    graphics.setSunFromMission(world.sunDirection, world.sunColor, world.ambientColor);
  }
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // Marble visual (real .dts marble model arrives with shape polish).
  // Enhanced mode: glossy PBR marble picking up the sky's reflections.
  const marbleTexUrl = index.resolve("data/shapes/balls/base.marble.png");
  let marbleTex: THREE.Texture | null = null;
  if (marbleTexUrl !== null) {
    marbleTex = new THREE.TextureLoader().load(marbleTexUrl);
    marbleTex.colorSpace = THREE.SRGBColorSpace;
  }
  const marbleMaterial =
    mode === "enhanced"
      ? new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.0, envMapIntensity: 1.4 })
      : new THREE.MeshPhongMaterial();
  if (marbleTex !== null) marbleMaterial.map = marbleTex;
  const marbleMesh = new THREE.Mesh(new THREE.SphereGeometry(world.marble.radius, 48, 24), marbleMaterial);
  marbleMesh.castShadow = true;
  scene.add(marbleMesh);

  // Shadow bounds across everything loaded
  {
    const worldBounds = world.collisionWorld.entities[0]?.boundingBox;
    if (worldBounds !== undefined) graphics.fitShadowsTo(worldBounds);
  }

  const input = new Input(renderer.domElement);
  world.restart();

  // Pause menu (Esc)
  const pauseMenu = new PauseMenu(index);
  let paused = false;

  const pauseGame = (): void => {
    if (paused) return;
    paused = true;
    if (input.pointerLocked) document.exitPointerLock();
    pauseMenu.open(world.missionTitle);
  };
  const resumeGame = (): void => {
    paused = false;
    pauseMenu.close();
    input.requestLock();
  };

  pauseMenu.onResume = resumeGame;
  pauseMenu.onRestart = () => {
    world.restart();
    resumeGame();
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      if (paused) resumeGame();
      else pauseGame();
    }
  });
  // Browser Esc exits pointer lock without a keydown — treat as pause
  input.onPointerLockLost = () => {
    if (!paused) pauseGame();
  };

  (window as unknown as Record<string, unknown>).__game = { world, graphics, input };

  let lastTime = performance.now();
  let frames = 0;
  let fpsTime = 0;
  let fps = 0;
  let restartHeld = false;
  let powerupHeld = false;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    graphics.resize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyG" && !e.repeat) graphics.toggle();
  });
  window.addEventListener("mousedown", (e) => {
    if (e.button === 2) mouseUse = true;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  let mouseUse = false;

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0.1) dt = 0.1;

    if (paused) {
      input.consumeMouseDelta();
      graphics.render();
      return;
    }

    frames++;
    fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = Math.round(frames / fpsTime);
      frames = 0;
      fpsTime = 0;
    }

    const mouse = input.consumeMouseDelta();
    world.cameraController.orbit(mouse.x, mouse.y);
    const camKeys = input.cameraKeyDeltas(dt);
    world.cameraController.rotate(camKeys.yaw, camKeys.pitch);

    const move = input.recordMove();
    // use-powerup: edge-triggered from E or right mouse
    const useDown = input.isDown("KeyE") || mouseUse;
    mouseUse = false;
    move.powerup = useDown && !powerupHeld;
    powerupHeld = input.isDown("KeyE");

    // restart: edge-triggered R
    const restartDown = input.isDown("KeyR");
    const restartRequested = restartDown && !restartHeld;
    restartHeld = restartDown;

    world.update(dt, move, restartRequested);

    marbleMesh.position.set(world.marble.position.x, world.marble.position.y, world.marble.position.z);
    marbleMesh.quaternion.set(
      world.marble.rotation.x,
      world.marble.rotation.y,
      world.marble.rotation.z,
      world.marble.rotation.w,
    );

    const mouseState = input.pointerLocked
      ? "mouse look on"
      : (input.pointerLockError ?? "click to capture mouse");
    status.textContent =
      `${world.missionTitle} — ${mouseState} | WASD roll, Space jump, E/RMB use, R restart, G gfx (${graphics.mode}) | ` +
      `${world.marble.velocity.length().toFixed(1)} m/s | ${fps} fps`;

    graphics.render();
  });
}

void main();
