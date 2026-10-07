import * as THREE from 'three';
import { createCardboardTexture, createConcreteTexture, createCorrugatedTexture, createCrateTexture, createHazardTexture, createPaintedMetalTexture } from '../textures';
import {
  barrelCluster,
  compose,
  industrialMaterials,
  instanced,
  latticeBeam,
  pipeRun,
  strut,
  type IndustrialMaterials,
  type Scenery,
} from './Scenery';

const WALL_HEIGHT = 15;
const TRUSS_HEIGHT = 13;
const BAY = 24;

interface Hall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Inside a huge factory hall: no roof, but trusses, pipes and lamps overhead. */
export function buildFactory(ctx: Scenery): void {
  const mats = industrialMaterials(createPaintedMetalTexture(), createConcreteTexture());
  const margin = ctx.track.def.wallOffset + 14;
  const hall: Hall = {
    minX: ctx.bounds.minX - margin,
    maxX: ctx.bounds.maxX + margin,
    minZ: ctx.bounds.minZ - margin,
    maxZ: ctx.bounds.maxZ + margin,
  };
  // Scatter props only inside the hall.
  ctx.area = { cx: (hall.minX + hall.maxX) / 2, cz: (hall.minZ + hall.maxZ) / 2, size: Math.max(hall.maxX - hall.minX, hall.maxZ - hall.minZ) - 6 };

  buildWalls(ctx, hall, mats);
  buildColumnsAndTrusses(ctx, hall, mats);
  buildOverheadPipes(ctx, hall, mats);
  buildLamps(ctx, hall, mats);
  buildFurnaces(ctx, mats);
  buildRacks(ctx);
  buildContainers(ctx);
  buildForklifts(ctx, mats);
  buildBarrels(ctx);
  buildCrates(ctx);
  buildFloorMarkings(ctx);
}

function buildWalls(ctx: Scenery, hall: Hall, mats: IndustrialMaterials): void {
  const tex = createCorrugatedTexture();
  const cladding = new THREE.MeshStandardMaterial({ map: tex, color: 0x6e7680, roughness: 0.6, metalness: 0.5 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x0c1218, emissive: 0x6a88a8, emissiveIntensity: 0.9, roughness: 0.2 });
  const w = hall.maxX - hall.minX;
  const d = hall.maxZ - hall.minZ;
  const cx = (hall.minX + hall.maxX) / 2;
  const cz = (hall.minZ + hall.maxZ) / 2;
  const sides: Array<[number, number, number, number]> = [
    [cx, hall.minZ, w, 0],
    [cx, hall.maxZ, w, 0],
    [hall.minX, cz, d, Math.PI / 2],
    [hall.maxX, cz, d, Math.PI / 2],
  ];
  for (const [x, z, len, rot] of sides) {
    const geo = new THREE.BoxGeometry(len, WALL_HEIGHT, 1);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len / 4, uv.getY(k) * 3);
    const wall = new THREE.Mesh(geo, cladding);
    wall.position.set(x, WALL_HEIGHT / 2, z);
    wall.rotation.y = rot;
    wall.castShadow = wall.receiveShadow = true;
    ctx.group.add(wall);
    // Concrete plinth and a band of high windows.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(len, 2, 1.4), mats.concrete);
    plinth.position.set(x, 1, z);
    plinth.rotation.y = rot;
    ctx.group.add(plinth);
    const band = new THREE.Mesh(new THREE.BoxGeometry(len - 8, 2.2, 1.1), windowMat);
    band.position.set(x, WALL_HEIGHT - 3, z);
    band.rotation.y = rot;
    ctx.group.add(band);
  }
  // Roll-up doors.
  const doorMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xb88a2a, roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const onX = i % 2 === 0;
    const t = ctx.range(0.15, 0.85);
    const x = onX ? hall.minX + t * w : i % 4 < 2 ? hall.minX : hall.maxX;
    const z = onX ? (i % 4 === 0 ? hall.minZ : hall.maxZ) : hall.minZ + t * d;
    const door = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 1.3), doorMat);
    door.position.set(x, 3, z);
    door.rotation.y = onX ? 0 : Math.PI / 2;
    ctx.group.add(door);
  }
}

