import * as THREE from 'three';
import { createRng } from '../../core/math';
import type { Track } from '../Track';
import { createLightPoolTexture } from '../textures';

export interface Spot {
  x: number;
  z: number;
}

/** Square area where random props are scattered. */
export interface ScatterArea {
  cx: number;
  cz: number;
  size: number;
}

/**
 * Shared state for building the scenery of one track: the target group, a seeded
 * random generator and a list of occupied circles so props never overlap.
 */
export class Scenery {
  readonly rnd: () => number;
  readonly occupied: Array<{ x: number; z: number; r: number }> = [];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  area: ScatterArea;
  private poolTexture: THREE.Texture | null = null;
  private readonly poolMaterials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(
    readonly group: THREE.Group,
    readonly track: Track,
    seed: number,
  ) {
    this.rnd = createRng(seed);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
    this.area = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, size: Math.max(maxX - minX, maxZ - minZ) + 260 };
  }

  range(min: number, max: number): number {
    return min + this.rnd() * (max - min);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rnd() * list.length)];
  }

  reserve(x: number, z: number, r: number): void {
    this.occupied.push({ x, z, r });
  }

  isFree(x: number, z: number, r: number): boolean {
    return !this.occupied.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2);
  }

  /** Tries random spots in the scatter area until one is clear of the track and other props. */
  findSpot(radius: number, minTrackDist: number, maxTrackDist: number, tries = 60, area: ScatterArea = this.area): Spot | null {
    for (let t = 0; t < tries; t++) {
      const x = area.cx + (this.rnd() - 0.5) * area.size;
      const z = area.cz + (this.rnd() - 0.5) * area.size;
      const d = this.track.distanceToCenterline(x, z);
      if (d < minTrackDist + radius || d > maxTrackDist) continue;
      if (!this.isFree(x, z, radius)) continue;
      this.reserve(x, z, radius);
      return { x, z };
    }
    return null;
  }

  /** Spot right behind the barrier at a given track distance. */
  trackside(along: number, side: 1 | -1, extra: number): { x: number; z: number; heading: number } {
    return this.track.pointAt(along, side * (this.track.def.wallOffset + extra));
  }

  /** Track distances (spaced at least `gap` apart) where the road runs straight. */
  straightSpots(count: number, gap: number, skipStart = 60): number[] {
    const n = this.track.samples.length;
    const L = this.track.length;
    const straight = (i: number) => {
      for (let k = -8; k <= 8; k++) if (Math.abs(this.track.samples[(i + k + n) % n].curvature) > 0.012) return false;
      return true;
    };
    const out: number[] = [];
    for (let k = 0; k < count * 40 && out.length < count; k++) {
      const along = ((k * 0.618034) % 1) * L;
      const i = Math.floor((along / L) * n);
      if (along < skipStart || along > L - skipStart * 0.6) continue;
      if (!straight(i)) continue;
      if (out.some((a) => Math.min(Math.abs(a - along), L - Math.abs(a - along)) < gap)) continue;
      out.push(along);
    }
    return out;
  }

  /** Additive glow on the floor, faking the pool of light under a lamp. */
  lightPool(x: number, z: number, radius: number, color: number, strength: number, y = 0.07): THREE.Mesh {
    this.poolTexture ??= createLightPoolTexture();
    const key = `${color}|${strength}`;
    let mat = this.poolMaterials.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: this.poolTexture,
        color: new THREE.Color(color).multiplyScalar(strength),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      this.poolMaterials.set(key, mat);
    }
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    geo.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(geo, mat);
    pool.position.set(x, y, z);
    pool.renderOrder = 2;
    this.group.add(pool);
    return pool;
  }
}

// -----------------------------------------------------------------------------
// Generic props
// -----------------------------------------------------------------------------

/** Fills an InstancedMesh from a list of matrices (and optional per-instance colors). */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors?: THREE.Color[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  mesh.count = matrices.length;
  matrices.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    if (colors) mesh.setColorAt(i, colors[i]);
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function compose(x: number, y: number, z: number, rotY = 0, sx = 1, sy = sx, sz = sx, rotX = 0, rotZ = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** A box spanning from `a` to `b` (its long axis), with the given cross-section. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, thickness: number, mat: THREE.Material, depth = thickness): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, depth, len), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.lookAt(b);
  mesh.castShadow = true;
  return mesh;
}

