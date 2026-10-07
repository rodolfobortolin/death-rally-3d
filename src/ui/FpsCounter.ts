const STORAGE_KEY = 'death-rally-3d.fps';
const REFRESH = 0.5;

/** Small on-screen frame rate readout, toggled with F and remembered between sessions. */
export class FpsCounter {
  private readonly el = document.getElementById('fps')!;
  private frames = 0;
  private time = 0;
  private worst = 0;
  private visible: boolean;

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage unavailable; default to visible.
    }
    this.visible = stored !== 'off';
    this.el.classList.toggle('hidden', !this.visible);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
    try {
      localStorage.setItem(STORAGE_KEY, this.visible ? 'on' : 'off');
    } catch {
      // Ignore storage errors.
    }
  }

  /** Call once per rendered frame with the real (unclamped) frame time in seconds. */
  update(dt: number): void {
    this.frames++;
    this.time += dt;
    this.worst = Math.max(this.worst, dt);
    if (this.time < REFRESH) return;
    const fps = this.frames / this.time;
    const avgMs = (this.time / this.frames) * 1000;
    if (this.visible) {
      this.el.textContent = `${Math.round(fps)} FPS · ${avgMs.toFixed(1)} ms · worst ${(this.worst * 1000).toFixed(0)} ms`;
      this.el.dataset.level = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad';
    }
    this.frames = 0;
    this.time = 0;
    this.worst = 0;
  }
}
