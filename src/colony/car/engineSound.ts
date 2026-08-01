// Spec 096 — Web Audio V8 Engine Sound Synthesizer & Sound Calibration.
// Synthesizes authentic V8 engine cross-plane crankshaft rumble, supercharger whine frequency,
// RPM tachometer pitch shifting, and exhaust backfire pop sound effects.

export interface EngineSoundCalibration {
  /** Idle RPM (600 - 1200 RPM) */
  idleRpm: number;
  /** Max RPM (6000 - 8500 RPM) */
  maxRpm: number;
  /** Current RPM (600 - 8500 RPM) */
  currentRpm: number;
  /** Supercharger whine intensity (0.0 to 1.0) */
  superchargerWhine: number;
  /** Exhaust backfire pop probability (0.0 to 1.0) */
  backfirePopFreq: number;
}

export function DEFAULT_ENGINE_CALIBRATION(): EngineSoundCalibration {
  return {
    idleRpm: 800,
    maxRpm: 7500,
    currentRpm: 2400,
    superchargerWhine: 0.75,
    backfirePopFreq: 0.4,
  };
}

/** Compute V8 firing frequency in Hz based on RPM. A 4-stroke V8 fires 4 times per revolution. */
export function v8FiringFrequencyHz(rpm: number): number {
  return (rpm / 60) * 4;
}

/** Compute supercharger whine pitch in Hz based on RPM. Superchargers spin at ~2x engine speed. */
export function superchargerWhineHz(rpm: number): number {
  return (rpm / 60) * 16;
}

export class V8AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;

  public start(): void {
    if (this.isPlaying) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Main V8 Crankshaft Rumble Oscillator (Sawtooth)
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = "sawtooth";
      this.osc1.frequency.setValueAtTime(
        v8FiringFrequencyHz(2400),
        this.ctx.currentTime,
      );

      // Sub-Bass Sub-Harmonic Oscillator (Square)
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = "square";
      this.osc2.frequency.setValueAtTime(
        v8FiringFrequencyHz(2400) / 2,
        this.ctx.currentTime,
      );

      // High-Pitched Supercharger Whine Oscillator (Triangle)
      this.whineOsc = this.ctx.createOscillator();
      this.whineOsc.type = "triangle";
      this.whineOsc.frequency.setValueAtTime(
        superchargerWhineHz(2400),
        this.ctx.currentTime,
      );

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(0.08, this.ctx.currentTime);

      this.osc1.connect(this.gainNode);
      this.osc2.connect(this.gainNode);
      this.whineOsc.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);

      this.osc1.start();
      this.osc2.start();
      this.whineOsc.start();
      this.isPlaying = true;
    } catch {
      // Audio context blocked until user interaction
    }
  }

  public updateRPM(cal: EngineSoundCalibration): void {
    if (!this.ctx || !this.osc1 || !this.osc2 || !this.whineOsc) return;
    const now = this.ctx.currentTime;
    const freq = v8FiringFrequencyHz(cal.currentRpm);
    const whineFreq = superchargerWhineHz(cal.currentRpm);

    this.osc1.frequency.setTargetAtTime(freq, now, 0.05);
    this.osc2.frequency.setTargetAtTime(freq / 2, now, 0.05);
    this.whineOsc.frequency.setTargetAtTime(whineFreq, now, 0.05);
  }

  public triggerBackfirePop(): void {
    if (!this.ctx || !this.gainNode) return;
    try {
      const now = this.ctx.currentTime;
      const popOsc = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();

      popOsc.type = "square";
      popOsc.frequency.setValueAtTime(120, now);
      popOsc.frequency.exponentialRampToValueAtTime(30, now + 0.08);

      popGain.gain.setValueAtTime(0.25, now);
      popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      popOsc.connect(popGain);
      popGain.connect(this.ctx.destination);

      popOsc.start(now);
      popOsc.stop(now + 0.08);
    } catch {
      // Ignore audio glitches
    }
  }

  public stop(): void {
    if (!this.isPlaying) return;
    try {
      this.osc1?.stop();
      this.osc2?.stop();
      this.whineOsc?.stop();
      this.ctx?.close();
    } catch {
      // Ignore
    }
    this.isPlaying = false;
  }
}
