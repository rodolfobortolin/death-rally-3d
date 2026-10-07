import type { Race } from '../race/Race';
import { MAX_TURBO } from '../race/Racer';

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

export const ordinalSuffix = (n: number): string => {
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0];
};

const el = (id: string) => document.getElementById(id)!;

/** Speed in km/h at the right end of the gauge. */
const GAUGE_MAX = 200;

/** Player card (gauge, turbo, damage portrait, lap, position, ammo), banners and kill feed. */
export class Hud {
  private readonly root = el('hud');
  private readonly speed = el('hud-speed');
  private readonly gauge = el('hud-gauge') as HTMLCanvasElement;
  private readonly gaugeCtx = this.gauge.getContext('2d')!;
  private readonly turbo = el('hud-turbo');
  private readonly portrait = el('hud-portrait') as HTMLImageElement;
  private readonly damageTint = el('hud-damage-tint');
  private readonly damage = el('hud-damage');
  private readonly lap = el('hud-lap');
  private readonly laps = el('hud-laps');
  private readonly pos = el('hud-pos');
  private readonly ammo = el('hud-ammo');
  private readonly mines = el('hud-mines');
  private readonly time = el('hud-time');
  private readonly best = el('hud-best');
  private readonly banner = el('hud-banner');
  private readonly feed = el('hud-feed');
  private readonly cache = new Map<HTMLElement, string>();
  private gaugeSpeed = -1;

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) this.feed.innerHTML = '';
  }

  setPortrait(src: string): void {
    this.portrait.src = src;
  }

  /** Only touches the DOM when a value actually changes. */
  private set(node: HTMLElement, value: string, html = false): void {
    if (this.cache.get(node) === value) return;
    this.cache.set(node, value);
    if (html) node.innerHTML = value;
    else node.textContent = value;
  }

  private setStyle(node: HTMLElement, prop: 'width' | 'opacity', value: string): void {
    const key = `${prop}:${value}`;
    if (this.cache.get(node) === key) return;
    this.cache.set(node, key);
    node.style[prop] = value;
  }

  update(race: Race): void {
    const p = race.player;
    if (!p) return;
    const kmh = Math.round(p.car.physics.speed * 3.6);
    this.set(this.speed, String(kmh));
    this.drawGauge(kmh);
    this.setStyle(this.turbo, 'width', `${Math.round((p.turbo / MAX_TURBO) * 100)}%`);

    const damage = p.destroyed ? 100 : Math.round((1 - p.health / p.maxHealth) * 100);
    this.set(this.damage, `${damage}%`);
    this.setStyle(this.damageTint, 'opacity', (damage / 100).toFixed(2));

    this.set(this.lap, String(race.playerLap()));
    this.set(this.laps, String(race.config.laps));
    this.set(this.pos, `${p.rank}<sup>${ordinalSuffix(p.rank)}</sup>`, true);
    this.set(this.ammo, String(p.ammo));
    this.set(this.mines, String(p.mines));
    this.set(this.time, formatTime(p.finished ? p.finishTime : race.raceTime));
    this.set(this.best, p.bestLap === null ? '--' : formatTime(p.bestLap));
  }

  /** Analog speedometer like the original's green dial. */
  private drawGauge(kmh: number): void {
    if (kmh === this.gaugeSpeed) return;
    this.gaugeSpeed = kmh;
    const ctx = this.gaugeCtx;
    const w = this.gauge.width;
    const h = this.gauge.height;
    const cx = w / 2;
    const cy = h - 6;
    const r = h - 16;
    const start = Math.PI * 1.05;
    const end = Math.PI * 1.95;
    ctx.clearRect(0, 0, w, h);

    // Scale band, green to red.
    const segments = 24;
    for (let i = 0; i < segments; i++) {
      const a0 = start + ((end - start) * i) / segments;
      const a1 = start + ((end - start) * (i + 0.8)) / segments;
      const t = i / segments;
      const lit = t <= kmh / GAUGE_MAX;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.lineWidth = 12;
      const hue = 130 - t * 130;
      ctx.strokeStyle = lit ? `hsl(${hue}, 85%, 50%)` : `hsla(${hue}, 40%, 25%, 0.6)`;
      ctx.stroke();
    }
    // Ticks.
    ctx.strokeStyle = '#cfe8d8';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 10; i++) {
      const a = start + ((end - start) * i) / 10;
      const inner = r - (i % 5 === 0 ? 18 : 12);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
      ctx.stroke();
    }
    // Needle.
    const a = start + (end - start) * Math.min(1.04, kmh / GAUGE_MAX);
    ctx.strokeStyle = '#ff5a1f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.stroke();
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
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
