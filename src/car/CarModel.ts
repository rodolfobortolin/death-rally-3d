import * as THREE from 'three';

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

export type CarBodyType = 'muscle' | 'pickup' | 'buggy';

export interface CarModelOptions {
  bodyColor: THREE.ColorRepresentation;
  stripeColor?: THREE.ColorRepresentation;
  bodyType?: CarBodyType;
  /** Racing number painted on the roof/hood. */
  number?: number;
}

const LENGTH = 4.4;
const WIDTH = 2.0;

export const CAR_DIMENSIONS = { length: LENGTH, width: WIDTH };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Extrudes a side profile (z, y) across the car width, centered on X. */
function extrudeProfile(points: Array<[number, number]>, width: number, bevel: number, curveSegments = 6): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments,
    steps: 6, // extra rows across the width so dents look smooth
  });
  // Shape space (x, y, extrude) -> car space (z, y, x).
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
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

/** A chunky off-road wheel: knobby tire, deep rim and a hub cap. */
function createWheel(radius: number, width: number, mats: Materials): THREE.Group {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18, 1), mats.tire);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  wheel.add(tire);
  // Tread blocks around the circumference.
  const knobGeo = new THREE.BoxGeometry(width * 1.04, radius * 0.16, radius * 0.22);
  const knobs = 14;
  for (let i = 0; i < knobs; i++) {
    const a = (i / knobs) * Math.PI * 2;
    const knob = new THREE.Mesh(knobGeo, mats.tire);
    knob.position.set(0, Math.cos(a) * radius * 0.98, Math.sin(a) * radius * 0.98);
    knob.rotation.x = -a;
    wheel.add(knob);
  }
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, width + 0.03, 10), mats.rim);
  rim.rotation.z = Math.PI / 2;
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.2, radius * 0.2, width + 0.06, 8), mats.chrome);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);
  return wheel;
}

/** Racing number in a white roundel, or a lightning bolt, as a transparent decal. */
function createDecalTexture(kind: 'number' | 'bolt', value: number, color: string): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  if (kind === 'number') {
    ctx.fillStyle = '#f2f0ea';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#111';
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 72px Impact, Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), s / 2, s / 2 + 4);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(78, 4);
    ctx.lineTo(30, 70);
    ctx.lineTo(60, 70);
    ctx.lineTo(44, 124);
    ctx.lineTo(100, 50);
    ctx.lineTo(70, 50);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function decal(tex: THREE.Texture, size: number, x: number, y: number, z: number, tiltX = 0, rotY = 0): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.1, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.position.set(x, y, z);
  m.rotation.set(tiltX, rotY, 0);
  return m;
}

interface Materials {
  paint: THREE.MeshPhysicalMaterial;
  stripe: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  chrome: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  brake: THREE.MeshStandardMaterial;
}

function createMaterials(o: CarModelOptions): Materials {
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: o.bodyColor, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 }),
    stripe: new THREE.MeshPhysicalMaterial({ color: o.stripeColor ?? 0xf2f2f2, roughness: 0.35, clearcoat: 1 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.45, metalness: 0.8 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.85, roughness: 0.3 }),
    brake: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 0.8 }),
  };
}

/** Roof/bed-mounted twin machine gun on a turret ring. Returns the muzzle position. */
function addTurretGun(parent: THREE.Object3D, mats: Materials, x: number, y: number, z: number, loose: THREE.Object3D[]): THREE.Vector3 {
  const turret = new THREE.Group();
  turret.position.set(x, y, z);
  const ring = cylinder(0.34, 0.12, mats.metal, 14);
  ring.position.y = 0.06;
  turret.add(ring);
  turret.add(box(0.5, 0.26, 0.7, mats.trim, 0, 0.25, 0.05));
  const ammo = box(0.26, 0.24, 0.36, mats.metal, 0.38, 0.22, -0.05);
  turret.add(ammo);
  for (const bx of [-0.1, 0.1]) {
    const barrel = cylinder(0.05, 1.1, mats.chrome, 8);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(bx, 0.3, 0.85);
    turret.add(barrel);
    const shroud = cylinder(0.075, 0.36, mats.trim, 8);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(bx, 0.3, 0.45);
    turret.add(shroud);
  }
  parent.add(turret);
  loose.push(ammo);
  return new THREE.Vector3(x, y + 0.3, z + 1.45);
}

