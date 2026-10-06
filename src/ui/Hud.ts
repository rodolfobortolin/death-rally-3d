import type { Race } from '../race/Race';
import { MAX_HEALTH, MAX_TURBO } from '../race/Racer';

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

const el = (id: string) => document.getElementById(id)!;

/** In-race overlay: standings, timers, armor/turbo/ammo, banners and a kill feed. */
export class Hud {
  private readonly root = el('hud');
  private readonly pos = el('hud-pos');
  private readonly total = el('hud-total');
  private readonly lap = el('hud-lap');
  private readonly laps = el('hud-laps');
  private readonly time = el('hud-time');
  private readonly best = el('hud-best');
  private readonly speed = el('hud-speed');
  private readonly health = el('hud-health');
  private readonly healthVal = el('hud-health-val');
  private readonly turbo = el('hud-turbo');
  private readonly ammo = el('hud-ammo');
  private readonly mines = el('hud-mines');
  private readonly banner = el('hud-banner');
  private readonly feed = el('hud-feed');
  private readonly cache = new Map<HTMLElement, string>();

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.feed.innerHTML = '';
  }

  /** Only touches the DOM when a value actually changes. */
  private set(node: HTMLElement, value: string): void {
    if (this.cache.get(node) === value) return;
    this.cache.set(node, value);
    node.textContent = value;
  }

  private setWidth(node: HTMLElement, ratio: number): void {
    const v = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    if (this.cache.get(node) === v) return;
    this.cache.set(node, v);
    node.style.width = v;
  }

  update(race: Race): void {
    const p = race.player;
    if (!p) return;
    this.set(this.pos, String(p.rank));
    this.set(this.total, String(race.racers.length));
    this.set(this.lap, String(race.playerLap()));
    this.set(this.laps, String(race.config.laps));
    this.set(this.time, formatTime(p.finished ? p.finishTime : race.raceTime));
    this.set(this.best, p.bestLap === null ? '--' : formatTime(p.bestLap));
    this.set(this.speed, String(Math.round(p.car.physics.speed * 3.6)));
    this.setWidth(this.health, p.health / MAX_HEALTH);
    this.set(this.healthVal, String(Math.max(0, Math.round(p.health))));
    this.setWidth(this.turbo, p.turbo / MAX_TURBO);
    this.set(this.ammo, String(p.ammo));
    this.set(this.mines, String(p.mines));
  }

  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth; // restart the CSS animation
    this.banner.classList.add('show');
  }

  pushFeed(text: string): void {
    const wrap = document.createElement('div');
    const line = document.createElement('span');
    line.textContent = text;
    wrap.appendChild(line);
    this.feed.prepend(wrap);
    while (this.feed.children.length > 5) this.feed.lastChild?.remove();
    setTimeout(() => wrap.remove(), 5000);
  }
}
