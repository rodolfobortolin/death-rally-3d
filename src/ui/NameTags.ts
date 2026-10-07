import * as THREE from 'three';
import type { Race } from '../race/Race';
import type { Racer } from '../race/Racer';

const MAX_DISTANCE = 45;

/** Floating name tags over the cars, projected from 3D into screen space. */
export class NameTags {
  private readonly root = document.getElementById('hud-tags')!;
  private readonly tags = new Map<Racer, HTMLElement>();
  private readonly v = new THREE.Vector3();

  build(race: Race): void {
    this.root.innerHTML = '';
    this.tags.clear();
    for (const r of race.racers) {
      const tag = document.createElement('div');
      tag.className = `tag${r.isPlayer ? ' player' : ''}`;
      tag.textContent = r.isPlayer ? 'PLAYER' : r.name.toUpperCase();
      tag.style.setProperty('--car-color', `#${r.profile.color.toString(16).padStart(6, '0')}`);
      this.root.appendChild(tag);
      this.tags.set(r, tag);
    }
  }

  update(race: Race, camera: THREE.Camera, width: number, height: number): void {
    const focus = race.focus.car.physics;
    // The player's own tag only shows on the grid, rivals' tags while they are nearby.
    const onGrid = race.phase === 'countdown' || race.raceTime < 2;
    for (const [r, tag] of this.tags) {
      const p = r.car.physics;
      const near = Math.hypot(p.x - focus.x, p.z - focus.z) < MAX_DISTANCE;
      const show = !r.destroyed && (r.isPlayer ? onGrid : near);
      if (!show) {
        tag.style.opacity = '0';
        continue;
      }
      this.v.set(p.x, 2.6, p.z).project(camera);
      if (this.v.z > 1) {
        tag.style.opacity = '0';
        continue;
      }
      tag.style.opacity = '1';
      tag.style.left = `${((this.v.x + 1) / 2) * width}px`;
      tag.style.top = `${((1 - this.v.y) / 2) * height}px`;
    }
  }
}
