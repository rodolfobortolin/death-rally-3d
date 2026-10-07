import * as THREE from 'three';
import { createConcreteTexture, createCrateTexture, createPaintedMetalTexture } from '../textures';
import {
  barrelCluster,
  compose,
  industrialMaterials,
  instanced,
  latticeBeam,
  pipeBridge,
  rockGeometry,
  strut,
  tireStacks,
  towerCrane,
  tracksidePipeline,
  type IndustrialMaterials,
  type Scenery,
} from './Scenery';

/** Open-pit quarry: rock walls, pipe bridges over the road, cranes and machinery. */
export function buildQuarry(ctx: Scenery): void {
  const mats = industrialMaterials(createPaintedMetalTexture(), createConcreteTexture());

  // Landmarks first so the random props flow around them.
  let bridges = 0;
  for (const along of ctx.straightSpots(12, ctx.track.length / 8)) {
    if (bridges < 4 && pipeBridge(ctx, along, mats, { height: 6 + (bridges % 2) * 0.8 })) bridges++;
  }
  buildPipelines(ctx, mats);
  buildCranes(ctx, mats);
  buildConveyor(ctx, mats);
  tireStacks(ctx, 0.03);
  buildCrates(ctx);
  buildBarrels(ctx);
  buildLooseBlocks(ctx, mats);
  buildFloodlights(ctx, mats);
  buildTrucks(ctx, mats);
  buildCabins(ctx, mats);
  buildGravelPiles(ctx);
  buildCliffs(ctx);
}

/** Pipelines along the longest straight-ish stretches, behind the barrier. */
function buildPipelines(ctx: Scenery, mats: IndustrialMaterials): void {
  const n = ctx.track.samples.length;
  const step = ctx.track.length / n;
  // Find runs of gentle curvature at least 70 m long.
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const gentle = i < n && Math.abs(ctx.track.samples[i].curvature) < 0.02;
    if (gentle && start < 0) start = i;
    if (!gentle && start >= 0) {
      if ((i - start) * step > 70) runs.push([start * step + 8, i * step - 8]);
      start = -1;
    }
  }
  runs.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  runs.slice(0, 2).forEach(([from, to], k) => {
    // Pipes go on the outside of the loop where there is more room.
    const mid = ctx.track.pointAt((from + to) / 2, 0);
    const out = ctx.trackside((from + to) / 2, 1, 6);
    const center = { x: (ctx.bounds.minX + ctx.bounds.maxX) / 2, z: (ctx.bounds.minZ + ctx.bounds.maxZ) / 2 };
    const rightIsOut = Math.hypot(out.x - center.x, out.z - center.z) > Math.hypot(mid.x - center.x, mid.z - center.z);
    const side: 1 | -1 = rightIsOut ? 1 : -1;
    if (!clearAlong(ctx, from, to, side, 7)) return;
    tracksidePipeline(ctx, from, Math.min(to, from + 140 + k * 20), side, mats);
  });
}

/** True when nothing else sits behind that barrier stretch. */
function clearAlong(ctx: Scenery, from: number, to: number, side: 1 | -1, extra: number): boolean {
  for (let a = from; a <= to; a += 5) {
    const p = ctx.trackside(a, side, extra);
    if (!ctx.isFree(p.x, p.z, 2)) return false;
    // The other side of the loop must not be close behind the pipes.
    if (ctx.track.distanceToCenterline(p.x, p.z) < ctx.track.def.wallOffset + extra - 0.5) return false;
  }
  return true;
}

function buildCranes(ctx: Scenery, mats: IndustrialMaterials): void {
  let placed = 0;
  for (let t = 0; t < 40 && placed < 2; t++) {
    const spot = ctx.findSpot(5, ctx.track.def.wallOffset + 5, 40, 30);
    if (!spot) continue;
    // Swing the jib out over the nearest road, like the reference shots.
    const q = ctx.track.query(spot.x, spot.z);
    const yaw = Math.atan2(q.sample.x - spot.x, q.sample.z - spot.z) + ctx.range(-0.5, 0.5);
    towerCrane(ctx, spot.x, spot.z, yaw, ctx.range(26, 36), ctx.range(15, 19), mats);
    placed++;
  }
}