/**
 * A lattice girder between two points: four chords plus zig-zag bracing on every
 * face. `up` sets which way the girder's height points.
 */
export function latticeBeam(
  from: THREE.Vector3,
  to: THREE.Vector3,
  width: number,
  height: number,
  mat: THREE.Material,
  bar = 0.14,
  up = new THREE.Vector3(0, 1, 0),
): THREE.Group {
  const g = new THREE.Group();
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width / 2);
  const vert = new THREE.Vector3().crossVectors(side, dir).normalize().multiplyScalar(height / 2);
  const corners = [
    side.clone().add(vert),
    side.clone().sub(vert),
    side.clone().negate().sub(vert),
    side.clone().negate().add(vert),
  ];
  for (const c of corners) g.add(strut(from.clone().add(c), to.clone().add(c), bar * 1.4, mat));
  const panels = Math.max(1, Math.round(len / Math.max(width, height, 1.2)));
  const step = len / panels;
  for (let f = 0; f < 4; f++) {
    const c0 = corners[f];
    const c1 = corners[(f + 1) % 4];
    for (let i = 0; i < panels; i++) {
      const p0 = from.clone().addScaledVector(dir, i * step);
      const p1 = from.clone().addScaledVector(dir, (i + 1) * step);
      // Alternate the diagonal so it zig-zags.
      const [a, b] = i % 2 === 0 ? [c0, c1] : [c1, c0];
      g.add(strut(p0.clone().add(a), p1.clone().add(b), bar, mat));
    }
  }
  return g;
}

export interface PipeStyle {
  radius: number;
  material: THREE.Material;
  flangeMaterial?: THREE.Material;
  /** Distance between flange rings along straight runs. */
  flangeSpacing?: number;
}

/**
 * A pipe following a polyline, with rounded elbows at the corners and flange rings
 * at regular intervals, so it reads as real plumbing from above.
 */
export function pipeRun(points: THREE.Vector3[], style: PipeStyle, elbow = style.radius * 2.5): THREE.Group {
  const g = new THREE.Group();
  const path = new THREE.CurvePath<THREE.Vector3>();
  const straights: Array<[THREE.Vector3, THREE.Vector3]> = [];
  let cursor = points[0].clone();
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const isLast = i === points.length - 1;
    if (isLast) {
      path.add(new THREE.LineCurve3(cursor.clone(), p.clone()));
      straights.push([cursor.clone(), p.clone()]);
      break;
    }
    const next = points[i + 1];
    const inDir = p.clone().sub(cursor).normalize();
    const outDir = next.clone().sub(p).normalize();
    const r = Math.min(elbow, p.distanceTo(cursor) * 0.45, next.distanceTo(p) * 0.45);
    const a = p.clone().addScaledVector(inDir, -r);
    const b = p.clone().addScaledVector(outDir, r);
    if (a.distanceTo(cursor) > 1e-3) {
      path.add(new THREE.LineCurve3(cursor.clone(), a));
      straights.push([cursor.clone(), a.clone()]);
    }
    path.add(new THREE.QuadraticBezierCurve3(a, p.clone(), b));
    cursor = b;
  }
  const segments = Math.max(8, Math.round(path.getLength() / 0.8));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, segments, style.radius, 12, false), style.material);
  tube.castShadow = tube.receiveShadow = true;
  g.add(tube);

  // Flanges: short wider rings along every straight section.
  const flangeMat = style.flangeMaterial ?? style.material;
  const spacing = style.flangeSpacing ?? 6;
  const flangeGeo = new THREE.CylinderGeometry(style.radius * 1.22, style.radius * 1.22, Math.max(0.12, style.radius * 0.35), 14);
  flangeGeo.rotateX(Math.PI / 2);
  for (const [a, b] of straights) {
    const len = a.distanceTo(b);
    const count = Math.floor(len / spacing);
    for (let k = 1; k <= count; k++) {
      const f = new THREE.Mesh(flangeGeo, flangeMat);
      f.position.lerpVectors(a, b, k / (count + 1));
      f.lookAt(b);
      f.castShadow = true;
      g.add(f);
    }
  }
  // Caps where the run ends.
  const capGeo = new THREE.CylinderGeometry(style.radius * 1.3, style.radius * 1.3, style.radius * 0.6, 14);
  capGeo.rotateX(Math.PI / 2);
  for (const [end, prev] of [[points[0], points[1]], [points[points.length - 1], points[points.length - 2]]]) {
    const cap = new THREE.Mesh(capGeo, flangeMat);
    cap.position.copy(end);
    cap.lookAt(prev);
    g.add(cap);
  }
  return g;
}

