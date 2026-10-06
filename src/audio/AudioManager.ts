/** Sound effect ids, matching files in public/audio/sfx/<id>.mp3. */
export type SfxId =
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

export interface PlayOptions {
  volume?: number;
  /** Playback rate; also shifts pitch. */
  rate?: number;
  /** Random +/- variation applied to rate, to avoid repetitive one-shots. */
  rateJitter?: number;
}

/** A looping sound whose volume and pitch can be driven every frame (engine, skid). */
export class LoopVoice {
  constructor(
    private readonly source: AudioBufferSourceNode,
    private readonly gain: GainNode,
    private readonly ctx: AudioContext,
  ) {}

  set(volume: number, rate = 1): void {
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(volume, t, 0.05);
    this.source.playbackRate.setTargetAtTime(rate, t, 0.05);
  }

  stop(): void {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.source.stop(this.ctx.currentTime + 0.3);
  }
}

/**
 * Web Audio based sound system: preloads buffers, plays one-shots and loops,
 * and crossfades music. Browsers keep audio suspended until a user gesture,
 * so call unlock() from the first click or key press.
 */
export class AudioManager {
  readonly ctx = new AudioContext();
  private readonly master = this.ctx.createGain();
  private readonly sfxBus = this.ctx.createGain();
  private readonly musicBus = this.ctx.createGain();
  private readonly buffers = new Map<string, AudioBuffer>();
  private music: { id: MusicId; source: AudioBufferSourceNode; gain: GainNode } | null = null;

  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}audio/`) {
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.musicBus.gain.value = 0.5;
  }

  /** Resumes the audio context; must run inside a user gesture handler. */
  unlock(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
  }

  /** Loads all sound effects. Missing files are logged and skipped so the game still runs. */
  async preloadSfx(): Promise<void> {
    await Promise.all(SFX_IDS.map((id) => this.load(`sfx/${id}`)));
  }

  setMasterVolume(v: number): void {
    this.master.gain.value = v;
  }

  setSfxVolume(v: number): void {
    this.sfxBus.gain.value = v;
  }

  setMusicVolume(v: number): void {
    this.musicBus.gain.value = v;
  }

  play(id: SfxId, { volume = 1, rate = 1, rateJitter = 0 }: PlayOptions = {}): void {
    const buffer = this.buffers.get(`sfx/${id}`);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate + (Math.random() * 2 - 1) * rateJitter;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.sfxBus);
    source.start();
  }

  /** Starts a loop at zero volume; drive it with LoopVoice.set(). Returns null if not loaded. */
  loop(id: SfxId): LoopVoice | null {
    const buffer = this.buffers.get(`sfx/${id}`);
    if (!buffer) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(this.sfxBus);
    source.start();
    return new LoopVoice(source, gain, this.ctx);
  }

  /** Crossfades to the given track, loading it on demand. */
  async playMusic(id: MusicId, fadeSeconds = 1.5): Promise<void> {
    if (this.music?.id === id) return;
    const buffer = await this.load(`music/${id}`);
    this.stopMusic(fadeSeconds);
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + fadeSeconds);
    source.connect(gain).connect(this.musicBus);
    source.start();
    this.music = { id, source, gain };
  }

  stopMusic(fadeSeconds = 1.5): void {
    if (!this.music) return;
    const { source, gain } = this.music;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
    source.stop(t + fadeSeconds);
    this.music = null;
  }

  private async load(key: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) return cached;
    try {
      const res = await fetch(`${this.baseUrl}${key}.mp3`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(key, buffer);
      return buffer;
    } catch (err) {
      console.warn(`[audio] could not load ${key}:`, err);
      return null;
    }
  }
}
