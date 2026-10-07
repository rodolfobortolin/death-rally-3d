import type { DriveInput } from '../core/Input';
import { clamp, damp } from '../core/math';

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
  /** Grip while the handbrake is pulled. */
  handbrakeGrip: number;
}

export const DEFAULT_CAR_SPEC: CarSpec = {
  maxSpeed: 42,
  acceleration: 20,
  brakeDeceleration: 32,
  maxReverseSpeed: 12,
  steering: 2.5,
  grip: 8.5,
  handbrakeGrip: 1.4,
};

/** Stronger than real gravity, so jumps stay short and slopes are felt at arcade speeds. */
export const GRAVITY = 26;

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
  /** Slope of the ground in the direction the car points (rise per meter). */
  grade = 0;
  /** Wheels off the ground: no drive, brakes, steering or grip until it lands. */
  airborne = false;

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
    this.vx = this.vz = this.yawRate = this.steerAngle = 0;
    this.grade = 0;
    this.airborne = false;
  }

  step(input: DriveInput, dt: number): void {
    const s = this.spec;
    const [fx, fz] = this.forward();
    const [rx, rz] = this.right();
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    if (this.airborne) {
      // Ballistic: momentum carries the car and it keeps whatever spin it took off with.
      this.isBraking = false;
      this.steerAngle += (input.steer - this.steerAngle) * damp(12, dt);
      this.yawRate *= Math.exp(-0.8 * dt);
      this.heading += this.yawRate * dt;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.slip = vR;
      this.forwardSpeed = vF;
      return;
    }

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
      vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt);
      this.isBraking = true;
    }
    // Rolling resistance plus extra drag on gravel; coasting slowly bleeds speed.
    const drag = 0.12 + this.surfaceDrag * 1.6 + (input.throttle === 0 && input.brake === 0 ? 0.25 : 0);
    vF -= vF * drag * dt;
    // Climbing costs speed, descending gives it back.
    vF -= GRAVITY * this.grade * dt;
    if (input.throttle === 0 && input.brake === 0 && Math.abs(vF) < 0.3) vF = 0;

    // Lateral: tires bleed sideways velocity; less grip when sliding or handbraking.
    const sliding = Math.abs(vR) > 5;
    const grip = input.handbrake ? s.handbrakeGrip : sliding ? s.grip * 0.7 : s.grip;
    vR *= Math.exp(-grip * dt);

    // Steering: yaw rate scales with speed and fades at very high speed.
    const absF = Math.abs(vF);
    const speedFactor = clamp(absF / 7, 0, 1) * (1 - 0.35 * clamp(absF / s.maxSpeed, 0, 1));
    this.steerAngle += (input.steer - this.steerAngle) * damp(12, dt);
    const direction = vF >= 0 ? 1 : -1;
    const handbrakeBoost = input.handbrake ? 1.45 : 1;
    // Positive steer (right) turns clockwise seen from above, which lowers the heading here.
    const targetYaw = -this.steerAngle * s.steering * speedFactor * direction * handbrakeBoost;
    this.yawRate += (targetYaw - this.yawRate) * damp(input.handbrake ? 5 : 9, dt);
    this.heading += this.yawRate * dt;

    // Rebuild the world velocity from the new heading so grip turns momentum.
    const [nfx, nfz] = this.forward();
    const [nrx, nrz] = this.right();
    this.vx = nfx * vF + nrx * vR;
    this.vz = nfz * vF + nrz * vR;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.slip = vR;
    this.forwardSpeed = vF;
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
