import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { Track, TrackQuery } from '../world/Track';
import { CarDamage } from './CarDamage';
import { CAR_DIMENSIONS, createCarModel, type CarModelOptions, type CarVisual } from './CarModel';
import { CarPhysics, DEFAULT_CAR_SPEC, GRAVITY, type CarSpec } from './CarPhysics';

/** Extra speed (m/s) the ground must drop away by before the wheels leave it; filters out tiny hops. */
const TAKEOFF_MARGIN = 0.3;

export interface CarEvents {
  /** Called when the car hits a barrier, or lands, hard enough to throw sparks. */
  onImpact?: (x: number, y: number, z: number, strength: number) => void;
}

/** A car in the world: physics state + visual model + track interaction. */
export class Car {
  readonly physics: CarPhysics;
  readonly visual: CarVisual;
  readonly damage: CarDamage;
  trackIndex = -1;
  trackLateral = 0;
  trackAlong = 0;
  onGravel = false;
  /** Height of the tires' contact point. */
  y = 0;
  /** True from landing at the bottom of a cliff until the car is put back on the track. */
  fallen = false;
  private vy = 0;
  /** Height of the road deck beside the car, to tell when it has dropped below it. */
  private deckY = 0;
  private pitch = 0;
  private wheelSpin = 0;
  private bodyRoll = 0;
  private bodyPitch = 0;
  private lastForwardSpeed = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly track: Track,
    model: CarModelOptions,
    spec: CarSpec = DEFAULT_CAR_SPEC,
    private readonly events: CarEvents = {},
  ) {
    this.physics = new CarPhysics({ ...spec });
    this.visual = createCarModel(model);
    this.visual.root.rotation.order = 'YXZ'; // heading first, then pitch in the car's own frame
    this.damage = new CarDamage(this.visual, Math.floor(Math.random() * 1e9));
  }

  get object(): THREE.Group {
    return this.visual.root;
  }

  placeOnTrack(along: number, lateral: number): void {
    const p = this.track.pointAt(along, lateral);
    this.physics.reset(p.x, p.z, p.heading);
    this.y = this.deckY = p.y;
    this.vy = 0;
    this.fallen = false;
    this.trackIndex = this.track.indexAt(along);
    this.syncVisual(0);
  }

  /** Puts the car back on the centerline at its current track position. */
  resetToTrack(): void {
    this.placeOnTrack(this.trackAlong, 0);
  }

  step(input: DriveInput, dt: number): void {
    if (this.fallen) return; // lies where it landed until the race puts it back
    const p = this.physics;
    this.lastForwardSpeed = p.forwardSpeed;
    p.step(input, dt);

    const q = this.track.query(p.x, p.z, this.trackIndex);
    this.trackIndex = q.index;
    this.trackLateral = q.lateral;
    this.trackAlong = q.along;
    const { roadHalfWidth, curbWidth } = this.track.def;
    this.onGravel = Math.abs(q.lateral) > roadHalfWidth + curbWidth * 0.6;
    p.surfaceDrag = this.onGravel ? 1 : 0;

    this.updateHeight(q, dt);
    // A car that has dropped below the deck is past the barriers.
    if (this.deckY - this.y < 1) this.resolveBarriers();
  }

  /** Follows the ground, takes off where it drops away and lands again. */
  private updateHeight(q: TrackQuery, dt: number): void {
    const p = this.physics;
    const s = q.sample;
    const [fx, fz] = p.forward();
    this.deckY = s.y;
    p.grade = q.overEdge ? 0 : q.grade * (fx * s.tx + fz * s.tz);
    if (!p.airborne) {
      // Vertical speed that keeps the wheels on the ground. When the ground falls away
      // faster than gravity can pull the car down, the car flies.
      const follow = (q.y - this.y) / dt;
      if (follow < this.vy - GRAVITY * dt - TAKEOFF_MARGIN) {
        p.airborne = true;
      } else {
        this.vy = follow;
        this.y = q.y;
      }
    }
    if (p.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= q.y) {
        // How fast the ground itself rises or falls under the moving car.
        const groundVy = q.overEdge ? 0 : q.grade * (p.vx * s.tx + p.vz * s.tz);
        const impact = groundVy - this.vy;
        this.y = q.y;
        this.vy = groundVy;
        p.airborne = false;
        this.fallen = q.overEdge;
        if (impact > 4) this.events.onImpact?.(p.x, this.y + 0.3, p.z, impact);
      }
    }
  }

  /** Checks each corner of the car against both barriers and pushes it back. */
  private resolveBarriers(): void {
    const p = this.physics;
    const wall = this.track.def.wallOffset;
    const [fx, fz] = p.forward();
    const [rx, rz] = p.right();
    const hl = CAR_DIMENSIONS.length / 2;
    const hw = CAR_DIMENSIONS.width / 2;
    let worst = 0;
    let nx = 0;
    let nz = 0;
    let hitX = 0;
    let hitZ = 0;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]]) {
      const cx = p.x + fx * a + rx * b;
      const cz = p.z + fz * a + rz * b;
      const q = this.track.query(cx, cz, this.trackIndex);
      const s = q.sample;
      let pen = 0;
      let sign = 0;
      if (q.lateral > wall && !s.cliffRight) {
        pen = q.lateral - wall;
        sign = -1;
      } else if (q.lateral < -wall && !s.cliffLeft) {
        pen = -wall - q.lateral;
        sign = 1;
      }
      if (pen > worst) {
        worst = pen;
        nx = s.rx * sign;
        nz = s.rz * sign;
        hitX = cx;
        hitZ = cz;
      }
    }
    if (worst > 0) {
      const impact = p.collideWall(nx, nz, worst);
      if (impact > 2) this.events.onImpact?.(hitX, this.y + 0.6, hitZ, impact);
    }
  }

  /** Updates the visual model from the physics state (call once per rendered frame). */
  syncVisual(dt: number): void {
    const p = this.physics;
    const v = this.visual;
    v.root.position.set(p.x, this.y, p.z);
    // Nose follows the slope on the ground and the flight path in the air.
    const targetPitch = p.airborne ? -Math.atan2(this.vy, Math.max(8, p.speed)) * 0.6 : -Math.atan(p.grade);
    this.pitch = dt > 0 ? this.pitch + (targetPitch - this.pitch) * Math.min(1, dt * 12) : targetPitch;
    v.root.rotation.set(this.pitch, p.heading, 0);

    this.wheelSpin += (p.forwardSpeed / v.wheelRadius) * dt;
    for (const wheel of v.wheels) wheel.rotation.x = this.wheelSpin;
    for (const pivot of v.frontWheelPivots) pivot.rotation.y = -p.steerAngle * 0.5;

    // Fake suspension: body leans against cornering and pitches under acceleration.
    if (dt > 0) {
      const accel = (p.forwardSpeed - this.lastForwardSpeed) / Math.max(dt, 1e-3);
      const targetRoll = THREE.MathUtils.clamp(p.yawRate * p.forwardSpeed * 0.004, -0.07, 0.07);
      const targetPitch = THREE.MathUtils.clamp(-accel * 0.002, -0.05, 0.05);
      this.bodyRoll += (targetRoll - this.bodyRoll) * Math.min(1, dt * 8);
      this.bodyPitch += (targetPitch - this.bodyPitch) * Math.min(1, dt * 6);
    }
    const body = v.body;
    body.rotation.z = this.bodyRoll;
    body.rotation.x = this.bodyPitch;

    v.brakeLightMaterial.emissiveIntensity = p.isBraking ? 6 : 0.8;
  }

  /** World positions of the rear tire contact patches. */
  rearWheelWorld(out: THREE.Vector3[]): THREE.Vector3[] {
    this.visual.root.updateMatrixWorld();
    this.visual.rearWheelOffsets.forEach((o, i) => {
      out[i] = (out[i] ?? new THREE.Vector3()).copy(o).applyMatrix4(this.visual.root.matrixWorld);
    });
    return out;
  }

  /** True when the tires are sliding enough to leave marks and smoke. */
  isSkidding(input: DriveInput): boolean {
    const p = this.physics;
    const speed = p.speed;
    if (p.airborne) return false;
    return (
      (Math.abs(p.slip) > 3.5 && speed > 6) ||
      (input.handbrake && speed > 5) ||
      (p.isBraking && input.brake > 0 && p.forwardSpeed > 14)
    );
  }

  get position(): THREE.Vector3 {
    return this.tmp.set(this.physics.x, this.y, this.physics.z);
  }
}
