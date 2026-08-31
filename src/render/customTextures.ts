// Runtime-generated replacement textures for select shapes — code-drawn, so
// the repo stays free of image assets. Currently: the start pad top, which
// originally carries the Monster Studios logo; we redraw it at 1024x1024
// (4x the original) with a START! badge in the same art style.
import * as THREE from "three";

let startPadTexture: THREE.CanvasTexture | null = null;

function drawStartPad(): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;

  // Yellow corners
  ctx.fillStyle = "#f2ea1a";
  ctx.fillRect(0, 0, size, size);

  // Outer green ring
  const ringOuter = c * 0.98;
  const ringInner = c * 0.80;
  const ringGrad = ctx.createRadialGradient(c, c * 0.8, ringInner * 0.6, c, c, ringOuter);
  ringGrad.addColorStop(0, "#7cc94e");
  ringGrad.addColorStop(0.75, "#4da32e");
  ringGrad.addColorStop(1, "#2f7a1c");
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(c, c, ringOuter, 0, Math.PI * 2);
  ctx.fill();

  // Ring bevel highlight
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  ctx.arc(c, c, ringOuter * 0.965, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  // Rivets
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const rx = c + Math.cos(angle) * c * 0.89;
    const ry = c + Math.sin(angle) * c * 0.89;
    const r = size * 0.02;
    const rivGrad = ctx.createRadialGradient(rx - r * 0.3, ry - r * 0.3, r * 0.1, rx, ry, r);
    rivGrad.addColorStop(0, "#c8f0a0");
    rivGrad.addColorStop(0.6, "#4da32e");
    rivGrad.addColorStop(1, "#245c14");
    ctx.fillStyle = rivGrad;
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Checkerboard disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, ringInner, 0, Math.PI * 2);
  ctx.clip();
  const cell = size / 10;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#8fc94f" : "#d9e26a";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // Soft vignette so the disc reads round
  const vign = ctx.createRadialGradient(c, c, ringInner * 0.4, c, c, ringInner);
  vign.addColorStop(0, "rgba(255,255,255,0.10)");
  vign.addColorStop(1, "rgba(20,60,10,0.22)");
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // Center badge: tilted red oval with START!
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-0.12);

  const badgeW = size * 0.34;
  const badgeH = size * 0.155;
  const badgeGrad = ctx.createLinearGradient(0, -badgeH, 0, badgeH);
  badgeGrad.addColorStop(0, "#e84438");
  badgeGrad.addColorStop(1, "#b31f1a");
  ctx.fillStyle = badgeGrad;
  ctx.strokeStyle = "#1f6f14";
  ctx.lineWidth = size * 0.018;
  ctx.beginPath();
  ctx.ellipse(0, 0, badgeW, badgeH, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = size * 0.006;
  ctx.beginPath();
  ctx.ellipse(0, 0, badgeW * 0.93, badgeH * 0.86, 0, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();

  ctx.font = `800 ${Math.round(size * 0.115)}px 'Baloo 2','Trebuchet MS',sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#5e1008";
  ctx.lineWidth = size * 0.02;
  ctx.strokeText("START!", 0, size * 0.008);
  ctx.fillStyle = "#fff8dc";
  ctx.fillText("START!", 0, size * 0.008);
  ctx.restore();

  return canvas;
}

// Returns a replacement texture for (dtsPath, matName), or null to load the
// original file.
export function customTextureFor(dtsPath: string, matName: string): THREE.Texture | null {
  if (dtsPath.includes("pads/startarea") && matName.toLowerCase().startsWith("spawn")) {
    if (startPadTexture === null) {
      startPadTexture = new THREE.CanvasTexture(drawStartPad());
      startPadTexture.colorSpace = THREE.SRGBColorSpace;
      startPadTexture.wrapS = THREE.RepeatWrapping;
      startPadTexture.wrapT = THREE.RepeatWrapping;
      startPadTexture.flipY = false;
      startPadTexture.anisotropy = 8;
    }
    return startPadTexture;
  }
  return null;
}
