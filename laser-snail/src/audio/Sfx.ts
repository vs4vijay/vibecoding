/**
 * WebAudio-synthesized SFX — no assets, per the audio spec. The AudioContext
 * is created lazily on the first user gesture (browsers block audio before
 * any input); every play method is a graceful no-op when audio is
 * unavailable (headless, blocked, or pre-gesture) or when muted (every voice
 * funnels through `tone`, which checks the mute flag first — the persisted
 * toggle therefore silences *everything*).
 *
 * Palette (Phase 5 coherence pass). One loudness hierarchy — UI ticks stay
 * quiet (~0.08), event feedback mid (~0.10–0.18), impacts big (~0.3–0.4):
 *
 * | event                | voice                              | gain   |
 * |----------------------|------------------------------------|--------|
 * | pickup               | bright square chirp                | 0.14   |
 * | heart                | warm sine two-note                 | 0.16   |
 * | menu move            | tiny square tick (UI tier)         | 0.08   |
 * | white ring (ladder)  | rising square/sine chime           | 0.13   |
 * | yellow ring (bomb)   | huge layered boom                  | 0.40   |
 * | red ring (trap)      | descending two-beep alarm          | 0.13   |
 * | damage / explosion   | low descending thud / crunch       | 0.30+  |
 * | finish fanfare       | triangle arpeggio, tiered by medal | 0.16–0.2 |
 * | unlock jingle        | fast bright octave run             | 0.12   |
 *
 * The three ring passes are deliberately distinct timbres AND directions:
 * white rises (reward), yellow detonates (payoff), red falls (threat).
 */

import type { MedalTier } from '../systems/Medal';

export class Sfx {
  private context: AudioContext | null = null;
  private isMuted = false;
  private unavailable = false;

  /** Creates/resumes the AudioContext. Call from any user-gesture handler. */
  public resume(): void {
    if (this.unavailable) return;
    if (!this.context) {
      const Ctor = resolveAudioContextCtor();
      if (!Ctor) {
        this.unavailable = true;
        return;
      }
      try {
        this.context = new Ctor();
      } catch {
        this.unavailable = true;
        return;
      }
    }
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => {
        this.unavailable = true;
      });
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public get muted(): boolean {
    return this.isMuted;
  }

  /** Package pickup: quick bright chirp (cyan feedback). */
  public pickup(): void {
    this.tone({ type: 'square', from: 720, to: 1240, duration: 0.09, gain: 0.14, delay: 0 });
  }

  /** Heart pickup: warm two-note chime (pink feedback). */
  public heart(): void {
    this.tone({ type: 'sine', from: 523, to: 523, duration: 0.09, gain: 0.16, delay: 0 });
    this.tone({ type: 'sine', from: 784, to: 784, duration: 0.16, gain: 0.16, delay: 0.08 });
  }

  /** Damage: low descending thud (magenta feedback). */
  public damage(): void {
    this.tone({ type: 'sine', from: 165, to: 52, duration: 0.2, gain: 0.34, delay: 0 });
    this.tone({ type: 'square', from: 110, to: 48, duration: 0.16, gain: 0.12, delay: 0 });
  }

  /** Knock-off death: falling saw sting. */
  public death(): void {
    this.tone({ type: 'sawtooth', from: 440, to: 92, duration: 0.55, gain: 0.2, delay: 0.05 });
    this.tone({ type: 'sawtooth', from: 220, to: 60, duration: 0.6, gain: 0.12, delay: 0.12 });
  }

