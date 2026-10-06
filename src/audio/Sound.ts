import type * as THREE from 'three';

/**
 * Procedural sound effects with the Web Audio API (no audio files needed).
 * The context is created lazily on the first user gesture, as browsers require.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private listenerX = 0;
  private listenerZ = 0;
  private lastGunTime = 0;
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
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  setListener(x: number, z: number): void {
    this.listenerX = x;
    this.listenerZ = z;
  }

  private attenuation(pos: THREE.Vector3 | null): number {
    if (!pos) return 1;
    const d = Math.hypot(pos.x - this.listenerX, pos.z - this.listenerZ);
    return 1 / (1 + d / 18);
  }

  private noise(duration: number, filterFreq: number, volume: number, filterType: BiquadFilterType = 'lowpass', sweepTo?: number): void {
    if (!this.ctx || !this.master || !this.noiseBuffer || volume < 0.01) return;
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
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  private tone(freq: number, duration: number, volume: number, type: OscillatorType = 'square', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  gun(pos: THREE.Vector3, isPlayer: boolean): void {
    if (!this.ctx) return;
    // Throttle overlapping shots from many cars.
    const now = this.ctx.currentTime;
    if (!isPlayer && now - this.lastGunTime < 0.03) return;
    this.lastGunTime = now;
    const v = (isPlayer ? 0.35 : 0.5) * this.attenuation(isPlayer ? null : pos);
    this.noise(0.07, 2600, v, 'bandpass', 600);
    this.tone(160, 0.05, v * 0.5, 'square', 60);
  }

  hit(pos: THREE.Vector3): void {
    this.noise(0.05, 5000, 0.18 * this.attenuation(pos), 'highpass');
  }

  explosion(pos: THREE.Vector3, size: number): void {
    const v = Math.min(1, 0.9 * size) * this.attenuation(pos);
    this.noise(1.4, 1800, v, 'lowpass', 80);
    this.tone(70, 0.6, v * 0.8, 'sine', 30);
  }

  mineDrop(pos: THREE.Vector3): void {
    this.tone(420, 0.08, 0.15 * this.attenuation(pos), 'triangle', 300);
  }

  pickup(): void {
    this.tone(660, 0.08, 0.2, 'square', 990);
    setTimeout(() => this.tone(990, 0.12, 0.18, 'square', 1320), 70);
  }

  impact(strength: number): void {
    this.noise(0.25, 900, Math.min(0.6, strength * 0.03), 'lowpass', 200);
  }

  countdownBeep(final: boolean): void {
    this.tone(final ? 880 : 440, final ? 0.6 : 0.25, 0.25, 'square');
  }

  uiClick(): void {
    this.tone(520, 0.05, 0.12, 'triangle', 700);
  }

  /** Continuous engine note for the player car. */
  updateEngine(speedRatio: number, throttle: number, boosting: boolean): void {
    if (!this.ctx || !this.master) return;
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
      this.engineFilter.connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
      this.engineSub.start();
    }
    const t = this.ctx.currentTime;
    // Fake gearbox: pitch rises within each of four gears.
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(speedRatio * gears));
    const inGear = speedRatio * gears - g;
    const rpm = 0.25 + inGear * 0.75;
    const freq = 45 + rpm * 85 + g * 8 + (boosting ? 25 : 0);
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineSub!.frequency.setTargetAtTime(freq / 2, t, 0.05);
    this.engineFilter!.frequency.setTargetAtTime(300 + throttle * 900 + rpm * 500, t, 0.08);
    this.engineGain!.gain.setTargetAtTime(0.05 + throttle * 0.07, t, 0.1);
  }

  stopEngine(): void {
    if (this.engineGain && this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
}
