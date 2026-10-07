import type { DriveInput } from '../core/Input';
import { clamp, damp, lerp } from '../core/math';

/** Tunable handling parameters. Upgrades in the shop will modify these. */
export interface CarSpec {
  /** Top speed in m/s. */
  maxSpeed: number;
  /** Acceleration from standstill in m/s². */
  acceleration: number;
  brakeDeceleration: number;
  maxReverseSpeed: number;
  /** Max yaw rate in rad/s. */
  steering: number;
  /** How quickly sideways velocity is killed (higher = more grip). */
  grip: number;
  /** Sideways grip at full drift (handbrake pulled). */
  handbrakeGrip: number;
}

export const DEFAULT_CAR_SPEC: CarSpec = {
  maxSpeed: 42,
  acceleration: 20,
  brakeDeceleration: 32,
  maxReverseSpeed: 12,
  steering: 2.5,
  grip: 8.5,
  handbrakeGrip: 2.0,
};

/**
 * Arcade top-down car physics in the XZ plane. Heading 0 faces +Z.
 * Forward = (sin h, cos h), right = (-cos h, sin h) for a top-down view where
 * the driver's right is screen-left when driving towards +Z.
 */
export class CarPhysics {
  x = 0;
  z = 0;
  heading = 0;
  vx = 0;
  vz = 0;
  yawRate = 0;
  steerAngle = 0;
  /** Sideways speed in m/s, positive when sliding to the right. */
  slip = 0;
  forwardSpeed = 0;
  isBraking = false;
  /** Multiplier for drag and top speed when driving on gravel. */
  surfaceDrag = 0;
  /** 0..1: how much rear traction is broken. Rises with the handbrake, fades after release. */
  drift = 0;
  private handbrakeWasDown = false;

  constructor(public spec: CarSpec = DEFAULT_CAR_SPEC) {}

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  forward(): [number, number] {
    return [Math.sin(this.heading), Math.cos(this.heading)];
  }

  right(): [number, number] {
    return [-Math.cos(this.heading), Math.sin(this.heading)];
  }

  reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = this.yawRate = this.steerAngle = this.drift = 0;
  }

  step(input: DriveInput, dt: number): void {
    const s = this.spec;
    const [fx, fz] = this.forward();
    const [rx, rz] = this.right();
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // Longitudinal: throttle, brake and reverse. Turbo raises both power and top speed.
    const boosting = input.boost && input.throttle > 0;
    const maxSpeed = s.maxSpeed * (1 - this.surfaceDrag * 0.45) * (boosting ? 1.3 : 1);
    const acceleration = s.acceleration * (boosting ? 1.9 : 1);
    this.isBraking = false;
    if (input.throttle > 0) {
      if (vF < -0.5) {
        vF += s.brakeDeceleration * input.throttle * dt;
        this.isBraking = true;
      } else {
        const ratio = clamp(vF / maxSpeed, 0, 1);
        vF += acceleration * input.throttle * (1 - ratio * ratio) * dt;
      }
    }
    if (input.brake > 0) {
      if (vF > 0.5) {
        vF = Math.max(0, vF - s.brakeDeceleration * input.brake * dt);
        this.isBraking = true;
      } else {
        vF = Math.max(-s.maxReverseSpeed, vF - s.acceleration * 0.6 * input.brake * dt);
      }
    }
    if (input.handbrake) {
      // Locked rear wheels scrub speed, but gently enough to carry momentum through a drift.
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), (Math.abs(vF) > 8 ? 5 : 14) * dt);
      this.isBraking = true;
    }
    // Rolling resistance plus extra drag on gravel; coasting slowly bleeds speed.
    const drag = 0.12 + this.surfaceDrag * 1.6 + (input.throttle === 0 && input.brake === 0 ? 0.25 : 0);
    vF -= vF * drag * dt;
    if (input.throttle === 0 && input.brake === 0 && Math.abs(vF) < 0.3) vF = 0;

    // Drift: the handbrake breaks rear traction. After release, keeping the throttle on
    // while still sideways holds a power slide; otherwise grip comes back quickly.
    const absF = Math.abs(vF);
    const speed = Math.hypot(vF, vR);
    const powerSlide = input.throttle > 0 && Math.abs(vR) > 4;
    if (input.handbrake && speed > 6) this.drift = Math.min(1, this.drift + 8 * dt);
    else this.drift = Math.max(0, this.drift - (powerSlide ? 1.2 : 3.5) * dt);
    if (input.handbrake && !this.handbrakeWasDown && absF > 8 && input.steer !== 0) {
      // Flick: the rear steps out towards the outside of the corner straight away.
      this.yawRate -= input.steer * 0.6 * Math.sign(vF);
    }
    this.handbrakeWasDown = input.handbrake;

    // Lateral: tires bleed sideways velocity; much less while drifting.
    const sliding = Math.abs(vR) > 5;
    let grip = lerp(sliding ? s.grip * 0.7 : s.grip, s.handbrakeGrip, this.drift);
    // Stability assist: past ~55 degrees of slip the tires bite again so the car doesn't spin out.
    const slipAngle = Math.atan2(Math.abs(vR), Math.max(1, absF));
    if (slipAngle > 0.95) grip += (slipAngle - 0.95) * 14;
    const lateralBefore = Math.abs(vR);
    vR *= Math.exp(-grip * dt);
    // Sideways momentum scrubbed off during a drift partly pushes the car forward,
    // so a well-timed slide exits with speed instead of stalling.
    if (this.drift > 0 && vF > 0) {
      vF = Math.min(maxSpeed, vF + (lateralBefore - Math.abs(vR)) * 0.6 * this.drift);
    }

    // Steering: yaw rate scales with speed and fades at very high speed (less so when drifting).
    const speedFactor = clamp(absF / 7, 0, 1) * (1 - 0.35 * (1 - this.drift) * clamp(absF / s.maxSpeed, 0, 1));
    this.steerAngle += (input.steer - this.steerAngle) * damp(12, dt);
    const direction = vF >= 0 ? 1 : -1;
    // Drifting rotates the car much harder; countersteering pulls the yaw back to hold the angle.
    const driftRotation = 1 + 0.8 * this.drift;
    // Positive steer (right) turns clockwise seen from above, which lowers the heading here.
    let targetYaw = -this.steerAngle * s.steering * speedFactor * direction * driftRotation;
    // Self-aligning: the sliding rear pulls the nose back towards the direction of travel.
    targetYaw -= (vR / Math.max(4, speed)) * 2.5 * this.drift;
    this.yawRate += (targetYaw - this.yawRate) * damp(lerp(9, 3.5, this.drift), dt);
    const turn = this.yawRate * dt;
    this.heading += turn;

    // Rebuild the world velocity. With full grip the momentum turns with the car; while
    // drifting the body rotates ahead of its momentum and the difference becomes slip.
    const carried = this.heading - turn * 0.5 * this.drift;
    const cfx = Math.sin(carried);
    const cfz = Math.cos(carried);
    this.vx = cfx * vF - cfz * vR;
    this.vz = cfz * vF + cfx * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const [nfx, nfz] = this.forward();
    const [nrx, nrz] = this.right();
    this.forwardSpeed = this.vx * nfx + this.vz * nfz;
    this.slip = this.vx * nrx + this.vz * nrz;
  }

  /** Adds an instantaneous velocity change (explosions, car-to-car hits). */
  applyImpulse(dvx: number, dvz: number, spin = 0): void {
    this.vx += dvx;
    this.vz += dvz;
    this.yawRate += spin;
  }

  /**
   * Resolves a collision against a wall plane. `nx, nz` is the wall normal pointing
   * back into the track and `penetration` how deep the car went. Returns impact speed.
   */
  collideWall(nx: number, nz: number, penetration: number): number {
    this.x += nx * penetration;
    this.z += nz * penetration;
    const vn = this.vx * nx + this.vz * nz;
    if (vn >= 0) return 0;
    const restitution = 0.25;
    this.vx -= (1 + restitution) * vn * nx;
    this.vz -= (1 + restitution) * vn * nz;
    // Scrape: lose some tangential speed and get a small spin away from the wall.
    const scrape = clamp(1 - Math.abs(vn) * 0.02, 0.6, 0.98);
    this.vx *= scrape;
    this.vz *= scrape;
    const [fx, fz] = this.forward();
    const towardWall = -(fx * nx + fz * nz);
    this.yawRate += clamp(vn * 0.04, -1.5, 1.5) * Math.sign(fx * nz - fz * nx) * towardWall;
    return -vn;
  }
}
