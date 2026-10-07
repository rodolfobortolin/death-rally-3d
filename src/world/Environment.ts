import * as THREE from 'three';
import { mergeByCell } from '../car/mergeStatic';
import { disposeObject, type Track } from './Track';
import type { TrackTheme } from './tracks';
import { buildFactory } from './scenery/factory';
import { buildQuarry } from './scenery/quarry';
import { Scenery } from './scenery/Scenery';
import { buildYard } from './scenery/yard';
import { createFactoryFloorTextures, createGroundTextures, createSandGroundTextures, type SurfaceTextures } from './textures';

/** Sky, light and fog settings for one theme. */
interface Atmosphere {
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  /** Strength of the sun disc and glow drawn in the sky. */
  sunGlow: number;
  sunOffset: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  envIntensity: number;
  ground: () => SurfaceTextures;
  groundColor: number;
  /** Texture repeats across the ground plane; 0 means one tile per 6 m slab. */
  groundRepeat: number;
}

const ATMOSPHERES: Record<TrackTheme, Atmosphere> = {
  yard: {
    skyTop: 0x2a4a7a, skyHorizon: 0xe8a86a, skyBottom: 0x5a4636, sunGlow: 1,
    sunOffset: [-70, 110, 55], sunColor: 0xffd2a0, sunIntensity: 3.2,
    hemiSky: 0xa8c4e8, hemiGround: 0x5c4630, hemiIntensity: 0.9,
    fogColor: 0xb08868, fogNear: 260, fogFar: 650, envIntensity: 0.55,
    ground: createGroundTextures, groundColor: 0xffffff, groundRepeat: 60,
  },
  quarry: {
    skyTop: 0x3a6aa8, skyHorizon: 0xf0d2a8, skyBottom: 0x7a6248, sunGlow: 1,
    sunOffset: [-60, 120, 40], sunColor: 0xffe2b8, sunIntensity: 3.4,
    hemiSky: 0xbcd0e8, hemiGround: 0x7a6040, hemiIntensity: 0.95,
    fogColor: 0xc8b090, fogNear: 240, fogFar: 600, envIntensity: 0.6,
    ground: createSandGroundTextures, groundColor: 0xffffff, groundRepeat: 70,
  },
  warehouse: {
    skyTop: 0x101318, skyHorizon: 0x2a2620, skyBottom: 0x0c0b09, sunGlow: 0,
    // Light through the roof skylights: nearly overhead, cool and soft.
    sunOffset: [-25, 120, 30], sunColor: 0xdfe8ff, sunIntensity: 1.7,
    hemiSky: 0x8a96aa, hemiGround: 0x3a3228, hemiIntensity: 0.65,
    fogColor: 0x121316, fogNear: 140, fogFar: 380, envIntensity: 0.35,
    ground: createFactoryFloorTextures, groundColor: 0xa29e96, groundRepeat: 0,
  },
};

const WORLD_SIZE = 900;

/** Sky, lighting, ground and all the scenery placed around the circuit. */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly sunOffset: THREE.Vector3;
  private readonly atmosphere: Atmosphere;
  /** Objects added straight to the scene (sky, lights), removed on dispose. */
  private readonly sceneObjects: THREE.Object3D[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    track: Track,
    renderer: THREE.WebGLRenderer,
  ) {
    this.atmosphere = ATMOSPHERES[track.def.theme];
    this.sunOffset = new THREE.Vector3(...this.atmosphere.sunOffset);
    this.buildSky(renderer);
    this.sun = this.buildLights();
    this.buildGround();

    const ctx = new Scenery(this.group, track, 1337);
    if (track.def.theme === 'quarry') buildQuarry(ctx);
    else if (track.def.theme === 'warehouse') buildFactory(ctx);
    else buildYard(ctx);
    // The scenery never moves: bake it into a few meshes per area to save draw calls.
    mergeByCell(this.group, 100);
  }

  /** Shadow resolution and coverage: smaller maps cover a tighter area around the car. */
  setShadowQuality(quality: 'low' | 'medium' | 'high'): void {
    const [mapSize, extent] = quality === 'high' ? [4096, 110] : quality === 'medium' ? [2048, 75] : [1024, 60];
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== mapSize) {
      shadow.mapSize.set(mapSize, mapSize);
      shadow.map?.dispose();
      shadow.map = null; // reallocated at the new size on the next render
    }
    const cam = shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.updateProjectionMatrix();
  }

  /** Keeps the shadow frustum centered on the player so shadows stay sharp. */
  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  /** Removes everything this environment added to the scene and frees GPU memory. */
  dispose(): void {
    this.scene.remove(this.group, ...this.sceneObjects);
    disposeObject(this.group);
    for (const o of this.sceneObjects) disposeObject(o);
    this.sun.shadow.map?.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }

  // ---------------------------------------------------------------------------

  private buildSky(renderer: THREE.WebGLRenderer): void {
    const a = this.atmosphere;
    const skyGeo = new THREE.SphereGeometry(1, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(a.skyTop) },
        uHorizon: { value: new THREE.Color(a.skyHorizon) },
        uBottom: { value: new THREE.Color(a.skyBottom) },
        uSunDir: { value: this.sunOffset.clone().normalize() },
        uSunGlow: { value: a.sunGlow },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform float uSunGlow;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.4));
          float sun = max(dot(vDir, uSunDir), 0.0);
          col += uSunGlow * vec3(1.0, 0.75, 0.45) * (pow(sun, 400.0) * 6.0 + pow(sun, 12.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.scale.setScalar(1000);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
    this.sceneObjects.push(sky);

    // Image-based lighting from the same sky so car paint gets matching reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envMat = skyMat.clone();
    const envSky = new THREE.Mesh(skyGeo, envMat);
    envSky.scale.setScalar(100);
    envScene.add(envSky);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = a.envIntensity;
    envMat.dispose();
    pmrem.dispose();

    this.scene.fog = new THREE.Fog(a.fogColor, a.fogNear, a.fogFar);
  }

  private buildLights(): THREE.DirectionalLight {
    const a = this.atmosphere;
    const hemi = new THREE.HemisphereLight(a.hemiSky, a.hemiGround, a.hemiIntensity);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(a.sunColor, a.sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = 110;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sceneObjects.push(hemi, sun, sun.target);
    return sun;
  }

  private buildGround(): void {
    const a = this.atmosphere;
    const tex = a.ground();
    const size = WORLD_SIZE * 1.6;
    const repeat = a.groundRepeat || size / 6;
    tex.map.repeat.set(repeat, repeat);
    tex.normalMap.repeat.set(repeat, repeat);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        color: a.groundColor,
        roughness: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }
}
