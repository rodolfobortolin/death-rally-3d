import type { Race } from '../race/Race';
import type { Racer } from '../race/Racer';
import { ordinalSuffix } from './Hud';

interface Card {
  el: HTMLElement;
  status: HTMLElement;
  lap: HTMLElement;
  pos: HTMLElement;
  bar: HTMLElement;
  key: string;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const healthColor = (ratio: number): string => {
  if (ratio > 0.6) return '#4cd160';
  if (ratio > 0.3) return '#f2c230';
  return '#e0402a';
};

/** One card per rival under the player card: name, portrait, lap, armor and position. */
export class Standings {
  private readonly root = document.getElementById('hud-rivals')!;
  private readonly cards = new Map<Racer, Card>();

  build(race: Race, portraits: Map<Racer, string>): void {
    this.root.innerHTML = '';
    this.cards.clear();
    // Squeeze the rival cards when the field is big so they all fit on screen.
    this.root.parentElement?.classList.toggle('compact', race.racers.length > 6);
    for (const r of race.racers) {
      if (r.isPlayer) continue;
      const el = document.createElement('section');
      el.className = 'card rival-card';
      el.style.setProperty('--car-color', hex(r.profile.color));
      el.innerHTML = `
        <header class="card-head"><span></span><small></small></header>
        <div class="rival-body">
          <div class="mini"><img alt="" /></div>
          <div class="rival-lap"><small>ON LAP</small> <b></b><div class="hud-bar"><div class="hud-bar-fill"></div></div></div>
          <div class="rival-pos"></div>
        </div>`;
      el.querySelector('.card-head span')!.textContent = r.name.toUpperCase();
      const img = el.querySelector('img')!;
      img.src = portraits.get(r) ?? '';
      img.alt = r.name;
      this.root.appendChild(el);
      this.cards.set(r, {
        el,
        status: el.querySelector('.card-head small')!,
        lap: el.querySelector('.rival-lap b')!,
        pos: el.querySelector('.rival-pos')!,
        bar: el.querySelector('.hud-bar-fill')!,
        key: '',
      });
    }
  }

  update(race: Race): void {
    const laps = race.config.laps;
    for (const [r, card] of this.cards) {
      const lap = Math.min(laps, Math.max(1, r.lapsDone + 1));
      const health = Math.max(0, Math.round(r.health));
      const key = `${r.rank}|${lap}|${health}|${r.destroyed}|${r.finished}`;
      if (key === card.key) continue;
      card.key = key;
      card.el.style.order = String(r.rank);
      card.pos.innerHTML = `${r.rank}<sup>${ordinalSuffix(r.rank)}</sup>`;
      card.lap.innerHTML = `${lap}<i> OF </i>${laps}`;
      const ratio = health / r.maxHealth;
      card.bar.style.width = `${ratio * 100}%`;
      card.bar.style.backgroundColor = healthColor(ratio);
      card.el.classList.toggle('wrecked', r.destroyed);
      card.status.textContent = r.finished ? 'FINISHED' : r.destroyed ? 'WRECKED' : `${Math.round((1 - ratio) * 100)}%`;
    }
  }
}
