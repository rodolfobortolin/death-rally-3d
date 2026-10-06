import * as THREE from 'three';
import { createRng } from '../core/math';
import type { Track } from './Track';
import { createConcreteTexture, createCorrugatedTexture, createFacadeTextures, createGroundTextures } from './textures';

const WORLD_SIZE = 900;

/** Sky, lighting, ground and all the scenery placed around the circuit. */
export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly sunOffset = new THREE.Vector3(-70, 110, 55);
  private readonly occupied: Array<{ x: number; z: number; r: number }> = [];
  private readonly rnd = createRng(1337);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly track: Track,
    renderer: THREE.WebGLRenderer,
  ) {
    this.buildSky(renderer);
    this.sun = this.buildLights();
    this.buildGround();
    this.buildWarehouses();
    this.buildContainers();
    this.buildTireStacks();
    this.buildBarrels();
    this.buildLampPosts();
    this.buildTrees();
    this.buildRocks();
  }

  /** Keeps the shadow frustum centered on the player so shadows stay sharp. */
  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }

  // ---------------------------------------------------------------------------

  private buildSky(renderer: THREE.WebGLRenderer): void {
    const skyGeo = new THREE.SphereGeometry(1, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x2a4a7a) },
        uHorizon: { value: new THREE.Color(0xe8a86a) },
        uBottom: { value: new THREE.Color(0x5a4636) },
        uSunDir: { value: this.sunOffset.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.4));
          float sun = max(dot(vDir, uSunDir), 0.0);
          col += vec3(1.0, 0.75, 0.45) * (pow(sun, 400.0) * 6.0 + pow(sun, 12.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.scale.setScalar(1000);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);

    // Image-based lighting from the same sky so car paint gets warm reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(skyGeo, skyMat.clone());
    envSky.material.uniforms.uSunDir.value = this.sunOffset.clone().normalize();
    envSky.scale.setScalar(100);
    envScene.add(envSky);
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.fog = new THREE.Fog(0xb08868, 260, 650);
  }

  private buildLights(): THREE.DirectionalLight {
    const hemi = new THREE.HemisphereLight(0xa8c4e8, 0x5c4630, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffd2a0, 3.2);
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
    return sun;
  }

  private buildGround(): void {
    const tex = createGroundTextures();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SIZE * 1.6, WORLD_SIZE * 1.6),
      new THREE.MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        normalScale: new THREE.Vector2(0.8, 0.8),
        roughness: 1,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  // ---------------------------------------------------------------------------
  // Placement helpers
  // ---------------------------------------------------------------------------

  /** Tries random spots until one is clear of the track and other props. */
  private findSpot(radius: number, minTrackDist: number, maxTrackDist: number, tries = 60): { x: number; z: number } | null {
    for (let t = 0; t < tries; t++) {
      const x = (this.rnd() - 0.5) * WORLD_SIZE * 0.75 + 10;
      const z = (this.rnd() - 0.5) * WORLD_SIZE * 0.75 + 25;
      const d = this.track.distanceToCenterline(x, z);
      if (d < minTrackDist + radius || d > maxTrackDist) continue;
      if (this.occupied.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + radius) ** 2)) continue;
      this.occupied.push({ x, z, r: radius });
      return { x, z };
    }
    return null;
  }

  /** Spot right behind the barrier at a given track distance. */
  private trackside(along: number, side: 1 | -1, extra: number): { x: number; z: number; heading: number } {
    return this.track.pointAt(along, side * (this.track.def.wallOffset + extra));
  }

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  private buildWarehouses(): void {
    const facade = createFacadeTextures();
    const corrugated = createCorrugatedTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: facade.map,
      emissiveMap: facade.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: 0.9,
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: corrugated, color: 0x7a6e62, roughness: 0.6, metalness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.8 });

    for (let i = 0; i < 50; i++) {
      const w = 18 + this.rnd() * 26;
      const d = 14 + this.rnd() * 22;
      const h = 8 + this.rnd() * 16;
      const spot = this.findSpot(Math.hypot(w, d) / 2, 16, 240);
      if (!spot) continue;
      const b = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      walls.position.y = h / 2;
      const uvScale = (geo: THREE.BufferGeometry) => {
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.round(w / 8), uv.getY(k) * Math.max(1, Math.round(h / 8)));
      };
      uvScale(walls.geometry);
      walls.castShadow = walls.receiveShadow = true;
      b.add(walls);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.6, d + 0.6), roofMat);
      roof.position.y = h + 0.3;
      roof.castShadow = roof.receiveShadow = true;
      b.add(roof);
      // Rooftop clutter: AC units and vents read well from above.
      const units = 2 + Math.floor(this.rnd() * 4);
      for (let u = 0; u < units; u++) {
        const s = 1.5 + this.rnd() * 2.5;
        const unit = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), trimMat);
        unit.position.set((this.rnd() - 0.5) * (w - s - 2), h + 0.6 + s * 0.3, (this.rnd() - 0.5) * (d - s - 2));
        unit.castShadow = true;
        b.add(unit);
      }
      b.position.set(spot.x, 0, spot.z);
      b.rotation.y = Math.floor(this.rnd() * 4) * (Math.PI / 2) + (this.rnd() - 0.5) * 0.3;
      this.group.add(b);
    }
  }

  private buildContainers(): void {
    const tex = createCorrugatedTexture();
    tex.repeat.set(3, 1);
    const geo = new THREE.BoxGeometry(2.5, 2.6, 6.1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 });
    const colors = [0xa23a24, 0x2a5d8a, 0x3f6e3a, 0xc08a2a, 0x6a6a6a, 0x8a3060, 0xd0d0c8];
    const instances: THREE.Matrix4[] = [];
    const tints: THREE.Color[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let yard = 0; yard < 40; yard++) {
      const spot = this.findSpot(11, 13, 180);
      if (!spot) continue;
      const rot = this.rnd() * Math.PI;
      const rows = 1 + Math.floor(this.rnd() * 2);
      const cols = 2 + Math.floor(this.rnd() * 4);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const stack = 1 + Math.floor(this.rnd() * 3);
          for (let s = 0; s < stack; s++) {
            const lx = (c - cols / 2) * 2.7;
            const lz = (r - rows / 2) * 6.4;
            const cos = Math.cos(rot);
            const sin = Math.sin(rot);
            const jitter = (this.rnd() - 0.5) * 0.15;
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + jitter);
            m.compose(new THREE.Vector3(spot.x + lx * cos + lz * sin, 1.3 + s * 2.6, spot.z - lx * sin + lz * cos), q, new THREE.Vector3(1, 1, 1));
            instances.push(m.clone());
            tints.push(new THREE.Color(colors[Math.floor(this.rnd() * colors.length)]));
          }
        }
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, instances.length);
    instances.forEach((mat4, i) => {
      mesh.setMatrixAt(i, mat4);
      mesh.setColorAt(i, tints[i]);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Tire walls on the outside of the sharpest corners. */
  private buildTireStacks(): void {
    const geo = new THREE.TorusGeometry(0.42, 0.2, 8, 16);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
    const matrices: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const n = this.track.samples.length;
    const step = 2;
    for (let i = 0; i < n; i += step) {
      const s = this.track.samples[i];
      if (Math.abs(s.curvature) < 0.022) continue;
      // Outside of a right turn is the left side (negative lateral).
      const side: 1 | -1 = s.curvature > 0 ? -1 : 1;
      const p = this.trackside(s.dist, side, 1.6);
      for (let level = 0; level < 3; level++) {
        const m = new THREE.Matrix4().makeTranslation(p.x, 0.2 + level * 0.38, p.z);
        matrices.push(m);
        const accent = Math.floor(i / step) % 4 === 0 ? new THREE.Color(0xd8d8d8) : new THREE.Color(0x222222);
        colors.push(level === 2 ? accent : new THREE.Color(0x222222));
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[i]);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildBarrels(): void {
    const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 14);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 });
    const colors = [0xb02a1a, 0x2a4ab0, 0xd09a20, 0x3a3a3a];
    const list: Array<[THREE.Matrix4, THREE.Color]> = [];
    for (let group = 0; group < 90; group++) {
      const spot = this.findSpot(3, 12.5, 140);
      if (!spot) continue;
      const count = 3 + Math.floor(this.rnd() * 6);
      const color = new THREE.Color(colors[Math.floor(this.rnd() * colors.length)]);
      for (let k = 0; k < count; k++) {
        const a = this.rnd() * Math.PI * 2;
        const r = this.rnd() * 2.2;
        const tipped = this.rnd() < 0.15;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(spot.x + Math.cos(a) * r, tipped ? 0.42 : 0.625, spot.z + Math.sin(a) * r),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(tipped ? Math.PI / 2 : 0, this.rnd() * 6, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        list.push([m, color]);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([m, c], i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildLampPosts(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.7, roughness: 0.4 });
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 4 });
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9, 8);
    const armGeo = new THREE.BoxGeometry(0.15, 0.15, 2.4);
    const headGeo = new THREE.BoxGeometry(0.5, 0.2, 0.9);
    const spacing = 45;
    for (let along = 10; along < this.track.length; along += spacing) {
      const side: 1 | -1 = Math.floor(along / spacing) % 2 === 0 ? 1 : -1;
      const p = this.trackside(along, side, 1.4);
      const lamp = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 4.5;
      pole.castShadow = true;
      lamp.add(pole);
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.set(0, 8.9, 1.1);
      lamp.add(arm);
      const head = new THREE.Mesh(headGeo, bulbMat);
      head.position.set(0, 8.8, 2.2);
      lamp.add(head);
      lamp.position.set(p.x, 0, p.z);
      // Point the arm over the road.
      const s = this.track.query(p.x, p.z).sample;
      lamp.rotation.y = Math.atan2(-s.rx * side, -s.rz * side);
      this.group.add(lamp);
      this.occupied.push({ x: p.x, z: p.z, r: 1 });
    }
  }

  private buildTrees(): void {
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.8, 1);
    crownGeo.translate(0, 3.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x55602e, roughness: 0.95, flatShading: true });
    const trunks: THREE.Matrix4[] = [];
    const crowns: THREE.Matrix4[] = [];
    const tints: THREE.Color[] = [];
    for (let cluster = 0; cluster < 140; cluster++) {
      const center = this.findSpot(6, 14, 300);
      if (!center) continue;
      const count = 3 + Math.floor(this.rnd() * 8);
      for (let k = 0; k < count; k++) {
        const x = center.x + (this.rnd() - 0.5) * 12;
        const z = center.z + (this.rnd() - 0.5) * 12;
        if (this.track.distanceToCenterline(x, z) < this.track.def.wallOffset + 4) continue;
        const s = 0.7 + this.rnd() * 0.8;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rnd() * 6);
        trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)));
        crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + this.rnd() * 0.4), s)));
        tints.push(new THREE.Color().setHSL(0.17 + this.rnd() * 0.08, 0.35 + this.rnd() * 0.2, 0.22 + this.rnd() * 0.12));
      }
    }
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trunks.length);
    const crownMesh = new THREE.InstancedMesh(crownGeo, crownMat, crowns.length);
    trunks.forEach((m, i) => trunkMesh.setMatrixAt(i, m));
    crowns.forEach((m, i) => {
      crownMesh.setMatrixAt(i, m);
      crownMesh.setColorAt(i, tints[i]);
    });
    trunkMesh.castShadow = crownMesh.castShadow = true;
    crownMesh.receiveShadow = true;
    this.group.add(trunkMesh, crownMesh);
  }

  private buildRocks(): void {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: createConcreteTexture(), color: 0x9a8a72, roughness: 0.95, flatShading: true });
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < 350; i++) {
      const spot = this.findSpot(1.5, 12, 260, 20);
      if (!spot) continue;
      const s = 0.4 + this.rnd() * 1.4;
      matrices.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(spot.x, s * 0.3, spot.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rnd() * 3, this.rnd() * 3, this.rnd() * 3)),
          new THREE.Vector3(s, s * 0.7, s),
        ),
      );
    }
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
