import * as THREE from 'three';
import { clamp, damp } from './math';

export type CameraMode = 'classic' | 'chase';

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

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 1, 2000);
  }

  toggleMode(): void {
    this.mode = this.mode === 'classic' ? 'chase' : 'classic';
  }

  snapTo(x: number, z: number, heading: number): void {
    this.focus.set(x, 0, z);
    this.yaw = heading;
    this.update(x, z, heading, 0, 0, 1);
  }

  update(x: number, z: number, heading: number, vx: number, vz: number, dt: number): void {
    const speed = Math.hypot(vx, vz);
    // Look ahead in the direction of travel so the player sees what is coming.
    const lead = clamp(speed * 0.35, 0, 14);
    const lx = speed > 0.1 ? (vx / speed) * lead : 0;
    const lz = speed > 0.1 ? (vz / speed) * lead : 0;
    this.desired.set(x + lx, 0, z + lz);
    this.focus.lerp(this.desired, dt === 1 ? 1 : damp(4.5, dt));

    // Zoom out a little at speed.
    const targetHeight = 46 + clamp(speed, 0, 45) * 0.35;
    this.height += (targetHeight - this.height) * damp(1.5, dt);

    let offX = 0;
    let offZ = this.height * 0.42;
    if (this.mode === 'chase') {
      let diff = heading - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * damp(2.5, dt);
      offX = -Math.sin(this.yaw) * this.height * 0.42;
      offZ = -Math.cos(this.yaw) * this.height * 0.42;
    } else {
      this.yaw = heading;
    }
    this.camera.position.set(this.focus.x + offX, this.height, this.focus.z + offZ);
    this.camera.lookAt(this.focus);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
