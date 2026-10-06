import * as THREE from 'three';
import type { Sound } from '../audio/Sound';
import type { Effects } from '../fx/Effects';
import { MAX_HEALTH, type Racer } from '../race/Racer';
import type { Track } from '../world/Track';

const GUN_INTERVAL = 0.085;
const GUN_RANGE = 70;
const GUN_DAMAGE = 2.1;
const GUN_SPREAD = 0.035;
const CAR_HIT_RADIUS = 1.15;
const CAR_HIT_OFFSET = 1.1;

const MINE_ARM_TIME = 0.6;
const MINE_OWNER_GRACE = 2;
const MINE_TRIGGER_RADIUS = 1.9;
const MINE_BLAST_RADIUS = 6;
const MINE_DAMAGE = 32;
const MINE_COOLDOWN = 0.6;
const MINE_LIFETIME = 90;
const MAX_MINES = 40;

const WRECK_BLAST_RADIUS = 7;
const WRECK_BLAST_DAMAGE = 18;

export interface Mine {
  x: number;
  z: number;
  owner: Racer;
  age: number;
  mesh: THREE.Group;
}

export interface CombatEvents {
  onWreck?: (victim: Racer, killer: Racer | null) => void;
}

/** Weapons, mines, damage and wrecks. */
export class Combat {
  readonly group = new THREE.Group();
  readonly mines: Mine[] = [];
  private readonly mineBody: THREE.CylinderGeometry;
  private readonly mineBodyMat: THREE.MeshStandardMaterial;
  private readonly mineLightGeo: THREE.SphereGeometry;
  private readonly mineLightMat: THREE.MeshStandardMaterial;
  private blinkTime = 0;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  constructor(
    private readonly track: Track,
    private readonly racers: Racer[],
    private readonly effects: Effects,
    private readonly sound: Sound,
    private readonly events: CombatEvents = {},
  ) {
    this.mineBody = new THREE.CylinderGeometry(0.5, 0.58, 0.22, 16);
    this.mineBodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2c26, metalness: 0.7, roughness: 0.45 });
    this.mineLightGeo = new THREE.SphereGeometry(0.11, 10, 8);
    this.mineLightMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 5 });
  }

  // ---------------------------------------------------------------------------
  // Machine gun
  // ---------------------------------------------------------------------------

  /** Fires one round if the gun is ready. `spread` adds AI inaccuracy on top of the base cone. */
  tryFire(shooter: Racer, extraSpread = 0): void {
    if (shooter.destroyed || shooter.fireCooldown > 0 || shooter.ammo <= 0) return;
    shooter.fireCooldown = GUN_INTERVAL;
    shooter.ammo--;

    const p = shooter.car.physics;
    const muzzle = shooter.worldPoint(shooter.car.visual.muzzleOffset, this.v1);
    const angle = p.heading + (Math.random() - 0.5) * 2 * (GUN_SPREAD + extraSpread);
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);

    // Closest car along the ray.
    let hitT = GUN_RANGE;
    let victim: Racer | null = null;
    for (const r of this.racers) {
      if (r === shooter || r.destroyed) continue;
      const rp = r.car.physics;
      const [fx, fz] = rp.forward();
      for (const off of [CAR_HIT_OFFSET, -CAR_HIT_OFFSET]) {
        const t = rayCircle(muzzle.x, muzzle.z, dx, dz, rp.x + fx * off, rp.z + fz * off, CAR_HIT_RADIUS);
        if (t !== null && t < hitT) {
          hitT = t;
          victim = r;
        }
      }
    }
    // Barriers: march along the ray until the lateral offset leaves the track.
    let hitWall = false;
    const wall = this.track.def.wallOffset;
    let hint = shooter.car.trackIndex;
    for (let t = 1.5; t < hitT; t += 1.5) {
      const q = this.track.query(muzzle.x + dx * t, muzzle.z + dz * t, hint);
      hint = q.index;
      if (Math.abs(q.lateral) > wall) {
        hitT = t;
        hitWall = true;
        victim = null;
        break;
      }
    }

    const end = this.v2.set(muzzle.x + dx * hitT, 0.85, muzzle.z + dz * hitT);
    this.effects.tracers.add(muzzle, end);
    this.effects.muzzleFlash(muzzle);
    this.sound.gun(muzzle, shooter.isPlayer);

    if (victim) {
      this.effects.sparksBurst(end, 4, 7);
      victim.car.physics.applyImpulse(dx * 0.25, dz * 0.25, (Math.random() - 0.5) * 0.15);
      this.damage(victim, GUN_DAMAGE, shooter);
      if (victim.isPlayer || shooter.isPlayer) this.sound.hit(end);
    } else if (hitWall) {
      this.effects.sparksBurst(end, 3, 5);
    }
  }

  // ---------------------------------------------------------------------------
  // Mines
  // ---------------------------------------------------------------------------

  tryDropMine(owner: Racer): void {
    if (owner.destroyed || owner.mines <= 0 || owner.mineCooldown > 0) return;
    owner.mines--;
    owner.mineCooldown = MINE_COOLDOWN;
    const p = owner.car.physics;
    const [fx, fz] = p.forward();
    const x = p.x - fx * 3;
    const z = p.z - fz * 3;

    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.mineBody, this.mineBodyMat);
    body.position.y = 0.11;
    body.castShadow = true;
    mesh.add(body);
    const light = new THREE.Mesh(this.mineLightGeo, this.mineLightMat);
    light.position.y = 0.25;
    mesh.add(light);
    mesh.position.set(x, 0.03, z);
    this.group.add(mesh);
    this.mines.push({ x, z, owner, age: 0, mesh });
    this.sound.mineDrop(mesh.position);

    if (this.mines.length > MAX_MINES) this.removeMine(0);
  }

  private removeMine(index: number): void {
    const [m] = this.mines.splice(index, 1);
    this.group.remove(m.mesh);
  }

  private detonate(index: number): void {
    const mine = this.mines[index];
    const pos = new THREE.Vector3(mine.x, 0.5, mine.z);
    this.removeMine(index);
    this.effects.explosion(pos, 1);
    this.sound.explosion(pos, 1);
    this.blast(pos, MINE_BLAST_RADIUS, MINE_DAMAGE, mine.owner, 14);
  }

  /** Radial damage and knock-back with linear falloff. */
  private blast(pos: THREE.Vector3, radius: number, damage: number, source: Racer | null, push: number): void {
    for (const r of this.racers) {
      if (r.destroyed) continue;
      const p = r.car.physics;
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const nx = d > 0.01 ? dx / d : 1;
      const nz = d > 0.01 ? dz / d : 0;
      p.applyImpulse(nx * push * k, nz * push * k, (Math.random() < 0.5 ? -1 : 1) * (2 + 4 * k));
      this.damage(r, damage * (0.35 + 0.65 * k), source);
    }
  }

  // ---------------------------------------------------------------------------
  // Damage and wrecks
  // ---------------------------------------------------------------------------

  damage(victim: Racer, amount: number, source: Racer | null): void {
    if (victim.destroyed || victim.invulnerable > 0 || amount <= 0) return;
    victim.health -= amount;
    if (source && source !== victim) victim.lastAttacker = source;
    if (victim.health <= 0) this.wreck(victim);
  }

  private wreck(victim: Racer): void {
    victim.health = 0;
    victim.destroyed = true;
    victim.wrecks++;
    victim.respawnTimer = 3;
    victim.setWrecked(true);
    const killer = victim.lastAttacker;
    if (killer) killer.kills++;
    const p = victim.car.physics;
    p.applyImpulse(0, 0, (Math.random() - 0.5) * 6);
    const pos = new THREE.Vector3(p.x, 0.8, p.z);
    this.effects.explosion(pos, 1.6);
    this.sound.explosion(pos, 1.6);
    this.blast(pos, WRECK_BLAST_RADIUS, WRECK_BLAST_DAMAGE, killer, 8);
    this.events.onWreck?.(victim, killer);
  }

  /** Damage from hitting barriers or other cars, above a speed threshold. */
  impactDamage(victim: Racer, impactSpeed: number, source: Racer | null): void {
    const threshold = 11;
    if (impactSpeed > threshold) this.damage(victim, (impactSpeed - threshold) * 1.3, source);
  }

  update(dt: number): void {
    this.blinkTime += dt;
    this.mineLightMat.emissiveIntensity = Math.sin(this.blinkTime * 10) > 0 ? 6 : 0.3;

    for (const r of this.racers) {
      r.fireCooldown = Math.max(0, r.fireCooldown - dt);
      r.mineCooldown = Math.max(0, r.mineCooldown - dt);
      r.invulnerable = Math.max(0, r.invulnerable - dt);
      if (r.health > MAX_HEALTH) r.health = MAX_HEALTH;
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.age += dt;
      if (m.age > MINE_LIFETIME) {
        this.removeMine(i);
        continue;
      }
      if (m.age < MINE_ARM_TIME) continue;
      for (const r of this.racers) {
        if (r.destroyed) continue;
        if (r === m.owner && m.age < MINE_OWNER_GRACE) continue;
        const p = r.car.physics;
        if ((p.x - m.x) ** 2 + (p.z - m.z) ** 2 < MINE_TRIGGER_RADIUS ** 2) {
          this.detonate(i);
          break;
        }
      }
    }
  }

  dispose(): void {
    this.mineBody.dispose();
    this.mineBodyMat.dispose();
    this.mineLightGeo.dispose();
    this.mineLightMat.dispose();
  }
}

/** Distance along a unit ray to a circle, or null if it misses. */
function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number | null {
  const lx = ox - cx;
  const lz = oz - cz;
  const b = lx * dx + lz * dz;
  const c = lx * lx + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return c < 0 ? 0 : null;
  return t;
}
