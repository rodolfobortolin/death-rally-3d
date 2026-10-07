import * as THREE from 'three';
import type { Race } from '../race/Race';
import type { Racer } from '../race/Racer';

/** Rivals' names show within this distance of the player. */
const NAME_DISTANCE = 45;
/** Rivals' damage bubbles show within this distance, or after the player hits them. */
const BUBBLE_DISTANCE = 26;

interface Tag {
  root: HTMLElement;
  name: HTMLElement;
  bubble: HTMLElement;
  fill: HTMLElement;
  /** Armor fraction currently drawn; eases towards the real value. */
  shown: number;
  state: string;
}

/**
 * Floating labels over the cars, projected from 3D into screen space: the driver's
 * name plus a damage bubble that fades in when a rival is close or under fire.
 */
export class NameTags {
  private readonly root = document.getElementById('hud-tags')!;
  private readonly tags = new Map<Racer, Tag>();
  private readonly v = new THREE.Vector3();
  private lastTime = performance.now();

  build(race: Race): void {
    this.root.innerHTML = '';
    this.tags.clear();
    for (const r of race.racers) {
      const root = document.createElement('div');
      root.className = `tag${r.isPlayer ? ' player' : ''}`;
      root.style.setProperty('--car-color', `#${r.profile.color.toString(16).padStart(6, '0')}`);
      const bubble = document.createElement('div');
      bubble.className = 'tag-hp';
      const track = document.createElement('div');
      track.className = 'tag-hp-track';
      const fill = document.createElement('div');
      fill.className = 'tag-hp-fill';
      track.appendChild(fill);
      bubble.appendChild(track);
      const name = document.createElement('div');
      name.className = 'tag-name';
      name.textContent = r.isPlayer ? 'PLAYER' : r.name.toUpperCase();
      root.append(bubble, name);
      this.root.appendChild(root);
      this.tags.set(r, { root, name, bubble, fill, shown: 1, state: '' });
    }
  }

  update(race: Race, camera: THREE.Camera, width: number, height: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const focus = race.focus.car.physics;
    // The player's own tag only shows on the grid, rivals' tags while they are nearby.
    const onGrid = race.phase === 'countdown' || race.raceTime < 2;
    for (const [r, tag] of this.tags) {
      const p = r.car.physics;
      const dist = Math.hypot(p.x - focus.x, p.z - focus.z);
      const underFire = r.hitByPlayer > 0;
      const show = !r.destroyed && (r.isPlayer ? onGrid : dist < NAME_DISTANCE || underFire);
      if (!show) {
        tag.root.style.opacity = '0';
        continue;
      }
      this.v.set(p.x, 2.6, p.z).project(camera);
      if (this.v.z > 1) {
        tag.root.style.opacity = '0';
        continue;
      }
      tag.root.style.opacity = '1';
      tag.root.style.left = `${((this.v.x + 1) / 2) * width}px`;
      tag.root.style.top = `${((1 - this.v.y) / 2) * height}px`;
      if (r.isPlayer) continue;

      // Damage bubble: eases down so hits read as a smooth drain.
      const armor = Math.max(0, r.health / r.maxHealth);
      tag.shown += (armor - tag.shown) * Math.min(1, dt * 6);
      tag.fill.style.width = `${(tag.shown * 100).toFixed(1)}%`;
      const visible = dist < BUBBLE_DISTANCE || underFire;
      const tone = armor > 0.6 ? '' : armor > 0.3 ? 'warn' : 'crit';
      const justHit = r.hitByPlayer > 2.75;
      const state = `${visible}|${tone}|${justHit}`;
      if (state !== tag.state) {
        tag.state = state;
        tag.bubble.className = ['tag-hp', visible ? 'show' : '', tone, justHit ? 'hit' : ''].filter(Boolean).join(' ');
      }
    }
  }
}
