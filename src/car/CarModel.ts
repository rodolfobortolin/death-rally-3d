import * as THREE from 'three';
import { mergeStatic } from './mergeStatic';

/**
 * Visual representation of a car. Models are built procedurally, but anything
 * that fills this interface (e.g. a glTF made in Blender) can be used.
 * Convention: the car faces +Z, +Y is up, origin at ground level between the axles.
 */
export interface CarVisual {
  root: THREE.Group;
  /** Everything that leans with the fake suspension (all but the wheels). */
  body: THREE.Group;
  /** Front wheels steer (rotation.y on the pivot) and spin (rotation.x on the wheel). */
  frontWheelPivots: THREE.Object3D[];
  wheels: THREE.Object3D[];
  wheelRadius: number;
  brakeLightMaterial: THREE.MeshStandardMaterial;
  /** Body paint, dirtied and charred as the car takes damage. */
  paintMaterial: THREE.MeshPhysicalMaterial;
  /** Local position of the engine bay, where damage smoke comes from. */
  engineOffset: THREE.Vector3;
  /** Local position of the gun muzzle. */
  muzzleOffset: THREE.Vector3;
  /** Rear wheel contact points in local space, used for skid marks and smoke. */
  rearWheelOffsets: THREE.Vector3[];
  /** Exhaust tips in local space, used for turbo flames. */
  exhaustOffsets: THREE.Vector3[];
  damage: DamageParts;
}

/** Parts the damage system bends, breaks or knocks off. */
export interface DamageParts {
  /** Painted panels whose vertices get dented. */
  panels: THREE.Mesh[];
  /** Bolt-on parts that hang loose and then fall off, in order of fragility. */
  loose: THREE.Object3D[];
  /** One material per headlight so they can fail individually. */
  headlights: THREE.MeshStandardMaterial[];
}

/** The six cars of the original Death Rally. */
export type CarBodyType = 'vagabond' | 'dervish' | 'sentinel' | 'shrieker' | 'wraith' | 'deliverator';

export interface CarModelOptions {
  bodyColor: THREE.ColorRepresentation;
  bodyType?: CarBodyType;
}

const LENGTH = 4.4;
const WIDTH = 2.0;

export const CAR_DIMENSIONS = { length: LENGTH, width: WIDTH };

// ---------------------------------------------------------------------------
// Materials and small parts
// ---------------------------------------------------------------------------

interface Materials {
  paint: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  brake: THREE.MeshStandardMaterial;
}

type MaterialKey = keyof Materials;

function createMaterials(o: CarModelOptions): Materials {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: o.bodyColor, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6b6763, roughness: 0.5, metalness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x8f8a86, metalness: 0.6, roughness: 0.45 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 0.8 }),
  };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

function cylinder(r: number, len: number, mat: THREE.Material, segments = 10): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), mat);
  m.castShadow = true;
  return m;
}

/** A straight tube between two points. */
function tube(r: number, from: THREE.Vector3, to: THREE.Vector3, mat: THREE.Material): THREE.Mesh {
  const t = cylinder(r, from.distanceTo(to), mat, 8);
  t.position.copy(from).add(to).multiplyScalar(0.5);
  t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return t;
}

interface WheelSpec {
  radius: number;
  width: number;
  /** Distance of the wheel center from the center line, and of the axles from the origin. */
  x: number;
  z: number;
}

/** A road wheel: tire with rounded shoulders and a plain steel rim. */
function createWheel(spec: WheelSpec, mats: Materials): THREE.Group {
  const { radius: r, width: w } = spec;
  const wheel = new THREE.Group();
  const shoulder = Math.min(0.06, w * 0.2);
  const profile = [
    [r * 0.6, -w / 2], [r - shoulder, -w / 2], [r, -w / 2 + shoulder], [r, w / 2 - shoulder], [r - shoulder, w / 2], [r * 0.6, w / 2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), mats.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);
  const disc = (radius: number, width: number, mat: THREE.Material, segments: number) => {
    const m = cylinder(radius, width, mat, segments);
    m.rotation.z = Math.PI / 2;
    wheel.add(m);
  };
  disc(r * 0.64, w - 0.02, mats.rim, 16);
  disc(r * 0.2, w + 0.02, mats.trim, 8);
  // Slots in the rim, so the wheel visibly turns.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const slot = box(w, r * 0.13, r * 0.13, mats.trim, 0, Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42, false);
    slot.rotation.x = -a;
    wheel.add(slot);
  }
  return wheel;
}

/** One emissive material per headlight, left then right. */
function lampMaterials(): THREE.MeshStandardMaterial[] {
  return [0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 3 }));
}

