const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/** Thin wrapper over the DOM overlay defined in index.html. */
export class Hud {
  private readonly speed = document.getElementById('hud-speed')!;
  private readonly lap = document.getElementById('hud-lap')!;
  private readonly best = document.getElementById('hud-best')!;
  private lastSpeed = -1;

  setSpeed(metersPerSecond: number): void {
    const kmh = Math.round(metersPerSecond * 3.6);
    if (kmh !== this.lastSpeed) {
      this.speed.textContent = String(kmh);
      this.lastSpeed = kmh;
    }
  }

  setLapTime(seconds: number): void {
    this.lap.textContent = formatTime(seconds);
  }

  setBestLap(seconds: number | null): void {
    this.best.textContent = seconds === null ? '--' : formatTime(seconds);
  }
}
