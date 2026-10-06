import * as THREE from 'three';
import { Car } from '../car/Car';
import { ParticleSystem } from '../fx/Particles';
import { SkidMarks } from '../fx/SkidMarks';
import { Hud } from '../ui/Hud';
import { Environment } from '../world/Environment';
import { createSoftParticleTexture } from '../world/textures';
import { Track } from '../world/Track';
import { FollowCamera } from './FollowCamera';
import { Input, type DriveInput } from './Input';
import { Renderer } from './Renderer';

const PHYSICS_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;

/** Owns the scene and runs the main loop: fixed-step physics, variable-rate rendering. */
export class Game {
  private readonly scene = new THREE.Scene();
  private readonly input = new Input();
  private readonly cameraRig: FollowCamera;
  private readonly renderer: Renderer;
  private readonly track: Track;
  private readonly environment: Environment;
  private readonly player: Car;
  private readonly skids = new SkidMarks();
  private readonly smoke: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly hud = new Hud();
  private readonly timer = new THREE.Timer();
  private accumulator = 0;
  private elapsed = 0;
  private lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private readonly wheelPoints: THREE.Vector3[] = [];

  // Lap timing: a lap counts only after passing the halfway point.
  private lapStart = 0;
  private bestLap: number | null = null;
  private passedHalfway = false;
  private lastAlong = 0;

  constructor(container: HTMLElement) {
    this.cameraRig = new FollowCamera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(container, this.scene, this.cameraRig.camera);

    this.track = new Track();
    this.scene.add(this.track.group);
    this.environment = new Environment(this.scene, this.track, this.renderer.webgl);
    this.scene.add(this.environment.group);

    const particleTex = createSoftParticleTexture();
    this.smoke = new ParticleSystem({ maxParticles: 1500, texture: particleTex, blending: THREE.NormalBlending });
    this.sparks = new ParticleSystem({ maxParticles: 600, texture: particleTex, blending: THREE.AdditiveBlending });
    this.scene.add(this.skids.mesh, this.smoke.points, this.sparks.points);

    this.player = new Car(
      this.track,
      { bodyColor: 0xc8201a, stripeColor: 0xf2f2f2 },
      undefined,
      { onImpact: (x, y, z, strength) => this.spawnSparks(x, y, z, strength) },
    );
    this.addHeadlights(this.player);
    this.scene.add(this.player.object);
    this.player.placeOnTrack(this.track.length - 12, 0);
    this.lastAlong = this.player.trackAlong;
    this.cameraRig.snapTo(this.player.physics.x, this.player.physics.z, this.player.physics.heading);

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  start(): void {
        this.renderer.webgl.setAnimationLoop(() => this.frame());
  }

  private addHeadlights(car: Car): void {
    const light = new THREE.SpotLight(0xfff0d0, 60, 40, 0.55, 0.6, 1.5);
    light.position.set(0, 0.8, 2.0);
    light.target.position.set(0, 0, 14);
    car.object.add(light, light.target);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cameraRig.resize(w / h);
    this.renderer.resize(w, h);
    const px = h * this.renderer.webgl.getPixelRatio();
    this.smoke.setViewport(px, this.cameraRig.camera.fov);
    this.sparks.setViewport(px, this.cameraRig.camera.fov);
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_TIME);
    this.elapsed += dt;

    if (this.input.wasPressed('KeyR')) this.player.resetToTrack();
    if (this.input.wasPressed('KeyC')) this.cameraRig.toggleMode();
    this.lastInput = this.input.getDriveInput();

    this.accumulator += dt;
    while (this.accumulator >= PHYSICS_STEP) {
      this.player.step(this.lastInput, PHYSICS_STEP);
      this.accumulator -= PHYSICS_STEP;
    }

    this.player.syncVisual(dt);
    this.updateEffects(dt);
    this.updateLap();

    const p = this.player.physics;
    this.cameraRig.update(p.x, p.z, p.heading, p.vx, p.vz, dt);
    this.environment.follow(this.player.position);
    this.hud.setSpeed(p.speed);

    this.renderer.render(this.elapsed);
    this.input.endFrame();
  }

  private updateEffects(dt: number): void {
    const car = this.player;
    const skidding = car.isSkidding(this.lastInput);
    const gravel = car.onGravel && car.physics.speed > 4;
    car.rearWheelWorld(this.wheelPoints);
    this.wheelPoints.forEach((pt, i) => {
      this.skids.update(`player-${i}`, pt, skidding && !car.onGravel);
      const emitChance = skidding ? 0.9 : gravel ? 0.6 : 0;
      if (Math.random() < emitChance) {
        const color = gravel ? new THREE.Color(0x9a8160) : new THREE.Color(0xd8d4cc);
        this.smoke.emit({
          position: pt.clone().setY(0.4),
          velocity: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5)
            .addScaledVector(new THREE.Vector3(car.physics.vx, 0, car.physics.vz), 0.15),
          color,
          size: 1.2,
          growth: gravel ? 3 : 4,
          life: 0.9 + Math.random() * 0.8,
          alpha: gravel ? 0.5 : 0.35,
          gravity: 0.4,
          drag: 1.5,
        });
      }
    });
    this.smoke.update(dt);
    this.sparks.update(dt);
  }

  private spawnSparks(x: number, y: number, z: number, strength: number): void {
    const count = Math.min(40, Math.floor(strength * 2));
    for (let i = 0; i < count; i++) {
      this.sparks.emit({
        position: new THREE.Vector3(x, y, z),
        velocity: new THREE.Vector3((Math.random() - 0.5) * 14, 2 + Math.random() * 6, (Math.random() - 0.5) * 14),
        color: new THREE.Color().setHSL(0.08 + Math.random() * 0.06, 1, 0.6),
        size: 0.25,
        growth: 0.3,
        life: 0.3 + Math.random() * 0.4,
        alpha: 1,
        gravity: -18,
        drag: 2,
      });
    }
  }

  private updateLap(): void {
    const along = this.player.trackAlong;
    const len = this.track.length;
    if (along > len * 0.45 && along < len * 0.55) this.passedHalfway = true;
    // Crossing the start line forwards: progress wraps from the end back to ~0.
    const crossed = this.lastAlong > len * 0.9 && along < len * 0.1;
    if (crossed) {
      if (this.passedHalfway) {
        const lapTime = this.elapsed - this.lapStart;
        if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
        this.hud.setBestLap(this.bestLap);
      }
      this.lapStart = this.elapsed;
      this.passedHalfway = false;
    }
    this.lastAlong = along;
    this.hud.setLapTime(this.elapsed - this.lapStart);
  }
}