function addLights(body: THREE.Object3D, mats: Materials, front: { x: number; y: number; z: number; tilt: number }, rear: { x: number; y: number; z: number }): THREE.MeshStandardMaterial[] {
  const heads: THREE.MeshStandardMaterial[] = [];
  for (const side of [-1, 1]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 3 });
    heads.push(mat);
    const head = box(0.4, 0.14, 0.06, mat, side * front.x, front.y, front.z, false);
    head.rotation.x = front.tilt;
    body.add(head);
    const tail = box(0.46, 0.13, 0.06, mats.brake, side * rear.x, rear.y, rear.z, false);
    body.add(tail);
  }
  return heads;
}

// ---------------------------------------------------------------------------
// Body styles
// ---------------------------------------------------------------------------

interface BodyBuild {
  muzzle: THREE.Vector3;
  engine: THREE.Vector3;
  exhausts: THREE.Vector3[];
  panels: THREE.Mesh[];
  loose: THREE.Object3D[];
  headlights: THREE.MeshStandardMaterial[];
  wheelRadius: number;
  wheelWidth: number;
  wheelX: number;
  axleZ: number;
}

function buildMuscle(body: THREE.Group, mats: Materials, o: CarModelOptions): BodyBuild {
  const half = LENGTH / 2;
  const panels: THREE.Mesh[] = [];
  const loose: THREE.Object3D[] = [];
  const lower = new THREE.Mesh(
    extrudeProfile(
      [
        [-half, 0.42], [half - 0.15, 0.42], [half, 0.55], [half - 0.05, 0.78],
        [half - 0.9, 1.0], [-half + 0.55, 1.05], [-half, 1.0], [-half - 0.05, 0.62],
      ],
      WIDTH - 0.1,
      0.1,
    ),
    mats.paint,
  );
  lower.castShadow = lower.receiveShadow = true;
  body.add(lower);
  panels.push(lower);

  // Wide fender flares over the big wheels.
  for (const z of [1.38, -1.38]) {
    for (const side of [-1, 1]) {
      const flare = box(0.22, 0.32, 1.25, mats.paint, side * (WIDTH / 2 - 0.02), 0.82, z);
      body.add(flare);
      panels.push(flare);
    }
  }

  const cabin = new THREE.Mesh(extrudeProfile([[-1.2, 1.0], [0.7, 1.0], [0.1, 1.5], [-0.95, 1.52]], WIDTH - 0.38, 0.06), mats.glass);
  cabin.castShadow = true;
  body.add(cabin);
  const roof = new THREE.Mesh(extrudeProfile([[-0.92, 1.48], [0.08, 1.48], [0.02, 1.57], [-0.88, 1.58]], WIDTH - 0.5, 0.04), mats.paint);
  roof.castShadow = true;
  body.add(roof);
  panels.push(roof);

  // Hood scoop and stripes.
  const scoop = box(0.6, 0.16, 0.7, mats.trim, 0, 1.12, 1.0);
  body.add(scoop);
  for (const x of [-0.42, 0.42]) {
    const stripe = box(0.2, 0.02, 1.4, mats.stripe, x, 1.05, 1.35, false);
    stripe.rotation.x = 0.16;
    body.add(stripe);
    const trunkStripe = box(0.2, 0.02, 0.85, mats.stripe, x, 1.13, -1.7, false);
    body.add(trunkStripe);
  }
  body.add(decal(createDecalTexture('number', o.number ?? 1, '#fff'), 0.62, 0, 1.6, -0.42));

  // Bolt-on parts (fall off first to last).
  const wing = new THREE.Group();
  wing.add(box(WIDTH - 0.1, 0.06, 0.4, mats.trim, 0, 1.36, -half + 0.22));
  for (const x of [-0.65, 0.65]) wing.add(box(0.06, 0.3, 0.16, mats.trim, x, 1.2, -half + 0.25));
  body.add(wing);
  const frontBumper = box(WIDTH, 0.22, 0.2, mats.metal, 0, 0.5, half + 0.05);
  const rearBumper = box(WIDTH, 0.22, 0.2, mats.metal, 0, 0.5, -half - 0.08);
  // Bull bar on the nose.
  const bullBar = new THREE.Group();
  for (const x of [-0.55, 0.55]) bullBar.add(box(0.08, 0.5, 0.08, mats.metal, x, 0.72, half + 0.2));
  bullBar.add(box(1.3, 0.08, 0.08, mats.metal, 0, 0.95, half + 0.2));
  body.add(frontBumper, rearBumper, bullBar);
  loose.push(wing, bullBar, rearBumper, frontBumper);

  for (const x of [-0.5, 0.5]) {
    const pipe = cylinder(0.07, 0.24, mats.chrome, 10);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, 0.45, -half - 0.16);
    body.add(pipe);
  }

  const headlights = addLights(body, mats, { x: 0.62, y: 0.68, z: half + 0.07, tilt: -0.5 }, { x: 0.62, y: 0.86, z: -half - 0.12 });
  const muzzle = addTurretGun(body, mats, 0, 1.58, -0.35, loose);
  return {
    muzzle,
    engine: new THREE.Vector3(0, 1.1, 1.4),
    exhausts: [new THREE.Vector3(-0.5, 0.45, -half - 0.3), new THREE.Vector3(0.5, 0.45, -half - 0.3)],
    panels,
    loose,
    headlights,
    wheelRadius: 0.5,
    wheelWidth: 0.42,
    wheelX: WIDTH / 2 - 0.12,
    axleZ: 1.38,
  };
}

