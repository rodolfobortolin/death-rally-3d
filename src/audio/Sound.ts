import type * as THREE from 'three';

/** Sample ids, matching files in public/audio/sfx/<id>.mp3. */
type SfxId =
  | 'engine-loop'
  | 'skid'
  | 'collision'
  | 'machine-gun'
  | 'mine-explosion'
  | 'mine-drop'
  | 'turbo'
  | 'powerup'
  | 'menu-click'
  | 'countdown-beep'
  | 'countdown-go'
  | 'car-destroyed';

/** Music track ids, matching files in public/audio/music/<id>.mp3. */
export type MusicId = 'menu-theme' | 'race-theme';

const SFX_IDS: SfxId[] = [
  'engine-loop',
  'skid',
  'collision',
  'machine-gun',
  'mine-explosion',
  'mine-drop',
  'turbo',
  'powerup',
  'menu-click',
  'countdown-beep',
  'countdown-go',
  'car-destroyed',
];
const MUSIC_IDS: MusicId[] = ['menu-theme', 'race-theme'];

const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;
const MASTER_VOLUME = 0.7;
const MUSIC_VOLUME = 0.32;
const MUSIC_FADE = 1.5;

interface SampleOptions {
  volume?: number;
  rate?: number;
  /** Random +/- variation applied to rate, to avoid repetitive one-shots. */
  jitter?: number;
  /** Play only a slice of the sample, in seconds. */
  offset?: number;
  duration?: number;
}

