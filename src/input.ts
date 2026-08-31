// Keyboard + mouse input, feeding Move structs the same way MBHaxe's
// recordMove does (WASD onto d.x/d.y, space = jump). Arrow keys rotate the
// camera (MBG's default cam bindings). Mouse look uses pointer lock, with a
// hold-left-button drag fallback when pointer lock is unavailable.
import type { Move } from "./marble/marble";

export class Input {
  private keys = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  pointerLocked = false;
  pointerLockError: string | null = null;
  onPointerLockLost: (() => void) | null = null;

  private dragging = false;
  private element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      // keep Space/arrows from scrolling the page
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    element.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.dragging = true;
        if (!this.pointerLocked) this.requestLock();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.dragging = false;
    });
    document.addEventListener("pointerlockchange", () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.element;
      // Browser Esc exits pointer lock before any Escape keydown reaches us
      if (wasLocked && !this.pointerLocked) this.onPointerLockLost?.();
    });
    document.addEventListener("pointerlockerror", () => {
      this.pointerLockError = "pointer lock rejected (drag with left button to look)";
    });
    window.addEventListener("mousemove", (e) => {
      // Locked: always look. Unlocked fallback: look while dragging.
      if (this.pointerLocked || this.dragging) {
        this.mouseDeltaX += e.movementX;
        this.mouseDeltaY += e.movementY;
      }
    });
    // Esc releases pointer lock natively; clicking re-acquires it.
  }

  requestLock(): void {
    try {
      const res = this.element.requestPointerLock() as unknown;
      if (res instanceof Promise) {
        res.catch((err: unknown) => {
          this.pointerLockError = `pointer lock unavailable (${err instanceof Error ? err.name : "error"}) — drag with left button to look`;
        });
      }
    } catch (err) {
      this.pointerLockError = `pointer lock unavailable (${err instanceof Error ? err.name : "error"}) — drag with left button to look`;
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  // Matches MBHaxe recordMove: forward => d.x -= 1, backward => d.x += 1,
  // left => d.y += 1, right => d.y -= 1.
  recordMove(): Move {
    const d = { x: 0, y: 0 };
    if (this.isDown("KeyW")) d.x -= 1;
    if (this.isDown("KeyS")) d.x += 1;
    if (this.isDown("KeyA")) d.y += 1;
    if (this.isDown("KeyD")) d.y -= 1;
    d.x = Math.max(-1, Math.min(1, d.x));
    d.y = Math.max(-1, Math.min(1, d.y));
    return { d, jump: this.isDown("Space"), powerup: false };
  }

  // Camera rotation from arrow keys, matching MBHaxe's CameraController
  // keyboard path: 0.75 * 5 rad/s. Returns yaw/pitch deltas for this frame.
  cameraKeyDeltas(dt: number): { yaw: number; pitch: number } {
    const yawDir = (this.isDown("ArrowRight") ? 1 : 0) - (this.isDown("ArrowLeft") ? 1 : 0);
    const pitchDir = (this.isDown("ArrowDown") ? 1 : 0) - (this.isDown("ArrowUp") ? 1 : 0);
    return { yaw: 0.75 * 5 * yawDir * dt, pitch: 0.75 * 5 * pitchDir * dt };
  }

  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }
}