function buildPickup(body: THREE.Group, mats: Materials, o: CarModelOptions): BodyBuild {
  const half = LENGTH / 2;
  const panels: THREE.Mesh[] = [];
  const loose: THREE.Object3D[] = [];
  // Chassis tub, a tall cab up front and an open bed behind.
  const lower = new THREE.Mesh(
    extrudeProfile([[-half, 0.55], [half - 0.1, 0.55], [half + 0.02, 0.75], [half - 0.05, 1.08], [-half, 1.08]], WIDTH - 0.1, 0.08),
    mats.paint,
  );
  lower.castShadow = lower.receiveShadow = true;
  body.add(lower);
  panels.push(lower);
  const hood = new THREE.Mesh(extrudeProfile([[0.45, 1.06], [half - 0.1, 1.06], [half - 0.15, 1.2], [0.45, 1.24]], WIDTH - 0.2, 0.06), mats.paint);
  hood.castShadow = true;
  body.add(hood);
  panels.push(hood);
  const cab = new THREE.Mesh(extrudeProfile([[-0.55, 1.06], [0.5, 1.06], [0.25, 1.82], [-0.5, 1.84]], WIDTH - 0.24, 0.07), mats.paint);
  cab.castShadow = true;
  body.add(cab);
  panels.push(cab);
  // Windows wrapped around the cab.
  const windshield = box(WIDTH - 0.4, 0.5, 0.05, mats.glass, 0, 1.5, 0.36, false);
  windshield.rotation.x = -0.32;
  body.add(windshield);
  for (const side of [-1, 1]) body.add(box(0.05, 0.36, 0.7, mats.glass, side * (WIDTH / 2 - 0.12), 1.55, -0.05, false));

  // Bed walls and floor.
  const bedFloor = box(WIDTH - 0.3, 0.06, 1.6, mats.metal, 0, 1.1, -1.35);
  body.add(bedFloor);
  for (const side of [-1, 1]) {
    const wall = box(0.12, 0.32, 1.65, mats.paint, side * (WIDTH / 2 - 0.12), 1.24, -1.35);
    body.add(wall);
    panels.push(wall);
  }
  const tailgate = box(WIDTH - 0.2, 0.32, 0.1, mats.paint, 0, 1.24, -half + 0.05);
  body.add(tailgate);
  // Cargo: spare tire and a crate.
  const spare = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.14, 8, 16), mats.tire);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(-0.4, 1.28, -1.65);
  spare.castShadow = true;
  const crate = box(0.6, 0.4, 0.5, new THREE.MeshStandardMaterial({ color: 0x6a5a2a, roughness: 0.9 }), 0.45, 1.33, -1.65);
  body.add(spare, crate);

  // Roll bar with spotlights behind the cab.
  const rollBar = new THREE.Group();
  for (const side of [-1, 1]) rollBar.add(box(0.09, 0.7, 0.09, mats.metal, side * 0.75, 1.5, -0.62));
  rollBar.add(box(1.6, 0.09, 0.09, mats.metal, 0, 1.85, -0.62));
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe8b0, emissiveIntensity: 2.5 });
  for (const x of [-0.45, -0.15, 0.15, 0.45]) rollBar.add(box(0.18, 0.14, 0.1, spotMat, x, 1.95, -0.6, false));
  body.add(rollBar);

  const frontBumper = box(WIDTH + 0.05, 0.28, 0.24, mats.metal, 0, 0.62, half + 0.08);
  const rearBumper = box(WIDTH, 0.24, 0.2, mats.metal, 0, 0.62, -half - 0.08);
  const stripe = box(0.5, 0.02, 1.1, mats.stripe, 0, 1.27, 1.38, false);
  body.add(frontBumper, rearBumper, stripe);
  body.add(decal(createDecalTexture('number', o.number ?? 1, '#fff'), 0.6, 0, 1.87, -0.12));
  loose.push(crate, spare, rollBar, tailgate, frontBumper, rearBumper);

  const headlights = addLights(body, mats, { x: 0.66, y: 0.92, z: half + 0.04, tilt: 0 }, { x: 0.7, y: 1.12, z: -half - 0.02 });
  // The gun sits on a pedestal in the bed and fires over the cab.
  const muzzle = addTurretGun(body, mats, 0, 1.92, -0.15, loose);
  return {
    muzzle,
    engine: new THREE.Vector3(0, 1.3, 1.5),
    exhausts: [new THREE.Vector3(0.7, 0.55, -half - 0.2)],
    panels,
    loose,
    headlights,
    wheelRadius: 0.56,
    wheelWidth: 0.46,
    wheelX: WIDTH / 2 - 0.1,
    axleZ: 1.42,
  };
}

