/**
 * @file core/audio.js — procedural SFX through a lazy AudioContext (created
 * on the first user gesture only — autoplay policy; main.js routeAction
 * unlocks on every action emission, so the first keydown/pointerdown opens
 * it and captures, which never gesture, stay silent-safe by construction).
 * Design 8 / task 5.2: master gain opens to CONFIG.AUDIO.master at unlock.
 * Every play no-ops before unlock and builds only short-lived nodes
 * (oscillator/buffer-source -> gain -> master) reaped after their stop time.
 */
import { CONFIG } from "./config.js";

export class AudioManager {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this._master = null;
    this._noise = null; // shared looped white-noise buffer (unlock-time)
  }

  /** Safe to call repeatedly. First gesture only — never at boot. */
  unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      this._master = this.ctx.createGain();
      this._master.gain.value = CONFIG.AUDIO.master;
      this._master.connect(this.ctx.destination);
      const len = Math.ceil(this.ctx.sampleRate * CONFIG.AUDIO.noiseS);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; // audio noise, not gameplay rng
      this._noise = buf;
    } catch {
      this.ctx = null;
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  /* QA play mirror (window.__QA_SFX, qa/hooks.js under ?qa=1 — the
   * __QA_ACTIONS precedent; .qa/audio_probe.mjs consumes it). */
  _count(name) {
    const t = window.__QA_SFX;
    if (t) t[name] = (t[name] || 0) + 1;
  }

  // -- SFX (all no-op before unlock; tunables in CONFIG.AUDIO) --------------

  /** UI confirm: menu select/start, pause resume/restart/quit, gameover retry. */
  ui() {
    this._count("ui");
    this._blip(CONFIG.AUDIO.ui);
  }

  /** Pickup collect: rising triangle chirp. */
  pickup() {
    this._count("pickup");
    this._blip(CONFIG.AUDIO.pickup);
  }

  /** Jump: short high tick. */
  jump() {
    this._count("jump");
    this._blip(CONFIG.AUDIO.jump);
  }

  /** Lane change: subtle filtered-noise sweep. */
  whoosh() {
    this._count("whoosh");
    this._noiseVoice(CONFIG.AUDIO.whoosh);
  }

  /** Slide: the whoosh path an octave lower, longer, softer. */
  swish() {
    this._count("swish");
    this._noiseVoice(CONFIG.AUDIO.swish);
  }

  /** Death: sawtooth pitch-drop + noise burst. */
  death() {
    this._count("death");
    const ctx = this.ctx;
    if (!ctx) return;
    const A = CONFIG.AUDIO.death;
    const osc = ctx.createOscillator();
    osc.type = A.type;
    osc.frequency.setValueAtTime(A.f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(A.f1, ctx.currentTime + A.dur);
    this._burst(osc, osc, A.vol, A.dur);
    this._noiseVoice(A.noise);
  }

  // -- synth helpers ---------------------------------------------------------

  /* One oscillator with an exponential pitch move + gain decay. */
  _blip(p) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.f0, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(p.f1, ctx.currentTime + p.dur);
    this._burst(osc, osc, p.vol, p.dur);
  }

  /* Route `entry`'s chain through a decaying gain to the master; start/stop
   * `src` (== entry for oscillators, the upstream buffer source for the
   * filtered noise path — filter nodes have no start()). */
  _burst(src, entry, vol, dur) {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    entry.connect(g);
    g.connect(this._master);
    src.start(t);
    src.stop(t + dur);
  }

  /* Shared-noise band-pass sweep (whoosh / swish / death burst). */
  _noiseVoice(p) {
    const ctx = this.ctx;
    if (!ctx || !this._noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = p.q;
    f.frequency.setValueAtTime(p.f0, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(p.f1, ctx.currentTime + p.dur);
    src.connect(f);
    this._burst(src, f, p.vol, p.dur);
  }

  dispose() {
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
