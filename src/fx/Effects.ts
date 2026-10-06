import * as THREE from 'three';
import { createSoftParticleTexture } from '../world/textures';
import { ParticleSystem } from './Particles';
import { SkidMarks } from './SkidMarks';
import { Tracers } from './Tracers';

const LIGHT_POOL = 4;
const MAX_SCORCH = 24;

/** Central place for every visual effect, so gameplay code only says *what* happened. */
export class Effects {
  readonly group = new THREE.Group();
  readonly skids = new SkidMarks();
  readonly smoke: ParticleSystem;
  readonly fire: ParticleSystem;
  readonly sparks: ParticleSystem;
  readonly tracers = new Tracers();
  private readonly lights: Array<{ light: THREE.PointLight; life: number; max: number; intensity: number }> = [];
  private lightCursor = 0;
  private readonly scorchMarks: THREE.Mesh[] = [];
  private scorchCursor = 0;
  private readonly tmpColor = new THREE.Color();
  onExplosion: (pos: THREE.Vector3, scale: number) => void = () => {};

  constructor() {
    const tex = createSoftParticleTexture();
    this.smoke = new ParticleSystem({ maxParticles: 2500, texture: tex, blending: THREE.NormalBlending });
    this.fire = new ParticleSystem({ maxParticles: 1200, texture: tex, blending: THREE.AdditiveBlending });
    this.sparks = new ParticleSystem({ maxParticles: 1200, texture: tex, blending: THREE.AdditiveBlending });
    this.group.add(this.skids.mesh, this.smoke.points, this.fire.points, this.sparks.points, this.tracers.lines);

    for (let i = 0; i < LIGHT_POOL; i++) {
      // Lights stay in the scene at zero intensity: toggling visibility would change
      // the light count and force every material to recompile (a visible hitch).
      const light = new THREE.PointLight(0xff8a30, 0, 30, 1.6);
      this.group.add(light);
      this.lights.push({ light, life: 0, max: 1, intensity: 0 });
    }

    const scorchTex = createSoftParticleTexture();
    const scorchGeo = new THREE.PlaneGeometry(1, 1);
    scorchGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SCORCH; i++) {
      const m = new THREE.Mesh(
        scorchGeo,
        new THREE.MeshBasicMaterial({ color: 0x050403, alphaMap: scorchTex, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
      );
      m.visible = false;
      m.renderOrder = 1;
      this.group.add(m);
      this.scorchMarks.push(m);
    }
  }

  setViewport(heightPx: number, fov: number): void {
    for (const p of [this.smoke, this.fire, this.sparks]) p.setViewport(heightPx, fov);
  }

  update(dt: number): void {
    this.smoke.update(dt);
    this.fire.update(dt);
    this.sparks.update(dt);
    this.tracers.update(dt);
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      const k = Math.max(0, l.life / l.max);
      l.light.intensity = l.intensity * k * k;
    }
  }

  flash(pos: THREE.Vector3, intensity: number, duration: number, color = 0xff8a30): void {
    const l = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % LIGHT_POOL;
    l.light.position.copy(pos).setY(pos.y + 1.5);
    l.light.color.set(color);
    l.life = l.max = duration;
    l.intensity = intensity;
    l.light.intensity = intensity;
  }

  sparksBurst(pos: THREE.Vector3, count: number, speed = 10): void {
    for (let i = 0; i < count; i++) {
      this.sparks.emit({
        position: pos,
        velocity: new THREE.Vector3((Math.random() - 0.5) * speed, 1 + Math.random() * speed * 0.5, (Math.random() - 0.5) * speed),
        color: this.tmpColor.setHSL(0.08 + Math.random() * 0.06, 1, 0.6),
        size: 0.22,
        growth: 0.3,
        life: 0.25 + Math.random() * 0.35,
        alpha: 1,
        gravity: -18,
        drag: 2,
      });
    }
  }

  muzzleFlash(pos: THREE.Vector3): void {
    this.fire.emit({
      position: pos,
      velocity: new THREE.Vector3(0, 0, 0),
      color: this.tmpColor.setRGB(3, 2, 0.8),
      size: 0.9,
      growth: 0.4,
      life: 0.05,
      alpha: 1,
      gravity: 0,
      drag: 0,
    });
  }