/** Round headlight in a chrome bezel, facing forward and tilted back by `tilt`. */
function roundLamp(lens: THREE.Material, mats: Materials, r: number, x: number, y: number, z: number, tilt: number): THREE.Group {
  const lamp = new THREE.Group();
  const bezel = cylinder(r * 1.18, 0.06, mats.chrome, 16);
  const glass = cylinder(r, 0.08, lens, 16);
  bezel.castShadow = glass.castShadow = false;
  lamp.add(bezel, glass);
  lamp.position.set(x, y, z);
  lamp.rotation.x = Math.PI / 2 - tilt;
  return lamp;
}

/** Twin machine guns poking out of the nose. Returns the muzzle position. */
function addGuns(body: THREE.Object3D, mats: Materials, y: number, z: number): THREE.Vector3 {
  for (const x of [-0.17, 0.17]) {
    const barrel = cylinder(0.035, 0.5, mats.metal, 8);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(x, y, z);
    const shroud = cylinder(0.052, 0.12, mats.trim, 8);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(x, y, z + 0.2);
    body.add(barrel, shroud);
  }
  return new THREE.Vector3(0, y, z + 0.3);
}

/** Tail pipes sticking out of the back. Returns the tips, for turbo flames. */
function addExhausts(body: THREE.Object3D, mats: Materials, xs: number[], y: number, z: number): THREE.Vector3[] {
  return xs.map((x) => {
    const pipe = cylinder(0.055, 0.24, mats.chrome, 10);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, z);
    body.add(pipe);
    return new THREE.Vector3(x, y, z - 0.16);
  });
}

function addMirrors(body: THREE.Object3D, mats: Materials, x: number, y: number, z: number): THREE.Group {
  const mirrors = new THREE.Group();
  for (const side of [-1, 1]) mirrors.add(box(0.14, 0.07, 0.05, mats.paint, side * x, y, z));
  body.add(mirrors);
  return mirrors;
}

// ---------------------------------------------------------------------------
// Lofted panels
// ---------------------------------------------------------------------------

/**
 * One cross-section of a lofted panel: a superellipse that is `w` wide (half width) at
 * height `yb`, bulging down to `y0` and up to `y1`.
 */
interface Section {
  z: number;
  w: number;
  y0: number;
  yb: number;
  y1: number;
}

const S = (z: number, w: number, y0: number, yb: number, y1: number): Section => ({ z, w, y0, yb, y1 });
/** Section of an open arch (a cabin) standing on the body at height `yb`. */
const A = (z: number, w: number, yb: number, y1: number): Section => S(z, w, yb, yb, y1);

/** Ring angles in degrees: -90 is the bottom center, 0 the widest point, 90 the top center. */
const BODY_RING = [-90, -75, -58, -38, -15, 0, 10, 22, 34, 46, 58, 70, 80, 90];
const FENDER_RING = [-90, -55, -20, 0, 20, 40, 60, 78, 90];
/** Starts at 0, so it makes an open arch. 40..50 is the roof rail. */
const CABIN_RING = [0, 5, 14, 27, 40, 50, 62, 76, 90];

/** Openings cut into the underside of a panel around the wheels. */
interface WheelArches {
  z: number[];
  axleY: number;
  radius: number;
  /** Only the part of the panel further out than this is cut. */
  innerX: number;
}

function wheelArches(wheel: WheelSpec): WheelArches {
  return { z: [wheel.z, -wheel.z], axleY: wheel.radius, radius: wheel.radius + 0.06, innerX: wheel.x - wheel.width / 2 - 0.04 };
}

interface LoftOptions {
  /** Offset of the center line, for fenders that run beside the body. */
  x?: number;
  /** Superellipse exponents above and below `yb`: 2 is round, higher is boxier. */
  nt?: number;
  nb?: number;
  /** How far the sides lean in towards the top, as a fraction of the width. */
  lean?: number;
  ring?: number[];
  /** Stations between consecutive sections. */
  steps?: number;
  /** Extra stations, where the material changes (window edges and so on). */
  cuts?: number[];
  arches?: WheelArches;
  /** Material of the quad at (z, ring angle); null leaves a hole. Paint by default. */
  pick?: (z: number, angle: number) => MaterialKey | null;
  capFront?: MaterialKey;
  capRear?: MaterialKey;
}