/** Steel columns on a grid wherever the road leaves room, and roof trusses across the hall. */
function buildColumnsAndTrusses(ctx: Scenery, hall: Hall, mats: IndustrialMaterials): void {
  const wo = ctx.track.def.wallOffset;
  const colGeo = new THREE.BoxGeometry(0.8, TRUSS_HEIGHT, 0.8);
  colGeo.translate(0, TRUSS_HEIGHT / 2, 0);
  const baseGeo = new THREE.BoxGeometry(1.4, 1.2, 1.4);
  baseGeo.translate(0, 0.6, 0);
  const cols: THREE.Matrix4[] = [];
  const bases: THREE.Matrix4[] = [];
  for (let x = hall.minX + BAY; x < hall.maxX - 4; x += BAY) {
    for (let z = hall.minZ + BAY / 2; z < hall.maxZ - 4; z += BAY) {
      if (ctx.track.distanceToCenterline(x, z) < wo + 1.6 || !ctx.isFree(x, z, 1)) continue;
      cols.push(compose(x, 0, z));
      bases.push(compose(x, 0, z));
      ctx.reserve(x, z, 1.2);
    }
  }
  ctx.group.add(instanced(colGeo, mats.steel, cols));
  const hazard = new THREE.MeshStandardMaterial({ map: createHazardTexture(), roughness: 0.7 });
  ctx.group.add(instanced(baseGeo, hazard, bases));

  // Trusses span the short way across the hall; the camera looks down through them.
  const along = hall.maxX - hall.minX > hall.maxZ - hall.minZ ? 'x' : 'z';
  if (along === 'x') {
    for (let x = hall.minX + BAY; x < hall.maxX - 4; x += BAY) {
      ctx.group.add(latticeBeam(new THREE.Vector3(x, TRUSS_HEIGHT, hall.minZ), new THREE.Vector3(x, TRUSS_HEIGHT, hall.maxZ), 0.6, 1.8, mats.steel, 0.12));
    }
  } else {
    for (let z = hall.minZ + BAY; z < hall.maxZ - 4; z += BAY) {
      ctx.group.add(latticeBeam(new THREE.Vector3(hall.minX, TRUSS_HEIGHT, z), new THREE.Vector3(hall.maxX, TRUSS_HEIGHT, z), 0.6, 1.8, mats.steel, 0.12));
    }
  }
}

/** Pipe and duct runs hung under the trusses, with drops to machines on the floor. */
function buildOverheadPipes(ctx: Scenery, hall: Hall, mats: IndustrialMaterials): void {
  const duct = new THREE.MeshStandardMaterial({ map: createPaintedMetalTexture(), color: 0x9aa4ae, roughness: 0.35, metalness: 0.8 });
  const w = hall.maxX - hall.minX;
  const d = hall.maxZ - hall.minZ;
  const runs = 3;
  for (let i = 0; i < runs; i++) {
    const horizontal = i % 2 === 0;
    const t = (i + 0.7) / (runs + 0.4);
    const y = TRUSS_HEIGHT - 1.4 - (i % 2) * 0.7;
    const a = horizontal ? new THREE.Vector3(hall.minX + 1, y, hall.minZ + t * d) : new THREE.Vector3(hall.minX + t * w, y, hall.minZ + 1);
    const b = horizontal ? new THREE.Vector3(hall.maxX - 1, y, a.z) : new THREE.Vector3(a.x, y, hall.maxZ - 1);
    const off = horizontal ? new THREE.Vector3(0, 0, 1.3) : new THREE.Vector3(1.3, 0, 0);
    ctx.group.add(pipeRun([a, b], { radius: 0.45, material: mats.pipeOrange, flangeMaterial: mats.flange, flangeSpacing: 8 }));
    ctx.group.add(pipeRun([a.clone().add(off), b.clone().add(off)], { radius: 0.3, material: mats.pipeGrey, flangeMaterial: mats.flange, flangeSpacing: 8 }));
    // Square ventilation duct alongside.
    const ductMesh = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? w - 2 : 1.6, 1.1, horizontal ? 1.6 : d - 2), duct);
    ductMesh.position.copy(a).add(b).multiplyScalar(0.5).sub(off.clone().multiplyScalar(1.8)).setY(y + 0.4);
    ductMesh.castShadow = true;
    ctx.group.add(ductMesh);
  }
}

/** Hanging high-bay lamps with fake pools of light on the floor. */
function buildLamps(ctx: Scenery, hall: Hall, mats: IndustrialMaterials): void {
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe6b8, emissiveIntensity: 5 });
  const shade = new THREE.CylinderGeometry(0.5, 1.1, 0.7, 12, 1, true);
  const bulb = new THREE.CylinderGeometry(0.85, 0.85, 0.1, 12);
  const spacing = BAY / 2;
  for (let x = hall.minX + spacing; x < hall.maxX - 4; x += spacing) {
    for (let z = hall.minZ + spacing; z < hall.maxZ - 4; z += spacing) {
      // Light the track and a little around it.
      if (ctx.track.distanceToCenterline(x, z) > 28) continue;
      const y = TRUSS_HEIGHT - 3.4;
      const s = new THREE.Mesh(shade, mats.steel);
      s.position.set(x, y + 0.3, z);
      ctx.group.add(s);
      const b = new THREE.Mesh(bulb, lampMat);
      b.position.set(x, y - 0.05, z);
      ctx.group.add(b);
      ctx.group.add(strut(new THREE.Vector3(x, y + 0.6, z), new THREE.Vector3(x, TRUSS_HEIGHT - 0.9, z), 0.05, mats.steel));
      ctx.lightPool(x, z, 11, 0xffd9a0, 0.22);
    }
  }
}

