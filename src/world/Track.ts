import * as THREE from 'three';
import { createAsphaltTextures, createCheckerTexture, createConcreteTexture, createCurbTexture, createGroundTextures } from './textures';

/** One sampled point of the track centerline, in the XZ plane. */
export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent (direction of travel). */
  tx: number;
  tz: number;
  /** Unit lateral vector pointing to the driver's right. */
  rx: number;
  rz: number;
  /** Distance along the centerline from the start line, in meters. */
  dist: number;
  /** Signed curvature (1 / radius); positive turns right. */
  curvature: number;
}

export interface TrackQuery {
  index: number;
  /** Signed lateral offset from the centerline (positive = right side). */
  lateral: number;
  /** Distance along the track from the start line. */
  along: number;
  sample: TrackSample;
}

export interface TrackDefinition {
  name: string;
  controlPoints: Array<[number, number]>;
  roadHalfWidth: number;
  curbWidth: number;
  /** Distance from the centerline to the barrier face. */
  wallOffset: number;
}

/** The first circuit: an industrial loop with a chicane and a long back straight. */
export const DEFAULT_TRACK: TrackDefinition = {
  name: 'Rust Yard',
  controlPoints: [
    [0, -120], [60, -125], [110, -100], [125, -50], [100, -10], [50, 0],
    [30, 30], [60, 70], [120, 80], [140, 130], [100, 170], [20, 160],
    [-40, 175], [-100, 150], [-120, 90], [-80, 50], [-110, 0], [-120, -60], [-80, -110],
  ],
  roadHalfWidth: 7,
  curbWidth: 1.2,
  wallOffset: 10.5,
};

const SAMPLE_SPACING = 1.5;
const BARRIER_HEIGHT = 1.1;
const BARRIER_THICKNESS = 0.6;

export class Track {
  readonly def: TrackDefinition;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly group = new THREE.Group();

  constructor(def: TrackDefinition = DEFAULT_TRACK) {
    this.def = def;
    const curve = new THREE.CatmullRomCurve3(
      def.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    const count = Math.round(this.length / SAMPLE_SPACING);
    const pts = curve.getSpacedPoints(count).slice(0, count); // drop the duplicated closing point
    for (let i = 0; i < count; i++) {
      const prev = pts[(i - 1 + count) % count];
      const next = pts[(i + 1) % count];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz);
      tx /= len;
      tz /= len;
      this.samples.push({ x: pts[i].x, z: pts[i].z, tx, tz, rx: -tz, rz: tx, dist: (i / count) * this.length, curvature: 0 });
    }
    // Curvature from the change of heading between neighbours.
    for (let i = 0; i < count; i++) {
      const a = this.samples[(i - 1 + count) % count];
      const b = this.samples[(i + 1) % count];
      const cross = a.tx * b.tz - a.tz * b.tx;
      const ds = 2 * (this.length / count);
      // Positive cross means a left turn in this coordinate system; flip so right turns are positive.
      this.samples[i].curvature = -Math.asin(THREE.MathUtils.clamp(cross, -1, 1)) / ds;
    }
    this.buildMeshes();
  }