/** Monotone cubic interpolation through (xs, ys): smooth, and it never overshoots the keys. */
function monotone(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = xs.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    const a = slope[i - 1];
    const b = slope[i];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = THREE.MathUtils.clamp((x - xs[i]) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (3 * t2 - 2 * t3) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * Skins a smooth panel through a few cross-sections along the car, one mesh per
 * material. Meshes are indexed, so they shade smooth and merge with the other parts.
 */
function loft(parent: THREE.Object3D, mats: Materials, sections: Section[], o: LoftOptions = {}): void {
  const keys = [...sections].sort((a, b) => a.z - b.z);
  const zs = keys.map((k) => k.z);
  const curve = (get: (s: Section) => number) => monotone(zs, keys.map(get));
  const fw = curve((s) => s.w);
  const f0 = curve((s) => s.y0);
  const fb = curve((s) => s.yb);
  const f1 = curve((s) => s.y1);
  const zMin = zs[0];
  const zMax = zs[zs.length - 1];

  const steps = o.steps ?? 4;
  const inner = [...(o.cuts ?? [])];
  for (let i = 0; i < zs.length - 1; i++) {
    for (let s = 0; s < steps; s++) inner.push(zs[i] + ((zs[i + 1] - zs[i]) * s) / steps);
  }
  for (const zc of o.arches?.z ?? []) {
    for (let k = 0; k <= 10; k++) inner.push(zc + o.arches!.radius * Math.cos((k * Math.PI) / 10));
  }
  const stations = [zMin];
  for (const z of inner.sort((a, b) => a - b)) {
    if (z - stations[stations.length - 1] > 0.012 && zMax - z > 0.012) stations.push(z);
  }
  stations.push(zMax);

  const angles = o.ring ?? BODY_RING;
  const closed = angles[0] === -90;
  // Counter-clockwise seen from the front: up the right side, then down the left.
  const ring: Array<[number, number]> = angles.map((a) => [a, 1]);
  for (let i = angles.length - 2; i >= (closed ? 1 : 0); i--) ring.push([angles[i], -1]);
  const cx = o.x ?? 0;
  const nt = o.nt ?? 3.5;
  const nb = o.nb ?? 6;
  const lean = o.lean ?? 0;

  const point = (z: number, angle: number, side: number): [number, number, number] => {
    const rad = THREE.MathUtils.degToRad(angle);
    const c = Math.max(0, Math.cos(rad));
    const s = Math.sin(rad);
    const w = fw(z);
    const yb = fb(z);
    let x: number;
    let y: number;
    if (s >= 0) {
      const rise = Math.pow(s, 2 / nt);
      x = w * Math.pow(c, 2 / nt) * (1 - lean * rise);
      y = yb + (f1(z) - yb) * rise;
    } else {
      x = w * Math.pow(c, 2 / nb);
      y = yb - (yb - f0(z)) * Math.pow(-s, 2 / nb);
    }
    x = cx + side * x;
    const arches = o.arches;
    if (arches && Math.abs(x) > arches.innerX) {
      for (const zc of arches.z) {
        const dz = Math.abs(z - zc);
        if (dz < arches.radius - 1e-3) y = Math.max(y, arches.axleY + Math.sqrt(arches.radius * arches.radius - dz * dz));
      }
    }
    return [x, y, z];
  };
  const grid = stations.map((z) => ring.map(([angle, side]) => point(z, angle, side)));

  interface Shell {
    positions: number[];
    index: number[];
    ids: Map<number, number>;
  }
  const shells = new Map<MaterialKey, Shell>();
  const shellFor = (key: MaterialKey): Shell => {
    let sh = shells.get(key);
    if (!sh) {
      sh = { positions: [], index: [], ids: new Map() };
      shells.set(key, sh);
    }
    return sh;
  };
  const n = ring.length;
  const segments = closed ? n : n - 1;
  const vertex = (sh: Shell, i: number, j: number): number => {
    const id = i * n + j;
    let v = sh.ids.get(id);
    if (v === undefined) {
      v = sh.positions.length / 3;
      sh.positions.push(...grid[i][j]);
      sh.ids.set(id, v);
    }
    return v;
  };
  for (let i = 0; i < stations.length - 1; i++) {
    const zMid = (stations[i] + stations[i + 1]) / 2;
    for (let j = 0; j < segments; j++) {
      const k = (j + 1) % n;
      const key = o.pick ? o.pick(zMid, (ring[j][0] + ring[k][0]) / 2) : 'paint';
      if (!key) continue;
      const sh = shellFor(key);
      const a = vertex(sh, i, j);
      const b = vertex(sh, i, k);
      const c = vertex(sh, i + 1, k);
      const d = vertex(sh, i + 1, j);
      sh.index.push(a, b, c, a, c, d);
    }
  }
  // End caps get their own vertices, so the edge stays crisp.
  const cap = (key: MaterialKey | undefined, i: number, front: boolean) => {
    if (!key) return;
    const sh = shellFor(key);
    const z = stations[i];
    const center = sh.positions.length / 3;
    sh.positions.push(cx, closed ? (f0(z) + f1(z)) / 2 : fb(z), z);
    for (const p of grid[i]) sh.positions.push(...p);
    for (let j = 0; j < segments; j++) {
      const a = center + 1 + j;
      const b = center + 1 + ((j + 1) % n);
      if (front) sh.index.push(center, a, b);
      else sh.index.push(center, b, a);
    }
  };
  cap(o.capRear, 0, false);
  cap(o.capFront, stations.length - 1, true);

  for (const [key, sh] of shells) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(sh.positions, 3));
    // Unused, but the attributes must match the stock geometries to merge with them.
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((sh.positions.length / 3) * 2), 2));
    geo.setIndex(sh.index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  }
}