/** Glowing crucibles and a ladle: the foundry's heat source and a strong landmark from above. */
function buildFurnaces(ctx: Scenery, mats: IndustrialMaterials): void {
  const molten = new THREE.MeshStandardMaterial({ color: 0xff6a10, emissive: 0xff5a08, emissiveIntensity: 4, roughness: 0.4 });
  const shell = new THREE.MeshStandardMaterial({ map: createPaintedMetalTexture(), color: 0x4a4440, roughness: 0.6, metalness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const spot = ctx.findSpot(5, ctx.track.def.wallOffset + 4, 60, 30);
    if (!spot) continue;
    const g = new THREE.Group();
    const r = ctx.range(2.4, 3.4);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 4, 20), shell);
    body.position.y = 2;
    g.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.25, 8, 24), mats.flange);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 4;
    g.add(rim);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(r * 0.88, 24), molten);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 3.9;
    g.add(pool);
    // Platform and hand rails.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(r * 2 + 3, 0.3, 2), mats.yellowSteel);
    deck.position.set(0, 3, r + 1.3);
    g.add(deck);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material !== molten) o.castShadow = o.receiveShadow = true;
    });
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = ctx.rnd() * Math.PI * 2;
    ctx.group.add(g);
    ctx.lightPool(spot.x, spot.z, r * 4.5, 0xff7a20, 0.5);
  }
}

/** Pallet racks: blue uprights, orange beams, three levels of boxed pallets. */
function buildRacks(ctx: Scenery): void {
  const upright = new THREE.MeshStandardMaterial({ map: createPaintedMetalTexture(), color: 0x2a5a9a, roughness: 0.5, metalness: 0.4 });
  const beam = new THREE.MeshStandardMaterial({ map: createPaintedMetalTexture(), color: 0xe0661c, roughness: 0.5, metalness: 0.4 });
  const box = new THREE.MeshStandardMaterial({ map: createCardboardTexture(), roughness: 0.9 });
  const boxGeo = new THREE.BoxGeometry(1.15, 1, 1.0);
  const boxes: THREE.Matrix4[] = [];
  for (let i = 0; i < 16; i++) {
    const len = 6 * (2 + Math.floor(ctx.rnd() * 3));
    const spot = ctx.findSpot(len / 2 + 1, ctx.track.def.wallOffset + 3, 90, 25);
    if (!spot) continue;
    const yaw = Math.floor(ctx.rnd() * 2) * (Math.PI / 2);
    const g = new THREE.Group();
    const levels = [0.15, 2.1, 4.05];
    for (let x = -len / 2; x <= len / 2 + 0.01; x += 3) {
      for (const z of [-0.6, 0.6]) {
        const u = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.12), upright);
        u.position.set(x, 3, z);
        g.add(u);
      }
    }
    for (const y of levels.slice(1)) {
      for (const z of [-0.6, 0.6]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.12), beam);
        b.position.set(0, y - 0.1, z);
        g.add(b);
      }
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = yaw;
    ctx.group.add(g);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (let x = -len / 2 + 0.8; x < len / 2 - 0.5; x += 1.3) {
      for (const y of levels) {
        if (ctx.rnd() < 0.18) continue;
        const h = ctx.range(0.7, 1.4);
        boxes.push(compose(spot.x + x * cos, y + h / 2 + 0.05, spot.z - x * sin, yaw + ctx.range(-0.06, 0.06), 1, h, 1));
      }
    }
  }
  ctx.group.add(instanced(boxGeo, box, boxes));
}

function buildContainers(ctx: Scenery): void {
  const tex = createCorrugatedTexture();
  tex.repeat.set(3, 1);
  const geo = new THREE.BoxGeometry(2.5, 2.6, 6.1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 });
  const colors = [0xa23a24, 0x2a5d8a, 0x3f6e3a, 0xc08a2a, 0x6a6a6a];
  const matrices: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  for (let i = 0; i < 10; i++) {
    const spot = ctx.findSpot(7, ctx.track.def.wallOffset + 3, 80, 20);
    if (!spot) continue;
    const yaw = ctx.rnd() * Math.PI;
    for (let c = 0; c < 2 + Math.floor(ctx.rnd() * 2); c++) {
      const stack = 1 + Math.floor(ctx.rnd() * 2);
      for (let s = 0; s < stack; s++) {
        const lx = (c - 1) * 2.7;
        matrices.push(compose(spot.x + lx * Math.cos(yaw), 1.3 + s * 2.6, spot.z - lx * Math.sin(yaw), yaw + ctx.range(-0.05, 0.05)));
        tints.push(new THREE.Color(ctx.pick(colors)));
      }
    }
  }
  ctx.group.add(instanced(geo, mat, matrices, tints));
}

