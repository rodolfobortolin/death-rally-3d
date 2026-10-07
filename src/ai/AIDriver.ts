import { NEUTRAL_INPUT, type DriveInput } from '../core/Input';
import { clamp } from '../core/math';
import type { Mine } from '../combat/Combat';
import type { Pickup } from '../race/Pickups';
import { MAX_HEALTH, type Racer } from '../race/Racer';
import type { Track } from '../world/Track';

export interface AIWorld {
  track: Track;
  racers: Racer[];
  mines: Mine[];
  pickups: Pickup[];
  /** The human player, if any, for rubber-banding. */
  player: Racer | null;
}

/**
 * Computer driver: follows the track with a preferred lane, brakes for corners,
 * overtakes, dodges mines, grabs pickups it needs and attacks nearby cars.
 */
export class AIDriver {
  private lane: number;
  private laneTimer = 0;
  private stuckTime = 0;
  private reverseTime = 0;
  private burstTime = 0;
  private burstCooldown = 0;
  private readonly aimError: number;

  constructor(private readonly racer: Racer) {
    this.lane = (Math.random() - 0.5) * 6;
    this.aimError = 0.09 * (1.15 - racer.profile.skill);
  }

  /** Extra spread added to this driver's shots. */
  get spread(): number {
    return Math.max(0, this.aimError);
  }

  think(world: AIWorld, dt: number): DriveInput {
    const r = this.racer;
    if (r.destroyed) return NEUTRAL_INPUT;
    const { track } = world;
    const car = r.car;
    const p = car.physics;
    const speed = p.speed;
    const skill = r.profile.skill;
    const halfRoad = track.def.roadHalfWidth - 1.6;

    // Wander between lanes now and then so the field doesn't drive in a single file.
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 3 + Math.random() * 4;
      this.lane = clamp(this.lane + (Math.random() - 0.5) * 5, -halfRoad, halfRoad);
    }
    let targetLane = this.lane;

    // Cars ahead (wrecks included): move to the side with more room to overtake.
    for (const other of world.racers) {
      if (other === r) continue;
      const gap = wrapGap(other.car.trackAlong - car.trackAlong, track.length);
      if (gap > 0 && gap < 22) {
        const latDiff = other.car.trackLateral - car.trackLateral;
        if (Math.abs(latDiff) < 3) {
          const dodge = other.car.trackLateral > 0 ? -1 : 1;
          targetLane = clamp(other.car.trackLateral + dodge * 3.5, -halfRoad, halfRoad);
        }
      }
    }

    // Pickups: grab what we need if it is reasonably close to our line.
    for (const item of world.pickups) {
      if (!item.active) continue;
      const gap = wrapGap(item.along - car.trackAlong, track.length);
      if (gap < 8 || gap > 45) continue;
      const need =
        (item.type === 'repair' && r.health < MAX_HEALTH * 0.6) ||
        (item.type === 'ammo' && r.ammo < 50) ||
        (item.type === 'turbo' && r.turbo < 50) ||
        (item.type === 'mines' && r.mines < 2);
      if (need && Math.abs(item.lateral - targetLane) < 5) targetLane = item.lateral;
    }

    // Mines on our line take priority over everything else.
    for (const mine of world.mines) {
      if (mine.owner === r && mine.age < 2) continue;
      const q = track.query(mine.x, mine.z, car.trackIndex);
      const gap = wrapGap(q.along - car.trackAlong, track.length);
      if (gap > 0 && gap < 35 && Math.abs(q.lateral - targetLane) < 2.8) {
        targetLane = clamp(q.lateral + (q.lateral > 0 ? -3.5 : 3.5), -halfRoad, halfRoad);
      }
    }

    // Steering towards a look-ahead point on the chosen lane.
    const lookAhead = 7 + speed * 0.5;
    const target = track.pointAt(car.trackAlong + lookAhead, targetLane);
    const desired = Math.atan2(target.x - p.x, target.z - p.z);
    const diff = Math.atan2(Math.sin(desired - p.heading), Math.cos(desired - p.heading));
    let steer = clamp(-diff * 2.8, -1, 1);

    // Corner speed from the sharpest curvature in the braking zone ahead.
    const n = track.samples.length;
    const scan = Math.round((12 + speed * 1.4) / (track.length / n));
    let maxCurv = 0;
    for (let k = 2; k < scan; k++) maxCurv = Math.max(maxCurv, Math.abs(track.samples[(car.trackIndex + k) % n].curvature));
    const grip = 19 + 6 * skill;
    let targetSpeed = Math.min(p.spec.maxSpeed * 1.3, Math.sqrt(grip / Math.max(maxCurv, 1e-4)));
    targetSpeed *= 0.86 + 0.14 * skill;

    // Light rubber-banding against the player keeps races close.
    if (world.player && !world.player.finished) {
      const gap = r.progress(track.length) - world.player.progress(track.length);
      if (gap < -120) targetSpeed *= 1.07;
      else if (gap > 150) targetSpeed *= 0.93;
    }

    let throttle = speed < targetSpeed ? 1 : 0;
    let brake = speed > targetSpeed + 2.5 ? 1 : 0;
    const boost = r.turbo > 35 && maxCurv < 0.008 && speed > 18 && Math.random() < 0.5 + 0.4 * skill;

    // Stuck against a wall: back off and steer the other way.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      throttle = 0;
      brake = 1;
      steer = -steer;
    } else if (speed < 2 && throttle > 0) {
      this.stuckTime += dt;
      if (this.stuckTime > 1.2) {
        this.reverseTime = 1;
        this.stuckTime = 0;
      }
    } else {
      this.stuckTime = 0;
    }

    return {
      throttle,
      brake,
      steer,
      handbrake: false,
      boost,
      fire: this.wantsToFire(world, dt),
      dropMine: this.wantsToDropMine(world, dt),
    };
  }

  private wantsToFire(world: AIWorld, dt: number): boolean {
    const r = this.racer;
    if (r.ammo <= 0) return false;
    this.burstCooldown -= dt;
    if (this.burstTime > 0) {
      this.burstTime -= dt;
      return true;
    }
    if (this.burstCooldown > 0) return false;
    const p = r.car.physics;
    const [fx, fz] = p.forward();
    for (const other of world.racers) {
      if (other === r || other.destroyed || other.invulnerable > 0) continue;
      const dx = other.car.physics.x - p.x;
      const dz = other.car.physics.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 40 || d < 2) continue;
      const cos = (dx * fx + dz * fz) / d;
      if (cos > 0.985) {
        this.burstTime = 0.3 + Math.random() * 0.6 * r.profile.skill;
        this.burstCooldown = 0.9 + Math.random() * 1.8 * (1.2 - r.profile.skill);
        return true;
      }
    }
    return false;
  }

  private wantsToDropMine(world: AIWorld, dt: number): boolean {
    const r = this.racer;
    if (r.mines <= 0) return false;
    const { track } = world;
    for (const other of world.racers) {
      if (other === r || other.destroyed) continue;
      const gap = wrapGap(r.car.trackAlong - other.car.trackAlong, track.length);
      if (gap > 4 && gap < 22 && Math.abs(other.car.trackLateral - r.car.trackLateral) < 2.5) {
        return Math.random() < dt * 0.5 * r.profile.skill;
      }
    }
    return false;
  }
}

/** Signed shortest distance along a looping track. */
function wrapGap(d: number, length: number): number {
  if (d > length / 2) return d - length;
  if (d < -length / 2) return d + length;
  return d;
}