/** Shared materials for steel structures and pipes, built once per scenery. */
export interface IndustrialMaterials {
  steel: THREE.MeshStandardMaterial;
  yellowSteel: THREE.MeshStandardMaterial;
  pipeOrange: THREE.MeshStandardMaterial;
  pipeGrey: THREE.MeshStandardMaterial;
  pipeYellow: THREE.MeshStandardMaterial;
  flange: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
}

export function industrialMaterials(metal: THREE.Texture, concrete: THREE.Texture): IndustrialMaterials {
  const painted = (color: number, roughness = 0.55, metalness = 0.45) =>
    new THREE.MeshStandardMaterial({ map: metal, color, roughness, metalness });
  return {
    steel: painted(0x3c3f44, 0.5, 0.7),
    yellowSteel: painted(0xd8a020, 0.55, 0.4),
    pipeOrange: painted(0xd9611c, 0.5, 0.45),
    pipeGrey: painted(0xb4b8bc, 0.4, 0.75),
    pipeYellow: painted(0xd8b030, 0.5, 0.4),
    flange: painted(0x55585e, 0.45, 0.75),
    concrete: new THREE.MeshStandardMaterial({ map: concrete, color: 0xc8c2b6, roughness: 0.9 }),
  };
}

/**
 * An overhead pipe bridge across the road: two trestles behind the barriers carry
 * a bundle of pipes that drop to the ground and run off on concrete sleepers.
 */
export function pipeBridge(ctx: Scenery, along: number, mats: IndustrialMaterials, opts: { height?: number; reach?: number } = {}): boolean {
  const track = ctx.track;
  const wo = track.def.wallOffset;
  const height = opts.height ?? 6.5;
  const reach = opts.reach ?? 26;
  const s = track.query(track.pointAt(along).x, track.pointAt(along).z).sample;
  // Bridge axis: across the road.
  const ax = s.rx;
  const az = s.rz;
  const tx = s.tx;
  const tz = s.tz;
  const center = track.pointAt(along);
  const at = (lat: number, fwd: number, y: number) => new THREE.Vector3(center.x + ax * lat + tx * fwd, y, center.z + az * lat + tz * fwd);

  // How far the ground runs can go on each side before meeting another part of the track.
  const room = (side: number): number => {
    let lat = wo + 2;
    for (; lat < wo + reach * 1.3; lat += 1.5) {
      const p = at(side * lat, 0, 0);
      if (ctx.track.distanceToCenterline(p.x, p.z) < wo + 2.5 || !ctx.isFree(p.x, p.z, 2)) break;
    }
    return lat - 2;
  };
  const roomA = room(-1);
  const roomB = room(1);
  if (roomA < wo + 12 || roomB < wo + 12) return false;

  const g = new THREE.Group();
  // Trestles: two columns along the pipe direction plus a cross beam on top.
  for (const side of [-1, 1]) {
    const lat = side * (wo + 2.6);
    for (const fwd of [-1.6, 1.6]) {
      const col = strut(at(lat, fwd, 0), at(lat, fwd, height - 0.5), 0.45, mats.yellowSteel);
      g.add(col);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 1.1), mats.concrete);
      foot.position.copy(at(lat, fwd, 0.2));
      foot.receiveShadow = true;
      g.add(foot);
    }
    g.add(strut(at(lat, -2.1, height - 0.45), at(lat, 2.1, height - 0.45), 0.4, mats.yellowSteel, 0.5));
    // Diagonal brace.
    g.add(strut(at(lat, -1.6, 0.6), at(lat, 1.6, height - 0.8), 0.18, mats.steel));
  }
  // Longitudinal I-beams under the pipes spanning the road.
  for (const fwd of [-1.3, 1.3]) {
    g.add(strut(at(-(wo + 2.6), fwd, height - 0.1), at(wo + 2.6, fwd, height - 0.1), 0.25, mats.steel, 0.5));
  }

  // The pipe bundle: each pipe drops down past the trestle and runs out on the ground.
  const pipes: Array<{ fwd: number; style: PipeStyle; lift: number }> = [
    { fwd: -0.9, style: { radius: 0.55, material: mats.pipeOrange, flangeMaterial: mats.flange }, lift: 0.75 },
    { fwd: 0.5, style: { radius: 0.38, material: mats.pipeGrey, flangeMaterial: mats.flange }, lift: 0.55 },
    { fwd: 1.4, style: { radius: 0.25, material: mats.pipeYellow, flangeMaterial: mats.flange }, lift: 0.42 },
  ];
  const outA = -Math.min(roomA, wo + reach * (0.7 + ctx.rnd() * 0.6));
  const outB = Math.min(roomB, wo + reach * (0.7 + ctx.rnd() * 0.6));
  for (const p of pipes) {
    const y = height + p.lift;
    const groundY = p.style.radius + 0.55;
    const drop = wo + 5 + p.fwd * 0.4;
    const pts = [
      at(outA, p.fwd, groundY),
      at(-drop - 3, p.fwd, groundY),
      at(-drop, p.fwd, y),
      at(drop, p.fwd, y),
      at(drop + 3, p.fwd, groundY),
      at(outB, p.fwd, groundY),
    ];
    g.add(pipeRun(pts, p.style));
  }
  // Concrete sleepers under the ground runs.
  for (const [from, to] of [[outA, -(wo + 8)], [wo + 8, outB]]) {
    const dir = Math.sign(to - from);
    for (let lat = from; dir * (to - lat) > 0; lat += dir * 5) {
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 4.2), mats.concrete);
      sleeper.position.copy(at(lat, 0.2, 0.25));
      sleeper.rotation.y = Math.atan2(tx, tz);
      sleeper.castShadow = sleeper.receiveShadow = true;
      g.add(sleeper);
    }
  }
  ctx.group.add(g);
  for (const lat of [outA, -(wo + 6), wo + 6, outB]) {
    const p = at(lat, 0, 0);
    ctx.reserve(p.x, p.z, 4);
  }
  for (let lat = outA; lat < outB; lat += 5) {
    const p = at(lat, 0, 0);
    ctx.reserve(p.x, p.z, 3.5);
  }
  return true;
}

