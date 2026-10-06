import * as THREE from 'three';

const MAX_TRACERS = 256;

/** Short-lived glowing bullet streaks, all drawn in one LineSegments call. */
export class Tracers {
  readonly lines: THREE.LineSegments;
  private readonly positions = new Float32Array(MAX_TRACERS * 6);
  private readonly colors = new Float32Array(MAX_TRACERS * 6);
  private readonly life = new Float32Array(MAX_TRACERS);
  private cursor = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
  }

  add(from: THREE.Vector3, to: THREE.Vector3): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_TRACERS;
    this.positions.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.life[i] = 0.06;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.life[i] = Math.max(0, this.life[i] - dt);
      const k = this.life[i] / 0.06;
      // HDR colors so the streaks bloom; the tail is dimmer than the head.
      this.colors.set([2.5 * k, 1.6 * k, 0.4 * k, 6 * k, 4.5 * k, 1.5 * k], i * 6);
    }
    const a = this.lines.geometry.attributes;
    a.position.needsUpdate = true;
    a.color.needsUpdate = true;
  }
}
