import * as THREE from 'three';
import { pathToPoints, trackById, DEFAULT_TRACK_ID, type TrackDefinition } from './tracks';
import {
  createAsphaltTextures,
  createCheckerTexture,
  createConcreteTexture,
  createCurbTexture,
  createDirtRoadTextures,
  createFactoryFloorTextures,
  createFactoryRoadTextures,
  createGroundTextures,
  createHazardTexture,
  createJerseyTexture,
  createRubbleEdgeTexture,
  type SurfaceTextures,
} from './textures';

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
  /** Height of the road above the surrounding ground. */
  y: number;
  /** Rise per meter in the direction of travel. */
  grade: number;
  /** Sides with no barrier, where the deck ends in a drop to the ground. */
  cliffLeft: boolean;
  cliffRight: boolean;
  /** True where the road is a bridge over another stretch of the track. */
  bridge: boolean;
}

export interface TrackQuery {
  index: number;
  /** Signed lateral offset from the centerline (positive = right side). */
  lateral: number;
  /** Distance along the track from the start line. */
  along: number;
  sample: TrackSample;
  /** Height of the ground under the point: the road deck, or the low ground past a cliff edge. */
  y: number;
  /** Rise per meter in the direction of travel. */
  grade: number;
  /** True when the point is past a cliff edge. */
  overEdge: boolean;
}

export type { TrackDefinition } from './tracks';

const SAMPLE_SPACING = 1.5;
/** How far the deck reaches past the curb on a cliff side. */
const CLIFF_SHOULDER = 0.4;
/** Minimum height difference for one stretch of track to count as passing over another. */
const BRIDGE_CLEARANCE = 3;
const BRIDGE_THICKNESS = 0.9;

/** A lateral offset that is either fixed or depends on the sample (cliff edges). */
type Offset = number | ((s: TrackSample) => number);
const offsetAt = (o: Offset, s: TrackSample): number => (typeof o === 'number' ? o : o(s));

/** Barrier cross-sections as [distance outwards from the barrier face, height]. */
const BARRIER_PROFILES = {
  wall: [[0, 0], [0, 1.1], [0.6, 1.1], [0.6, 0]],
  jersey: [[0, 0], [0, 0.28], [0.2, 0.85], [0.2, 1.05], [0.5, 1.05], [0.5, 0.85], [0.7, 0.28], [0.7, 0]],
  hazard: [[0, 0], [0, 0.95], [0.08, 1.05], [0.62, 1.05], [0.7, 0.95], [0.7, 0]],
} satisfies Record<string, Array<[number, number]>>;

/** Everything about the track surface that changes with the theme. */
interface TrackLook {
  road: () => SurfaceTextures;
  roadRoughness: number;
  curb: () => THREE.Texture;
  curbTile: number;
  runoff: () => SurfaceTextures;
  runoffColor: number;
  runoffRepeat: [number, number];
  barrier: () => THREE.Texture;
  barrierColor: number;
  barrierTile: number;
  barrierProfile: Array<[number, number]>;
}

const LOOKS: Record<TrackDefinition['theme'], TrackLook> = {
  yard: {
    road: createAsphaltTextures,
    roadRoughness: 0.88,
    curb: createCurbTexture,
    curbTile: 3,
    runoff: createGroundTextures,
    runoffColor: 0xc8bba4,
    runoffRepeat: [0.1, 0.25],
    barrier: createConcreteTexture,
    barrierColor: 0xd8d2c4,
    barrierTile: 4,
    barrierProfile: BARRIER_PROFILES.wall,
  },
  quarry: {
    road: createDirtRoadTextures,
    roadRoughness: 0.97,
    curb: createRubbleEdgeTexture,
    curbTile: 2,
    runoff: createGroundTextures,
    runoffColor: 0xd8c4a0,
    runoffRepeat: [0.1, 0.25],
    barrier: createJerseyTexture,
    barrierColor: 0xe0dcd2,
    barrierTile: 3,
    barrierProfile: BARRIER_PROFILES.jersey,
  },
  warehouse: {
    road: createFactoryRoadTextures,
    roadRoughness: 0.55,
    curb: createHazardTexture,
    curbTile: 1.6,
    runoff: createFactoryFloorTextures,
    runoffColor: 0x9a968e,
    runoffRepeat: [0.37, 1],
    barrier: createHazardTexture,
    barrierColor: 0xffffff,
    barrierTile: 2,
    barrierProfile: BARRIER_PROFILES.hazard,
  },
};