/** A pipeline running parallel to the track behind the barrier, on sleepers. */
export function tracksidePipeline(ctx: Scenery, from: number, to: number, side: 1 | -1, mats: IndustrialMaterials): void {
  const g = new THREE.Group();
  const styles: Array<[number, PipeStyle]> = [
    [3.2, { radius: 0.5, material: mats.pipeOrange, flangeMaterial: mats.flange, flangeSpacing: 7 }],
    [4.5, { radius: 0.5, material: mats.pipeOrange, flangeMaterial: mats.flange, flangeSpacing: 7 }],
    [5.6, { radius: 0.32, material: mats.pipeGrey, flangeMaterial: mats.flange, flangeSpacing: 7 }],
  ];
  for (const [extra, style] of styles) {
    const pts: THREE.Vector3[] = [];
    for (let a = from; a <= to; a += 6) {
      const p = ctx.trackside(a, side, extra);
      pts.push(new THREE.Vector3(p.x, style.radius + 0.5, p.z));
    }
    if (pts.length >= 2) g.add(pipeRun(pts, style, 3));
  }
  for (let a = from; a <= to; a += 5) {
    const p = ctx.trackside(a, side, 4.4);
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.5, 0.8), mats.concrete);
    sleeper.position.set(p.x, 0.25, p.z);
    sleeper.rotation.y = p.heading;
    sleeper.castShadow = sleeper.receiveShadow = true;
    g.add(sleeper);
    ctx.reserve(p.x, p.z, 3.2);
  }
  ctx.group.add(g);
}

