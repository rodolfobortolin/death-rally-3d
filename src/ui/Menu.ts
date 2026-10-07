import { CARS, carById, DEFAULT_CAR_ID, effectiveStats, FULL_UPGRADES, TIER_NAMES, type CarStats } from '../car/CarCatalog';
import type { Difficulty, RaceConfig, RaceResult } from '../race/Race';
import { formatTime } from './Hud';

export type MenuAction = 'start' | 'resume' | 'restart' | 'quit';
type ScreenId = 'menu' | 'controls' | 'pause' | 'results';

export interface Settings {
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  sound: boolean;
  respawn: boolean;
  car: string;
}

const OPTIONS = {
  laps: [1, 2, 3, 5, 8],
  opponents: [1, 3, 5, 7],
  difficulty: ['easy', 'normal', 'hard'] as Difficulty[],
  sound: [true, false],
  respawn: [false, true],
  car: CARS.map((c) => c.id),
};

const STAT_LABELS: Array<[keyof CarStats, string]> = [
  ['speed', 'TOP SPEED'],
  ['acceleration', 'ACCEL'],
  ['handling', 'HANDLING'],
  ['armor', 'ARMOR'],
];

const STORAGE_KEY = 'death-rally-3d.settings';

function loadSettings(): Settings {
  const defaults: Settings = { laps: 3, opponents: 5, difficulty: 'normal', sound: true, respawn: false, car: DEFAULT_CAR_ID };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage may be unavailable (private mode); fall back to defaults.
  }
  return defaults;
}

/** Main menu, controls, pause and results screens (plain HTML overlays). */
export class Menu {
  readonly settings: Settings = loadSettings();
  onAction: (action: MenuAction) => void = () => {};
  onSettingsChange: (settings: Settings) => void = () => {};
  onClick: () => void = () => {};
  private current: ScreenId | null = 'menu';
  private carPreviews = new Map<string, string>();
  private readonly screens: Record<ScreenId, HTMLElement> = {
    menu: document.getElementById('menu')!,
    controls: document.getElementById('controls')!,
    pause: document.getElementById('pause')!,
    results: document.getElementById('results')!,
  };

  constructor() {
    document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.onClick();
        const action = btn.dataset.action!;
        if (action === 'controls') this.show('controls');
        else if (action === 'back') this.show('menu');
        else this.onAction(action as MenuAction);
      });
    });
    document.querySelectorAll<HTMLElement>('[data-option]').forEach((row) => {
      const key = row.dataset.option as keyof Settings;
      row.querySelectorAll<HTMLButtonElement>('.opt-btn').forEach((b) =>
        b.addEventListener('click', () => {
          this.onClick();
          this.cycle(key, Number(b.dataset.dir));
        }),
      );
    });
    document.querySelectorAll<HTMLButtonElement>('[data-car-dir]').forEach((b) =>
      b.addEventListener('click', () => {
        this.onClick();
        this.cycle('car', Number(b.dataset.carDir));
      }),
    );
    this.renderOptions();
  }

  /** Car preview images, keyed by car id. */
  setCarPreviews(previews: Map<string, string>): void {
    this.carPreviews = previews;
    this.renderGarage();
  }

  get visible(): ScreenId | null {
    return this.current;
  }

  show(id: ScreenId | null): void {
    this.current = id;
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('hidden', key !== id);
    // Drop focus when leaving menus so Space/Enter in the race can't click a hidden button.
    if (!id && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (id) {
      const first = this.screens[id].querySelector<HTMLButtonElement>('.btn.primary, .btn');
      first?.focus({ preventScroll: true });
    }
  }

  raceConfig(): RaceConfig {
    return { laps: this.settings.laps, opponents: this.settings.opponents, difficulty: this.settings.difficulty, withPlayer: true, respawn: this.settings.respawn, car: this.settings.car };
  }

  private cycle(key: keyof Settings, dir: number): void {
    const list = OPTIONS[key] as Array<Settings[typeof key]>;
    const i = list.indexOf(this.settings[key]);
    const next = list[(i + dir + list.length) % list.length];
    (this.settings as unknown as Record<string, unknown>)[key] = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore storage errors; settings still apply for this session.
    }
    this.renderOptions();
    this.onSettingsChange(this.settings);
  }

  private renderOptions(): void {
    const label = (key: keyof Settings): string => {
      const v = this.settings[key];
      if (key === 'sound' || key === 'respawn') return v ? 'ON' : 'OFF';
      return String(v).toUpperCase();
    };
    document.querySelectorAll<HTMLElement>('[data-option]').forEach((row) => {
      row.querySelector('[data-value]')!.textContent = label(row.dataset.option as keyof Settings);
    });
    this.renderGarage();
  }

  private renderGarage(): void {
    const def = carById(this.settings.car);
    const stats = effectiveStats(def);
    const maxed = effectiveStats(def, FULL_UPGRADES);
    const img = document.getElementById('garage-img') as HTMLImageElement;
    const src = this.carPreviews.get(def.id);
    if (src) img.src = src;
    document.getElementById('garage-name')!.textContent = def.name.toUpperCase();
    document.getElementById('garage-tier')!.textContent = `TIER ${def.tier} · ${TIER_NAMES[def.tier]} · $${def.price.toLocaleString('en-US')}`;
    document.getElementById('garage-tag')!.textContent = def.tagline;
    document.getElementById('garage-stats')!.innerHTML = STAT_LABELS.map(([key, text]) => {
      // Filled = stock, outlined = what fully upgrading this car can reach.
      const cells = Array.from({ length: 10 }, (_, i) => `<i class="${i < stats[key] ? 'on' : i < maxed[key] ? 'up' : ''}"></i>`).join('');
      return `<div class="stat"><span>${text}</span><div class="stat-bar">${cells}</div></div>`;
    }).join('');
    document.getElementById('garage-dots')!.innerHTML = CARS.map((c) => `<i class="${c.id === def.id ? 'on' : ''}"></i>`).join('');
  }

  showResults(results: RaceResult[]): void {
    const me = results.find((r) => r.isPlayer);
    const title = document.getElementById('results-title')!;
    const ordinal = (n: number) => {
      const suffix = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]);
    };
    title.textContent = me?.wrecked ? 'YOU WERE WRECKED' : me ? (me.rank === 1 ? 'YOU WIN!' : `YOU FINISHED ${ordinal(me.rank).toUpperCase()}`) : 'RESULTS';
    const body = document.getElementById('results-body')!;
    body.innerHTML = '';
    for (const r of results) {
      const tr = document.createElement('tr');
      tr.className = [r.isPlayer ? 'me' : '', r.wrecked ? 'out' : ''].join(' ').trim();
      const cells = [
        String(r.rank),
        '',
        r.wrecked ? 'WRECKED' : r.time === null ? 'DNF' : `${r.estimated ? '~' : ''}${formatTime(r.time)}`,
        r.bestLap === null ? '--' : formatTime(r.bestLap),
        String(r.kills),
        String(r.wrecks),
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i === 1) {
          const sw = document.createElement('span');
          sw.className = 'swatch';
          sw.style.background = `#${r.color.toString(16).padStart(6, '0')}`;
          td.append(sw, r.name);
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    this.show('results');
  }
}
