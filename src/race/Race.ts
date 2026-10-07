import * as THREE from 'three';
import { AIDriver } from '../ai/AIDriver';
import type { Sound } from '../audio/Sound';
import { buildCar, carById, STOCK_UPGRADES, type CarUpgrades } from '../car/CarCatalog';
import { DEFAULT_CAR_SPEC, type CarSpec } from '../car/CarPhysics';
import { Combat } from '../combat/Combat';
import { NEUTRAL_INPUT, type DriveInput, type Input } from '../core/Input';
import type { Effects } from '../fx/Effects';
import type { Track } from '../world/Track';
import { Pickups } from './Pickups';
import { MAX_TURBO, Racer, type RacerProfile } from './Racer';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceConfig {
  laps: number;
  opponents: number;
  difficulty: Difficulty;
  /** False for the attract-mode race running behind the main menu. */
  withPlayer: boolean;
  /** Wrecked cars come back after a few seconds. Off by default: like the original, a wreck is out of the race. */
  respawn: boolean;
  /** Player car id from the catalog. */
  car: string;
  /** Shop upgrades fitted to the player car. */
  upgrades?: CarUpgrades;
}

export interface RaceResult {
  rank: number;
  name: string;
  isPlayer: boolean;
  color: number;
  time: number | null;
  /** True when `time` is a projection for a car that has not finished yet. */
  estimated: boolean;
  bestLap: number | null;
  kills: number;
  wrecks: number;
  /** Eliminated from the race (no respawn). */
  wrecked: boolean;
}

export interface RaceMessage {
  text: string;
  /** Big centered banner instead of a small feed line. */
  banner: boolean;
}

const COUNTDOWN = 3.5;
/** Weapons stay locked for the first seconds so the start isn't a massacre. */
const WEAPONS_FREE_AFTER = 4;
const TURBO_DRAIN = 32;
const CAR_RADIUS = 1.05;
const CAR_CIRCLE_OFFSET = 1.1;

const RIVALS: Array<Omit<RacerProfile, 'isPlayer' | 'skill'>> = [
  { name: 'Viper', color: 0x2f8a3a, bodyType: 'shrieker' },
  { name: 'Razor', color: 0x1f4fa8, bodyType: 'wraith' },
  { name: 'Sledge', color: 0xd8a51c, bodyType: 'dervish' },
  { name: 'Mad Dog', color: 0x6a2a8a, bodyType: 'sentinel' },
  { name: 'Bones', color: 0xe6e2da, bodyType: 'vagabond' },
  { name: 'Cinder', color: 0xd85a10, bodyType: 'deliverator' },
  { name: 'Ghost', color: 0x2e4a44, bodyType: 'sentinel' },
];

const SKILL: Record<Difficulty, [number, number]> = {
  easy: [0.55, 0.72],
  normal: [0.75, 0.9],
  hard: [0.92, 1.05],
};

/** One race: the field of cars, their controllers, weapons, pickups and standings. */
export class Race {
  readonly group = new THREE.Group();
  readonly racers: Racer[] = [];
  readonly player: Racer | null = null;
  readonly combat: Combat;
  readonly pickups: Pickups;
  phase: RacePhase = 'countdown';
  countdown = COUNTDOWN;
  raceTime = 0;
  onMessage: (msg: RaceMessage) => void = () => {};
  onFinish: (results: RaceResult[]) => void = () => {};
  /** Camera shake request, scaled by how close the event was to the focus car. */
  onShake: (amount: number) => void = () => {};