/** Where the glass goes on a cabin, as [rear, front] ranges along the car. */
interface Glazing {
  windshield: [number, number];
  rear?: [number, number];
  side: [number, number];
  /** Pillars splitting the side glass. */
  pillars?: number[];
}

const PILLAR = 0.045;

/** Loft options that turn a cabin arch into windows, roof, rails and pillars. */
function glazing(g: Glazing): Pick<LoftOptions, 'ring' | 'cuts' | 'pick'> {
  const pillars = g.pillars ?? [];
  const within = (z: number, range?: [number, number]) => range !== undefined && z > range[0] && z < range[1];
  return {
    ring: CABIN_RING,
    cuts: [...g.windshield, ...(g.rear ?? []), ...g.side, ...pillars.flatMap((z) => [z - PILLAR, z + PILLAR])],
    pick: (z, angle) => {
      if (angle > 50) return within(z, g.windshield) || within(z, g.rear) ? 'glass' : 'paint';
      if (angle < 40 && within(z, g.side) && !pillars.some((p) => Math.abs(z - p) < PILLAR)) return 'glass';
      return 'paint';
    },
  };
}

// ---------------------------------------------------------------------------
// Body styles
// ---------------------------------------------------------------------------

interface BodyBuild {
  muzzle: THREE.Vector3;
  engine: THREE.Vector3;
  exhausts: THREE.Vector3[];
  loose: THREE.Object3D[];
  headlights: THREE.MeshStandardMaterial[];
  wheel: WheelSpec;
}

/** Vagabond: the old Beetle. Round shell, four bulging fenders and running boards. */
function buildVagabond(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.37, width: 0.26, x: 0.79, z: 1.3 };
  const arches = wheelArches(wheel);
  // Sloping hood, cabin floor and engine lid.
  loft(
    body,
    mats,
    [
      S(2.02, 0.26, 0.52, 0.58, 0.66), S(1.92, 0.42, 0.44, 0.62, 0.8), S(1.6, 0.55, 0.36, 0.7, 0.96), S(1.1, 0.64, 0.32, 0.78, 1.05),
      S(0.7, 0.72, 0.3, 0.84, 1.07), S(-0.9, 0.74, 0.3, 0.84, 1.07), S(-1.4, 0.68, 0.32, 0.78, 1.0), S(-1.8, 0.54, 0.4, 0.66, 0.82),
      S(-2.02, 0.3, 0.5, 0.56, 0.62),
    ],
    { nt: 2.6, arches, capFront: 'paint', capRear: 'paint' },
  );
  // Domed roof that runs down into the engine lid.
  loft(
    body,
    mats,
    [
      A(0.78, 0.62, 1.03, 1.05), A(0.48, 0.62, 1.03, 1.46), A(0.1, 0.64, 1.03, 1.62), A(-0.45, 0.64, 1.03, 1.63), A(-1.0, 0.6, 1.02, 1.46),
      A(-1.5, 0.52, 0.95, 1.2), A(-1.9, 0.38, 0.74, 0.76),
    ],
    { nt: 2.6, lean: 0.12, ...glazing({ windshield: [0.48, 0.78], rear: [-1.4, -1.02], side: [-0.95, 0.44], pillars: [-0.25] }) },
  );
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    const fender: LoftOptions = { x: side * 0.76, nt: 2.2, nb: 3, ring: FENDER_RING, arches, capFront: 'paint', capRear: 'paint' };
    loft(body, mats, [S(2.04, 0.12, 0.5, 0.62, 0.74), S(1.9, 0.19, 0.4, 0.62, 0.86), S(1.3, 0.22, 0.3, 0.6, 0.92), S(0.9, 0.21, 0.3, 0.52, 0.8), S(0.5, 0.14, 0.28, 0.36, 0.46)], fender);
    loft(body, mats, [S(-0.45, 0.14, 0.28, 0.36, 0.46), S(-0.85, 0.22, 0.3, 0.54, 0.84), S(-1.3, 0.24, 0.3, 0.62, 0.95), S(-1.8, 0.2, 0.38, 0.6, 0.84), S(-2.02, 0.1, 0.48, 0.56, 0.66)], fender);
    body.add(box(0.2, 0.05, 1.0, mats.trim, side * 0.84, 0.33, 0.02));
    body.add(roundLamp(headlights[i], mats, 0.13, side * 0.76, 0.7, 2.02, 0.3));
    body.add(box(0.12, 0.1, 0.05, mats.brake, side * 0.76, 0.66, -2.02, false));
  });
  const frontBumper = box(1.75, 0.08, 0.08, mats.chrome, 0, 0.43, 2.09);
  const rearBumper = box(1.75, 0.08, 0.08, mats.chrome, 0, 0.43, -2.08);
  body.add(frontBumper, rearBumper);
  return {
    muzzle: addGuns(body, mats, 0.52, 2.02),
    engine: new THREE.Vector3(0, 1.0, -1.6),
    exhausts: addExhausts(body, mats, [-0.18, 0.18], 0.38, -2.06),
    loose: [frontBumper, rearBumper],
    headlights,
    wheel,
  };
}