  /** Finds the closest centerline segment. `hint` speeds up the search for moving objects. */
  query(x: number, z: number, hint = -1): TrackQuery {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    const scan = (from: number, to: number) => {
      for (let k = from; k <= to; k++) {
        const i = ((k % n) + n) % n;
        const s = this.samples[i];
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    };
    if (hint >= 0) scan(hint - 25, hint + 25);
    if (hint < 0 || bestD > 30 * 30) scan(0, n - 1);

    // Refine by projecting onto the segment towards the closer neighbour.
    const s = this.samples[best];
    const dx = x - s.x;
    const dz = z - s.z;
    const t = dx * s.tx + dz * s.tz;
    const lateral = dx * s.rx + dz * s.rz;
    let along = s.dist + t;
    if (along < 0) along += this.length;
    if (along >= this.length) along -= this.length;
    return { index: best, lateral, along, sample: s };
  }

  /** World position at a given distance along the track and lateral offset. */
  pointAt(along: number, lateral = 0): { x: number; z: number; heading: number } {
    const n = this.samples.length;
    const f = (((along % this.length) + this.length) % this.length) / this.length * n;
    const i0 = Math.floor(f) % n;
    const i1 = (i0 + 1) % n;
    const t = f - Math.floor(f);
    const a = this.samples[i0];
    const b = this.samples[i1];
    const x = a.x + (b.x - a.x) * t + (a.rx + (b.rx - a.rx) * t) * lateral;
    const z = a.z + (b.z - a.z) * t + (a.rz + (b.rz - a.rz) * t) * lateral;
    const heading = Math.atan2(a.tx + (b.tx - a.tx) * t, a.tz + (b.tz - a.tz) * t);
    return { x, z, heading };
  }

  /** Minimum distance from a point to the centerline (used for prop placement). */
  distanceToCenterline(x: number, z: number): number {
    let best = Infinity;
    for (const s of this.samples) best = Math.min(best, (s.x - x) ** 2 + (s.z - z) ** 2);
    return Math.sqrt(best);
  }

  // ---------------------------------------------------------------------------
  // Mesh generation
  // ---------------------------------------------------------------------------

  /**
   * Builds a horizontal strip between two lateral offsets. U goes across (0..1),
   * V goes along the track in units of `tileLength` meters.
   */
  private buildStrip(offsetA: number, offsetB: number, y: number, tileLength: number): THREE.BufferGeometry {
    const n = this.samples.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    // Repeat the texture an integer number of times so the seam at the start line is invisible.
    const vTotal = Math.max(1, Math.round(this.length / tileLength));
    for (let i = 0; i <= n; i++) {
      const s = this.samples[i % n];
      const v = (i / n) * vTotal;
      positions.push(s.x + s.rx * offsetA, y, s.z + s.rz * offsetA);
      positions.push(s.x + s.rx * offsetB, y, s.z + s.rz * offsetB);
      uvs.push(0, v, 1, v);
      normals.push(0, 1, 0, 0, 1, 0);
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    return g;
  }

  /** Builds a solid barrier (inner face, top and outer face) centered at a lateral offset. */
  private buildBarrier(offset: number, side: 1 | -1): THREE.BufferGeometry {
    const n = this.samples.length;
    const inner = offset - (side * BARRIER_THICKNESS) / 2;
    const outer = offset + (side * BARRIER_THICKNESS) / 2;
    // Cross-section profile, walked from the track side to the outside.
    const profile: Array<[number, number]> = [
      [inner, 0],
      [inner, BARRIER_HEIGHT],
      [outer, BARRIER_HEIGHT],
      [outer, 0],
    ];
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const vTotal = Math.max(1, Math.round(this.length / 4));
    let vert = 0;
    for (let p = 0; p < profile.length - 1; p++) {
      const [o0, y0] = profile[p];
      const [o1, y1] = profile[p + 1];
      const base = vert;
      for (let i = 0; i <= n; i++) {
        const s = this.samples[i % n];
        const v = (i / n) * vTotal;
        positions.push(s.x + s.rx * o0, y0, s.z + s.rz * o0);
        positions.push(s.x + s.rx * o1, y1, s.z + s.rz * o1);
        uvs.push(v, p === 1 ? 0.9 : 0, v, p === 1 ? 1 : 1);
        vert += 2;
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        // Winding chosen so every face points away from the barrier's core.
        if (side === 1) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  private buildMeshes(): void {
    const { roadHalfWidth: hw, curbWidth: cw, wallOffset: wo } = this.def;

    const asphalt = createAsphaltTextures();
    const road = new THREE.Mesh(
      this.buildStrip(-hw, hw, 0.03, hw * 2),
      new THREE.MeshStandardMaterial({
        map: asphalt.map,
        normalMap: asphalt.normalMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: 0.88,
        metalness: 0.0,
      }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const curbTex = createCurbTexture();
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.7 });
    for (const [a, b] of [[-hw - cw, -hw], [hw, hw + cw]]) {
      const curb = new THREE.Mesh(this.buildStrip(a, b, 0.06, 3), curbMat);
      curb.receiveShadow = true;
      this.group.add(curb);
    }

    // Gravel run-off between the curbs and the barriers.
    const gravelTex = createGroundTextures();
    gravelTex.map.repeat.set(0.1, 0.25);
    gravelTex.normalMap.repeat.set(0.1, 0.25);
    const gravelMat = new THREE.MeshStandardMaterial({ color: 0xc8bba4, roughness: 1, map: gravelTex.map, normalMap: gravelTex.normalMap });
    for (const [a, b] of [[-wo, -hw - cw], [hw + cw, wo]]) {
      const gravel = new THREE.Mesh(this.buildStrip(a, b, 0.02, 6), gravelMat);
      gravel.receiveShadow = true;
      this.group.add(gravel);
    }

    const concrete = createConcreteTexture();
    const barrierMat = new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, color: 0xd8d2c4 });
    for (const side of [-1, 1] as const) {
      const offset = side * (wo + BARRIER_THICKNESS / 2);
      const barrier = new THREE.Mesh(this.buildBarrier(offset, side), barrierMat);
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      this.group.add(barrier);
    }

    this.buildStartLine();
  }

  private buildStartLine(): void {
    const s = this.samples[0];
    const { roadHalfWidth: hw, wallOffset: wo } = this.def;
    const heading = Math.atan2(s.tx, s.tz);

    const checker = createCheckerTexture();
    checker.repeat.set(hw / 2, 0.5);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, 2.5),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6 }),
    );
    line.rotation.set(-Math.PI / 2, 0, heading);
    line.position.set(s.x, 0.05, s.z);
    line.receiveShadow = true;
    this.group.add(line);

    // Gantry over the start/finish line.
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.7, roughness: 0.45 });
    const postGeo = new THREE.BoxGeometry(0.6, 7, 0.6);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, steel);
      post.position.set(side * (wo + 1), 3.5, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(wo * 2 + 2.6, 1.0, 0.7), steel);
    beam.position.y = 7;
    beam.castShadow = true;
    gantry.add(beam);
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(wo * 1.4, 0.8, 0.75),
      new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a10, emissiveIntensity: 2.2 }),
    );
    sign.position.y = 7;
    gantry.add(sign);
    gantry.position.set(s.x, 0, s.z);
    gantry.rotation.y = heading;
    this.group.add(gantry);
  }
}
