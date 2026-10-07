import * as THREE from 'three';
import type { DriveInput } from '../core/Input';
import type { Track } from '../world/Track';
import { CarDamage } from './CarDamage';
import { CAR_DIMENSIONS, createCarModel, type CarModelOptions, type CarVisual } from './CarModel';
import { CarPhysics, DEFAULT_CAR_SPEC, type CarSpec } from './CarPhysics';

export interface CarEvents {
  /** Called when the car hits a barrier hard enough to throw sparks. */
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
    this.damage = new CarDamage(this.visual, Math.floor(Math.random() * 1e9));
  }

  get object(): THREE.Group {
    return this.visual.root;
  }

  placeOnTrack(along: number, lateral: number): void {
    const p = this.track.pointAt(along, lateral);
    this.physics.reset(p.x, p.z, p.heading);
    this.trackIndex = -1;
    this.syncVisual(0);
  }

  /** Puts the car back on the centerline at its current track position. */
  resetToTrack(): void {
    this.placeOnTrack(this.trackAlong, 0);
  }

  step(input: DriveInput, dt: number): void {
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

    this.resolveBarriers();
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
      if (q.lateral > wall) {
        pen = q.lateral - wall;
        sign = -1;
      } else if (q.lateral < -wall) {
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
      if (impact > 2) this.events.onImpact?.(hitX, 0.6, hitZ, impact);
    }
  }

  /** Updates the visual model from the physics state (call once per rendered frame). */
  syncVisual(dt: number): void {
    const p = this.physics;
    const v = this.visual;
    v.root.position.set(p.x, 0, p.z);
    v.root.rotation.y = p.heading;

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
    return (
      (Math.abs(p.slip) > 3.5 && speed > 6) ||
      (input.handbrake && speed > 5) ||
      (p.isBraking && input.brake > 0 && p.forwardSpeed > 14)
    );
  }

  get position(): THREE.Vector3 {
    return this.tmp.set(this.physics.x, 0, this.physics.z);
  }
}