export class Track {
  readonly def: TrackDefinition;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly group = new THREE.Group();
  /** Actual distance between samples. */
  private readonly spacing: number;
  /** Lateral offset of the deck edge on a cliff side. */
  private readonly cliffEdge: number;

  constructor(def: TrackDefinition = trackById(DEFAULT_TRACK_ID)) {
    this.def = def;
    const points = def.path ? pathToPoints(def.path) : (def.controlPoints ?? []);
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    );
    this.length = curve.getLength();
    this.cliffEdge = def.roadHalfWidth + def.curbWidth + CLIFF_SHOULDER;
    const count = Math.round(this.length / SAMPLE_SPACING);
    this.spacing = this.length / count;
    const pts = curve.getSpacedPoints(count).slice(0, count); // drop the duplicated closing point
    for (let i = 0; i < count; i++) {
      const prev = pts[(i - 1 + count) % count];
      const next = pts[(i + 1) % count];
      let tx = next.x - prev.x;
      let tz = next.z - prev.z;
      const len = Math.hypot(tx, tz);
      tx /= len;
      tz /= len;
      this.samples.push({
        x: pts[i].x, z: pts[i].z, tx, tz, rx: -tz, rz: tx, dist: (i / count) * this.length, curvature: 0,
        y: 0, grade: 0, cliffLeft: false, cliffRight: false, bridge: false,
      });
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
    this.applyTerrain();
    this.buildMeshes();
  }

