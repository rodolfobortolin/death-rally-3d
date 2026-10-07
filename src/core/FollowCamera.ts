import * as THREE from 'three';
import { clamp, damp } from './math';

export type CameraMode = 'classic' | 'chase' | 'cinematic';

/**
 * Top-down camera. "classic" keeps a fixed north-up orientation like the original
 * Death Rally; "chase" rotates with the car while still looking down steeply.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'classic';
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private yaw = 0;
  private height = 48;
  private shake = 0;
  private orbit = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 1, 2000);
  }

  toggleMode(): void {
    this.mode = this.mode === 'classic' ? 'chase' : 'classic';
  }

  /** Adds screen shake (explosions, hard hits); decays automatically. */
  addShake(amount: number): void {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  snapTo(x: number, y: number, z: number, heading: number): void {
    this.focus.set(x, y, z);
    this.yaw = heading;
    this.update(x, y, z, heading, 0, 0, 1);
  }

  update(x: number, y: number, z: number, heading: number, vx: number, vz: number, dt: number): void {
    const speed = Math.hypot(vx, vz);
    // Look ahead in the direction of travel so the player sees what is coming.
    const lead = clamp(speed * 0.35, 0, 14);
    const lx = speed > 0.1 ? (vx / speed) * lead : 0;
    const lz = speed > 0.1 ? (vz / speed) * lead : 0;
    this.desired.set(x + lx, y, z + lz);
    this.focus.lerp(this.desired, dt === 1 ? 1 : damp(4.5, dt));

    // Zoom out a little at speed.
    const targetHeight = 46 + clamp(speed, 0, 45) * 0.35;
    this.height += (targetHeight - this.height) * damp(1.5, dt);

    let offX = 0;
    let offZ = this.height * 0.42;
    let height = this.height;
    if (this.mode === 'cinematic') {
      // Slow orbit for the menu background.
      this.orbit += dt * 0.12;
      height = 26;
      offX = Math.sin(this.orbit) * 42;
      offZ = Math.cos(this.orbit) * 42;
    } else if (this.mode === 'chase') {
      let diff = heading - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * damp(2.5, dt);
      offX = -Math.sin(this.yaw) * this.height * 0.42;
      offZ = -Math.cos(this.yaw) * this.height * 0.42;
    } else {
      this.yaw = heading;
    }
    this.camera.position.set(this.focus.x + offX, this.focus.y + height, this.focus.z + offZ);
    this.camera.lookAt(this.focus);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 1.6;
      this.camera.position.z += (Math.random() - 0.5) * s * 1.6;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.03;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
  }

  /** Shifts the image so the car is centered in the area right of a left sidebar. */
  setLeftInset(px: number, width: number, height: number): void {
    if (px > 0) this.camera.setViewOffset(width, height, -px / 2, 0, width, height);
    else this.camera.clearViewOffset();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
