import * as THREE from 'three';

const MAX_SEGMENTS = 4000;
const MARK_WIDTH = 0.32;
const MIN_SEGMENT_LENGTH = 0.25;

/**
 * Tire marks drawn as quads in a ring buffer. Each tracked wheel keeps its last
 * contact point; a new quad is appended whenever the wheel has moved enough.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private cursor = 0;
  private readonly last = new Map<string, THREE.Vector3 | null>();

  constructor() {
    this.positions = new Float32Array(MAX_SEGMENTS * 4 * 3);
    this.alphas = new Float32Array(MAX_SEGMENTS * 4);
    const indices = new Uint32Array(MAX_SEGMENTS * 6);
    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      uniforms: { uColor: { value: new THREE.Color(0x0a0a0a) } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor, vAlpha); }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** Erases every mark (used when the track changes). */
  clear(): void {
    this.alphas.fill(0);
    (this.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    this.last.clear();
    this.cursor = 0;
  }

  /** Adds a mark for `wheelId` at `point`; pass `active=false` to lift the tire. */
  update(wheelId: string, point: THREE.Vector3, active: boolean, intensity = 0.55): void {
    const prev = this.last.get(wheelId) ?? null;
    if (!active) {
      this.last.set(wheelId, null);
      return;
    }
    if (!prev) {
      this.last.set(wheelId, point.clone());
      return;
    }
    const dx = point.x - prev.x;
    const dz = point.z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < MIN_SEGMENT_LENGTH) return;
    if (len > 4) {
      // Teleport (reset); start a new mark instead of drawing a long streak.
      prev.copy(point);
      return;
    }
    const nx = (-dz / len) * MARK_WIDTH * 0.5;
    const nz = (dx / len) * MARK_WIDTH * 0.5;
    const y0 = prev.y + 0.07;
    const y1 = point.y + 0.07;
    const base = this.cursor * 12;
    this.positions.set(
      [prev.x + nx, y0, prev.z + nz, prev.x - nx, y0, prev.z - nz, point.x + nx, y1, point.z + nz, point.x - nx, y1, point.z - nz],
      base,
    );
    this.alphas.set([intensity, intensity, intensity, intensity], this.cursor * 4);
    this.cursor = (this.cursor + 1) % MAX_SEGMENTS;
    prev.copy(point);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
