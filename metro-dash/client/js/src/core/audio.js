/**
 * @file core/audio.js
 * WAVE 5 — fully procedural WebAudio: a light 4-bar looping groove
 * (bass + hats + pluck melody, lookahead-scheduled) plus synthesized SFX for
 * every gameplay moment. NO audio assets anywhere — oscillators, one shared
 * noise buffer, biquad filters, gains.
 *
 * Hard guarantees:
 *  - LAZY: the AudioContext is created only inside _unlock(), which fires on
 *    the first real user gesture (pointerdown/keydown). Boot and the headless
 *    QA capture never construct it — zero autoplay attempts, zero console
 *    errors, screenshots unaffected.
 *  - SILENT WHEN MUTED: master gain ramps to 0 and the music scheduler idles
 *    while muted; toggling back resumes the loop in phase.
 *  - D6 PER-BUS SETTINGS: separate music / sfx on-off settings (musicOn /
 *    sfxOn, persisted by main.js under late_again_music / late_again_sfx,
 *    missing key = on). Effective music = musicOn && !muted (the same idle
 *    gate as mute); sfx off early-returns play(). Master mute sits on top.
 *  - Mix architecture:  musicBus (-14 dB) --\
 *                              master gain -> limiter (DynamicsCompressor) -> destination
 *                      sfxBus    (-8 dB) --/
 *  - Every method is safe to call before the context exists (no-ops).
 */
export const AUDIO = {
  musicGainDb: -14,
  sfxGainDb: -8,
  bpm: 126,
  lookahead: 0.14, // s scheduled ahead of ctx.currentTime
  timerMs: 30,
  bars: 4,
  stepsPerBar: 16, // 16th notes
};

/** dB -> linear gain. */
const db = (v) => Math.pow(10, v / 20);

// NOTE frequencies (Hz).
const N = {
  A1: 55, C2: 65.41, D2: 73.42, E2: 82.41, G2: 98, A2: 110, C3: 130.81,
  D3: 146.83, E3: 164.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63,
  G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.26, G5: 783.99, A5: 880,
  B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093,
};

