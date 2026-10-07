import * as THREE from 'three';
import { createRng } from '../core/math';
import type { CarVisual } from './CarModel';

interface PanelState {
  mesh: THREE.Mesh;
  original: Float32Array;
  /** Per-vertex inward offset at full damage. */
  offsets: Float32Array;
  /** Per-vertex 0..1 weight of how scorched the paint gets around dents. */
  grime: Float32Array;
  colors: THREE.BufferAttribute;
}

interface LooseState {
  part: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  /** Damage level where the part starts hanging, and where it falls off. */
  hangAt: number;
  dropAt: number;
  hangRotation: THREE.Euler;
  hangDrop: number;
}

const SOOT = new THREE.Color(0x2a221a);
const CHARRED = new THREE.Color(0x141110);

/**
 * Makes a car look progressively wrecked: dented panels, dirty paint, parts that
 * hang loose and fall off, and broken headlights. Fully reversible for repairs.
 */
export class CarDamage {
  private readonly panels: PanelState[] = [];
  private readonly loose: LooseState[] = [];
  private readonly paintColor: THREE.Color;
  private applied = -1;
  private appliedWrecked = false;

  constructor(private readonly visual: CarVisual, seed: number) {
    const rnd = createRng(seed);
    this.paintColor = visual.paintMaterial.color.clone();

    // A handful of dent centers spread around the body, in car-local space.
    const dents = Array.from({ length: 7 }, () => ({
      center: new THREE.Vector3((rnd() - 0.5) * 2.2, 0.6 + rnd() * 0.9, (rnd() - 0.5) * 4.6),
      radius: 0.6 + rnd() * 0.6,
      depth: 0.2 + rnd() * 0.2,
    }));

    for (const mesh of visual.damage.panels) {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const original = new Float32Array(pos.array as Float32Array);
      const offsets = new Float32Array(original.length);
      const grime = new Float32Array(pos.count);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        // Vertex in car space (panels may be offset inside the body group).
        v.fromArray(original, i * 3).add(mesh.position);
        for (const d of dents) {
          const dist = v.distanceTo(d.center);
          if (dist > d.radius) continue;
          const k = 1 - dist / d.radius;
          const fall = k * k * (3 - 2 * k); // smoothstep falloff
          // Push towards the car's center line and slightly down.
          const inward = new THREE.Vector3(-v.x, -0.4, -v.z * 0.25).normalize();
          offsets[i * 3] += inward.x * d.depth * fall;
          offsets[i * 3 + 1] += inward.y * d.depth * fall;
          offsets[i * 3 + 2] += inward.z * d.depth * fall;
          grime[i] = Math.max(grime[i], fall);
        }
        // A little overall grime everywhere, more towards the bottom.
        grime[i] = Math.max(grime[i], 0.25 + rnd() * 0.15 - v.y * 0.1);
      }
      const colors = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
      mesh.geometry.setAttribute('color', colors);
      this.panels.push({ mesh, original, offsets, grime, colors });
    }

    const n = visual.damage.loose.length;
    visual.damage.loose.forEach((part, i) => {
      // Earlier parts in the list are the most fragile.
      const hangAt = 0.35 + (i / Math.max(1, n)) * 0.4;
      this.loose.push({
        part,
        position: part.position.clone(),
        rotation: part.rotation.clone(),
        hangAt,
        dropAt: hangAt + 0.22,
        hangRotation: new THREE.Euler((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.7),
        hangDrop: 0.08 + rnd() * 0.15,
      });
    });
  }

  /** `damage` is 0 (pristine) .. 1 (destroyed). */
  apply(damage: number, wrecked: boolean): void {
    const level = Math.round(THREE.MathUtils.clamp(damage, 0, 1) * 50) / 50;
    if (level === this.applied && wrecked === this.appliedWrecked) return;
    this.applied = level;
    this.appliedWrecked = wrecked;

    // Dents grow from 20% damage onwards.
    const dent = THREE.MathUtils.smoothstep(level, 0.2, 1);
    for (const p of this.panels) {
      const pos = p.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i++) arr[i] = p.original[i] + p.offsets[i] * dent;
      pos.needsUpdate = true;
      p.mesh.geometry.computeVertexNormals();
      // Scorch the paint around the dents (vertex colors multiply the paint color).
      const c = p.colors.array as Float32Array;
      for (let i = 0; i < p.grime.length; i++) {
        const shade = 1 - Math.min(0.85, p.grime[i] * dent * 1.1);
        c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = shade;
      }
      p.colors.needsUpdate = true;
    }

    for (const l of this.loose) {
      l.part.position.copy(l.position);
      l.part.rotation.copy(l.rotation);
      l.part.visible = level < l.dropAt;
      if (level >= l.hangAt && level < l.dropAt) {
        const k = (level - l.hangAt) / (l.dropAt - l.hangAt);
        l.part.rotation.set(l.rotation.x + l.hangRotation.x * k, l.rotation.y + l.hangRotation.y * k, l.rotation.z + l.hangRotation.z * k);
        l.part.position.y -= l.hangDrop * k;
      }
    }

    const heads = this.visual.damage.headlights;
    heads.forEach((m, i) => {
      const broken = level > (i === 0 ? 0.55 : 0.8);
      m.emissiveIntensity = broken ? 0 : 3;
      m.color.set(broken ? 0x222222 : 0xffffff);
    });

    const paint = this.visual.paintMaterial;
    if (wrecked) {
      paint.color.copy(CHARRED);
      paint.roughness = 0.95;
      paint.clearcoat = 0.05; // keep > 0 so the shader variant doesn't change
    } else {
      paint.color.copy(this.paintColor).lerp(SOOT, level * 0.6);
      paint.roughness = 0.38 + level * 0.45;
      paint.clearcoat = Math.max(0.05, 1 - level * 1.2);
    }
  }
}