function buildForklifts(ctx: Scenery, mats: IndustrialMaterials): void {
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const wheel = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  wheel.rotateZ(Math.PI / 2);
  for (let i = 0; i < 7; i++) {
    const spot = ctx.findSpot(2.5, ctx.track.def.wallOffset + 1.5, 50, 20);
    if (!spot) continue;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 2.2), mats.yellowSteel);
    body.position.y = 0.8;
    g.add(body);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 1.2), mats.steel);
    guard.position.set(0, 2.2, -0.1);
    g.add(guard);
    for (const x of [-0.5, 0.5]) {
      g.add(strut(new THREE.Vector3(x, 0.8, 0.45), new THREE.Vector3(x, 2.2, 0.45), 0.08, mats.steel));
      g.add(strut(new THREE.Vector3(x, 0.8, -0.65), new THREE.Vector3(x, 2.2, -0.65), 0.08, mats.steel));
    }
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.6, 0.15), mats.steel);
    mast.position.set(0, 1.4, 1.2);
    g.add(mast);
    for (const x of [-0.3, 0.3]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1.2), mats.steel);
      fork.position.set(x, 0.15, 1.85);
      g.add(fork);
    }
    for (const [x, z] of [[-0.6, 0.7], [0.6, 0.7], [-0.6, -0.7], [0.6, -0.7]]) {
      const w = new THREE.Mesh(wheel, tire);
      w.position.set(x, 0.35, z);
      g.add(w);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = ctx.rnd() * Math.PI * 2;
    ctx.group.add(g);
  }
}

function buildBarrels(ctx: Scenery): void {
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 14);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.6 });
  const colors = [0x2a4ab0, 0xd09a20, 0x3a3a3a, 0xb02a1a];
  const list: Array<[THREE.Matrix4, THREE.Color]> = [];
  for (let g = 0; g < 40; g++) {
    const spot = ctx.findSpot(2.5, ctx.track.def.wallOffset + 1.2, 60, 20);
    if (!spot) continue;
    barrelCluster(list, ctx, spot.x, spot.z, 3 + Math.floor(ctx.rnd() * 6), new THREE.Color(ctx.pick(colors)));
  }
  ctx.group.add(instanced(geo, mat, list.map((l) => l[0]), list.map((l) => l[1])));
}

function buildCrates(ctx: Scenery): void {
  const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const mat = new THREE.MeshStandardMaterial({ map: createCrateTexture(), roughness: 0.85 });
  const matrices: THREE.Matrix4[] = [];
  for (let g = 0; g < 35; g++) {
    const spot = ctx.findSpot(2.2, ctx.track.def.wallOffset + 1.2, 40, 20);
    if (!spot) continue;
    for (let k = 0; k < 2 + Math.floor(ctx.rnd() * 4); k++) {
      const s = ctx.range(0.8, 1.2);
      matrices.push(compose(spot.x + ctx.range(-1.5, 1.5), k > 2 ? s * 1.5 : s * 0.6, spot.z + ctx.range(-1.5, 1.5), ctx.rnd() * 6, s));
    }
  }
  ctx.group.add(instanced(geo, mat, matrices));
}

/** Yellow walkway lines painted on the floor around the circuit. */
function buildFloorMarkings(ctx: Scenery): void {
  const paint = new THREE.MeshStandardMaterial({ color: 0xd8a820, roughness: 0.8, side: THREE.DoubleSide });
  const wo = ctx.track.def.wallOffset;
  const n = ctx.track.samples.length;
  for (const side of [-1, 1] as const) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = ctx.track.samples[i % n];
      for (const o of [wo + 2.4, wo + 2.7]) {
        const x = s.x + s.rx * side * o;
        const z = s.z + s.rz * side * o;
        positions.push(x, 0.015, z);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const p0 = ctx.track.samples[i];
      // Skip pieces that run into another part of the track.
      const x = p0.x + p0.rx * side * (wo + 2.5);
      const z = p0.z + p0.rz * side * (wo + 2.5);
      if (ctx.track.distanceToCenterline(x, z) < wo + 2.2) continue;
      if (side === 1) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, paint);
    mesh.receiveShadow = true;
    ctx.group.add(mesh);
  }
}