/** 4-bar groove (64 16th steps). "-" = rest. */
const BASS = [
  // Bar 1: driving A root.               Bar 2: lift to C/G.
  N.A1, 0, N.A2, 0, N.A1, 0, N.A1, N.G2, N.A1, 0, N.A2, 0, N.A1, 0, N.G2, 0,
  N.C2, 0, N.C3, 0, N.C2, 0, N.C2, N.D3, N.G2, 0, N.G2, 0, N.C2, 0, N.D3, 0,
  // Bar 3: back to A with a push.       Bar 4: turnaround walk-up.
  N.A1, 0, N.A2, 0, N.A1, 0, N.A1, N.G2, N.A1, 0, N.A2, 0, N.E2, 0, N.G2, 0,
  N.A1, 0, N.A2, 0, N.C3, 0, N.D3, 0, N.E3, 0, N.E2, N.G2, N.A2, 0, N.D3, 0,
];
/** Pluck melody (sparse, pentatonic — rests dominate so it stays light). */
const MELODY = [
  0, 0, N.E4, 0, N.A4, 0, 0, N.C5, 0, N.A4, 0, 0, N.G4, 0, N.E4, 0,
  0, 0, N.C5, 0, 0, N.E5, 0, N.D5, N.C5, 0, N.G4, 0, 0, 0, 0, 0,
  N.A4, 0, 0, N.C5, 0, 0, N.E5, 0, N.D5, 0, N.C5, N.A4, 0, 0, N.G4, 0,
  0, N.A4, 0, 0, N.E4, N.G4, N.A4, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
/** Hat pattern: 1 = closed tick, 2 = open-ish accent (offbeats + bar ends). */
const HAT = [
  1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 2, 0,
  1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 2, 0,
  1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 2, 0,
  1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 2, 0, 2, 0,
];

const LS_MUTE_KEY = "late_again_muted";
// D6: per-bus settings, persisted by main.js; missing key = ON, "0" = off.
const LS_MUSIC_KEY = "late_again_music";
const LS_SFX_KEY = "late_again_sfx";

export class AudioManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.enabled = true; // false = muted (persisted by main.js)
    this._muted = false;
    /** D6: music setting. Missing LS key = on; "0" = off; else truthy = on. */
    this.musicOn = true;
    /** D6: sfx setting (same convention). play() early-returns while off. */
    this.sfxOn = true;
    try {
      this._muted = localStorage.getItem(LS_MUTE_KEY) === "1";
      this.enabled = !this._muted;
      this.musicOn = localStorage.getItem(LS_MUSIC_KEY) !== "0";
      this.sfxOn = localStorage.getItem(LS_SFX_KEY) !== "0";
    } catch {
      /* storage unavailable */
    }

    // Bus nodes (created with the context).
    this._master = null;
    this._musicBus = null;
    this._sfxBus = null;
    this._noise = null;

    // Music scheduler state. `_musicWanted` is the "a run wants the groove"
    // flag (startMusic/stopMusic) — distinct from the musicOn SETTING above;
    // the scheduler actually runs only when wanted AND musicOn AND !muted.
    this._musicWanted = false;
    this._step = 0;
    this._nextTime = 0;
    this._timer = 0;
    this._stepsTotal = AUDIO.bars * AUDIO.stepsPerBar;

    this._unlockBound = this._unlock.bind(this);
    window.addEventListener("pointerdown", this._unlockBound, { once: false });
    window.addEventListener("keydown", this._unlockBound, { once: false });
  }

  /** True once the muted state as persisted by main.js. */
  get muted() {
    return this._muted;
  }

  /**
   * Create the context + bus graph on the first gesture (no-op if it exists).
   * NEVER called at boot — autoplay-safe, headless-capture-safe.
   * @private
   */
  _unlock() {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          this.ctx = new Ctx();
          this._buildGraph();
          if (this._musicWanted && this.musicOn && !this._muted) this._startScheduler();
        }
      } catch {
        this.ctx = null; // audio is strictly optional
      }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  /** @private Build master limiter + music/sfx buses + the shared noise buffer. */
  _buildGraph() {
    const ctx = this.ctx;
    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0 : 1;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    this._musicBus = ctx.createGain();
    this._musicBus.gain.value = db(AUDIO.musicGainDb);
    this._sfxBus = ctx.createGain();
    this._sfxBus.gain.value = db(AUDIO.sfxGainDb);

    this._musicBus.connect(this._master);
    this._sfxBus.connect(this._master);
    this._master.connect(limiter);
    limiter.connect(ctx.destination);

    // 1 s of white noise, shared by every noise-based SFX (hat/whoosh/crash).
    const len = ctx.sampleRate;
    this._noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this._noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // ---------------------------------------------------------------------
  // Music: 4-bar loop scheduled with lookahead (works even while the main
  // thread hiccups; every voice is a fire-and-forget oscillator).
  // ---------------------------------------------------------------------

  /**
   * Begin the groove (no-op while muted, while the music setting is off, or
   * before the first gesture). The desired flag survives muted/music-off
   * pauses so either being restored resumes the loop in phase.
   */
  startMusic() {
    this._musicWanted = true;
    if (this.ctx && this.musicOn && !this._muted) this._startScheduler();
  }

  stopMusic() {
    this._musicWanted = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = 0;
    }
  }

  /** @private */
  _startScheduler() {
    if (this._timer || !this.ctx) return;
    // (Re)start from "now": after a mute pause the stale _nextTime would
    // otherwise trigger a catch-up burst of scheduled steps.
    if (this._nextTime < this.ctx.currentTime) this._nextTime = this.ctx.currentTime + 0.06;
    this._timer = setInterval(() => this._schedule(), AUDIO.timerMs);
  }

  /** @private Lookahead scheduler: queue every step falling inside the window. */
  _schedule() {
    if (!this.ctx || this._muted || !this.musicOn) return;
    const stepDur = 60 / AUDIO.bpm / 4;
    while (this._nextTime < this.ctx.currentTime + AUDIO.lookahead) {
      const s = this._step % this._stepsTotal;
      const t = this._nextTime;
      if (BASS[s]) this._bass(BASS[s], t, stepDur);
      if (MELODY[s]) this._pluck(MELODY[s], t, stepDur);
      if (HAT[s]) this._hat(HAT[s] === 2, t);
      this._step++;
      this._nextTime += stepDur;
    }
  }

  /** @private Round synth bass: sine + soft triangle blend, tight envelope. */
  _bass(freq, t, stepDur) {
    const ctx = this.ctx;
    const dur = stepDur * 1.7;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    const sub = ctx.createOscillator();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    osc.connect(g);
    sub.connect(g2);
    g2.connect(g);
    g.connect(this._musicBus);
    osc.start(t);
    sub.start(t);
    osc.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
  }

  /** @private Pluck lead: triangle with a fast decay + a whisper of square. */
  _pluck(freq, t, stepDur) {
    const ctx = this.ctx;
    const dur = stepDur * 2.6;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);
    const sparkle = ctx.createOscillator();
    sparkle.type = "square";
    sparkle.frequency.setValueAtTime(freq * 2, t);
    const sg = ctx.createGain();
    sg.gain.value = 0.06;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.24, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    sparkle.connect(sg);
    sg.connect(g);
    g.connect(this._musicBus);
    osc.start(t);
    sparkle.start(t);
    osc.stop(t + dur + 0.02);
    sparkle.stop(t + dur + 0.02);
  }

  /** @private Hat: high-passed noise tick (accent = slightly longer/louder). */
  _hat(accent, t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const dur = accent ? 0.09 : 0.035;
    g.gain.setValueAtTime(accent ? 0.28 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(this._musicBus);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  // ---------------------------------------------------------------------
  // SFX (all synthesized, routed to the sfx bus)
  // ---------------------------------------------------------------------

  /**
   * Play a named SFX. Unknown ids, pre-gesture calls, master mute and the
   * sfx-off setting (D6) are all silent no-ops.
   * @param {string} id coin|jump|roll|lane|crash|powerup
   */
  play(id) {
    if (!this.ctx || this._muted || !this.sfxOn) return;
    switch (id) {
      case "coin": this._sfxCoin(); break;
      case "jump": this._sfxJump(); break;
      case "roll": this._sfxRoll(); break;
      case "lane": this._sfxLane(); break;
      case "crash": this._sfxCrash(); break;
      case "powerup": this._sfxPowerup(); break;
      default: break;
    }
  }

  /** @private Bright coin ding: two detuned sines, fast sparkle decay. */
  _sfxCoin() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (const [f, g0, d] of [[N.G6, 0.16, 0.16], [N.C7, 0.1, 0.22]]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.02, t + d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(g0, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.connect(g);
      g.connect(this._sfxBus);
      osc.start(t);
      osc.stop(t + d + 0.02);
    }
  }

  /** @private Shared noise-voice helper (bandpass sweep). */
  _noiseVoice(t, dur, f0, f1, gain, q = 1.2, type = "bandpass") {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this._sfxBus);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.05);
  }

  /** @private Jump: airy whoosh sweeping up. */
  _sfxJump() {
    this._noiseVoice(this.ctx.currentTime, 0.26, 420, 2400, 0.3, 1.6);
  }

  /** @private Roll: short gravelly scrape (low band, wobble via two voices). */
  _sfxRoll() {
    const t = this.ctx.currentTime;
    this._noiseVoice(t, 0.3, 260, 720, 0.26, 0.9);
    this._noiseVoice(t + 0.05, 0.2, 900, 500, 0.12, 1.4);
  }

  /** @private Lane switch: quick soft whoosh. */
  _sfxLane() {
    this._noiseVoice(this.ctx.currentTime, 0.16, 900, 1900, 0.2, 1.8);
  }

  /** @private Crash: noise burst + low pitch-dropping thud. */
  _sfxCrash() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this._noiseVoice(t, 0.42, 1800, 160, 0.55, 0.6, "lowpass");
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    osc.connect(g);
    g.connect(this._sfxBus);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** @private Powerup: rising major arpeggio (4 quick plucks). */
  _sfxPowerup() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = [N.A4, N.C5, N.E5, N.A5];
    notes.forEach((f, i) => {
      const at = t + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.22, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      osc.connect(g);
      g.connect(this._sfxBus);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  }

  // ---------------------------------------------------------------------
  // Mute + per-bus settings (D6)
  // ---------------------------------------------------------------------

  /**
   * Mute/unmute. Silent when muted: the master gain ramps to 0 AND the
   * scheduler pauses (the desired-playing flag survives so unmuting resumes
   * the groove — unless the music setting itself is off). Persistence
   * (localStorage) is owned by the caller (main.js).
   * @param {boolean} on
   */
  setMuted(on) {
    this._muted = on;
    this.enabled = !on;
    if (on) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = 0;
      }
    } else if (this.ctx && this._musicWanted && this.musicOn) {
      this._startScheduler();
    }
    if (this._master && this.ctx) {
      const g = this._master.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setTargetAtTime(this._muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * D6: music setting. Effective audibility = musicOn && !muted, so turning
   * music off idles the scheduler exactly like mute does (the desired-playing
   * flag survives); turning it back on resumes the loop in phase when a run
   * wants it and the master is unmuted. Persistence is owned by the caller.
   * @param {boolean} on
   */
  setMusicOn(on) {
    this.musicOn = on;
    if (!on) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = 0;
      }
    } else if (this.ctx && this._musicWanted && !this._muted) {
      this._startScheduler();
    }
  }

  /**
   * D6: sfx setting — play() early-returns while off; nothing else changes
   * (sfx voices are fire-and-forget, there is no scheduler to idle).
   * Persistence is owned by the caller (main.js).
   * @param {boolean} on
   */
  setSfxOn(on) {
    this.sfxOn = on;
  }

  dispose() {
    this.stopMusic();
    window.removeEventListener("pointerdown", this._unlockBound);
    window.removeEventListener("keydown", this._unlockBound);
    if (this.ctx) this.ctx.close().catch(() => {});
  }
}
