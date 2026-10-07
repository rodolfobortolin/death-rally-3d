import type { Race } from '../race/Race';
import { MAX_TURBO, START_AMMO } from '../race/Racer';

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

const el = (id: string) => document.getElementById(id)!;

/** Bars in the machine-gun magazine; each holds an equal share of a full load. */
const AMMO_BARS = 12;

/** Race clock as m:ss:cc, like the remake's HUD. */
const formatClock = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}:${String(cs).padStart(2, '0')}`;
};

/** Top row (position, condition, time, lap), bottom-right dock, banners and kill feed. */
export class Hud {
  private readonly root = el('hud');
  private readonly pos = el('hud-pos');
  private readonly total = el('hud-total');
  private readonly condition = el('hud-condition');
  private readonly conditionBox = el('hud-condition-box');
  private readonly time = el('hud-time');
  private readonly lap = el('hud-lap');
  private readonly laps = el('hud-laps');
  private readonly ammo = el('hud-ammo');
  private readonly ammoBars: HTMLElement[];
  private readonly dockMain = document.querySelector('.dock-main') as HTMLElement;
  private readonly mines = el('hud-mines');
  private readonly minesCell = el('hud-mines-cell');
  private readonly turbo = el('hud-turbo');
  private readonly turboNum = el('hud-turbo-num');
  private readonly turboCell = el('hud-turbo-cell');
  private readonly portrait = el('hud-portrait') as HTMLImageElement;
  private readonly damageTint = el('hud-damage-tint');
  private readonly banner = el('hud-banner');
  private readonly feed = el('hud-feed');
  private readonly cache = new Map<HTMLElement, string>();
  private readonly classCache = new Map<string, boolean>();

  constructor() {
    const bars = el('hud-ammo-bars');
    this.ammoBars = Array.from({ length: AMMO_BARS }, () => bars.appendChild(document.createElement('i')));
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.feed.innerHTML = '';
  }

  setPortrait(src: string): void {
    this.portrait.src = src;
  }

  /** Only touches the DOM when a value actually changes. */
  private set(node: HTMLElement, value: string): void {
    if (this.cache.get(node) === value) return;
    this.cache.set(node, value);
    node.textContent = value;
  }

  private setStyle(node: HTMLElement, prop: string, value: string): void {
    const key = `${prop}:${value}`;
    if (this.cache.get(node) === key) return;
    this.cache.set(node, key);
    node.style.setProperty(prop, value);
  }

  private setClass(node: HTMLElement, name: string, on: boolean): void {
    const key = `${node.id || node.className}|${name}`;
    if (this.classCache.get(key) === on) return;
    this.classCache.set(key, on);
    node.classList.toggle(name, on);
  }

  update(race: Race): void {
    const p = race.player;
    if (!p) return;

    this.set(this.pos, String(p.rank));
    this.set(this.total, String(race.racers.length));
    this.set(this.lap, String(race.playerLap()));
    this.set(this.laps, String(race.config.laps));
    this.set(this.time, formatClock(p.finished ? p.finishTime : race.raceTime));

    const condition = p.destroyed ? 0 : Math.max(0, Math.ceil((p.health / p.maxHealth) * 100));
    this.set(this.condition, String(condition));
    this.setClass(this.conditionBox, 'warn', condition <= 50 && condition > 25);
    this.setClass(this.conditionBox, 'crit', condition <= 25);
    this.setStyle(this.damageTint, 'opacity', ((100 - condition) / 100).toFixed(2));

    // Magazine: full bars on the right, the partly used one on the left shrinks as you fire.
    this.set(this.ammo, String(p.ammo));
    const perBar = START_AMMO / AMMO_BARS;
    const loaded = Math.min(p.ammo, START_AMMO) / perBar;
    this.ammoBars.forEach((bar, i) => {
      const fromRight = AMMO_BARS - 1 - i;
      const fill = Math.max(0, Math.min(1, loaded - fromRight));
      this.setStyle(bar, '--fill', `${Math.round(fill * 100)}%`);
    });
    this.setClass(this.dockMain, 'low', p.ammo < 20);

    this.set(this.mines, String(p.mines));
    this.setClass(this.minesCell, 'low', p.mines === 0);

    const turbo = Math.round((p.turbo / MAX_TURBO) * 100);
    this.setStyle(this.turbo, 'width', `${turbo}%`);
    this.set(this.turboNum, String(turbo));
    this.setClass(this.turboCell, 'low', turbo < 20);
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