/** An inclined conveyor feeding a gravel heap, on lattice legs. */
function buildConveyor(ctx: Scenery, mats: IndustrialMaterials): void {
  const spot = ctx.findSpot(16, 6, 70);
  if (!spot) return;
  const yaw = ctx.rnd() * Math.PI * 2;
  const g = new THREE.Group();
  const low = new THREE.Vector3(-14, 1.2, 0);
  const high = new THREE.Vector3(12, 9, 0);
  g.add(latticeBeam(low, high, 1.6, 1.0, mats.yellowSteel, 0.1));
  const belt = new THREE.Mesh(new THREE.BoxGeometry(low.distanceTo(high), 0.15, 1.2), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 }));
  belt.position.copy(low).add(high).multiplyScalar(0.5).setY((low.y + high.y) / 2 + 0.6);
  belt.rotation.z = Math.atan2(high.y - low.y, high.x - low.x);
  belt.castShadow = true;
  g.add(belt);
  for (const t of [0.3, 0.65, 0.95]) {
    const p = low.clone().lerp(high, t);
    g.add(strut(new THREE.Vector3(p.x, 0, -1), new THREE.Vector3(p.x, p.y - 0.4, -0.7), 0.25, mats.steel));
    g.add(strut(new THREE.Vector3(p.x, 0, 1), new THREE.Vector3(p.x, p.y - 0.4, 0.7), 0.25, mats.steel));
  }
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.1, 2.6, 8), mats.pipeOrange);
  hopper.position.set(-15, 2.4, 0);
  hopper.castShadow = true;
  g.add(hopper);
  const heap = new THREE.Mesh(gravelHeap(ctx.rnd), new THREE.MeshStandardMaterial({ color: 0x9a8e7c, roughness: 1, flatShading: true }));
  heap.scale.set(9, 6.5, 9);
  heap.position.set(17, 0, 0);
  heap.castShadow = heap.receiveShadow = true;
  g.add(heap);
  g.position.set(spot.x, 0, spot.z);
  g.rotation.y = yaw;
  ctx.group.add(g);
}

function gravelHeap(rnd: () => number): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(1, 1, 14, 3);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.98 || y < 0.02) continue;
    const k = 0.85 + rnd() * 0.3;
    pos.setXYZ(i, pos.getX(i) * k, y * (0.9 + rnd() * 0.2), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildGravelPiles(ctx: Scenery): void {
  const geo = gravelHeap(ctx.rnd);
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const tints = [0x9a8e7c, 0xb09a78, 0x7c7468, 0xa48a66];
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  for (let i = 0; i < 45; i++) {
    const r = ctx.range(3, 8);
    const spot = ctx.findSpot(r, 4, 120, 20);
    if (!spot) continue;
    matrices.push(compose(spot.x, 0, spot.z, ctx.rnd() * 6, r, r * ctx.range(0.45, 0.7), r * ctx.range(0.8, 1.2)));
    colors.push(new THREE.Color(ctx.pick(tints)));
  }
  ctx.group.add(instanced(geo, mat, matrices, colors));
}

/** Big rock masses: they fill the infield and wall in the pit. */
function buildCliffs(ctx: Scenery): void {
  const variants = [rockGeometry(ctx.rnd), rockGeometry(ctx.rnd), rockGeometry(ctx.rnd)];
  const mat = new THREE.MeshStandardMaterial({ map: createConcreteTexture(), roughness: 0.95, flatShading: true });
  const lists: Array<{ m: THREE.Matrix4[]; c: THREE.Color[] }> = variants.map(() => ({ m: [], c: [] }));
  const add = (x: number, z: number, r: number, h: number) => {
    const k = Math.floor(ctx.rnd() * variants.length);
    lists[k].m.push(compose(x, h * 0.15, z, ctx.rnd() * 6, r, h, r * ctx.range(0.7, 1.3)));
    lists[k].c.push(new THREE.Color().setHSL(0.08 + ctx.rnd() * 0.04, 0.16 + ctx.rnd() * 0.1, 0.36 + ctx.rnd() * 0.12));
  };
  // Boulders right behind the barriers.
  for (let i = 0; i < 260; i++) {
    const r = ctx.range(1.2, 3.5);
    const spot = ctx.findSpot(r, ctx.track.def.wallOffset + 1.2, ctx.track.def.wallOffset + 12, 12);
    if (spot) add(spot.x, spot.z, r, r * ctx.range(0.6, 1.1));
  }
  // Large masses further out.
  for (let i = 0; i < 160; i++) {
    const r = ctx.range(7, 18);
    const spot = ctx.findSpot(r * 0.8, ctx.track.def.wallOffset + 6, 220, 12);
    if (spot) add(spot.x, spot.z, r, r * ctx.range(0.45, 0.9));
  }
  variants.forEach((geo, k) => ctx.group.add(instanced(geo, mat, lists[k].m, lists[k].c)));
}

function buildCrates(ctx: Scenery): void {
  const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const mat = new THREE.MeshStandardMaterial({ map: createCrateTexture(), roughness: 0.85 });
  const matrices: THREE.Matrix4[] = [];
  for (let g = 0; g < 40; g++) {
    const spot = ctx.findSpot(2.5, ctx.track.def.wallOffset + 1.5, ctx.track.def.wallOffset + 18, 20);
    if (!spot) continue;
    const count = 2 + Math.floor(ctx.rnd() * 5);
    for (let k = 0; k < count; k++) {
      const s = ctx.range(0.8, 1.3);
      const stacked = k > 1 && ctx.rnd() < 0.4;
      matrices.push(compose(spot.x + ctx.range(-1.8, 1.8), stacked ? s * 1.5 : s * 0.6, spot.z + ctx.range(-1.8, 1.8), ctx.rnd() * 6, s));
    }
  }
  ctx.group.add(instanced(geo, mat, matrices));
}

function buildBarrels(ctx: Scenery): void {
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 14);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 });
  const colors = [0xb02a1a, 0xc8c4bc, 0xd09a20, 0x2a6a3a];
  const list: Array<[THREE.Matrix4, THREE.Color]> = [];
  for (let g = 0; g < 60; g++) {
    const spot = ctx.findSpot(2.5, ctx.track.def.wallOffset + 1.2, 90, 20);
    if (!spot) continue;
    barrelCluster(list, ctx, spot.x, spot.z, 3 + Math.floor(ctx.rnd() * 6), new THREE.Color(ctx.pick(colors)));
  }
  ctx.group.add(instanced(geo, mat, list.map((l) => l[0]), list.map((l) => l[1])));
}