/** Dervish: a pickup with an open bed, roll bars behind the cab and a bull bar. */
function buildDervish(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.4, width: 0.32, x: 0.78, z: 1.4 };
  // One boxy shell, nose to tailgate, with the top left open over the bed.
  const bed: [number, number] = [-2.08, -0.6];
  loft(
    body,
    mats,
    [S(2.2, 0.9, 0.44, 0.7, 0.93), S(2.1, 0.94, 0.34, 0.8, 0.99), S(0.8, 0.96, 0.3, 0.88, 1.05), S(-2.14, 0.96, 0.3, 0.88, 1.05), S(-2.2, 0.94, 0.36, 0.88, 1.05)],
    {
      nt: 5,
      arches: wheelArches(wheel),
      cuts: bed,
      capFront: 'paint',
      capRear: 'paint',
      pick: (z, angle) => (angle > 46 && z > bed[0] && z < bed[1] ? null : 'paint'),
    },
  );
  // The shell is one-sided, so the bed gets its own floor and inner walls.
  const bedZ = (bed[0] + bed[1]) / 2;
  const bedLength = bed[1] - bed[0];
  body.add(box(1.66, 0.04, bedLength, mats.metal, 0, 0.7, bedZ));
  for (const side of [-1, 1]) body.add(box(0.04, 0.34, bedLength, mats.paint, side * 0.82, 0.86, bedZ));
  for (const z of bed) body.add(box(1.66, 0.34, 0.04, mats.paint, 0, 0.86, z));

  loft(body, mats, [A(0.8, 0.84, 1.03, 1.05), A(0.35, 0.82, 1.03, 1.5), A(-0.5, 0.82, 1.03, 1.5)], {
    nt: 4.5,
    lean: 0.1,
    capRear: 'paint',
    ...glazing({ windshield: [0.35, 0.8], side: [-0.4, 0.7] }),
  });
  body.add(box(1.25, 0.3, 0.03, mats.glass, 0, 1.28, -0.51, false));

  const rollBars = new THREE.Group();
  for (const side of [-1, 1]) rollBars.add(tube(0.045, new THREE.Vector3(side * 0.62, 1.47, -0.5), new THREE.Vector3(side * 0.62, 0.72, -1.3), mats.metal));
  // Bumper with a row of uprights and a hoop over the grille.
  const bullBar = new THREE.Group();
  bullBar.add(box(1.9, 0.14, 0.14, mats.metal, 0, 0.42, 2.24));
  for (const x of [-0.66, -0.33, 0, 0.33, 0.66]) bullBar.add(box(0.08, 0.36, 0.08, mats.metal, x, 0.62, 2.3));
  bullBar.add(box(1.5, 0.07, 0.07, mats.metal, 0, 0.78, 2.3));
  for (const x of [-0.3, 0.3]) bullBar.add(box(0.07, 0.24, 0.07, mats.metal, x, 0.9, 2.3));
  bullBar.add(box(0.67, 0.07, 0.07, mats.metal, 0, 1.0, 2.3));
  const rearBumper = box(1.9, 0.14, 0.12, mats.metal, 0, 0.42, -2.25);
  body.add(rollBars, bullBar, rearBumper);

  body.add(box(0.8, 0.2, 0.04, mats.trim, 0, 0.8, 2.205, false));
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    body.add(box(0.36, 0.15, 0.05, headlights[i], side * 0.62, 0.82, 2.21, false));
    body.add(box(0.14, 0.26, 0.05, mats.brake, side * 0.8, 0.86, -2.21, false));
  });
  return {
    muzzle: addGuns(body, mats, 0.58, 2.2),
    engine: new THREE.Vector3(0, 1.1, 1.5),
    exhausts: addExhausts(body, mats, [0.62], 0.36, -2.28),
    loose: [rollBars, addMirrors(body, mats, 0.9, 1.09, 0.55), bullBar, rearBumper],
    headlights,
    wheel,
  };
}

