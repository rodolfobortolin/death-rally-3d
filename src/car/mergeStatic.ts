import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bakes the meshes under `group` that never move relative to it into one mesh per
 * material, cutting draw calls (main pass and shadow pass alike). Objects in `keep`,
 * and everything below them, stay untouched so they can still be animated.
 */
export function mergeStatic(group: THREE.Object3D, keep: Iterable<THREE.Object3D> = []): void {
  const skip = new Set(keep);
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();

  const buckets = new Map<string, THREE.Mesh[]>();
  const collect = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !Array.isArray(o.material)) {
      const attrs = Object.keys(o.geometry.attributes).sort().join(',');
      const key = `${o.material.uuid}|${attrs}`;
      const list = buckets.get(key);
      if (list) list.push(o);
      else buckets.set(key, [o]);
    }
    for (const child of o.children) collect(child);
  };
  for (const child of group.children) collect(child);

  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const anyNonIndexed = meshes.some((m) => m.geometry.index === null);
    const geometries = meshes.map((m) => {
      let g = m.geometry.clone();
      if (anyNonIndexed && g.index !== null) g = g.toNonIndexed();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = meshes.some((m) => m.castShadow);
    mesh.receiveShadow = meshes.some((m) => m.receiveShadow);
    mesh.renderOrder = first.renderOrder;
    group.add(mesh);
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
  }
}

/**
 * Same as `mergeStatic`, but first buckets the static meshes into square cells of
 * `cellSize` meters so the merged chunks can still be frustum culled.
 */
export function mergeByCell(group: THREE.Object3D, cellSize: number): void {
  group.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh)) meshes.push(o);
  });
  const cells = new Map<string, THREE.Group>();
  const p = new THREE.Vector3();
  for (const m of meshes) {
    m.getWorldPosition(p);
    const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.z / cellSize)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = new THREE.Group();
      group.add(cell);
      group.updateMatrixWorld(true);
      cells.set(key, cell);
    }
    cell.attach(m);
  }
  for (const cell of cells.values()) mergeStatic(cell);
  // Drop the now-empty groups the meshes came from.
  const empty: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (o !== group && o.type === 'Group' && o.children.length === 0) empty.push(o);
  });
  empty.forEach((o) => o.removeFromParent());
}
