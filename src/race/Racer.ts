import * as THREE from 'three';
import { Car } from '../car/Car';
import type { CarBodyType } from '../car/CarModel';
import type { CarSpec } from '../car/CarPhysics';
import type { Track } from '../world/Track';

export interface RacerProfile {
  name: string;
  color: number;
  bodyType: CarBodyType;
  isPlayer: boolean;
  /** 0..1+, scales AI top speed, aim and aggression. Ignored for the player. */
  skill: number;
}

export const MAX_HEALTH = 100;
export const MAX_TURBO = 100;
export const START_AMMO = 120;
export const START_MINES = 3;
export const RESPAWN_DELAY = 3;

/** A car taking part in a race, plus its combat stats and lap bookkeeping. */
export class Racer {
  readonly car: Car;
  health: number;
  ammo = START_AMMO;
  mines = START_MINES;
  turbo = MAX_TURBO;
  destroyed = false;
  respawnTimer = 0;
  /** Seconds of spawn protection left after a respawn. */
  invulnerable = 0;
  fireCooldown = 0;
  mineCooldown = 0;
  kills = 0;
  wrecks = 0;
  /** Who last damaged this car, for kill credit. */
  lastAttacker: Racer | null = null;

  // Lap tracking.
  started = false;
  lapsDone = 0;
  passedHalfway = false;
  lastAlong = 0;
  lapStart = 0;
  bestLap: number | null = null;
  finished = false;
  finishTime = 0;
  rank = 0;

  constructor(
    readonly profile: RacerProfile,
    track: Track,
    spec: CarSpec,
    onWallImpact: (racer: Racer, x: number, y: number, z: number, strength: number) => void,
    /** Armor capacity; tougher cars have more. */
    readonly maxHealth = MAX_HEALTH,
  ) {
    this.health = maxHealth;
    this.car = new Car(track, { bodyColor: profile.color, bodyType: profile.bodyType }, spec, {
      onImpact: (x, y, z, s) => onWallImpact(this, x, y, z, s),
    });
  }

  get name(): string {
    return this.profile.name;
  }

  get isPlayer(): boolean {
    return this.profile.isPlayer;
  }

  /** Total distance covered, used to rank the field. */
  progress(trackLength: number): number {
    if (!this.started) return this.car.trackAlong - trackLength;
    return this.lapsDone * trackLength + this.car.trackAlong;
  }

  /** Refreshes dents, loose parts and paint from the current armor. */
  updateDamageVisual(): void {
    this.car.damage.apply(this.destroyed ? 1 : 1 - this.health / this.maxHealth, this.destroyed);
  }

  repair(): void {
    this.health = this.maxHealth;
    this.destroyed = false;
    this.invulnerable = 2;
    this.lastAttacker = null;
  }

  worldPoint(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.car.object.updateMatrixWorld();
    return out.copy(local).applyMatrix4(this.car.object.matrixWorld);
  }
}