/** Sentinel: a square three-box sedan with a full-width headlight band. */
function buildSentinel(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.38, width: 0.3, x: 0.79, z: 1.4 };
  loft(
    body,
    mats,
    [
      S(2.25, 0.88, 0.42, 0.6, 0.74), S(2.15, 0.93, 0.32, 0.66, 0.8), S(0.8, 0.96, 0.3, 0.86, 1.0), S(-1.45, 0.96, 0.3, 0.88, 1.02),
      S(-2.15, 0.94, 0.32, 0.88, 1.01), S(-2.25, 0.9, 0.42, 0.82, 0.96),
    ],
    { nt: 4.5, arches: wheelArches(wheel), capFront: 'paint', capRear: 'paint' },
  );
  loft(body, mats, [A(0.85, 0.84, 0.98, 1.0), A(0.2, 0.82, 0.98, 1.44), A(-0.8, 0.82, 0.99, 1.45), A(-1.5, 0.8, 1.0, 1.02)], {
    nt: 4.2,
    lean: 0.1,
    ...glazing({ windshield: [0.2, 0.85], rear: [-1.5, -0.8], side: [-1.3, 0.72], pillars: [-0.2, -0.85] }),
  });
  body.add(box(1.6, 0.12, 0.04, mats.trim, 0, 0.65, 2.255, false));
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    body.add(box(0.5, 0.1, 0.05, headlights[i], side * 0.54, 0.65, 2.265, false));
    body.add(box(0.36, 0.12, 0.05, mats.brake, side * 0.6, 0.86, -2.255, false));
  });
  const frontBumper = box(1.86, 0.15, 0.14, mats.trim, 0, 0.44, 2.24);
  const rearBumper = box(1.86, 0.15, 0.14, mats.trim, 0, 0.46, -2.24);
  body.add(frontBumper, rearBumper);
  return {
    muzzle: addGuns(body, mats, 0.44, 2.22),
    engine: new THREE.Vector3(0, 1.05, 1.5),
    exhausts: addExhausts(body, mats, [-0.5], 0.34, -2.3),
    loose: [addMirrors(body, mats, 0.9, 1.03, 0.6), rearBumper, frontBumper],
    headlights,
    wheel,
  };
}

/** Shrieker: a long-nosed muscle coupe with a glass fastback. */
function buildShrieker(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.41, width: 0.34, x: 0.79, z: 1.42 };
  loft(
    body,
    mats,
    [
      S(2.3, 0.78, 0.4, 0.52, 0.6), S(2.18, 0.9, 0.32, 0.6, 0.72), S(1.42, 0.98, 0.3, 0.8, 0.9), S(0.4, 0.98, 0.3, 0.86, 0.96),
      S(-1.3, 1.0, 0.3, 0.88, 0.97), S(-2.2, 0.97, 0.32, 0.88, 0.98), S(-2.3, 0.93, 0.42, 0.82, 0.94),
    ],
    { nt: 3.6, arches: wheelArches(wheel), capFront: 'paint', capRear: 'paint' },
  );
  loft(body, mats, [A(0.45, 0.82, 0.94, 0.96), A(-0.3, 0.78, 0.95, 1.3), A(-0.85, 0.78, 0.95, 1.31), A(-1.95, 0.74, 0.96, 0.98)], {
    nt: 3.8,
    lean: 0.14,
    ...glazing({ windshield: [-0.3, 0.45], rear: [-1.95, -0.85], side: [-1.25, 0.32], pillars: [-0.85] }),
  });
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    body.add(box(0.34, 0.08, 0.05, headlights[i], side * 0.48, 0.52, 2.305, false));
    body.add(box(0.5, 0.12, 0.05, mats.brake, side * 0.55, 0.84, -2.305, false));
  });
  const spoiler = box(1.8, 0.04, 0.18, mats.paint, 0, 0.985, -2.2);
  const airDam = box(1.6, 0.1, 0.08, mats.trim, 0, 0.36, 2.22);
  const rearBumper = box(1.8, 0.12, 0.1, mats.trim, 0, 0.46, -2.29);
  body.add(spoiler, airDam, rearBumper);
  return {
    muzzle: addGuns(body, mats, 0.44, 2.24),
    engine: new THREE.Vector3(0, 1.0, 1.4),
    exhausts: addExhausts(body, mats, [-0.55, 0.55], 0.34, -2.34),
    loose: [spoiler, addMirrors(body, mats, 0.9, 0.99, 0.2), airDam, rearBumper],
    headlights,
    wheel,
  };
}