  /**
   * Finish fanfare, tiered by medal: Gold rings out a five-note run with a
   * high sparkle tail, Silver keeps the classic four-note arpeggio, Bronze
   * settles for three lower notes, and a medal-less finish still gets a
   * modest two-note "delivered" motif. Same triangle family throughout —
   * the tier reads through length and register, not a different instrument.
   */
  public finish(medal: MedalTier = 'gold'): void {
    switch (medal) {
      case 'gold': {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
        notes.forEach((frequency, index) => {
          this.tone({ type: 'triangle', from: frequency, to: frequency, duration: 0.2, gain: 0.19, delay: index * 0.1 });
        });
        this.tone({ type: 'sine', from: 2093, to: 2093, duration: 0.45, gain: 0.12, delay: notes.length * 0.1 });
        this.tone({ type: 'triangle', from: 1046.5, to: 1568, duration: 0.4, gain: 0.13, delay: notes.length * 0.1 });
        break;
      }
      case 'silver': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((frequency, index) => {
          this.tone({ type: 'triangle', from: frequency, to: frequency, duration: 0.22, gain: 0.18, delay: index * 0.11 });
        });
        this.tone({ type: 'triangle', from: 1046.5, to: 1318.5, duration: 0.4, gain: 0.14, delay: notes.length * 0.11 });
        break;
      }
      case 'bronze': {
        const notes = [440, 523.25, 659.25];
        notes.forEach((frequency, index) => {
          this.tone({ type: 'triangle', from: frequency, to: frequency, duration: 0.2, gain: 0.16, delay: index * 0.12 });
        });
        break;
      }
      case 'none': {
        this.tone({ type: 'triangle', from: 392, to: 392, duration: 0.18, gain: 0.13, delay: 0 });
        this.tone({ type: 'triangle', from: 523.25, to: 523.25, duration: 0.26, gain: 0.13, delay: 0.14 });
        break;
      }
    }
  }

  /**
   * Unlock celebration jingle: a fast bright run leaping an octave — clearly
   * a "something opened" moment, distinct from the finish fanfare's stately
   * climb. Scheduled with a delay so it can land right after the fanfare.
   */
  public unlock(delay = 0): void {
    const notes = [659.25, 783.99, 987.77, 1318.5];
    notes.forEach((frequency, index) => {
      this.tone({ type: 'square', from: frequency, to: frequency, duration: 0.11, gain: 0.1, delay: delay + index * 0.09 });
    });
    this.tone({ type: 'sine', from: 2637, to: 2637, duration: 0.3, gain: 0.09, delay: delay + notes.length * 0.09 });
    this.tone({ type: 'triangle', from: 1318.5, to: 1760, duration: 0.34, gain: 0.12, delay: delay + notes.length * 0.09 });
  }

  /** Menu cursor move (level select): a tiny low-gain UI tick. */
  public move(): void {
    this.tone({ type: 'square', from: 660, to: 660, duration: 0.05, gain: 0.08, delay: 0 });
  }

  /** Cannon shot, per weapon class: bolt zap / laser sweep / rocket thump. */
  public shoot(kind: 'bolt' | 'laser' | 'rocket'): void {
    switch (kind) {
      case 'bolt':
        this.tone({ type: 'square', from: 940, to: 420, duration: 0.08, gain: 0.1, delay: 0 });
        break;
      case 'laser':
        this.tone({ type: 'sawtooth', from: 1760, to: 260, duration: 0.16, gain: 0.12, delay: 0 });
        this.tone({ type: 'square', from: 2400, to: 900, duration: 0.06, gain: 0.06, delay: 0 });
        break;
      case 'rocket':
        this.tone({ type: 'triangle', from: 200, to: 90, duration: 0.18, gain: 0.16, delay: 0 });
        this.tone({ type: 'square', from: 620, to: 180, duration: 0.1, gain: 0.07, delay: 0.01 });
        break;
    }
  }

  /** Enemy destruction (cannon kill, asteroid crash): crunch + low thump. */
  public explosion(): void {
    this.tone({ type: 'sine', from: 150, to: 42, duration: 0.24, gain: 0.3, delay: 0 });
    this.tone({ type: 'square', from: 320, to: 70, duration: 0.16, gain: 0.12, delay: 0.01 });
  }

  /** Smart bomb: big layered boom with a long low tail. */
  public bomb(): void {
    this.tone({ type: 'sine', from: 110, to: 30, duration: 0.55, gain: 0.4, delay: 0 });
    this.tone({ type: 'sawtooth', from: 420, to: 60, duration: 0.4, gain: 0.16, delay: 0.02 });
    this.tone({ type: 'square', from: 900, to: 120, duration: 0.2, gain: 0.1, delay: 0 });
  }

  /** White ring: weapon ladder up — bright two-step rising chime. */
  public ladderUp(): void {
    this.tone({ type: 'square', from: 660, to: 660, duration: 0.09, gain: 0.13, delay: 0 });
    this.tone({ type: 'square', from: 990, to: 990, duration: 0.16, gain: 0.13, delay: 0.08 });
    this.tone({ type: 'sine', from: 1320, to: 1320, duration: 0.2, gain: 0.1, delay: 0.16 });
  }

  /** Jump pod launch: airy rising whoosh (the catapult kicks). */
  public whoosh(): void {
    this.tone({ type: 'sawtooth', from: 170, to: 760, duration: 0.3, gain: 0.09, delay: 0 });
    this.tone({ type: 'sine', from: 340, to: 1500, duration: 0.24, gain: 0.09, delay: 0.02 });
  }

  /** Touchdown: soft low thud plus a dusty click. */
  public land(): void {
    this.tone({ type: 'sine', from: 130, to: 44, duration: 0.16, gain: 0.26, delay: 0 });
    this.tone({ type: 'triangle', from: 460, to: 170, duration: 0.08, gain: 0.08, delay: 0.01 });
  }

  /** Red ring trap: menacing two-beep descending alarm (loudest of the three ring voices — it is the threat). */
  public alarm(): void {
    this.tone({ type: 'square', from: 900, to: 640, duration: 0.11, gain: 0.13, delay: 0 });
    this.tone({ type: 'square', from: 640, to: 420, duration: 0.18, gain: 0.13, delay: 0.13 });
  }

  /** Releases the AudioContext (teardown). */
  public dispose(): void {
    if (this.context) {
      void this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  /**
   * One enveloped oscillator: exponential pitch glide + gain attack/decay.
   * Everything is scheduled up front, so the sound never blocks the frame.
   */
  private tone(options: {
    type: OscillatorType;
    from: number;
    to: number;
    duration: number;
    gain: number;
    delay: number;
  }): void {
    if (this.isMuted || !this.context || this.context.state !== 'running') return;
    const context = this.context;
    const start = context.currentTime + options.delay;
    const stop = start + options.duration;

    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(Math.max(1, options.from), start);
    if (options.to !== options.from) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), stop);
    }

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(options.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(stop);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}

type AudioContextCtor = new () => AudioContext;

/** Best-effort AudioContext lookup; null when audio is unavailable. */
function resolveAudioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}
