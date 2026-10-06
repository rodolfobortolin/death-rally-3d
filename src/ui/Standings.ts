import type { Race } from '../race/Race';
import { MAX_HEALTH, type Racer } from '../race/Racer';

interface Row {
  el: HTMLElement;
  rank: HTMLElement;
  status: HTMLElement;
  bar: HTMLElement;
  lastRank: number;
  lastHealth: number;
  lastWrecked: boolean;
}

const healthColor = (ratio: number): string => {
  if (ratio > 0.6) return '#4cd160';
  if (ratio > 0.3) return '#f2c230';
  return '#e0402a';
};

/** Left-side list of every car: portrait, live position and armor. */
export class Standings {
  private readonly root = document.getElementById('hud-standings')!;
  private rows = new Map<Racer, Row>();

  build(race: Race, portraits: Map<Racer, string>): void {
    this.root.innerHTML = '';
    this.rows.clear();
    for (const r of race.racers) {
      const el = document.createElement('div');
      el.className = `standing${r.isPlayer ? ' me' : ''}`;
      el.style.setProperty('--car-color', `#${r.profile.color.toString(16).padStart(6, '0')}`);

      const rank = document.createElement('div');
      rank.className = 'standing-rank';
      const img = document.createElement('img');
      img.alt = r.name;
      img.src = portraits.get(r) ?? '';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'standing-name';
      const label = document.createElement('span');
      label.textContent = r.isPlayer ? 'YOU' : r.name;
      const status = document.createElement('small');
      name.append(label, status);
      const barWrap = document.createElement('div');
      barWrap.className = 'hud-bar';
      const bar = document.createElement('div');
      bar.className = 'hud-bar-fill';
      barWrap.appendChild(bar);
      info.append(name, barWrap);
      el.append(rank, img, info);
      this.root.appendChild(el);
      this.rows.set(r, { el, rank, status, bar, lastRank: -1, lastHealth: -1, lastWrecked: false });
    }
  }

  update(race: Race): void {
    for (const r of race.racers) {
      const row = this.rows.get(r);
      if (!row) continue;
      if (row.lastRank !== r.rank) {
        row.lastRank = r.rank;
        row.rank.textContent = String(r.rank);
        row.el.style.order = String(r.rank);
      }
      const health = Math.max(0, Math.round(r.health));
      if (row.lastHealth !== health) {
        row.lastHealth = health;
        const ratio = health / MAX_HEALTH;
        row.bar.style.width = `${ratio * 100}%`;
        row.bar.style.backgroundColor = healthColor(ratio);
        if (!r.destroyed) row.status.textContent = String(health);
      }
      if (row.lastWrecked !== r.destroyed) {
        row.lastWrecked = r.destroyed;
        row.el.classList.toggle('wrecked', r.destroyed);
        row.status.textContent = r.destroyed ? 'WRECKED' : String(health);
      }
    }
  }
}