  private readonly drivers = new Map<Racer, AIDriver>();
  private readonly inputs = new Map<Racer, DriveInput>();
  /** Cars knocked out of the race, in the order they were wrecked. */
  private outOrder: Racer[] = [];
  private finishDelay = -1;
  private wrongWayTime = 0;
  private lastCountdownBeep = 4;
  private readonly wheelPoints: THREE.Vector3[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly track: Track,
    private readonly effects: Effects,
    private readonly sound: Sound,
    readonly config: RaceConfig,
  ) {
    const onWall = (r: Racer, x: number, y: number, z: number, strength: number) => {
      this.effects.sparksBurst(this.tmp.set(x, y, z), Math.min(30, Math.floor(strength * 1.5)));
      this.combat.impactDamage(r, strength, null);
      if (r.isPlayer) {
        this.sound.impact(strength);
        this.onShake(Math.min(0.6, strength * 0.03));
      }
    };

    // Build the field: rivals first, the player starts from the back like the original.
    // Rivals race in the same class as the player's car (stock, without upgrades), so
    // upgrades are the player's edge and a better car means a tougher field.
    const playerCar = carById(config.car);
    const fieldSpec = config.withPlayer ? buildCar(playerCar).spec : DEFAULT_CAR_SPEC;
    const [minSkill, maxSkill] = SKILL[config.difficulty];
    const rivals = [...RIVALS].sort(() => Math.random() - 0.5).slice(0, config.opponents);
    rivals.forEach((rival, i) => {
      const skill = maxSkill - (i / Math.max(1, rivals.length - 1)) * (maxSkill - minSkill);
      const spec: CarSpec = { ...fieldSpec, maxSpeed: fieldSpec.maxSpeed * (0.93 + 0.1 * skill) };
      const racer = new Racer({ ...rival, isPlayer: false, skill }, track, spec, onWall);
      this.racers.push(racer);
      this.drivers.set(racer, new AIDriver(racer));
    });
    if (config.withPlayer) {
      const { spec, maxHealth } = buildCar(playerCar, config.upgrades ?? STOCK_UPGRADES);
      const p = playerCar;
      const profile: RacerProfile = { name: 'You', color: p.color, bodyType: p.bodyType, isPlayer: true, skill: 1 };
      const player = new Racer(profile, track, spec, onWall, maxHealth);
      this.racers.push(player);
      this.player = player;
      this.drivers.set(player, new AIDriver(player)); // takes over after the finish line
      this.addHeadlights(player);
    }

    // Starting grid: two columns behind the start line.
    this.racers.forEach((r, i) => {
      const row = Math.floor(i / 2);
      const lateral = i % 2 === 0 ? -3.4 : 3.4;
      r.car.placeOnTrack(track.length - 9 - row * 8 - (i % 2) * 2, lateral);
      r.lastAlong = r.car.trackAlong;
      this.group.add(r.car.object);
      this.inputs.set(r, NEUTRAL_INPUT);
    });

    this.combat = new Combat(track, this.racers, effects, sound, {
      onWreck: (victim, killer) => {
        const text = killer ? `${killer.name} wrecked ${victim.name}` : `${victim.name} wrecked`;
        this.onMessage({ text, banner: false });
        if (!config.respawn && !victim.finished) {
          this.outOrder.push(victim);
          if (victim.isPlayer && this.finishDelay < 0) {
            // Race over for the player: let the explosion play, then show the results.
            this.onMessage({ text: 'WRECKED!', banner: true });
            this.finishDelay = 3.5;
          }
        } else if (victim.isPlayer) {
          this.onMessage({ text: 'WRECKED!', banner: true });
        }
      },
    });
    this.pickups = new Pickups(track, effects, sound);
    this.effects.onExplosion = (pos, scale) => {
      const f = this.focus.car.physics;
      const d = Math.hypot(pos.x - f.x, pos.z - f.z);
      if (d < 40) this.onShake(scale * 0.9 * (1 - d / 40));
    };
    this.group.add(this.combat.group, this.pickups.group);

    if (!config.withPlayer) {
      // Attract mode starts already racing.
      this.phase = 'racing';
      this.countdown = 0;
    }
  }

  private addHeadlights(r: Racer): void {
    const light = new THREE.SpotLight(0xfff0d0, 60, 40, 0.55, 0.6, 1.5);
    light.position.set(0, 0.8, 2.0);
    light.target.position.set(0, 0, 14);
    r.car.object.add(light, light.target);
  }

  /** The car the camera should follow. */
  get focus(): Racer {
    if (this.player) return this.player;
    return [...this.racers].sort((a, b) => a.rank - b.rank)[0];
  }

  // ---------------------------------------------------------------------------
  // Simulation (fixed step)
  // ---------------------------------------------------------------------------