/** Wraith: the rear-engined sports car. Round lamps on raised fenders, wide hips, fastback. */
function buildWraith(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.39, width: 0.32, x: 0.79, z: 1.35 };
  const arches = wheelArches(wheel);
  loft(
    body,
    mats,
    [
      S(2.15, 0.8, 0.42, 0.52, 0.6), S(2.02, 0.9, 0.32, 0.58, 0.7), S(1.35, 0.93, 0.3, 0.76, 0.85), S(0.6, 0.94, 0.3, 0.84, 0.95),
      S(-0.8, 0.97, 0.3, 0.86, 0.96), S(-1.4, 1.0, 0.3, 0.86, 0.97), S(-1.95, 0.94, 0.34, 0.76, 0.86), S(-2.15, 0.84, 0.44, 0.64, 0.72),
    ],
    { nt: 3, arches, capFront: 'paint', capRear: 'paint' },
  );
  loft(
    body,
    mats,
    [A(0.65, 0.78, 0.93, 0.95), A(0.05, 0.75, 0.94, 1.36), A(-0.45, 0.75, 0.95, 1.38), A(-1.2, 0.7, 0.95, 1.2), A(-1.95, 0.58, 0.84, 0.86)],
    { nt: 2.8, lean: 0.14, ...glazing({ windshield: [0.05, 0.65], rear: [-1.25, -0.45], side: [-1.05, 0.5], pillars: [-0.42] }) },
  );
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    // Fenders stand proud of the hood and carry the headlights.
    loft(body, mats, [S(2.1, 0.15, 0.56, 0.66, 0.78), S(1.9, 0.25, 0.5, 0.72, 0.93), S(1.35, 0.28, 0.5, 0.78, 0.99), S(0.55, 0.2, 0.6, 0.88, 0.97)], {
      x: side * 0.66,
      nt: 2.2,
      nb: 2.2,
      ring: FENDER_RING,
      arches,
      capFront: 'paint',
    });
    body.add(roundLamp(headlights[i], mats, 0.14, side * 0.66, 0.79, 2.09, 0.4));
  });
  // Engine lid grille and the full-width reflector.
  const grille = box(0.7, 0.02, 0.3, mats.trim, 0, 0.94, -1.72, false);
  grille.rotation.x = -0.28;
  body.add(grille, box(1.5, 0.1, 0.05, mats.brake, 0, 0.66, -2.15, false));
  const frontBumper = new THREE.Group();
  frontBumper.add(box(1.72, 0.07, 0.08, mats.trim, 0, 0.5, 2.14));
  for (const side of [-1, 1]) frontBumper.add(box(0.24, 0.07, 0.05, mats.chrome, side * 0.5, 0.41, 2.14, false));
  const rearBumper = box(1.76, 0.1, 0.1, mats.trim, 0, 0.52, -2.14);
  body.add(frontBumper, rearBumper);
  return {
    muzzle: addGuns(body, mats, 0.45, 2.08),
    engine: new THREE.Vector3(0, 0.95, -1.7),
    exhausts: addExhausts(body, mats, [-0.5, 0.5], 0.38, -2.18),
    loose: [addMirrors(body, mats, 0.86, 0.98, 0.42), frontBumper, rearBumper],
    headlights,
    wheel,
  };
}

