import * as THREE from 'three';
import { createRng } from '../core/math';

/**
 * Procedural textures generated on canvas at startup. They keep the project
 * asset-free for now; any of them can later be replaced by image files.
 */

type Painter = (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function makeCanvas(size: number, paint: Painter, seed: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size, createRng(seed));
  return canvas;
}

function toTexture(canvas: HTMLCanvasElement, repeat: [number, number], srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

/** Builds a tangent-space normal map from the luminance of a height canvas. */
function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = src.width;
  const sctx = src.getContext('2d')!;
  const h = sctx.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(size, size);
  const lum = (x: number, y: number) => {
    const i = (((y + size) % size) * size + ((x + size) % size)) * 4;
    return (h[i] + h[i + 1] + h[i + 2]) / (3 * 255);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (lum(x + 1, y) - lum(x - 1, y)) * strength;
      const dy = (lum(x, y + 1) - lum(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, count: number, colors: string[], maxR: number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const r = rnd() * maxR + 0.4;
    ctx.globalAlpha = 0.15 + rnd() * 0.5;
    ctx.fillRect(rnd() * size, rnd() * size, r, r);
  }
  ctx.globalAlpha = 1;
}

function blotches(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, count: number, colors: string[], minR: number, maxR: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = minR + rnd() * (maxR - minR);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[Math.floor(rnd() * colors.length)];
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    ctx.fillStyle = g;
    // Draw wrapped copies so the texture tiles seamlessly.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
}

/** Road asphalt. U runs across the road (0..1), V runs along the track in meters / tile length. */
export function createAsphaltTextures(): SurfaceTextures {
  const size = 512;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 40, ['#2c2c2e', '#47464a', '#302f33'], 20, 90, 0.5);
    speckle(ctx, s, rnd, 26000, ['#1d1d1f', '#5a5a5e', '#6b6a6e', '#29292b'], 2);
    // Darker racing line where tires wear the asphalt.
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0.0, 'rgba(0,0,0,0)');
    g.addColorStop(0.3, 'rgba(0,0,0,0.12)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Cracks.
    ctx.strokeStyle = 'rgba(15,15,15,0.55)';
    for (let i = 0; i < 14; i++) {
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath();
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 40;
        y += (rnd() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 11);
  const normal = normalFromHeight(base, 3.5);

  // Edge lines and dashed center line painted on a copy, so the normal map stays clean.
  const painted = document.createElement('canvas');
  painted.width = painted.height = size;
  const pctx = painted.getContext('2d')!;
  pctx.drawImage(base, 0, 0);
  pctx.fillStyle = 'rgba(235,235,225,0.85)';
  pctx.fillRect(size * 0.035, 0, size * 0.018, size);
  pctx.fillRect(size * (1 - 0.053), 0, size * 0.018, size);
  pctx.fillStyle = 'rgba(240,200,60,0.75)';
  pctx.fillRect(size * 0.494, 0, size * 0.012, size * 0.5);

  return { map: toTexture(painted, [1, 1]), normalMap: toTexture(normal, [1, 1], false) };
}

/** Red/white curb stripes. */
export function createCurbTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s, rnd) => {
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#b8261e';
    ctx.fillRect(0, 0, s, s / 2);
    speckle(ctx, s, rnd, 1500, ['#000', '#fff'], 1.5);
  }, 21);
  return toTexture(c, [1, 1]);
}

/** Dusty dirt/scrub ground for the area around the circuit. */
export function createGroundTextures(): SurfaceTextures {
  const size = 1024;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#7d6a4e';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 90, ['#6a5a40', '#8f7a58', '#5d5a3a', '#73694a'], 40, 180, 0.55);
    blotches(ctx, s, rnd, 60, ['#4f5a32', '#5b6438'], 20, 70, 0.45);
    speckle(ctx, s, rnd, 90000, ['#4a3e2c', '#a08a66', '#5f5236', '#3c4426', '#b59d76'], 2.2);
  }, 31);
  const normal = normalFromHeight(base, 4);
  return { map: toTexture(base, [60, 60]), normalMap: toTexture(normal, [60, 60], false) };
}

