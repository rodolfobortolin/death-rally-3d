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
