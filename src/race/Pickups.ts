import * as THREE from 'three';
import type { Sound } from '../audio/Sound';
import type { Effects } from '../fx/Effects';
import type { Track } from '../world/Track';
import { MAX_TURBO, type Racer } from './Racer';

export type PickupType = 'repair' | 'ammo' | 'turbo' | 'mines';

const PICKUP_RADIUS = 2.4;
const RESPAWN_TIME = 12;

const STYLE: Record<PickupType, { color: number; glow: number }> = {
  repair: { color: 0x1f7a34, glow: 0x40ff70 },
  ammo: { color: 0x8a6a10, glow: 0xffc830 },
  turbo: { color: 0x1a3f8a, glow: 0x40a0ff },
  mines: { color: 0x8a1a1a, glow: 0xff4030 },
};

export interface Pickup {
  type: PickupType;
  x: number;
  y: number;
  z: number;
  lateral: number;
  along: number;
  mesh: THREE.Group;
  active: boolean;
  timer: number;
}

/** Draws the icon shown on top of each crate. */
function createIconTexture(type: PickupType): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = `#${STYLE[type].glow.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, s - 12, s - 12);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (type === 'repair') {
    ctx.fillRect(s / 2 - 12, 26, 24, s - 52);
    ctx.fillRect(26, s / 2 - 12, s - 52, 24);
  } else if (type === 'ammo') {
    for (const x of [36, 64, 92]) {
      ctx.beginPath();
      ctx.moveTo(x - 9, 98);
      ctx.lineTo(x - 9, 50);
      ctx.quadraticCurveTo(x, 22, x + 9, 50);
      ctx.lineTo(x + 9, 98);
      ctx.closePath();
      ctx.fill();
    }
  } else if (type === 'turbo') {
    ctx.beginPath();
    ctx.moveTo(74, 18);
    ctx.lineTo(34, 72);
    ctx.lineTo(62, 72);
    ctx.lineTo(52, 110);
    ctx.lineTo(96, 52);
    ctx.lineTo(66, 52);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 9;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * 24, s / 2 + Math.sin(a) * 24);
      ctx.lineTo(s / 2 + Math.cos(a) * 40, s / 2 + Math.sin(a) * 40);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Floating crates on the track that refill repair, ammo, turbo or mines. */
export class Pickups {
  readonly group = new THREE.Group();
  readonly items: Pickup[] = [];
  private time = 0;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  constructor(
    track: Track,
    private readonly effects: Effects,
    private readonly sound: Sound,
  ) {
    const crate = new THREE.BoxGeometry(1.3, 1.3, 1.3);
    const ring = new THREE.TorusGeometry(1.25, 0.06, 8, 32);
    ring.rotateX(Math.PI / 2);
    this.geometries.push(crate, ring);
    const mats = new Map<PickupType, { side: THREE.Material; top: THREE.Material; ring: THREE.Material }>();
    for (const type of Object.keys(STYLE) as PickupType[]) {
      const st = STYLE[type];
      const icon = createIconTexture(type);
      const side = new THREE.MeshStandardMaterial({ color: st.color, emissive: st.glow, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.4 });
      const top = new THREE.MeshStandardMaterial({ map: icon, emissive: 0xffffff, emissiveMap: icon, emissiveIntensity: 1.4 });
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(st.glow).multiplyScalar(3) });
      this.materials.push(side, top, ringMat);
      mats.set(type, { side, top, ring: ringMat });
    }

    // Spread pickup rows around the lap; each row holds 2-3 crates across the road.
    const order: PickupType[] = ['ammo', 'repair', 'turbo', 'mines', 'ammo', 'turbo', 'repair', 'mines'];
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const along = ((r + 0.5) / rows) * track.length;
      const lanes = r % 2 === 0 ? [-3.5, 3.5] : [-4.5, 0, 4.5];
      lanes.forEach((lateral, k) => {
        const type = order[(r + k) % order.length];
        const m = mats.get(type)!;
        const mesh = new THREE.Group();
        const box = new THREE.Mesh(crate, [m.side, m.side, m.top, m.side, m.side, m.side]);
        box.castShadow = true;
        mesh.add(box);
        const halo = new THREE.Mesh(ring, m.ring);
        halo.position.y = -0.85;
        mesh.add(halo);
        const p = track.pointAt(along, lateral);
        mesh.position.set(p.x, p.y + 1.2, p.z);
        this.group.add(mesh);
        this.items.push({ type, x: p.x, y: p.y, z: p.z, lateral, along, mesh, active: true, timer: 0 });
      });
    }
  }

  update(dt: number, racers: Racer[]): void {
    this.time += dt;
    for (const item of this.items) {
      if (!item.active) {
        item.timer -= dt;
        if (item.timer <= 0) {
          item.active = true;
          item.mesh.visible = true;
        }
        continue;
      }
      item.mesh.rotation.y = this.time * 1.6;
      item.mesh.children[0].position.y = Math.sin(this.time * 3 + item.along) * 0.15;
      for (const r of racers) {
        if (r.destroyed) continue;
        const p = r.car.physics;
        if ((p.x - item.x) ** 2 + (p.z - item.z) ** 2 < PICKUP_RADIUS ** 2 && Math.abs(r.car.y - item.y) < 2.5) {
          this.collect(item, r);
          break;
        }
      }
    }
  }

  private collect(item: Pickup, r: Racer): void {
    item.active = false;
    item.mesh.visible = false;
    item.timer = RESPAWN_TIME;
    switch (item.type) {
      case 'repair':
        r.health = Math.min(r.maxHealth, r.health + r.maxHealth * 0.45);
        break;
      case 'ammo':
        r.ammo += 60;
        break;
      case 'turbo':
        r.turbo = Math.min(MAX_TURBO, r.turbo + 60);
        break;
      case 'mines':
        r.mines += 2;
        break;
    }
    const pos = item.mesh.position.clone();
    this.effects.flash(pos, 40, 0.3, STYLE[item.type].glow);
    this.effects.sparksBurst(pos, 12, 6);
    if (r.isPlayer) this.sound.pickup();
  }

  dispose(): void {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