/** Concrete with stains, used by barriers and building walls. */
export function createConcreteTexture(): THREE.Texture {
  const c = makeCanvas(256, (ctx, s, rnd) => {
    ctx.fillStyle = '#9a968e';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 25, ['#7d7972', '#aaa69e', '#6d685f'], 10, 60, 0.6);
    speckle(ctx, s, rnd, 8000, ['#5f5b55', '#bdb9b0'], 1.5);
    // Vertical rain streaks.
    for (let i = 0; i < 30; i++) {
      ctx.globalAlpha = 0.08 + rnd() * 0.12;
      ctx.fillStyle = '#3a352e';
      ctx.fillRect(rnd() * s, 0, 1 + rnd() * 3, s * (0.2 + rnd() * 0.8));
    }
    ctx.globalAlpha = 1;
  }, 41);
  return toTexture(c, [1, 1]);
}

/** Corrugated metal panels for shipping containers and sheds. */
export function createCorrugatedTexture(): THREE.Texture {
  const c = makeCanvas(256, (ctx, s, rnd) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 8) {
      const g = ctx.createLinearGradient(x, 0, x + 8, 0);
      g.addColorStop(0, '#b8b8b8');
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(1, '#9a9a9a');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 8, s);
    }
    blotches(ctx, s, rnd, 30, ['#6b4a2a', '#5a3d22'], 6, 40, 0.35);
    speckle(ctx, s, rnd, 3000, ['#4a3420', '#888'], 2);
  }, 51);
  return toTexture(c, [1, 1]);
}

/** Building facade with a grid of windows; returns color + emissive (lit windows). */
export function createFacadeTextures(): { map: THREE.Texture; emissiveMap: THREE.Texture } {
  const size = 256;
  const lit: boolean[] = [];
  const rnd0 = createRng(61);
  for (let i = 0; i < 64; i++) lit.push(rnd0() < 0.3);
  const drawWindows = (ctx: CanvasRenderingContext2D, emissive: boolean) => {
    let k = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const x = col * 32 + 7;
        const y = row * 32 + 8;
        if (emissive) {
          ctx.fillStyle = lit[k] ? '#ffcf7a' : '#000';
        } else {
          ctx.fillStyle = lit[k] ? '#d8b070' : '#1d2228';
        }
        ctx.fillRect(x, y, 18, 16);
        k++;
      }
    }
  };
  const map = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#6f675c';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 20, ['#5a5249', '#7f776b'], 10, 50, 0.6);
    drawWindows(ctx, false);
    speckle(ctx, s, rnd, 4000, ['#3e3832', '#8a8276'], 1.5);
  }, 62);
  const emissive = makeCanvas(size, (ctx, s) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    drawWindows(ctx, true);
  }, 63);
  return { map: toTexture(map, [1, 1]), emissiveMap: toTexture(emissive, [1, 1]) };
}

/** Soft round sprite for smoke, dust and sparks. */
export function createSoftParticleTexture(): THREE.Texture {
  const c = makeCanvas(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 71);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Start/finish checkered pattern. */
export function createCheckerTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s) => {
    const n = 8;
    const cell = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f2f2' : '#111';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }, 81);
  return toTexture(c, [1, 1]);
}

// -----------------------------------------------------------------------------
// Quarry and factory themes
// -----------------------------------------------------------------------------

/** Wavy line drawn in several wrapped copies so it tiles vertically. */
function rut(ctx: CanvasRenderingContext2D, s: number, rnd: () => number, x: number, width: number, color: string, alpha: number) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let y = 0; y <= s; y += 8) {
    // Sine with an integer number of periods keeps the seam clean.
    const px = x + Math.sin((y / s) * Math.PI * 2 * 2) * 4 + (rnd() - 0.5) * 2;
    if (y === 0) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Packed quarry dirt with tire ruts running along the road. Same UV layout as asphalt. */
export function createDirtRoadTextures(): SurfaceTextures {
  const size = 512;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#9c8566';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 50, ['#8a7356', '#ad9674', '#7d684d', '#b8a27e'], 20, 90, 0.55);
    speckle(ctx, s, rnd, 30000, ['#6a573f', '#c4ae8a', '#5a4a36', '#d6c4a0', '#7f6b52'], 2.4);
    // Pebbles.
    for (let i = 0; i < 700; i++) {
      const r = 0.8 + rnd() * 2.4;
      ctx.fillStyle = rnd() < 0.5 ? '#6e6252' : '#c9bca4';
      ctx.globalAlpha = 0.5 + rnd() * 0.4;
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Darker, compacted ruts where the cars run.
    for (const u of [0.22, 0.34, 0.66, 0.78]) rut(ctx, s, rnd, u * s, 14, '#5e4d39', 0.28);
    for (const u of [0.22, 0.34, 0.66, 0.78]) rut(ctx, s, rnd, u * s + 3, 3, '#3f3326', 0.25);
  }, 111);
  const normal = normalFromHeight(base, 4.5);
  return { map: toTexture(base, [1, 1]), normalMap: toTexture(normal, [1, 1], false) };
}