function buildBuggy(body: THREE.Group, mats: Materials, o: CarModelOptions): BodyBuild {
  const half = LENGTH / 2;
  const panels: THREE.Mesh[] = [];
  const loose: THREE.Object3D[] = [];
  // Narrow tub with a pointed nose; the wheels stick out on long arms.
  const tub = new THREE.Mesh(
    extrudeProfile([[-half + 0.3, 0.5], [half - 0.3, 0.5], [half, 0.72], [half - 0.2, 0.92], [-0.2, 1.0], [-half + 0.35, 1.0]], WIDTH - 0.55, 0.1),
    mats.paint,
  );
  tub.castShadow = tub.receiveShadow = true;
  body.add(tub);
  panels.push(tub);
  // Side pods.
  for (const side of [-1, 1]) {
    const pod = box(0.32, 0.36, 1.6, mats.paint, side * (WIDTH / 2 - 0.35), 0.75, 0.1);
    body.add(pod);
    panels.push(pod);
  }
  // Cockpit: seat, driver helmet, steering wheel.
  body.add(box(0.7, 0.12, 0.7, mats.trim, 0, 1.02, -0.2));
  const seatBack = box(0.7, 0.6, 0.12, mats.trim, 0, 1.3, -0.55);
  body.add(seatBack);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), mats.stripe);
  helmet.position.set(0, 1.55, -0.3);
  helmet.castShadow = true;
  body.add(helmet);
  const visor = box(0.3, 0.1, 0.1, mats.glass, 0, 1.56, -0.08, false);
  body.add(visor);

  // Roll cage.
  const cage = new THREE.Group();
  const tube = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    const a = new THREE.Vector3(x1, y1, z1);
    const b = new THREE.Vector3(x2, y2, z2);
    const len = a.distanceTo(b);
    const t = cylinder(0.05, len, mats.metal, 6);
    t.position.copy(a).add(b).multiplyScalar(0.5);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    cage.add(t);
  };
  for (const s of [-1, 1]) {
    tube(s * 0.55, 1.0, 0.5, s * 0.45, 1.85, -0.1);
    tube(s * 0.45, 1.85, -0.1, s * 0.5, 1.85, -0.8);
    tube(s * 0.5, 1.85, -0.8, s * 0.55, 1.0, -1.1);
  }
  tube(-0.45, 1.85, -0.1, 0.45, 1.85, -0.1);
  tube(-0.5, 1.85, -0.8, 0.5, 1.85, -0.8);
  body.add(cage);

  // Exposed engine at the back.
  const engine = new THREE.Group();
  engine.add(box(0.8, 0.45, 0.8, mats.metal, 0, 1.15, -1.45));
  for (let i = 0; i < 4; i++) engine.add(box(0.85, 0.04, 0.1, mats.chrome, 0, 1.4, -1.75 + i * 0.2, false));
  const intake = cylinder(0.14, 0.4, mats.chrome, 10);
  intake.position.set(0, 1.55, -1.35);
  engine.add(intake);
  body.add(engine);

  const nose = box(1.1, 0.16, 0.25, mats.metal, 0, 0.6, half - 0.05);
  const rearGuard = box(1.2, 0.18, 0.18, mats.metal, 0, 0.7, -half + 0.12);
  const wing = new THREE.Group();
  wing.add(box(1.7, 0.05, 0.45, mats.trim, 0, 1.75, -half + 0.3));
  for (const x of [-0.45, 0.45]) wing.add(box(0.05, 0.5, 0.1, mats.trim, x, 1.5, -half + 0.35));
  body.add(nose, rearGuard, wing);
  body.add(decal(createDecalTexture('bolt', 0, '#ffffff'), 0.8, 0, 0.99, 1.15, 0.12));
  body.add(decal(createDecalTexture('number', o.number ?? 1, '#fff'), 0.5, 0, 1.0, 0.45));
  loose.push(wing, intake, nose, rearGuard);

  const headlights = addLights(body, mats, { x: 0.35, y: 0.82, z: half - 0.12, tilt: -0.4 }, { x: 0.45, y: 0.9, z: -half + 0.05 });
  const muzzle = addTurretGun(body, mats, 0, 1.88, -0.45, loose);
  return {
    muzzle,
    engine: new THREE.Vector3(0, 1.3, -1.45),
    exhausts: [new THREE.Vector3(-0.3, 1.0, -half - 0.1), new THREE.Vector3(0.3, 1.0, -half - 0.1)],
    panels,
    loose,
    headlights,
    wheelRadius: 0.56,
    wheelWidth: 0.44,
    wheelX: WIDTH / 2 + 0.02,
    axleZ: 1.45,
  };
}

