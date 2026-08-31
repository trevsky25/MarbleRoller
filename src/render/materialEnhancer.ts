// Remaster-pass material enhancement: generates normal maps from the
// original 2002-era diffuse textures (luminance -> height -> Sobel), and
// upgrades materials to PBR with per-surface roughness so ice glints and
// carpet stays matte. Purely additive — classic mode keeps original art.
import * as THREE from "three";

// Roughness/normal-strength heuristics by material name substring.
const SURFACE_PROFILES: { match: RegExp; roughness: number; normalStrength: number; metalness?: number }[] = [
  { match: /ice|slick/i, roughness: 0.08, normalStrength: 0.4 },
  { match: /oil/i, roughness: 0.15, normalStrength: 0.3 },
  { match: /water/i, roughness: 0.2, normalStrength: 0.5 },
  { match: /grass|carpet|rug|sand|dirt|mud/i, roughness: 0.95, normalStrength: 1.2 },
  { match: /friction_high/i, roughness: 0.9, normalStrength: 1.4 },
  { match: /friction_none|friction_low/i, roughness: 0.15, normalStrength: 0.4 },
  { match: /metal|plate|chrome|steel/i, roughness: 0.35, normalStrength: 0.8, metalness: 0.6 },
  { match: /tile|floor/i, roughness: 0.45, normalStrength: 1.0 },
  { match: /wall|brick|cobble|stone/i, roughness: 0.8, normalStrength: 1.3 },
  { match: /trim|edge|border|beam|side/i, roughness: 0.5, normalStrength: 0.9 },
  { match: /chevron|arrow|caution|stripe/i, roughness: 0.55, normalStrength: 0.7 },
];

function profileFor(name: string): { roughness: number; normalStrength: number; metalness: number } {
  for (const p of SURFACE_PROFILES) {
    if (p.match.test(name)) return { roughness: p.roughness, normalStrength: p.normalStrength, metalness: p.metalness ?? 0 };
  }
  return { roughness: 0.65, normalStrength: 0.9, metalness: 0 };
}

// Sobel height-to-normal on a canvas. Returns a CanvasTexture normal map.
function generateNormalMap(image: HTMLImageElement | ImageBitmap, strength: number): THREE.CanvasTexture | null {
  const w = image.width;
  const h = image.height;
  if (w === 0 || h === 0) return null;

  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const srcCtx = src.getContext("2d");
  if (srcCtx === null) return null;
  srcCtx.drawImage(image, 0, 0);
  const data = srcCtx.getImageData(0, 0, w, h).data;

  // luminance height field
  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    height[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) / 255;
  }

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const outCtx = out.getContext("2d");
  if (outCtx === null) return null;
  const outData = outCtx.createImageData(w, h);

  const at = (x: number, y: number): number => {
    // wrap (textures repeat)
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
    return height[y * w + x]!;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;

      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const idx = (y * w + x) * 4;
      outData.data[idx] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      outData.data[idx + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      outData.data[idx + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      outData.data[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outData, 0, 0);

  const texture = new THREE.CanvasTexture(out);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  return texture;
}

export class MaterialEnhancer {
  enabled: boolean;
  maxAnisotropy: number;

  constructor(enabled: boolean, renderer: THREE.WebGLRenderer) {
    this.enabled = enabled;
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  // Create the material for a named game surface. In enhanced mode returns a
  // PBR material and schedules normal-map generation once the texture loads.
  createMaterial(name: string, texture: THREE.Texture | null): THREE.Material {
    if (!this.enabled) {
      const mat = new THREE.MeshPhongMaterial({ side: THREE.DoubleSide });
      if (texture !== null) mat.map = texture;
      else mat.color.set(0x888888);
      return mat;
    }

    const profile = profileFor(name);
    const mat = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: profile.roughness,
      metalness: profile.metalness,
    });
    if (texture === null) {
      mat.color.set(0x888888);
      return mat;
    }

    texture.anisotropy = this.maxAnisotropy;
    mat.map = texture;

    const applyNormal = (): void => {
      const image = texture.image as HTMLImageElement | ImageBitmap | undefined;
      if (image === undefined || image === null) return;
      const normalMap = generateNormalMap(image, profile.normalStrength);
      if (normalMap !== null) {
        normalMap.anisotropy = this.maxAnisotropy;
        mat.normalMap = normalMap;
        mat.needsUpdate = true;
      }
    };

    const image = texture.image as HTMLImageElement | undefined;
    if (image !== undefined && image !== null && image.width > 0) {
      applyNormal();
    } else {
      // TextureLoader sets .image when loaded; poll cheaply via onUpdate or
      // listen for the load through the source data
      const check = (): void => {
        const img = texture.image as HTMLImageElement | undefined;
        if (img !== undefined && img !== null && img.width > 0) applyNormal();
        else setTimeout(check, 100);
      };
      setTimeout(check, 50);
    }

    return mat;
  }
}