/** Deliverator: a low wedge. Shovel nose and bubble cockpit between four fat pontoon fenders. */
function buildDeliverator(body: THREE.Group, mats: Materials): BodyBuild {
  const wheel: WheelSpec = { radius: 0.4, width: 0.34, x: 0.84, z: 1.38 };
  const arches = wheelArches(wheel);
  // Fuselage: wide flat nose that rises towards the cockpit.
  loft(
    body,
    mats,
    [
      S(2.4, 0.16, 0.36, 0.4, 0.44), S(2.2, 0.34, 0.3, 0.44, 0.54), S(1.3, 0.5, 0.28, 0.58, 0.76), S(0.4, 0.58, 0.28, 0.72, 0.9),
      S(-0.9, 0.58, 0.28, 0.76, 0.96), S(-1.7, 0.5, 0.3, 0.74, 0.92), S(-2.3, 0.4, 0.4, 0.7, 0.84),
    ],
    { nt: 2.8, nb: 5, capFront: 'paint', capRear: 'paint' },
  );
  // Teardrop canopy: raked wraparound glass, painted roof band, and a spine down to the tail.
  loft(body, mats, [A(0.5, 0.46, 0.88, 0.9), A(-0.1, 0.5, 0.92, 1.22), A(-0.55, 0.5, 0.95, 1.27), A(-1.3, 0.36, 0.94, 1.08), A(-2.0, 0.16, 0.88, 0.9)], {
    nt: 2.6,
    lean: 0.1,
    ring: CABIN_RING,
    cuts: [-0.55, -0.1],
    pick: (z, angle) => (z > -0.55 && (angle < 40 || z > -0.1) ? 'glass' : 'paint'),
  });
  // Tail deck between the rear fenders, kicking up into a ducktail.
  loft(body, mats, [S(-1.5, 0.5, 0.7, 0.76, 0.8), S(-2.0, 0.62, 0.78, 0.84, 0.88), S(-2.36, 0.66, 0.85, 0.92, 0.96)], { nt: 6, capRear: 'paint' });
  // Floor of the channels between the fuselage and the fenders.
  body.add(box(1.3, 0.2, 4.2, mats.paint, 0, 0.4, 0));
  const headlights = lampMaterials();
  [-1, 1].forEach((side, i) => {
    const fender: LoftOptions = { nt: 2.3, nb: 3, ring: FENDER_RING, arches, capFront: 'paint', capRear: 'paint' };
    // The front fenders are the widest part of the car and reach as far forward as the nose.
    loft(body, mats, [S(2.38, 0.16, 0.4, 0.48, 0.56), S(2.2, 0.27, 0.32, 0.52, 0.7), S(1.38, 0.32, 0.28, 0.58, 0.9), S(0.5, 0.3, 0.28, 0.56, 0.84), S(-0.25, 0.22, 0.28, 0.48, 0.68)], { ...fender, x: side * 0.8 });
    loft(body, mats, [S(0.25, 0.22, 0.28, 0.48, 0.68), S(-0.6, 0.31, 0.28, 0.58, 0.9), S(-1.38, 0.34, 0.28, 0.62, 1.02), S(-2.05, 0.3, 0.34, 0.64, 0.94), S(-2.38, 0.2, 0.44, 0.62, 0.8)], { ...fender, x: side * 0.78 });
    // Air intakes: beside the nose, and ahead of the rear wheels.
    body.add(box(0.18, 0.14, 0.3, mats.trim, side * 0.43, 0.46, 2.12, false));
    const scoop = box(0.12, 0.1, 0.34, mats.trim, side * 0.6, 0.76, -0.5, false);
    scoop.rotation.x = -0.25;
    body.add(scoop);
    const lamp = box(0.24, 0.12, 0.04, headlights[i], side * 0.8, 0.645, 2.29, false);
    lamp.rotation.x = -0.9;
    body.add(lamp);
    body.add(box(0.26, 0.1, 0.05, mats.brake, side * 0.78, 0.66, -2.385, false));
  });
  const splitter = box(2.0, 0.03, 0.34, mats.trim, 0, 0.3, 2.3);
  const lip = box(1.3, 0.04, 0.08, mats.paint, 0, 0.975, -2.33);
  body.add(splitter, lip);
  return {
    muzzle: addGuns(body, mats, 0.42, 2.25),
    engine: new THREE.Vector3(0, 1.0, -1.3),
    exhausts: addExhausts(body, mats, [-0.42, -0.18, 0.18, 0.42], 0.38, -2.4),
    loose: [lip, splitter],
    headlights,
    wheel,
  };
}

const BUILDERS: Record<CarBodyType, (body: THREE.Group, mats: Materials) => BodyBuild> = {
  vagabond: buildVagabond,
  dervish: buildDervish,
  sentinel: buildSentinel,
  shrieker: buildShrieker,
  wraith: buildWraith,
  deliverator: buildDeliverator,
};

/** Builds a car of the requested style. */
export function createCarModel(options: CarModelOptions): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats = createMaterials(options);
  const build = BUILDERS[options.bodyType ?? 'vagabond'](body, mats);
  // Bake the rigid body into one mesh per material (loose parts stay separate so they can
  // hang and fall off). This keeps a car down to a handful of draw calls.
  mergeStatic(body, build.loose);
  for (const part of build.loose) mergeStatic(part);
  // Paint uses vertex colors for damage grime, so every painted mesh must be a damage panel
  // (meshes without a color attribute would render black).
  mats.paint.vertexColors = true;
  const panels: THREE.Mesh[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === mats.paint) panels.push(o);
  });

  const wheels: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];
  const { radius, x: wheelX, z: axleZ } = build.wheel;
  // All four wheels share one baked wheel (tire, rim, hub).
  const wheelTemplate = createWheel(build.wheel, mats);
  mergeStatic(wheelTemplate);
  for (const z of [axleZ, -axleZ]) {
    for (const x of [-wheelX, wheelX]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, radius, z);
      const wheel = wheelTemplate.clone();
      pivot.add(wheel);
      root.add(pivot);
      wheels.push(wheel);
      if (z > 0) frontWheelPivots.push(pivot);
    }
  }

  return {
    root,
    body,
    frontWheelPivots,
    wheels,
    wheelRadius: radius,
    brakeLightMaterial: mats.brake,
    paintMaterial: mats.paint,
    engineOffset: build.engine,
    muzzleOffset: build.muzzle,
    rearWheelOffsets: [new THREE.Vector3(-wheelX, 0, -axleZ), new THREE.Vector3(wheelX, 0, -axleZ)],
    exhaustOffsets: build.exhausts,
    damage: { panels, loose: build.loose, headlights: build.headlights },
  };
}
