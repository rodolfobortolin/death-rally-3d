import * as THREE from 'three';
import { Sound } from '../audio/Sound';
import { Effects } from '../fx/Effects';
import { Race, type RaceConfig } from '../race/Race';
import { Hud } from '../ui/Hud';
import { Menu, type MenuAction } from '../ui/Menu';
import { Minimap } from '../ui/Minimap';
import { Environment } from '../world/Environment';
import { Track } from '../world/Track';
import { FollowCamera } from './FollowCamera';
import { Input, NEUTRAL_INPUT } from './Input';
import { Renderer } from './Renderer';

const PHYSICS_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;

type GameState = 'menu' | 'racing' | 'paused' | 'results';

/** Owns the world and the main loop, and switches between menus and races. */
export class Game {
  private readonly scene = new THREE.Scene();
  private readonly input = new Input();
  private readonly cameraRig: FollowCamera;
  private readonly renderer: Renderer;
  private readonly track: Track;
  private readonly environment: Environment;
  private readonly effects = new Effects();
  private readonly sound = new Sound();
  private readonly hud = new Hud();
  private readonly menu = new Menu();
  private readonly minimap: Minimap;
  private readonly timer = new THREE.Timer();
  private race: Race | null = null;
  private lastConfig: RaceConfig | null = null;
  private state: GameState = 'menu';
  private accumulator = 0;
  private elapsed = 0;
  /** Mine key presses are latched until a physics sub-step consumes them. */
  private pendingMine = false;

  constructor(container: HTMLElement) {
    this.cameraRig = new FollowCamera(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(container, this.scene, this.cameraRig.camera);

    this.track = new Track();
    this.scene.add(this.track.group);
    this.environment = new Environment(this.scene, this.track, this.renderer.webgl);
    this.scene.add(this.environment.group, this.effects.group);
    this.minimap = new Minimap(this.track);

    this.menu.onAction = (a) => this.onMenuAction(a);
    this.menu.onClick = () => {
      this.sound.unlock();
      this.sound.uiClick();
    };
    this.menu.onSettingsChange = (s) => this.sound.setMuted(!s.sound);
    this.sound.setMuted(!this.menu.settings.sound);
    window.addEventListener('keydown', () => this.sound.unlock(), { once: true });

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.enterMenu();
  }

  start(): void {
    this.renderer.webgl.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  private setRace(config: RaceConfig): void {
    if (this.race) {
      this.scene.remove(this.race.group);
      this.race.dispose();
    }
    const race = new Race(this.track, this.effects, this.sound, config);
    race.onMessage = (m) => {
      if (this.state !== 'racing') return;
      if (m.banner) this.hud.showBanner(m.text);
      else this.hud.pushFeed(m.text);
    };
    race.onFinish = (results) => {
      this.state = 'results';
      this.hud.setVisible(false);
      this.menu.showResults(results);
    };
    race.onShake = (amount) => {
      if (this.state === 'racing') this.cameraRig.addShake(amount);
    };
    this.race = race;
    this.scene.add(race.group);
    const f = race.focus.car.physics;
    this.cameraRig.snapTo(f.x, f.z, f.heading);
  }

  private enterMenu(): void {
    this.state = 'menu';
    this.cameraRig.mode = 'cinematic';
    this.setRace({ laps: 99, opponents: 6, difficulty: 'hard', withPlayer: false });
    this.hud.setVisible(false);
    this.menu.show('menu');
    this.sound.playMusic('menu-theme');
  }

  private startRace(config: RaceConfig): void {
    this.lastConfig = config;
    this.state = 'racing';
    this.cameraRig.mode = 'classic';
    this.setRace(config);
    this.hud.setVisible(true);
    this.menu.show(null);
    this.sound.playMusic('race-theme');
  }

  private onMenuAction(action: MenuAction): void {
    switch (action) {
      case 'start':
        this.startRace(this.menu.raceConfig());
        break;
      case 'resume':
        this.togglePause();
        break;
      case 'restart':
        this.startRace(this.lastConfig ?? this.menu.raceConfig());
        break;
      case 'quit':
        this.enterMenu();
        break;
    }
  }

  private togglePause(): void {
    if (this.state === 'racing') {
      this.state = 'paused';
      this.sound.stopEngine();
      this.menu.show('pause');
    } else if (this.state === 'paused') {
      this.state = 'racing';
      this.menu.show(null);
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cameraRig.resize(w / h);
    this.renderer.resize(w, h);
    this.effects.setViewport(h * this.renderer.webgl.getPixelRatio(), this.cameraRig.camera.fov);
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  private handleGlobalKeys(): void {
    const input = this.input;
    if (this.state === 'menu' && this.menu.visible === 'menu' && input.wasPressed('Enter', 'NumpadEnter')) {
      // Buttons already react to Enter when focused; only start when nothing is focused.
      if (!(document.activeElement instanceof HTMLButtonElement)) this.onMenuAction('start');
    }
    if (input.wasPressed('Escape', 'KeyP')) {
      if (this.state === 'racing' || this.state === 'paused') this.togglePause();
      else if (this.menu.visible === 'controls') this.menu.show('menu');
    }
    if (this.state === 'racing') {
      if (input.wasPressed('KeyC')) this.cameraRig.toggleMode();
      const p = this.race?.player;
      if (p && input.wasPressed('KeyR') && !p.destroyed && this.race?.phase === 'racing') p.car.resetToTrack();
    }
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), MAX_FRAME_TIME);
    this.handleGlobalKeys();

    const race = this.race;
    const simulate = race && this.state !== 'paused';
    if (race && simulate) {
      this.elapsed += dt;
      const playerInput = this.state === 'racing' ? this.input.getDriveInput() : NEUTRAL_INPUT;
      if (playerInput.dropMine) this.pendingMine = true;
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_STEP) {
        const cmd = { ...playerInput, dropMine: this.pendingMine };
        this.pendingMine = false;
        race.step(PHYSICS_STEP, this.state === 'racing' ? this.input : null, cmd);
        this.accumulator -= PHYSICS_STEP;
      }
      race.syncVisuals(dt, this.elapsed);
      this.effects.update(dt);
    }

    if (race) {
      const focus = race.focus.car;
      const p = focus.physics;
      this.cameraRig.update(p.x, p.z, p.heading, p.vx, p.vz, simulate ? dt : 0);
      this.environment.follow(focus.position);
      this.sound.setListener(p.x, p.z);
      if (this.state === 'racing') {
        this.hud.update(race);
        this.minimap.draw(race);
      }
    }

    this.renderer.render(this.elapsed);
    this.input.endFrame();
  }
}