  step(dt: number, input: Input | null, playerInput: DriveInput): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const whole = Math.ceil(this.countdown - 0.5);
      if (whole < this.lastCountdownBeep && whole >= 0) {
        this.lastCountdownBeep = whole;
        this.sound.countdownBeep(whole === 0);
        this.onMessage({ text: whole === 0 ? 'GO!' : String(whole), banner: true });
      }
      if (this.countdown <= 0.5) this.phase = 'racing';
    }
    const racing = this.phase !== 'countdown';
    if (racing) this.raceTime += dt;

    const world = {
      track: this.track,
      racers: this.racers,
      mines: this.combat.mines,
      pickups: this.pickups.items,
      player: this.player,
    };

    for (const r of this.racers) {
      let cmd: DriveInput;
      if (!racing || r.destroyed) {
        cmd = NEUTRAL_INPUT;
      } else if (r.isPlayer && !r.finished && input) {
        cmd = playerInput;
      } else {
        cmd = this.drivers.get(r)!.think(world, dt);
      }
      // Turbo fuel.
      let boost = cmd.boost && r.turbo > 0 && cmd.throttle > 0;
      if (boost) r.turbo = Math.max(0, r.turbo - TURBO_DRAIN * dt);
      else r.turbo = Math.min(MAX_TURBO, r.turbo + (r.isPlayer ? 0 : 2) * dt);
      if (r.turbo <= 0) boost = false;
      if (boost !== cmd.boost) cmd = { ...cmd, boost };
      this.inputs.set(r, cmd);

      r.car.step(cmd, dt);

      const armed = this.raceTime > WEAPONS_FREE_AFTER || !this.config.withPlayer;
      if (cmd.fire && armed) this.combat.tryFire(r, r.isPlayer && !r.finished ? 0 : this.drivers.get(r)!.spread);
      if (cmd.dropMine && armed) this.combat.tryDropMine(r);

      if (r.destroyed && this.config.respawn) {
        r.respawnTimer -= dt;
        if (r.respawnTimer <= 0) {
          r.car.resetToTrack();
          r.repair();
        }
      }
      // A burnt-out wreck stays on the track as an obstacle but no longer races.
      if (!this.isOut(r)) this.updateLaps(r);
    }

    this.resolveCarCollisions();
    this.combat.update(dt);
    this.pickups.update(dt, this.racers);
    this.updateStandings();
    this.updateWrongWay(dt);

    if (this.finishDelay > 0) {
      this.finishDelay -= dt;
      if (this.finishDelay <= 0) {
        this.phase = 'finished';
        this.onFinish(this.results());
      }
    }
  }

  private updateLaps(r: Racer): void {
    const L = this.track.length;
    const a = r.car.trackAlong;
    if (a > L * 0.45 && a < L * 0.55) r.passedHalfway = true;
    const crossedForward = r.lastAlong > L * 0.9 && a < L * 0.1;
    r.lastAlong = a;
    if (!crossedForward) return;

    if (!r.started) {
      r.started = true;
      r.lapStart = this.raceTime;
    } else if (r.passedHalfway) {
      const lapTime = this.raceTime - r.lapStart;
      r.lapStart = this.raceTime;
      if (r.bestLap === null || lapTime < r.bestLap) r.bestLap = lapTime;
      r.lapsDone++;
      if (this.config.withPlayer && r.lapsDone >= this.config.laps && !r.finished) {
        r.finished = true;
        r.finishTime = this.raceTime;
        if (r.isPlayer) {
          this.onMessage({ text: 'FINISH!', banner: true });
          this.finishDelay = 2.5;
        }
      } else if (r.isPlayer && r.lapsDone === this.config.laps - 1) {
        this.onMessage({ text: 'FINAL LAP', banner: true });
      }
    }
    r.passedHalfway = false;
  }

  /** Each car is two circles; overlapping circles push apart and exchange momentum. */
  private resolveCarCollisions(): void {
    const list = this.racers;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].car.physics;
        const b = list[j].car.physics;
        if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > 36) continue;
        const [afx, afz] = a.forward();
        const [bfx, bfz] = b.forward();
        for (const oa of [CAR_CIRCLE_OFFSET, -CAR_CIRCLE_OFFSET]) {
          for (const ob of [CAR_CIRCLE_OFFSET, -CAR_CIRCLE_OFFSET]) {
            const ax = a.x + afx * oa;
            const az = a.z + afz * oa;
            const bx = b.x + bfx * ob;
            const bz = b.z + bfz * ob;
            const dx = ax - bx;
            const dz = az - bz;
            const d = Math.hypot(dx, dz);
            if (d >= CAR_RADIUS * 2 || d < 1e-4) continue;
            const nx = dx / d;
            const nz = dz / d;
            const pen = (CAR_RADIUS * 2 - d) / 2;
            a.x += nx * pen;
            a.z += nz * pen;
            b.x -= nx * pen;
            b.z -= nz * pen;
            const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
            if (vrel >= 0) continue;
            const jImpulse = (-(1 + 0.3) * vrel) / 2;
            // Off-center hits spin the cars a little.
            const spin = THREE.MathUtils.clamp(jImpulse * 0.05, 0, 1) * Math.sign(oa) ;
            a.applyImpulse(nx * jImpulse, nz * jImpulse, spin * (afx * nz - afz * nx));
            b.applyImpulse(-nx * jImpulse, -nz * jImpulse, -spin * (bfx * nz - bfz * nx));
            const strength = -vrel;
            this.combat.impactDamage(list[i], strength, list[j]);
            this.combat.impactDamage(list[j], strength, list[i]);
            if (strength > 4) {
              this.effects.sparksBurst(this.tmp.set((ax + bx) / 2, 0.6, (az + bz) / 2), Math.min(20, Math.floor(strength)));
              if (list[i].isPlayer || list[j].isPlayer) this.sound.impact(strength);
            }
          }
        }
      }
    }
  }

  /** True when the racer was wrecked and will not come back. */
  isOut(r: Racer): boolean {
    return this.outOrder.includes(r);
  }

  /** Finishers by time, then cars still running by progress, then wrecks (last wrecked ranks highest). */
  private ordered(): Racer[] {
    const L = this.track.length;
    const out = [...this.outOrder].reverse();
    const running = this.racers.filter((r) => !r.finished && !this.isOut(r)).sort((a, b) => b.progress(L) - a.progress(L));
    const finished = this.racers.filter((r) => r.finished && !this.isOut(r)).sort((a, b) => a.finishTime - b.finishTime);
    return [...finished, ...running, ...out];
  }

  private updateStandings(): void {
    this.ordered().forEach((r, i) => (r.rank = i + 1));
  }

  private updateWrongWay(dt: number): void {
    const p = this.player;
    if (!p || p.destroyed || this.phase !== 'racing') return;
    const s = this.track.samples[p.car.trackIndex];
    if (!s) return;
    const ph = p.car.physics;
    const dot = ph.vx * s.tx + ph.vz * s.tz;
    this.wrongWayTime = dot < -3 ? this.wrongWayTime + dt : 0;
    if (this.wrongWayTime > 1.2) {
      this.wrongWayTime = -2; // repeat at most every few seconds
      this.onMessage({ text: 'WRONG WAY', banner: true });
    }
  }

  results(): RaceResult[] {
    return this.ordered().map((r, i) => ({
      rank: i + 1,
      name: r.name,
      isPlayer: r.isPlayer,
      color: r.profile.color,
      time: r.finished ? r.finishTime : this.isOut(r) ? null : this.estimateFinish(r),
      estimated: !r.finished && !this.isOut(r),
      bestLap: r.bestLap,
      kills: r.kills,
      wrecks: r.wrecks,
      wrecked: this.isOut(r),
    }));
  }

  /** Projects a finish time for cars still racing from their average pace. */
  private estimateFinish(r: Racer): number | null {
    const L = this.track.length;
    const done = r.progress(L);
    if (done <= 0 || this.raceTime <= 0) return null;
    return (this.raceTime * (this.config.laps * L)) / done;
  }

  /** Current lap number (1-based) for the HUD. */
  playerLap(): number {
    const p = this.player;
    if (!p) return 0;
    return Math.min(this.config.laps, Math.max(1, p.lapsDone + 1));
  }

  // ---------------------------------------------------------------------------
  // Per-frame visuals
  // ---------------------------------------------------------------------------

  syncVisuals(dt: number, time: number): void {
    this.racers.forEach((r, idx) => {
      const car = r.car;
      car.syncVisual(dt);
      r.updateDamageVisual();
      const cmd = this.inputs.get(r) ?? NEUTRAL_INPUT;

      // Spawn protection blink.
      car.object.visible = r.invulnerable > 0 ? Math.sin(time * 30) > 0 : true;

      const v = this.tmp2.set(car.physics.vx, 0, car.physics.vz);
      const skidding = !r.destroyed && car.isSkidding(cmd);
      const gravel = car.onGravel && car.physics.speed > 4;
      car.rearWheelWorld(this.wheelPoints);
      this.wheelPoints.forEach((pt, w) => {
        this.effects.skids.update(`${idx}-${w}`, pt, skidding && !car.onGravel);
        const chance = skidding ? 0.8 : gravel ? 0.5 : 0;
        if (Math.random() < chance) this.effects.tireSmoke(pt, v, gravel);
      });

      this.effects.damageSmoke(r.worldPoint(car.visual.engineOffset, this.tmp), r.destroyed ? 5 : r.health, dt);

      if (cmd.boost && !r.destroyed) {
        const [fx, fz] = car.physics.forward();
        const back = new THREE.Vector3(-fx, 0, -fz);
        for (const e of car.visual.exhaustOffsets) this.effects.boostFlame(r.worldPoint(e, this.tmp), back);
      }
    });

    const p = this.player;
    if (p) {
      const cmd = this.inputs.get(p) ?? NEUTRAL_INPUT;
      const ratio = Math.min(1, Math.abs(p.car.physics.forwardSpeed) / p.car.physics.spec.maxSpeed);
      const skidding = !p.destroyed && p.car.isSkidding(cmd) && !p.car.onGravel;
      this.sound.updateEngine(ratio, p.destroyed ? 0 : cmd.throttle, cmd.boost, skidding);
    }
  }

  dispose(): void {
    this.combat.dispose();
    this.pickups.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.sound.stopEngine();
  }
}