  explosion(pos: THREE.Vector3, scale = 1): void {
    const n = Math.round(60 * scale);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.fire.emit({
        position: pos.clone().addScaledVector(dir, Math.random() * scale),
        velocity: dir.clone().multiplyScalar((4 + Math.random() * 10) * scale),
        color: this.tmpColor.setHSL(0.04 + Math.random() * 0.08, 1, 0.55).multiplyScalar(2.5),
        size: (1.5 + Math.random() * 2) * scale,
        growth: 2.2,
        life: 0.35 + Math.random() * 0.5,
        alpha: 1,
        gravity: 3,
        drag: 3,
      });
    }
    for (let i = 0; i < n * 0.8; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, 0.3 + Math.random(), Math.random() - 0.5).normalize();
      this.smoke.emit({
        position: pos.clone().addScaledVector(dir, Math.random() * scale * 1.5),
        velocity: dir.multiplyScalar((2 + Math.random() * 5) * scale),
        color: this.tmpColor.setRGB(0.12, 0.11, 0.1),
        size: (2 + Math.random() * 2) * scale,
        growth: 3.5,
        life: 1.5 + Math.random() * 1.5,
        alpha: 0.75,
        gravity: 1.2,
        drag: 1.8,
      });
    }
    this.sparksBurst(pos, Math.round(40 * scale), 22 * scale);
    this.flash(pos, 220 * scale, 0.6);
    this.scorch(pos, 4.5 * scale);
    this.onExplosion(pos, scale);
  }

  scorch(pos: THREE.Vector3, size: number): void {
    const m = this.scorchMarks[this.scorchCursor];
    this.scorchCursor = (this.scorchCursor + 1) % MAX_SCORCH;
    m.position.set(pos.x, 0.075, pos.z);
    m.scale.setScalar(size);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.visible = true;
  }

  /** Continuous smoke (and fire when critical) from a damaged car. */
  damageSmoke(pos: THREE.Vector3, health: number, dt: number): void {
    if (health > 45) return;
    const severity = 1 - health / 45;
    if (Math.random() < dt * 25 * severity) {
      const dark = 0.35 - severity * 0.25;
      this.smoke.emit({
        position: pos,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, 2 + Math.random(), (Math.random() - 0.5) * 0.8),
        color: this.tmpColor.setRGB(dark, dark, dark),
        size: 0.8,
        growth: 4,
        life: 1 + Math.random(),
        alpha: 0.6,
        gravity: 0.5,
        drag: 1,
      });
    }
    if (health < 20 && Math.random() < dt * 30) {
      this.fire.emit({
        position: pos,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.5, (Math.random() - 0.5) * 0.6),
        color: this.tmpColor.setHSL(0.06, 1, 0.55).multiplyScalar(2),
        size: 0.7,
        growth: 0.4,
        life: 0.3 + Math.random() * 0.2,
        alpha: 0.9,
        gravity: 1,
        drag: 1,
      });
    }
  }

  tireSmoke(pos: THREE.Vector3, carVelocity: THREE.Vector3, gravel: boolean): void {
    this.smoke.emit({
      position: pos.clone().setY(0.4),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5).addScaledVector(carVelocity, 0.15),
      color: gravel ? this.tmpColor.set(0x9a8160) : this.tmpColor.set(0xd8d4cc),
      size: 1.2,
      growth: gravel ? 3 : 4,
      life: 0.9 + Math.random() * 0.8,
      alpha: gravel ? 0.5 : 0.35,
      gravity: 0.4,
      drag: 1.5,
    });
  }

  /** Turbo exhaust flame. */
  boostFlame(pos: THREE.Vector3, backward: THREE.Vector3): void {
    this.fire.emit({
      position: pos,
      velocity: backward.clone().multiplyScalar(6 + Math.random() * 3),
      color: this.tmpColor.setRGB(0.6, 1.2, 3.2),
      size: 0.55,
      growth: 0.2,
      life: 0.12 + Math.random() * 0.06,
      alpha: 1,
      gravity: 0,
      drag: 2,
    });
  }
}