/** A looping sample whose gain and rate are driven every frame. */
interface LoopVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Game audio with the Web Audio API: ElevenLabs samples from public/audio,
 * falling back to procedural synthesis for any sample that has not loaded.
 * The context is created lazily on the first user gesture, as browsers require.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineLoop: LoopVoice | null = null;
  private skidLoop: LoopVoice | null = null;
  private wasBoosting = false;
  private wantedMusic: MusicId | null = null;
  private music: { id: MusicId; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private listenerX = 0;
  private listenerZ = 0;
  private lastGunTime = 0;
  private lastImpactTime = 0;
  muted = false;

  /** Call from a click/keydown handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = MUSIC_VOLUME;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);

    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    void this.loadAll();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  // ---------------------------------------------------------------------------
  // Loading and playback helpers
  // ---------------------------------------------------------------------------

  private async loadAll(): Promise<void> {
    // Sound effects first: they are small and needed as soon as a race starts.
    await Promise.all(SFX_IDS.map((id) => this.load(`sfx/${id}`)));
    await Promise.all(MUSIC_IDS.map((id) => this.load(`music/${id}`)));
    this.applyMusic();
  }

  private async load(key: string): Promise<void> {
    if (!this.ctx) return;
    try {
      const res = await fetch(`${AUDIO_BASE}${key}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.buffers.set(key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
    } catch (err) {
      console.warn(`[audio] could not load ${key}, using procedural fallback:`, err);
    }
    // Music may have been requested while this track was still loading.
    if (key.startsWith('music/')) this.applyMusic();
  }

  /** Plays a one-shot sample; returns false if it is not loaded so callers can fall back. */
  private sample(id: SfxId, { volume = 1, rate = 1, jitter = 0, offset = 0, duration }: SampleOptions = {}): boolean {
    const buffer = this.buffers.get(`sfx/${id}`);
    if (!this.ctx || !this.sfxBus || !buffer) return false;
    if (volume < 0.01) return true;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate + (Math.random() * 2 - 1) * jitter;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    if (duration !== undefined) {
      // Short fade-out so a sliced sample does not click.
      gain.gain.setValueAtTime(volume, t + duration * 0.7);
      gain.gain.linearRampToValueAtTime(0, t + duration);
    }
    src.connect(gain).connect(this.sfxBus);
    src.start(t, offset, duration);
    return true;
  }

  private startLoop(id: SfxId): LoopVoice | null {
    const buffer = this.buffers.get(`sfx/${id}`);
    if (!this.ctx || !this.sfxBus || !buffer) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.sfxBus);
    source.start(0, Math.random() * buffer.duration);
    return { source, gain };
  }

  private attenuation(pos: THREE.Vector3 | null): number {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.listenerX, pos.z - this.listenerZ);
    return 1 / (1 + d / 18);
  }

  private noise(duration: number, filterFreq: number, volume: number, filterType: BiquadFilterType = 'lowpass', sweepTo?: number): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer || volume < 0.01) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, volume: number, type: OscillatorType = 'square', slideTo?: number): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------

  /** Crossfades to the given track (or silence). Safe to call before unlock(). */
  playMusic(id: MusicId | null): void {
    this.wantedMusic = id;
    this.applyMusic();
  }

  private applyMusic(): void {
    if (!this.ctx || !this.musicBus) return;
    const id = this.wantedMusic;
    if (this.music?.id === id) return;
    const buffer = id ? this.buffers.get(`music/${id}`) : undefined;
    // Keep the current track playing until the next one has loaded.
    if (id && !buffer) return;

    const t = this.ctx.currentTime;
    if (this.music) {
      const { source, gain } = this.music;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + MUSIC_FADE);
      source.stop(t + MUSIC_FADE);
      this.music = null;
    }
    if (!id || !buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + MUSIC_FADE);
    source.connect(gain).connect(this.musicBus);
    source.start(t);
    this.music = { id, source, gain };
  }

  // ---------------------------------------------------------------------------
  // Sound effects
  // ---------------------------------------------------------------------------

  gun(pos: THREE.Vector3, isPlayer: boolean): void {
    if (!this.ctx) return;
    // Throttle overlapping shots from many cars.
    const now = this.ctx.currentTime;
    if (!isPlayer && now - this.lastGunTime < 0.03) return;
    this.lastGunTime = now;
    const v = (isPlayer ? 0.35 : 0.5) * this.attenuation(isPlayer ? null : pos);
    // The sample is a three-round burst; play only its first round per shot.
    if (this.sample('machine-gun', { volume: v * 1.6, jitter: 0.08, offset: 0.02, duration: 0.08 })) return;
    this.noise(0.07, 2600, v, 'bandpass', 600);
    this.tone(160, 0.05, v * 0.5, 'square', 60);
  }

  hit(pos: THREE.Vector3): void {
    this.noise(0.05, 5000, 0.18 * this.attenuation(pos), 'highpass');
  }

  explosion(pos: THREE.Vector3, size: number): void {
    const v = Math.min(1, 0.9 * size) * this.attenuation(pos);
    // Car wrecks are triggered with a bigger size than mine blasts.
    const id: SfxId = size >= 1.5 ? 'car-destroyed' : 'mine-explosion';
    if (this.sample(id, { volume: v, jitter: 0.06 })) return;
    this.noise(1.4, 1800, v, 'lowpass', 80);
    this.tone(70, 0.6, v * 0.8, 'sine', 30);
  }

  mineDrop(pos: THREE.Vector3): void {
    const v = 0.15 * this.attenuation(pos);
    if (this.sample('mine-drop', { volume: v * 3, jitter: 0.05 })) return;
    this.tone(420, 0.08, v, 'triangle', 300);
  }

  pickup(): void {
    if (this.sample('powerup', { volume: 0.8 })) return;
    this.tone(660, 0.08, 0.2, 'square', 990);
    setTimeout(() => this.tone(990, 0.12, 0.18, 'square', 1320), 70);
  }

  impact(strength: number): void {
    if (!this.ctx) return;
    // Wall scrapes report many small impacts in a row; keep the crunch for real hits.
    const now = this.ctx.currentTime;
    if (now - this.lastImpactTime < 0.15) return;
    const v = Math.min(1, strength * 0.05);
    if (v < 0.08) return;
    this.lastImpactTime = now;
    if (this.sample('collision', { volume: v, jitter: 0.1 })) return;
    this.noise(0.25, 900, Math.min(0.6, strength * 0.03), 'lowpass', 200);
  }

  countdownBeep(final: boolean): void {
    if (this.sample(final ? 'countdown-go' : 'countdown-beep', { volume: 0.7 })) return;
    this.tone(final ? 880 : 440, final ? 0.6 : 0.25, 0.25, 'square');
  }

  uiClick(): void {
    // The generated click is quiet, so it gets extra gain.
    if (this.sample('menu-click', { volume: 2.5, jitter: 0.05 })) return;
    this.tone(520, 0.05, 0.12, 'triangle', 700);
  }

  /** Continuous engine and tire sounds for the player car. */
  updateEngine(speedRatio: number, throttle: number, boosting: boolean, skidding = false): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    // Fake gearbox: pitch rises within each of four gears.
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(speedRatio * gears));
    const inGear = speedRatio * gears - g;
    const rpm = 0.25 + inGear * 0.75;

    if (boosting && !this.wasBoosting) this.sample('turbo', { volume: 0.6 });
    this.wasBoosting = boosting;

    this.skidLoop ??= this.startLoop('skid');
    if (this.skidLoop) {
      this.skidLoop.gain.gain.setTargetAtTime(skidding ? 0.35 : 0, t, skidding ? 0.04 : 0.12);
      this.skidLoop.source.playbackRate.setTargetAtTime(0.9 + speedRatio * 0.25, t, 0.1);
    }

    this.engineLoop ??= this.startLoop('engine-loop');
    if (this.engineLoop) {
      const rate = 0.6 + rpm * 0.75 + g * 0.08 + (boosting ? 0.2 : 0);
      this.engineLoop.source.playbackRate.setTargetAtTime(rate, t, 0.05);
      this.engineLoop.gain.gain.setTargetAtTime(0.22 + throttle * 0.3, t, 0.1);
      return;
    }

    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineSub = this.ctx.createOscillator();
      this.engineSub.type = 'square';
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.Q.value = 4;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineSub.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain).connect(this.sfxBus!);
      this.engineOsc.start();
      this.engineSub.start();
    }
    const freq = 45 + rpm * 85 + g * 8 + (boosting ? 25 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineSub!.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.engineFilter!.frequency.setTargetAtTime(300 + throttle * 900 + rpm * 500, t, 0.08);
    this.engineGain!.gain.setTargetAtTime(0.05 + throttle * 0.07, t, 0.1);
  }

  stopEngine(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wasBoosting = false;
    this.engineGain?.gain.setTargetAtTime(0, t, 0.1);
    this.engineLoop?.gain.gain.setTargetAtTime(0, t, 0.1);
    this.skidLoop?.gain.gain.setTargetAtTime(0, t, 0.1);
  }
}
