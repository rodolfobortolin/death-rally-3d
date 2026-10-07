import * as THREE from 'three';
import { createConcreteTexture, createCorrugatedTexture, createFacadeTextures } from '../textures';
import { tireStacks, type Scenery } from './Scenery';

/** The original look: an industrial outskirts with warehouses, containers and trees. */
export function buildYard(ctx: Scenery): void {
  // Rust Yard keeps the exact scatter area it was designed with.
  if (ctx.track.def.id === 'rust-yard') ctx.area = { cx: 10, cz: 25, size: 900 * 0.75 };
  buildWarehouses(ctx);
  buildContainers(ctx);
  tireStacks(ctx);
  buildBarrels(ctx);
  buildLampPosts(ctx);
  buildTrees(ctx);
  buildRocks(ctx);
}

function buildWarehouses(ctx: Scenery): void {
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
    const w = 18 + ctx.rnd() * 26;
    const d = 14 + ctx.rnd() * 22;
    const h = 8 + ctx.rnd() * 16;
    const spot = ctx.findSpot(Math.hypot(w, d) / 2, 16, 240);
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
    const units = 2 + Math.floor(ctx.rnd() * 4);
    for (let u = 0; u < units; u++) {
      const s = 1.5 + ctx.rnd() * 2.5;
      const unit = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s), trimMat);
      unit.position.set((ctx.rnd() - 0.5) * (w - s - 2), h + 0.6 + s * 0.3, (ctx.rnd() - 0.5) * (d - s - 2));
      unit.castShadow = true;
      b.add(unit);
    }
    b.position.set(spot.x, 0, spot.z);
    b.rotation.y = Math.floor(ctx.rnd() * 4) * (Math.PI / 2) + (ctx.rnd() - 0.5) * 0.3;
    ctx.group.add(b);
  }
}

function buildContainers(ctx: Scenery): void {
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
    const spot = ctx.findSpot(11, 13, 180);
    if (!spot) continue;
    const rot = ctx.rnd() * Math.PI;
    const rows = 1 + Math.floor(ctx.rnd() * 2);
    const cols = 2 + Math.floor(ctx.rnd() * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const stack = 1 + Math.floor(ctx.rnd() * 3);
        for (let s = 0; s < stack; s++) {
          const lx = (c - cols / 2) * 2.7;
          const lz = (r - rows / 2) * 6.4;
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          const jitter = (ctx.rnd() - 0.5) * 0.15;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + jitter);
          m.compose(new THREE.Vector3(spot.x + lx * cos + lz * sin, 1.3 + s * 2.6, spot.z - lx * sin + lz * cos), q, new THREE.Vector3(1, 1, 1));
          instances.push(m.clone());
          tints.push(new THREE.Color(colors[Math.floor(ctx.rnd() * colors.length)]));
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
  ctx.group.add(mesh);
}

function buildBarrels(ctx: Scenery): void {
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.25, 14);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.6 });
  const colors = [0xb02a1a, 0x2a4ab0, 0xd09a20, 0x3a3a3a];
  const list: Array<[THREE.Matrix4, THREE.Color]> = [];
  for (let group = 0; group < 90; group++) {
    const spot = ctx.findSpot(3, 12.5, 140);
    if (!spot) continue;
    const count = 3 + Math.floor(ctx.rnd() * 6);
    const color = new THREE.Color(colors[Math.floor(ctx.rnd() * colors.length)]);
    for (let k = 0; k < count; k++) {
      const a = ctx.rnd() * Math.PI * 2;
      const r = ctx.rnd() * 2.2;
      const tipped = ctx.rnd() < 0.15;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(spot.x + Math.cos(a) * r, tipped ? 0.42 : 0.625, spot.z + Math.sin(a) * r),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(tipped ? Math.PI / 2 : 0, ctx.rnd() * 6, 0)),
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
  ctx.group.add(mesh);
}

function buildLampPosts(ctx: Scenery): void {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, metalness: 0.7, roughness: 0.4 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 4 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 9, 8);
  const armGeo = new THREE.BoxGeometry(0.15, 0.15, 2.4);
  const headGeo = new THREE.BoxGeometry(0.5, 0.2, 0.9);
  const spacing = 45;
  for (let along = 10; along < ctx.track.length; along += spacing) {
    const side: 1 | -1 = Math.floor(along / spacing) % 2 === 0 ? 1 : -1;
    const p = ctx.trackside(along, side, 1.4);
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
    const s = ctx.track.query(p.x, p.z).sample;
    lamp.rotation.y = Math.atan2(-s.rx * side, -s.rz * side);
    ctx.group.add(lamp);
    ctx.reserve(p.x, p.z, 1);
  }
}

function buildTrees(ctx: Scenery): void {
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
    const center = ctx.findSpot(6, 14, 300);
    if (!center) continue;
    const count = 3 + Math.floor(ctx.rnd() * 8);
    for (let k = 0; k < count; k++) {
      const x = center.x + (ctx.rnd() - 0.5) * 12;
      const z = center.z + (ctx.rnd() - 0.5) * 12;
      if (ctx.track.distanceToCenterline(x, z) < ctx.track.def.wallOffset + 4) continue;
      const s = 0.7 + ctx.rnd() * 0.8;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ctx.rnd() * 6);
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)));
      crowns.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + ctx.rnd() * 0.4), s)));
      tints.push(new THREE.Color().setHSL(0.17 + ctx.rnd() * 0.08, 0.35 + ctx.rnd() * 0.2, 0.22 + ctx.rnd() * 0.12));
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
  ctx.group.add(trunkMesh, crownMesh);
}

function buildRocks(ctx: Scenery): void {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ map: createConcreteTexture(), color: 0x9a8a72, roughness: 0.95, flatShading: true });
  const matrices: THREE.Matrix4[] = [];
  for (let i = 0; i < 350; i++) {
    const spot = ctx.findSpot(1.5, 12, 260, 20);
    if (!spot) continue;
    const s = 0.4 + ctx.rnd() * 1.4;
    matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(spot.x, s * 0.3, spot.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(ctx.rnd() * 3, ctx.rnd() * 3, ctx.rnd() * 3)),
        new THREE.Vector3(s, s * 0.7, s),
      ),
    );
  }
  const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true;
  ctx.group.add(mesh);
}