/** Coarse stones lining the edge of the dirt road. */
export function createRubbleEdgeTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s, rnd) => {
    ctx.fillStyle = '#6d6150';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) {
      const r = 2 + rnd() * 7;
      const v = 90 + Math.floor(rnd() * 90);
      ctx.fillStyle = `rgb(${v}, ${v - 8}, ${v - 20})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * s, rnd() * s, r, r * (0.6 + rnd() * 0.4), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    speckle(ctx, s, rnd, 1500, ['#2e281f', '#d8ccb4'], 1.5);
  }, 121);
  return toTexture(c, [1, 1]);
}

/** Light quarry sand and dust for the open ground. */
export function createSandGroundTextures(): SurfaceTextures {
  const size = 1024;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#a58c68';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 90, ['#94795a', '#b9a07a', '#8a7558', '#c2ab84'], 40, 200, 0.55);
    blotches(ctx, s, rnd, 40, ['#7a7466', '#857a66'], 30, 100, 0.4);
    speckle(ctx, s, rnd, 110000, ['#6e5a42', '#cdb894', '#5c4c38', '#e0cfac', '#8d8270'], 2.2);
  }, 131);
  const normal = normalFromHeight(base, 4);
  return { map: toTexture(base, [70, 70]), normalMap: toTexture(normal, [70, 70], false) };
}

/**
 * Concrete jersey barrier: grey blocks with joints and dark diagonal stripes.
 * U runs along the track (one tile = one 3 m block), V across the profile.
 */
export function createJerseyTexture(): THREE.Texture {
  const c = makeCanvas(256, (ctx, s, rnd) => {
    ctx.fillStyle = '#a9a69e';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 30, ['#8f8c84', '#bebab0', '#7d7a72'], 10, 60, 0.6);
    speckle(ctx, s, rnd, 9000, ['#605c55', '#cfcac0'], 1.5);
    // Diagonal stripes on the middle of each block, like site safety barriers.
    ctx.save();
    ctx.beginPath();
    ctx.rect(s * 0.18, s * 0.25, s * 0.64, s * 0.5);
    ctx.clip();
    ctx.fillStyle = 'rgba(40, 40, 42, 0.85)';
    for (let x = -s; x < s * 2; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 22, s);
      ctx.lineTo(x + 22 + s * 0.6, 0);
      ctx.lineTo(x + s * 0.6, 0);
      ctx.fill();
    }
    ctx.restore();
    blotches(ctx, s, rnd, 12, ['#5a4a38'], 10, 40, 0.3);
    // Joint between blocks.
    ctx.fillStyle = '#2a2826';
    ctx.fillRect(0, 0, 5, s);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(5, 0, 2, s);
  }, 141);
  return toTexture(c, [1, 1]);
}

/** Worn yellow and black hazard stripes. */
export function createHazardTexture(): THREE.Texture {
  const c = makeCanvas(256, (ctx, s, rnd) => {
    ctx.fillStyle = '#e0aa1c';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#18160f';
    for (let x = -s; x < s * 2; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 32, s);
      ctx.lineTo(x + 32 + s, 0);
      ctx.lineTo(x + s, 0);
      ctx.fill();
    }
    blotches(ctx, s, rnd, 30, ['#4a4030', '#8a7a5a'], 6, 30, 0.35);
    speckle(ctx, s, rnd, 6000, ['#2a2418', '#f8e8b0', '#6a6050'], 1.6);
  }, 151);
  return toTexture(c, [1, 1]);
}

/** Sealed factory floor for the road: dark epoxy with painted edge and center lines. */
export function createFactoryRoadTextures(): SurfaceTextures {
  const size = 512;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#4c4d4f';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 40, ['#3e3f41', '#56575a', '#454240'], 20, 90, 0.5);
    speckle(ctx, s, rnd, 14000, ['#2e2f31', '#6a6b6e'], 1.6);
    // Tire rubber laid down on the racing line.
    for (const u of [0.3, 0.7]) rut(ctx, s, rnd, u * s, 40, '#1a1a1b', 0.18);
    // Saw-cut expansion joint across the slab.
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    ctx.fillRect(0, s * 0.5, s, 2);
  }, 161);
  const normal = normalFromHeight(base, 2.5);
  const painted = document.createElement('canvas');
  painted.width = painted.height = size;
  const p = painted.getContext('2d')!;
  p.drawImage(base, 0, 0);
  p.fillStyle = 'rgba(240,240,232,0.85)';
  p.fillRect(size * 0.03, 0, size * 0.02, size);
  p.fillRect(size * 0.95, 0, size * 0.02, size);
  p.fillStyle = 'rgba(245,190,40,0.85)';
  p.fillRect(size * 0.492, 0, size * 0.016, size * 0.45);
  // Scuffs over the paint.
  const rnd = createRng(162);
  speckle(p, size, rnd, 2500, ['#3a3a3c', '#2a2a2b'], 2.5);
  return { map: toTexture(painted, [1, 1]), normalMap: toTexture(normal, [1, 1], false) };
}

/** Concrete hall floor in square slabs, with oil stains. One tile = one 6 m slab. */
export function createFactoryFloorTextures(): SurfaceTextures {
  const size = 512;
  const base = makeCanvas(size, (ctx, s, rnd) => {
    ctx.fillStyle = '#77736c';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 40, ['#6a665f', '#85817a', '#5f5b55'], 20, 120, 0.5);
    blotches(ctx, s, rnd, 10, ['#2a2622', '#3a342c'], 10, 50, 0.45); // oil
    speckle(ctx, s, rnd, 20000, ['#4f4c47', '#9a968e'], 1.6);
    ctx.fillStyle = 'rgba(30,28,26,0.8)';
    ctx.fillRect(0, 0, s, 3);
    ctx.fillRect(0, 0, 3, s);
  }, 171);
  const normal = normalFromHeight(base, 3);
  return { map: toTexture(base, [1, 1]), normalMap: toTexture(normal, [1, 1], false) };
}

/** Painted metal with rust runs and grime, tinted per material (pipes, beams, machines). */
export function createPaintedMetalTexture(): THREE.Texture {
  const c = makeCanvas(256, (ctx, s, rnd) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 40, ['#d8d8d8', '#bdbdbd', '#e8e8e8'], 10, 50, 0.6);
    blotches(ctx, s, rnd, 26, ['#7a4a22', '#5e3418', '#8a5a2a'], 4, 24, 0.55); // rust
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.1 + rnd() * 0.25;
      ctx.fillStyle = rnd() < 0.6 ? '#6a3c1a' : '#3a3530';
      ctx.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 10 + rnd() * 60);
    }
    ctx.globalAlpha = 1;
    speckle(ctx, s, rnd, 6000, ['#5a5550', '#ffffff', '#7a5030'], 1.5);
  }, 181);
  return toTexture(c, [1, 1]);
}

/** Wooden crate face: plank frame with a stencil. */
export function createCrateTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s, rnd) => {
    ctx.fillStyle = '#a7834f';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      ctx.fillStyle = rnd() < 0.5 ? '#9a7744' : '#b48f5a';
      ctx.fillRect(0, y + 1, s, 14);
      ctx.fillStyle = 'rgba(40,25,10,0.6)';
      ctx.fillRect(0, y, s, 1.5);
    }
    speckle(ctx, s, rnd, 1500, ['#5a4020', '#d8b480'], 1.5);
    ctx.strokeStyle = '#6a4c26';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, s - 12, s - 12);
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(s - 10, s - 10);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(30,20,10,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, s - 24, s - 24);
  }, 191);
  return toTexture(c, [1, 1]);
}

/** Cardboard box face with tape, for warehouse racks. */
export function createCardboardTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s, rnd) => {
    ctx.fillStyle = '#b48a58';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, rnd, 10, ['#a07848', '#c49a68'], 10, 40, 0.5);
    speckle(ctx, s, rnd, 1200, ['#7a5a30', '#d8b080'], 1.2);
    ctx.fillStyle = 'rgba(220,200,160,0.7)';
    ctx.fillRect(s * 0.44, 0, s * 0.12, s);
    ctx.fillStyle = 'rgba(30,20,10,0.55)';
    ctx.fillRect(s * 0.12, s * 0.7, s * 0.24, s * 0.06);
    ctx.fillRect(s * 0.12, s * 0.8, s * 0.16, s * 0.04);
  }, 201);
  return toTexture(c, [1, 1]);
}

/** Soft round glow used as an additive light pool on the floor under lamps. */
export function createLightPoolTexture(): THREE.Texture {
  const c = makeCanvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, 211);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