/** A tower crane: lattice mast, a long jib and a counter-jib with concrete weights. */
export function towerCrane(ctx: Scenery, x: number, z: number, yaw: number, jib: number, height: number, mats: IndustrialMaterials): void {
  const g = new THREE.Group();
  g.add(latticeBeam(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, height, 0), 1.8, 1.8, mats.yellowSteel, 0.12, new THREE.Vector3(1, 0, 0)));
  const base = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, 4), mats.concrete);
  base.position.y = 0.4;
  base.receiveShadow = base.castShadow = true;
  g.add(base);
  const top = height + 0.9;
  g.add(latticeBeam(new THREE.Vector3(0, top, -3), new THREE.Vector3(0, top, jib), 1.4, 1.5, mats.yellowSteel, 0.11));
  g.add(latticeBeam(new THREE.Vector3(0, top, -3), new THREE.Vector3(0, top, -12), 1.6, 1.2, mats.yellowSteel, 0.12));
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.8, 2.2), mats.steel);
  cab.position.set(1.6, top - 0.2, 0.5);
  cab.castShadow = true;
  g.add(cab);
  for (let k = 0; k < 3; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.1), mats.concrete);
    w.position.set(0, top - 0.6, -9 - k * 1.15);
    w.castShadow = true;
    g.add(w);
  }
  // Apex and tie bars.
  const apex = new THREE.Vector3(0, top + 5, 0);
  g.add(strut(new THREE.Vector3(0, top + 0.7, 0), apex, 0.4, mats.yellowSteel));
  g.add(strut(apex, new THREE.Vector3(0, top + 0.7, jib * 0.65), 0.08, mats.steel));
  g.add(strut(apex, new THREE.Vector3(0, top + 0.6, -11.5), 0.08, mats.steel));
  // Trolley and hook cable.
  const trolleyZ = jib * (0.45 + ctx.rnd() * 0.4);
  const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.4), mats.steel);
  trolley.position.set(0, top - 1, trolleyZ);
  g.add(trolley);
  const hookY = 4 + ctx.rnd() * 6;
  g.add(strut(new THREE.Vector3(0, top - 1.2, trolleyZ), new THREE.Vector3(0, hookY, trolleyZ), 0.06, mats.steel));
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), mats.yellowSteel);
  hook.position.set(0, hookY - 0.4, trolleyZ);
  hook.castShadow = true;
  g.add(hook);
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  ctx.group.add(g);
  ctx.reserve(x, z, 4);
}

/** Barrels in small groups around a center. */
export function barrelCluster(list: Array<[THREE.Matrix4, THREE.Color]>, ctx: Scenery, x: number, z: number, count: number, color: THREE.Color, spread = 2.2): void {
  for (let k = 0; k < count; k++) {
    const a = ctx.rnd() * Math.PI * 2;
    const r = ctx.rnd() * spread;
    const tipped = ctx.rnd() < 0.15;
    list.push([
      compose(x + Math.cos(a) * r, tipped ? 0.42 : 0.625, z + Math.sin(a) * r, ctx.rnd() * 6, 1, 1, 1, tipped ? Math.PI / 2 : 0),
      color,
    ]);
  }
}

/** Tire walls on the outside of the sharpest corners. */
export function tireStacks(ctx: Scenery, minCurvature = 0.022): void {
  const geo = new THREE.TorusGeometry(0.42, 0.2, 8, 16);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.95 });
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const n = ctx.track.samples.length;
  const step = 2;
  for (let i = 0; i < n; i += step) {
    const s = ctx.track.samples[i];
    if (Math.abs(s.curvature) < minCurvature) continue;
    // Outside of a right turn is the left side (negative lateral).
    const side: 1 | -1 = s.curvature > 0 ? -1 : 1;
    const p = ctx.trackside(s.dist, side, 1.6);
    for (let level = 0; level < 3; level++) {
      matrices.push(new THREE.Matrix4().makeTranslation(p.x, 0.2 + level * 0.38, p.z));
      const accent = Math.floor(i / step) % 4 === 0 ? new THREE.Color(0xd8d8d8) : new THREE.Color(0x222222);
      colors.push(level === 2 ? accent : new THREE.Color(0x222222));
    }
    ctx.reserve(p.x, p.z, 0.8);
  }
  ctx.group.add(instanced(geo, mat, matrices, colors));
}

/** Low-poly rock: an icosahedron with jittered vertices, flattened at the base. */
export function rockGeometry(rnd: () => number, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // Displace shared vertices consistently so the surface stays closed.
  const offsets = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = offsets.get(key);
    if (k === undefined) {
      k = 0.75 + rnd() * 0.5;
      offsets.set(key, k);
    }
    const y = pos.getY(i);
    pos.setXYZ(i, pos.getX(i) * k, Math.max(y * k, -0.25), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}
