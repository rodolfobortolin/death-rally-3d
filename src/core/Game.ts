import * as THREE from 'three';
import { Sound } from '../audio/Sound';
import { Effects } from '../fx/Effects';
import { CARS, DEFAULT_CAR_ID } from '../car/CarCatalog';
import { CarDamage } from '../car/CarDamage';
import { createCarModel } from '../car/CarModel';
import { Race, type RaceConfig } from '../race/Race';
import { FpsCounter } from '../ui/FpsCounter';
import { Hud } from '../ui/Hud';
import { Menu, type MenuAction } from '../ui/Menu';
import { Minimap } from '../ui/Minimap';
import { renderCarPortrait } from '../ui/Portraits';
import { NameTags } from '../ui/NameTags';
import { Standings } from '../ui/Standings';
import { Environment } from '../world/Environment';
import { Track } from '../world/Track';
import { FollowCamera } from './FollowCamera';
import { Input, NEUTRAL_INPUT } from './Input';
import { Renderer } from './Renderer';

const PHYSICS_STEP = 1 / 120;
const MAX_FRAME_TIME = 0.1;
/** The attract race behind the menus doesn't need a high frame rate. */
const MENU_FPS = 30;

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
  private readonly fps = new FpsCounter();
  private readonly menu = new Menu();
  private readonly minimap: Minimap;
  private readonly standings = new Standings();
  private readonly nameTags = new NameTags();
  private readonly timer = new THREE.Timer();
  private race: Race | null = null;
  private lastConfig: RaceConfig | null = null;
  private state: GameState = 'menu';
  private accumulator = 0;
  private elapsed = 0;
  /** Mine key presses are latched until a physics sub-step consumes them. */
  private pendingMine = false;
  /** Width of the HUD sidebar, so the camera can center the car in the free area. */
  private hudInset = 0;
  private previewsPending = true;
  /** Timestamp (ms) of the last frame actually rendered, for the frame cap. */
  private lastFrameAt = 0;
  /** Set when something changed while paused, so one fresh frame gets drawn. */
  private needsRender = true;

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
    this.menu.onSettingsChange = (s) => {
      this.sound.setMuted(!s.sound);
      this.applyGraphics();
    };
    this.sound.setMuted(!this.menu.settings.sound);
    this.applyGraphics();
    window.addEventListener('keydown', () => this.sound.unlock(), { once: true });

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.enterMenu();
  }

  /**
   * Renders a showroom shot of every selectable car for the garage panel. Runs from the
   * frame loop until it succeeds, since the canvas can have no size yet at startup.
   */
  private buildCarPreviews(): void {
    const previews = new Map<string, string>();
    for (const def of CARS) {
      const model = createCarModel({ bodyColor: def.color, stripeColor: def.stripe, bodyType: def.bodyType, number: def.number });
      new CarDamage(model, 1).apply(0, false); // adds the paint's vertex colors
      const image = renderCarPortrait(this.renderer.webgl, model.root, this.scene.environment, 400, 240);
      model.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      if (!image) return;
      previews.set(def.id, image);
    }
    this.previewsPending = false;
    this.menu.setCarPreviews(previews);
  }

  start(): void {
    this.renderer.webgl.setAnimationLoop((t) => this.tick(t));
    // Stop drawing entirely while the tab is hidden; pause a race left running.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'racing') this.togglePause();
        this.renderer.webgl.setAnimationLoop(null);
      } else {
        this.timer.reset();
        this.needsRender = true;
        this.renderer.webgl.setAnimationLoop((t) => this.tick(t));
      }
    });
  }

  /** Frame-rate target for the current state (Infinity = uncapped, 0 = draw only when something changed). */
  private targetFps(): number {
    if (this.state === 'paused') return 0;
    if (this.state === 'menu' || this.state === 'results') return Math.min(MENU_FPS, this.menu.settings.frameCap || MENU_FPS);
    return this.menu.settings.frameCap || Infinity;
  }

  /** Animation loop entry: skips display refreshes beyond the frame cap (e.g. on 120 Hz screens). */
  private tick(now: number): void {
    const fps = this.targetFps();
    if (fps === 0 && !this.needsRender) {
      // Keep the input edge state fresh so Esc still unpauses.
      this.handleGlobalKeys();
      this.input.endFrame();
      return;
    }
    if (fps > 0 && fps !== Infinity) {
      const interval = 1000 / fps;
      const since = now - this.lastFrameAt;
      // Small tolerance so a 60 cap on a 60 Hz display never drops frames.
      if (since < interval - 2) return;
      this.lastFrameAt = since > interval * 2 ? now : this.lastFrameAt + interval;
    }
    this.needsRender = false;
    this.frame();
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
    if (config.withPlayer) {
      const portraits = new Map(race.racers.map((r) => [r, renderCarPortrait(this.renderer.webgl, r.car.object, this.scene.environment) ?? ''] as const));
      this.standings.build(race, portraits);
      if (race.player) this.hud.setPortrait(portraits.get(race.player) ?? '');
      this.nameTags.build(race);
    }
    const f = race.focus.car.physics;
    this.cameraRig.snapTo(f.x, f.z, f.heading);
  }

  private enterMenu(): void {
    this.state = 'menu';
    this.cameraRig.mode = 'cinematic';
    this.hudInset = 0;
    this.onResize();
    this.setRace({ laps: 99, opponents: 6, difficulty: 'hard', withPlayer: false, respawn: true, car: DEFAULT_CAR_ID });
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
    this.hudInset = (document.querySelector('.sidebar') as HTMLElement | null)?.offsetWidth ?? 0;
    this.onResize();
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
    this.needsRender = true;
    if (this.state === 'racing') {
      this.state = 'paused';
      this.sound.stopEngine();
      this.menu.show('pause');
    } else if (this.state === 'paused') {
      this.timer.reset(); // don't feed the paused time into the next physics step
      this.state = 'racing';
      this.menu.show(null);
    }
  }

  private applyGraphics(): void {
    const quality = this.menu.settings.graphics;
    this.renderer.setQuality(quality);
    this.environment.setShadowQuality(quality);
    this.onResize();
  }

  private onResize(): void {
    this.needsRender = true;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cameraRig.resize(w / h);
    this.cameraRig.setLeftInset(this.hudInset, w, h);
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
    if (input.wasPressed('KeyF')) this.fps.toggle();
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
    const rawDt = this.timer.getDelta();
    const dt = Math.min(rawDt, MAX_FRAME_TIME);
    this.fps.update(rawDt);
    this.handleGlobalKeys();
    if (this.previewsPending) this.buildCarPreviews();

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
        this.standings.update(race);
        this.nameTags.update(race, this.cameraRig.camera, window.innerWidth, window.innerHeight);
      }
    }

    this.renderer.render(this.elapsed);
    this.input.endFrame();
  }
}