const BUILDERS: Record<CarBodyType, (body: THREE.Group, mats: Materials, o: CarModelOptions) => BodyBuild> = {
  muscle: buildMuscle,
  pickup: buildPickup,
  buggy: buildBuggy,
};

/** Builds a car of the requested style. */
export function createCarModel(options: CarModelOptions): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats = createMaterials(options);
  const build = BUILDERS[options.bodyType ?? 'muscle'](body, mats, options);
  // Paint uses vertex colors for damage grime, so every painted mesh must be a damage panel
  // (meshes without a color attribute would render black).
  mats.paint.vertexColors = true;
  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material === mats.paint && !build.panels.includes(o)) build.panels.push(o);
  });

  const wheels: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];
  for (const z of [build.axleZ, -build.axleZ]) {
    for (const x of [-build.wheelX, build.wheelX]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, build.wheelRadius, z);
      const wheel = createWheel(build.wheelRadius, build.wheelWidth, mats);
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
    wheelRadius: build.wheelRadius,
    brakeLightMaterial: mats.brake,
    paintMaterial: mats.paint,
    engineOffset: build.engine,
    muzzleOffset: build.muzzle,
    rearWheelOffsets: [new THREE.Vector3(-build.wheelX, 0, -build.axleZ), new THREE.Vector3(build.wheelX, 0, -build.axleZ)],
    exhaustOffsets: build.exhausts,
    damage: { panels: build.panels, loose: build.loose, headlights: build.headlights },
  };
}