  /** Fills in the height, grade, cliff edges and bridges of every sample. */
  private applyTerrain(): void {
    const n = this.samples.length;
    const L = this.length;
    const keys = [...(this.def.elevation ?? [])].sort((a, b) => a[0] - b[0]);
    if (keys.length > 0) {
      // The profile wraps around: the lap ends at the height of the first key.
      keys.push([keys[0][0] + L, keys[0][1]]);
      const raw = this.samples.map((s) => {
        const d = s.dist < keys[0][0] ? s.dist + L : s.dist;
        let k = 0;
        while (k < keys.length - 2 && d > keys[k + 1][0]) k++;
        const [d0, h0] = keys[k];
        const [d1, h1] = keys[k + 1];
        return h0 + (h1 - h0) * THREE.MathUtils.clamp((d - d0) / Math.max(1e-6, d1 - d0), 0, 1);
      });
      // Round off the kinks between ramps a little.
      this.samples.forEach((s, i) => (s.y = Math.max(0, (raw[(i - 1 + n) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4)));
    }
    this.samples.forEach((s, i) => (s.grade = (this.samples[(i + 1) % n].y - this.samples[(i - 1 + n) % n].y) / (2 * this.spacing)));

    for (const [from, to, side] of this.def.cliffs ?? []) {
      for (const s of this.samples) {
        const inside = from <= to ? s.dist >= from && s.dist <= to : s.dist >= from || s.dist <= to;
        if (!inside) continue;
        if (side === 1) s.cliffRight = true;
        else s.cliffLeft = true;
      }
    }

    // A raised stretch is a bridge where another, lower part of the track runs beneath it.
    const reach = (this.def.wallOffset + 4) ** 2;
    const apart = Math.ceil(60 / this.spacing);
    this.samples.forEach((s, i) => {
      if (s.y < BRIDGE_CLEARANCE) return;
      s.bridge = this.samples.some((o, j) => {
        const gap = Math.abs(i - j);
        return Math.min(gap, n - gap) > apart && s.y - o.y > BRIDGE_CLEARANCE && (s.x - o.x) ** 2 + (s.z - o.z) ** 2 < reach;
      });
    });
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
    // Height: towards the neighbour on the same side of the sample as the point.
    const other = this.samples[(best + (t >= 0 ? 1 : n - 1)) % n];
    const overEdge = (s.cliffRight && lateral > this.cliffEdge) || (s.cliffLeft && lateral < -this.cliffEdge);
    const y = overEdge ? 0 : s.y + (other.y - s.y) * Math.min(1, Math.abs(t) / this.spacing);
    return { index: best, lateral, along, sample: s, y, grade: s.grade, overEdge };
  }

  /** Index of the sample at a distance along the track, to seed `query` hints. */
  indexAt(along: number): number {
    const n = this.samples.length;
    return ((Math.round((along / this.length) * n) % n) + n) % n;
  }

  /** World position at a given distance along the track and lateral offset. */
  pointAt(along: number, lateral = 0): { x: number; y: number; z: number; heading: number } {
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
    return { x, y: a.y + (b.y - a.y) * t, z, heading };
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
   * Builds a strip of road surface between two lateral offsets, `y` above the deck.
   * U goes across (0..1), V goes along the track in units of `tileLength` meters.
   */
  private buildStrip(offsetA: Offset, offsetB: Offset, y: number, tileLength: number): THREE.BufferGeometry {
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
      const a = offsetAt(offsetA, s);
      const b = offsetAt(offsetB, s);
      positions.push(s.x + s.rx * a, s.y + y, s.z + s.rz * a);
      positions.push(s.x + s.rx * b, s.y + y, s.z + s.rz * b);
      uvs.push(0, v, 1, v);
      // The surface tilts with the grade.
      const k = 1 / Math.hypot(1, s.grade);
      const normal = [-s.grade * s.tx * k, k, -s.grade * s.tz * k];
      normals.push(...normal, ...normal);
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

  /**
   * Builds a solid barrier along one side from a cross-section profile. U runs along
   * the track in `tile` meter blocks, V across the profile.
   */
  private buildBarrier(side: 1 | -1, profile: Array<[number, number]>, tile: number): THREE.BufferGeometry {
    const n = this.samples.length;
    const wall = this.def.wallOffset;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const uTotal = Math.max(1, Math.round(this.length / tile));
    // V follows the length of the outline so textures are not stretched on slopes.
    const lengths = [0];
    for (let p = 1; p < profile.length; p++) {
      lengths.push(lengths[p - 1] + Math.hypot(profile[p][0] - profile[p - 1][0], profile[p][1] - profile[p - 1][1]));
    }
    const perimeter = lengths[lengths.length - 1];
    let vert = 0;
    for (let p = 0; p < profile.length - 1; p++) {
      const [d0, y0] = profile[p];
      const [d1, y1] = profile[p + 1];
      const o0 = side * (wall + d0);
      const o1 = side * (wall + d1);
      const base = vert;
      for (let i = 0; i <= n; i++) {
        const s = this.samples[i % n];
        const u = (i / n) * uTotal;
        positions.push(s.x + s.rx * o0, s.y + y0, s.z + s.rz * o0);
        positions.push(s.x + s.rx * o1, s.y + y1, s.z + s.rz * o1);
        uvs.push(u, lengths[p] / perimeter, u, lengths[p + 1] / perimeter);
        vert += 2;
      }
      for (let i = 0; i < n; i++) {
        // No barrier along a cliff edge.
        if (this.isCliff(i, side) || this.isCliff(i + 1, side)) continue;
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

  private isCliff(i: number, side: 1 | -1): boolean {
    const s = this.samples[i % this.samples.length];
    return side === 1 ? s.cliffRight : s.cliffLeft;
  }

  /**
   * Builds what holds a raised deck up on one side: a retaining wall down to the
   * ground, or just the edge of the slab where the road is a bridge. `depth` is how
   * far the barrier reaches past the wall offset.
   */
  private buildEmbankment(side: 1 | -1, depth: number): THREE.BufferGeometry {
    const n = this.samples.length;
    const tile = 4;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = this.samples[i % n];
      const o = side * (this.isCliff(i, side) ? this.cliffEdge : this.def.wallOffset + depth);
      const bottom = s.bridge ? s.y - BRIDGE_THICKNESS : -0.3;
      const u = (i / n) * Math.round(this.length / tile);
      positions.push(s.x + s.rx * o, s.y + 0.02, s.z + s.rz * o);
      positions.push(s.x + s.rx * o, bottom, s.z + s.rz * o);
      uvs.push(u, s.y / tile, u, bottom / tile);
    }
    for (let i = 0; i < n; i++) {
      if (this.samples[i].y < 0.03 && this.samples[(i + 1) % n].y < 0.03) continue;
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      if (side === 1) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  /** Underside of the slab where the road is a bridge. */
  private buildBridgeSoffit(depth: number): THREE.BufferGeometry {
    const n = this.samples.length;
    const o = this.def.wallOffset + depth;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = this.samples[i % n];
      const y = s.y - BRIDGE_THICKNESS;
      positions.push(s.x - s.rx * o, y, s.z - s.rz * o, s.x + s.rx * o, y, s.z + s.rz * o);
      uvs.push(0, s.dist / 4, (o * 2) / 4, s.dist / 4);
    }
    for (let i = 0; i < n; i++) {
      if (!this.samples[i].bridge || !this.samples[(i + 1) % n].bridge) continue;
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
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
    const look = LOOKS[this.def.theme];

    const roadTex = look.road();
    const road = new THREE.Mesh(
      this.buildStrip(-hw, hw, 0.03, hw * 2),
      new THREE.MeshStandardMaterial({
        map: roadTex.map,
        normalMap: roadTex.normalMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: look.roadRoughness,
        metalness: 0.0,
      }),
    );
    road.receiveShadow = true;
    this.group.add(road);

    const curbMat = new THREE.MeshStandardMaterial({ map: look.curb(), roughness: 0.7 });
    for (const [a, b] of [[-hw - cw, -hw], [hw, hw + cw]]) {
      const curb = new THREE.Mesh(this.buildStrip(a, b, 0.06, look.curbTile), curbMat);
      curb.receiveShadow = true;
      this.group.add(curb);
    }

    // Run-off area between the curbs and the barriers.
    const runoffTex = look.runoff();
    runoffTex.map.repeat.set(...look.runoffRepeat);
    runoffTex.normalMap.repeat.set(...look.runoffRepeat);
    const runoffMat = new THREE.MeshStandardMaterial({ color: look.runoffColor, roughness: 1, map: runoffTex.map, normalMap: runoffTex.normalMap });
    // Along a cliff the run-off shrinks to a narrow shoulder.
    const leftEdge: Offset = (s) => (s.cliffLeft ? -this.cliffEdge : -wo);
    const rightEdge: Offset = (s) => (s.cliffRight ? this.cliffEdge : wo);
    for (const [a, b] of [[leftEdge, -hw - cw], [hw + cw, rightEdge]] as Array<[Offset, Offset]>) {
      const runoff = new THREE.Mesh(this.buildStrip(a, b, 0.02, 6), runoffMat);
      runoff.receiveShadow = true;
      this.group.add(runoff);
    }

    const barrierMat = new THREE.MeshStandardMaterial({ map: look.barrier(), roughness: 0.85, color: look.barrierColor });
    for (const side of [-1, 1] as const) {
      const barrier = new THREE.Mesh(this.buildBarrier(side, look.barrierProfile, look.barrierTile), barrierMat);
      barrier.castShadow = true;
      barrier.receiveShadow = true;
      this.group.add(barrier);
    }

    if (this.samples.some((s) => s.y > 0.03)) {
      const depth = Math.max(...look.barrierProfile.map(([d]) => d));
      const wallMat = new THREE.MeshStandardMaterial({ map: createConcreteTexture(), roughness: 0.95, color: 0x8d8478 });
      for (const side of [-1, 1] as const) {
        const wall = new THREE.Mesh(this.buildEmbankment(side, depth), wallMat);
        wall.castShadow = true;
        wall.receiveShadow = true;
        this.group.add(wall);
      }
      if (this.samples.some((s) => s.bridge)) {
        const soffit = new THREE.Mesh(this.buildBridgeSoffit(depth), wallMat);
        soffit.castShadow = true;
        this.group.add(soffit);
      }
    }

    this.buildStartLine();
  }

  /** Frees GPU memory for every mesh, material and texture of the track. */
  dispose(): void {
    disposeObject(this.group);
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
    line.position.set(s.x, s.y + 0.05, s.z);
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
    gantry.position.set(s.x, s.y, s.z);
    gantry.rotation.y = heading;
    this.group.add(gantry);
  }
}

/** Disposes geometries, materials and their textures below `root`. */
export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
      o.geometry.dispose();
      const m = o.material as THREE.Material | THREE.Material[];
      for (const mat of Array.isArray(m) ? m : [m]) materials.add(mat);
    }
  });
  for (const mat of materials) {
    for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
    mat.dispose();
  }
}
