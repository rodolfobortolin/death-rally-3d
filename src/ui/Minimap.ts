import type { Race } from '../race/Race';
import type { Track } from '../world/Track';

const PICKUP_COLORS: Record<string, string> = { repair: '#40ff70', ammo: '#ffc830', turbo: '#40a0ff', mines: '#ff4030' };

/** Top-down radar of the whole circuit with every car, mine and pickup. */
export class Minimap {
  private readonly canvas = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly background = document.createElement('canvas');
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;

  constructor(track: Track) {
    this.setTrack(track);
  }

  /** Fits the map to a track and pre-renders its outline. */
  setTrack(track: Track): void {
    const size = this.canvas.width;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z);
    }
    const pad = 18;
    this.scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.offsetX = pad + ((size - pad * 2) - (maxX - minX) * this.scale) / 2 - minX * this.scale;
    this.offsetZ = pad + ((size - pad * 2) - (maxZ - minZ) * this.scale) / 2 - minZ * this.scale;

    // Pre-render the track outline once.
    this.background.width = this.background.height = size;
    const b = this.background.getContext('2d')!;
    b.clearRect(0, 0, size, size);
    const path = () => {
      b.beginPath();
      track.samples.forEach((s, i) => {
        const [x, y] = this.project(s.x, s.z);
        if (i === 0) b.moveTo(x, y);
        else b.lineTo(x, y);
      });
      b.closePath();
    };
    b.lineJoin = 'round';
    path();
    b.strokeStyle = 'rgba(0,0,0,0.8)';
    b.lineWidth = 11;
    b.stroke();
    path();
    b.strokeStyle = '#8a8478';
    b.lineWidth = 7;
    b.stroke();
    path();
    b.strokeStyle = '#3a3836';
    b.lineWidth = 4;
    b.stroke();
    // Start line.
    const s0 = track.samples[0];
    const [sx, sy] = this.project(s0.x, s0.z);
    b.fillStyle = '#fff';
    b.fillRect(sx - 2, sy - 6, 4, 12);
  }

  private project(x: number, z: number): [number, number] {
    return [x * this.scale + this.offsetX, z * this.scale + this.offsetZ];
  }

  draw(race: Race): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.background, 0, 0);

    for (const item of race.pickups.items) {
      if (!item.active) continue;
      const [x, y] = this.project(item.x, item.z);
      ctx.fillStyle = PICKUP_COLORS[item.type];
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ff2020';
    for (const m of race.combat.mines) {
      const [x, y] = this.project(m.x, m.z);
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Draw the player last so it stays on top.
    const ordered = [...race.racers].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer));
    for (const r of ordered) {
      const p = r.car.physics;
      const [x, y] = this.project(p.x, p.z);
      const size = r.isPlayer ? 6 : 4.5;
      ctx.save();
      ctx.translate(x, y);
      // Canvas y grows downwards like world +Z, so the heading maps directly.
      ctx.rotate(-p.heading + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.3);
      ctx.lineTo(size, size);
      ctx.lineTo(-size, size);
      ctx.closePath();
      ctx.fillStyle = r.destroyed ? '#444' : `#${r.profile.color.toString(16).padStart(6, '0')}`;
      ctx.fill();
      ctx.lineWidth = r.isPlayer ? 2 : 1;
      ctx.strokeStyle = r.isPlayer ? '#fff' : '#000';
      ctx.stroke();
      ctx.restore();
    }
  }
}
