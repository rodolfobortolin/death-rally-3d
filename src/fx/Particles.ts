import * as THREE from 'three';

export interface ParticleOptions {
  maxParticles: number;
  texture: THREE.Texture;
  blending: THREE.Blending;
}

export interface EmitParams {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  /** Size multiplier reached at the end of life. */
  growth: number;
  life: number;
  alpha: number;
  /** Vertical acceleration (negative = gravity, positive = buoyant smoke). */
  gravity: number;
  drag: number;
}

/** CPU-simulated point sprites (smoke, dust, sparks) in a single draw call. */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly growth: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(opts: ParticleOptions) {
    const n = (this.max = opts.maxParticles);
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.growth = new Float32Array(n);
    this.baseAlpha = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.blending,
      vertexColors: true,
      uniforms: { uMap: { value: opts.texture }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, vAlpha * t.a);
          if (gl_FragColor.a < 0.003) discard;
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Must be called on resize so sprite sizes are expressed in world meters. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(p: EmitParams): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos.set([p.position.x, p.position.y, p.position.z], i * 3);
    this.vel.set([p.velocity.x, p.velocity.y, p.velocity.z], i * 3);
    this.col.set([p.color.r, p.color.g, p.color.b], i * 3);
    this.life[i] = this.maxLife[i] = p.life;
    this.baseSize[i] = p.size;
    this.growth[i] = p.growth;
    this.baseAlpha[i] = p.alpha;
    this.gravity[i] = p.gravity;
    this.drag[i] = p.drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const k = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d + this.gravity[i] * dt;
      this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] = Math.max(0.05, this.pos[k + 1] + this.vel[k + 1] * dt);
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + (this.growth[i] - 1) * t);
      // Quick fade in, long fade out.
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, t * 8) * (1 - t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}
