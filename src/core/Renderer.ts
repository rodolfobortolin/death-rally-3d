import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Subtle vignette + film grain to give the image a gritty, cinematic look. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - smoothstep(0.35, 0.85, d) * uVignette;
      c.rgb += (hash(vUv * 800.0 + uTime) - 0.5) * 0.025;
      gl_FragColor = c;
    }`,
};

export type GraphicsQuality = 'low' | 'medium' | 'high';

interface QualityPreset {
  /** Upper bound for the device pixel ratio (Retina screens report 2). */
  maxPixelRatio: number;
  msaa: number;
  bloom: boolean;
  grain: boolean;
}

const PRESETS: Record<GraphicsQuality, QualityPreset> = {
  low: { maxPixelRatio: 1, msaa: 2, bloom: false, grain: false },
  medium: { maxPixelRatio: 1.25, msaa: 4, bloom: true, grain: true },
  high: { maxPixelRatio: 2, msaa: 4, bloom: true, grain: true },
};

/** WebGL renderer with an HDR post-processing chain (bloom, grading, tone mapping). */
export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;

  constructor(container: HTMLElement, scene: THREE.Scene, camera: THREE.Camera) {
    this.webgl = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, PRESETS.medium.maxPixelRatio));
    this.webgl.setSize(window.innerWidth, window.innerHeight);
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.15;
    container.appendChild(this.webgl.domElement);

    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: PRESETS.medium.msaa });
    this.composer = new EffectComposer(this.webgl, target);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.6, 1.0);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** Trades image quality for frame rate. Call `resize` afterwards to apply the pixel ratio. */
  setQuality(quality: GraphicsQuality): void {
    const preset = PRESETS[quality];
    const pixelRatio = Math.min(window.devicePixelRatio, preset.maxPixelRatio);
    this.webgl.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== preset.msaa) {
        rt.samples = preset.msaa;
        rt.dispose(); // reallocated with the new sample count on next use
      }
    }
    this.bloom.enabled = preset.bloom;
    this.grade.enabled = preset.grain;
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  resize(width: number, height: number): void {
    this.webgl.setSize(width, height);
    this.composer.setSize(width, height);
  }

  render(time: number): void {
    this.grade.uniforms.uTime.value = time % 100;
    this.composer.render();
  }
}