/** Spare jersey blocks lying around, some knocked askew. */
function buildLooseBlocks(ctx: Scenery, mats: IndustrialMaterials): void {
  const geo = new THREE.BoxGeometry(0.7, 1.0, 3);
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < 30; i++) {
    const spot = ctx.findSpot(3, ctx.track.def.wallOffset + 2, 60, 15);
    if (!spot) continue;
    const yaw = ctx.rnd() * Math.PI;
    for (let k = 0; k < 2 + Math.floor(ctx.rnd() * 3); k++) {
      matrices.push(compose(spot.x + Math.sin(yaw) * k * 3.1, 0.5, spot.z + Math.cos(yaw) * k * 3.1, yaw + ctx.range(-0.15, 0.15)));
    }
  }
  ctx.group.add(instanced(geo, mats.concrete, matrices));
}

/** Floodlight masts with a lamp bank, alternating sides of the road. */
function buildFloodlights(ctx: Scenery, mats: IndustrialMaterials): void {
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 3 });
  const spacing = 70;
  for (let along = 30; along < ctx.track.length - 20; along += spacing) {
    const side: 1 | -1 = Math.floor(along / spacing) % 2 === 0 ? 1 : -1;
    const p = ctx.trackside(along, side, 2.2);
    if (!ctx.isFree(p.x, p.z, 1.5) || ctx.track.distanceToCenterline(p.x, p.z) < ctx.track.def.wallOffset + 1.5) continue;
    const g = new THREE.Group();
    g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 12, 0), 0.35, mats.steel));
    const bank = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.9, 0.4), mats.steel);
    bank.position.set(0, 12.2, 0.2);
    g.add(bank);
    for (let k = -1; k <= 1; k++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.12), lampMat);
      lamp.position.set(k * 0.9, 12.2, 0.45);
      g.add(lamp);
    }
    g.position.set(p.x, 0, p.z);
    const s = ctx.track.query(p.x, p.z).sample;
    g.rotation.y = Math.atan2(-s.rx * side, -s.rz * side);
    ctx.group.add(g);
    ctx.reserve(p.x, p.z, 1.5);
  }
}

/** Mining dump trucks parked off the road. */
function buildTrucks(ctx: Scenery, mats: IndustrialMaterials): void {
  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const wheelGeo = new THREE.CylinderGeometry(1.3, 1.3, 1.0, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const spot = ctx.findSpot(7, ctx.track.def.wallOffset + 4, 80, 30);
    if (!spot) continue;
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 9), mats.steel);
    chassis.position.y = 1.6;
    g.add(chassis);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 6), mats.yellowSteel);
    bed.position.set(0, 3.1, -1.4);
    bed.rotation.x = i % 2 === 0 ? -0.35 : 0;
    g.add(bed);
    const load = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.6, 5.4), new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 1 }));
    load.position.set(0, 4.2, -1.4);
    load.rotation.x = bed.rotation.x;
    if (i % 2 === 1) g.add(load);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 2.2), mats.yellowSteel);
    cab.position.set(-1.0, 3.0, 3.2);
    g.add(cab);
    for (const [x, z] of [[-2.3, 3], [2.3, 3], [-2.3, -2.6], [2.3, -2.6]]) {
      const w = new THREE.Mesh(wheelGeo, tire);
      w.position.set(x, 1.3, z);
      g.add(w);
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = ctx.rnd() * Math.PI * 2;
    ctx.group.add(g);
  }
}

/** Site offices: portable cabins with a window strip. */
function buildCabins(ctx: Scenery, mats: IndustrialMaterials): void {
  const wall = new THREE.MeshStandardMaterial({ map: createPaintedMetalTexture(), color: 0xe8e2d4, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a38, emissive: 0x6a5a30, emissiveIntensity: 0.6, roughness: 0.2 });
  for (let i = 0; i < 6; i++) {
    const spot = ctx.findSpot(5, ctx.track.def.wallOffset + 4, 70, 20);
    if (!spot) continue;
    const g = new THREE.Group();
    const stack = i % 3 === 0 ? 2 : 1;
    for (let s = 0; s < stack; s++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2.8, 7.5), wall);
      box.position.y = 1.4 + s * 2.85;
      g.add(box);
      const win = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.8, 5), glass);
      win.position.y = 1.8 + s * 2.85;
      g.add(win);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 7.7), mats.steel);
    roof.position.y = stack * 2.85 + 0.1;
    g.add(roof);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    g.position.set(spot.x, 0, spot.z);
    g.rotation.y = ctx.rnd() * Math.PI;
    ctx.group.add(g);
  }
}
