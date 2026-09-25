// W1-AUDIO — WebAudio synth engine (ARCHITECTURE.md: src/audio/Audio.js).
// 100% synthesized — no assets, no libraries. Lazy init on the first user
// gesture; before that every call is a silent no-op. Audio must never break
// the game: context construction/resume are feature-detected and guarded
// once, everything else assumes a live context.
//
// Music: procedural synthwave @ 124 BPM, 16-step bar, 4-bar loop (Am–F–C–G).
// Combo tiers layer up on bus 'combo:change'{tier}:
//   t1 kick+bass+pad · t2 +hats+clap+arp · t3 +lead · t4 +octave-bass.
// Layer gains ramp in/out over ~0.3 s (setTargetAtTime τ=0.16). Kick pumps a
// sidechain-style duck on every non-kick layer; crash / phase-warp duck the
// whole music bus. Menu variant: pad + slow arp + soft whole-note bass.
//
// API:  Audio.init({ save, bus })   — one call from main.js; ALL bus wiring
//                                     lives here, Audio owns it.
//       Audio.sfx('coin')           — direct one-shots
//       Audio.music.setTier(n)      — contract accessor
//       Audio.setMute(bool)         — persists via save.settings.mute; M key
//                                     toggles (Input has no 'mute' action, so
//                                     this module listens for KeyM itself).
//       window.__NR_AUDIO_DEBUG     — tiny QA probe (guarded, getters only):
//                                     { unlocked, ctxState, musicPlaying, tier,
//                                       mode, activeVoices, muted, sfx{} }
import { setSoundProvider } from '../core/Sound.js';

const BPM = 124;
const STEP_S = 60 / BPM / 4;        // 16th note = 0.12097 s
const BAR_S = STEP_S * 16;
const LOOKAHEAD = 0.14;             // seconds scheduled ahead of ctx time
const TICK_MS = 25;                 // sequencer poll interval
const MASTER_LEVEL = 0.85;

// 4-bar progression: Am — F — C — G (i–VI–III–VII). Bass roots 43–65 Hz;
// octave-up notes capped at 110 Hz so the low end stays where it belongs.
const ROOTS = [55.0, 43.65, 65.41, 49.0];
const ROOTS_OCT = [110.0, 87.3, 110.0, 98.0];       // min(root*2, 110)
const CHORD = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]]; // semis over root

// Layer gains per combo tier (index tier-1). 0 = silent layer.
const TIER_GAINS = {
  kick:    [0.95, 0.95, 0.95, 1.00],
  bass:    [0.85, 0.90, 0.95, 1.00],
  bassOct: [0.00, 0.00, 0.00, 0.60],
  pad:     [0.55, 0.50, 0.45, 0.42],
  hats:    [0.00, 0.50, 0.55, 0.65],
  clap:    [0.00, 0.40, 0.45, 0.55],
  arp:     [0.00, 0.45, 0.50, 0.55],
  lead:    [0.00, 0.00, 0.50, 0.60],
};
const MENU_GAINS = { kick: 0, bass: 0.40, bassOct: 0, pad: 0.65, hats: 0, clap: 0, arp: 0.30, lead: 0 };
const LAYERS = ['kick', 'bass', 'bassOct', 'pad', 'hats', 'clap', 'arp', 'lead'];

// 16th arp order over chord tones [c0,c1,c2,octave]
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 3, 1, 2, 0, 2];
// 4-bar lead phrase (64 steps), semitones relative to A4, -1 = rest.
const LEAD = [
  0, -1, -1, -1,  3, -1,  7, -1,  5, -1,  3, -1,  0, -1, -1, -1,
  8, -1, -1, -1,  7, -1, -1, -1,  5, -1, -1, -1,  3, -1,  5, -1,
  3, -1, -1,  3,  7, -1, -1, -1, 10, -1,  7, -1,  5, -1,  3, -1,
  7, -1, -1, -1, 10, -1, 12, -1, 10, -1,  7, -1,  5, -1,  7, -1,
];
const SEMI = (f, s) => f * Math.pow(2, s / 12);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

class AudioEngine {
  constructor() {
    this.ac = null;            // AudioContext (lazy, on first gesture)
    this.disabled = false;     // WebAudio unavailable — stay silent forever
    this.unlocked = false;
    this.muted = false;
    this.mode = 'menu';        // 'menu' | 'run'
    this.tier = 1;             // music layer tier 1..4
    this.coinTier = 1;         // combo tier 1..5 — coin pitch follows it
    this.musicOn = false;
    this.step = 0;
    this.bar = 0;
    this.nextT = 0;
    this.voices = 0;
    this.sfxCounts = {};
    this._duckHold = 0;        // pump skips while a crash/warp duck owns the bus
    this._timer = 0;
    this._wasAir = false;      // landing-thud poll state (grounded transitions)
    this._airV = 0;            // most negative vy seen while airborne
    this._inited = false;
    this.save = null;
    this.bus = null;
    this.layerG = {};
    // contract surface: Audio.sfx(...) + Audio.music.setTier(n)
    this.music = {
      setTier: (n) => this._setTier(n),
      setMode: (m) => this._setMode(m),
    };
    this._voiceEnd = this._onVoiceEnd.bind(this);
    this._tick = this._tick.bind(this);
  }

  // ---- boot ------------------------------------------------------------------

  init({ save, bus } = {}) {
    if (this._inited) return;
    this._inited = true;
    this.save = save || null;
    this.bus = bus || null;
    const s = save && save.data && save.data.settings;
    this.muted = !!(s && s.mute);

    this._wireBus();
    this._wireLegacy();
    this._wireUnlock();
    this._watchLanding();
    this._attachDebug();
  }

  // First user gesture → create/resume the context. Browsers suspend audio
  // until a gesture; creating it here also satisfies that on the same tick.
  _wireUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => this._unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.code === 'KeyM' && !e.repeat) this.setMute(!this.muted); // Input has no 'mute' action
    });
  }

  _unlock() {
    if (this.unlocked || this.disabled) return;
    if (!this._build()) return;
    this._tryResume();
  }

  // Landing thud: Player emits no bus event for ground contact (fx/FX.js polls
  // the same fields for dust — "no bus events exist for these"), so Audio polls
  // the debug handle once per frame. Reads primitives only — zero allocs; and
  // no-ops until __NR exists or the player is in a real run.
  _watchLanding() {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) return;
    const poll = () => {
      window.requestAnimationFrame(poll);
      const g = window.__NR;
      const pl = g && g.game && g.game.player;
      if (!pl || !this.unlocked || this.disabled) { this._wasAir = false; this._airV = 0; return; }
      if (!pl.grounded) {
        this._wasAir = true;
        if (pl.vy < this._airV) this._airV = pl.vy;
        return;
      }
      if (this._wasAir && this.mode === 'run' && !pl.ghost && !pl.dead &&
          g.game.state === 'RUN' && !g.game.warping) {
        this._play('land', clamp(-this._airV / 9.2, 0.3, 1)); // JUMP_V ≈ 9.2 → full thud
      }
      this._wasAir = false;
      this._airV = 0;
    };
    window.requestAnimationFrame(poll);
  }

  _tryResume() {
    const ac = this.ac;
    if (!ac) return;
    if (ac.state === 'running') { this._onLive(); return; }
    const p = ac.resume();
    if (p && p.then) p.then(() => this._onLive()).catch(() => { /* no gesture yet */ });
  }

  _onLive() {
    if (this.unlocked || !this.ac || this.ac.state !== 'running') return;
    this.unlocked = true;
    this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, this.ac.currentTime, 0.02);
    this._applyGains(0.05);
    this._startMusic();
  }

  // Feature-detect + build the whole graph once. Any failure = silent mode.
  _build() {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { this.disabled = true; return false; }
    try {
      const ac = new AC();
      this.ac = ac;
      ac.addEventListener('statechange', () => { if (ac.state === 'running') this._onLive(); });

      // master chain: [musicOut / sfxBus] → glue comp → limiter → master → out
      this.master = ac.createGain();
      this.master.gain.value = 0; // ramped up once unlocked (respects mute)
      const glue = ac.createDynamicsCompressor();
      glue.threshold.value = -16; glue.knee.value = 18; glue.ratio.value = 3;
      glue.attack.value = 0.008; glue.release.value = 0.24;
      const limiter = ac.createDynamicsCompressor();
      limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = 0.002; limiter.release.value = 0.12;
      glue.connect(limiter); limiter.connect(this.master); this.master.connect(ac.destination);

      this.sfxBus = ac.createGain();
      this.sfxBus.gain.value = 1;
      this.sfxBus.connect(glue);

      this.musicOut = ac.createGain();
      this.musicOut.gain.value = 0.9;
      this.duck = ac.createGain();       // sidechain-style pump bus (everything but kick)
      this.duck.gain.value = 1;
      this.duck.connect(this.musicOut);
      this.musicOut.connect(glue);

      for (const name of LAYERS) {
        const g = ac.createGain();
        g.gain.value = 0;
        g.connect(name === 'kick' ? this.musicOut : this.duck);
        this.layerG[name] = g;
      }

      // shared dotted-8th delay for arp/lead
      this.delaySend = ac.createGain();
      this.delaySend.gain.value = 1;
      const delay = ac.createDelay(1.0);
      delay.delayTime.value = STEP_S * 3;
      const fb = ac.createGain(); fb.gain.value = 0.32;
      const dFilt = ac.createBiquadFilter();
      dFilt.type = 'lowpass'; dFilt.frequency.value = 3000;
      this.delaySend.connect(delay);
      delay.connect(dFilt);
      dFilt.connect(fb); fb.connect(delay);
      dFilt.connect(this.musicOut);

      // shared white-noise buffer (all noise voices reuse it)
      const len = (ac.sampleRate * 1.2) | 0;
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // soft-clip curve for the crash waveshaper
      const curve = new Float32Array(257);
      for (let i = 0; i < 257; i++) {
        const x = (i / 256) * 2 - 1;
        curve[i] = (3 + 24) * x / (3 + 24 * Math.abs(x));
      }
      this.distCurve = curve;
      return true;
    } catch (e) {
      this.disabled = true; // no WebAudio here — audio stays a no-op, game unaffected
      this.ac = null;
      return false;
    }
  }

  // ---- mute ------------------------------------------------------------------

  setMute(m) {
    this.muted = !!m;
    if (this.save && this.save.data && this.save.data.settings) {
      this.save.data.settings.mute = this.muted; // matches Save.js schema
      this.save.save();                          // debounced flush
    }
    if (this.ac && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, this.ac.currentTime, 0.02);
    }
    if (this.bus) this.bus.emit('ui:toast', { msg: this.muted ? 'AUDIO MUTED' : 'AUDIO ON', kind: 'system' });
  }

  // ---- music engine ------------------------------------------------------------

  _startMusic() {
    if (this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.bar = 0;
    this.nextT = this.ac.currentTime + 0.1;
    this._timer = setInterval(this._tick, TICK_MS);
  }

  _tick() {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.musicOn) return;
    const now = ac.currentTime;
    if (this.nextT < now - 0.2) this.nextT = now + 0.05; // catch up after suspension
    while (this.nextT < now + LOOKAHEAD) {
      this._scheduleStep(this.step, this.bar, this.nextT);
      this.nextT += STEP_S;
      this.step++;
      if (this.step === 16) { this.step = 0; this.bar++; }
    }
  }

  _scheduleStep(step, bar, t) {
    const ch = bar % 4;
    const root = ROOTS[ch];
    if (this.mode === 'run') {
      const T = this.tier;
      // kick: four-on-floor (+ ghost at 14 from tier 4)
      if (step % 4 === 0) {
        this._kick(t, 1);
        this._pump(t);
      } else if (step === 14 && T >= 4) {
        this._kick(t, 0.55);
      }
      // bass: root on down-8ths, octave on off-8ths, 16th pickups from tier 2
      if (step % 2 === 0) {
        const f = step % 4 === 2 ? ROOTS_OCT[ch] : root;
        this._bassNote(t, f, STEP_S * 1.7, 0.6);
      } else if ((step === 7 || step === 15) && T >= 2) {
        this._bassNote(t, root, STEP_S * 0.8, 0.4);
      }
      // octave-bass layer (tier 4): 16th offbeats
      if (T >= 4 && step % 2 === 1) this._bassPluck(t, ROOTS_OCT[ch]);
      // pad: one chord per bar
      if (step === 0) this._padChord(t, ch);
      // hats: open on the "and", closed elsewhere
      if (T >= 2) {
        if (step % 4 === 2) this._hat(t, true, 0.5);
        else this._hat(t, false, step % 4 === 0 ? 0.6 : 0.32);
      }
      // clap backbeat (tier 2+)
      if (T >= 2 && (step === 4 || step === 12)) this._clap(t);
      // arp: driving 16ths (tier 2+); order value 3 = chord octave
      if (T >= 2) {
        const order = ARP_ORDER[step];
        const s = (order === 3) ? 12 : CHORD[ch][order];
        this._arpNote(t, SEMI(root * 8, s), false, step);
      }
      // lead hook (tier 3+)
      if (T >= 3) {
        const v = LEAD[(bar % 4) * 16 + step];
        if (v >= 0) this._leadNote(t, SEMI(440, v), STEP_S * 2.2);
      }
    } else {
      // menu: pad + slow arp + soft whole-note bass
      if (step === 0) {
        this._padChord(t, ch);
        this._bassNote(t, root, STEP_S * 6, 0.42);
      }
      if (step % 2 === 0) {
        const idx = ((step >> 1) + bar) & 3;
        const s = (idx === 3) ? 12 : CHORD[ch][idx]; // 3 = octave sparkle
        this._arpNote(t, SEMI(root * 4, s), true, step);
      }
    }
  }

  // Sidechain-style pump on the duck bus at each kick.
  _pump(t) {
    if (t < this._duckHold) return;
    const g = this.duck.gain;
    g.setValueAtTime(1.0, t);
    g.linearRampToValueAtTime(0.5, t + 0.035);
    g.setTargetAtTime(1.0, t + 0.06, 0.105);
  }

  // Deep duck for crash / phase warp (pump pauses while held).
  _duckMusic(to, tau, hold) {
    if (!this.ac) return;
    const g = this.duck.gain;
    const t = this.ac.currentTime;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + 0.06);
    g.setValueAtTime(to, t + hold);
    g.setTargetAtTime(1, t + hold + 0.06, tau);
    this._duckHold = t + hold + 0.1;
  }

  _unduck() {
    if (!this.ac) return;
    const g = this.duck.gain;
    const t = this.ac.currentTime;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else g.cancelScheduledValues(t);
    this._duckHold = 0;
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1, t, 0.15);
  }

  _setTier(n) {
    const t = clamp((n | 0) || 1, 1, 4);
    this.tier = t;
    this.coinTier = clamp((n | 0) || 1, 1, 5);
    this._applyGains(0.16); // layer ramps ≤ 0.5 s
  }

  _setMode(m) {
    if (m !== 'menu' && m !== 'run') return;
    this.mode = m;
    if (m === 'run') this.bar = 0; // progression restarts on each run
    this._applyGains(0.3);
  }

  _applyGains(tau) {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    const table = this.mode === 'run' ? TIER_GAINS : MENU_GAINS;
    for (const name of LAYERS) {
      const target = this.mode === 'run' ? table[name][this.tier - 1] : table[name];
      this.layerG[name].gain.setTargetAtTime(target, now, tau);
    }
  }

  // ---- music voices (per-note nodes are cheap + GC-safe once disconnected) -----

  _go(osc, t, dur) {
    osc.start(t);
    osc.stop(t + dur);
    osc.onended = this._voiceEnd;
    this.voices++;
  }

  _onVoiceEnd(e) {
    this.voices--;
    const n = e.target;
    if (n && n.disconnect) n.disconnect();
  }

  _noise(t, dur) {
    const s = this.ac.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start(t);
    s.stop(t + dur + 0.05);
    s.onended = this._voiceEnd;
    this.voices++;
    return s;
  }

  _kick(t, vel) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);          // pitch drop 150 → 45 Hz
    o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.95 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(this.layerG.kick);
    this._go(o, t, 0.32);
    // click transient
    const n = this._noise(t, 0.02);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.22 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    n.connect(hp); hp.connect(ng); ng.connect(this.layerG.kick);
  }

  _bassNote(t, f, gate, vel) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 3.2;
    flt.frequency.setValueAtTime(950, t);
    flt.frequency.exponentialRampToValueAtTime(190, t + gate + 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + gate + 0.05);
    o.connect(flt); flt.connect(g); g.connect(this.layerG.bass);
    this._go(o, t, gate + 0.1);
  }

  _bassPluck(t, f) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 500;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + STEP_S * 0.9);
    o.connect(flt); flt.connect(g); g.connect(this.layerG.bassOct);
    this._go(o, t, STEP_S);
  }

  _padChord(t, ch) {
    const ac = this.ac;
    const root = ROOTS[ch] * 4; // A3/F3/C4/G3 register
    const semis = CHORD[ch];
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 0.7;
    flt.frequency.setValueAtTime(600, t);
    flt.frequency.linearRampToValueAtTime(1100, t + BAR_S * 0.6);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.35);
    g.gain.setValueAtTime(0.16, t + BAR_S - 0.05);
    g.gain.linearRampToValueAtTime(0.0001, t + BAR_S + 0.4);
    flt.connect(g); g.connect(this.layerG.pad);
    for (let i = 0; i < 3; i++) {
      const f = SEMI(root, semis[i]);
      for (let d = -7; d <= 7; d += 14) { // ±7 cents detune pair
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = d;
        o.connect(flt);
        this._go(o, t, BAR_S + 0.5);
      }
    }
  }

  _hat(t, open, vel) {
    const ac = this.ac;
    const dur = open ? 0.28 : 0.06;
    const n = this._noise(t, dur);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7800;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.45 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (open ? 0.24 : 0.045));
    n.connect(hp); hp.connect(g); g.connect(this.layerG.hats);
  }

  _clap(t) {
    const ac = this.ac;
    const n = this._noise(t, 0.28);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    // 3 quick bursts + tail = clap
    g.gain.linearRampToValueAtTime(0.7, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.014);
    g.gain.linearRampToValueAtTime(0.65, t + 0.016);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.028);
    g.gain.linearRampToValueAtTime(0.6, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp); bp.connect(g); g.connect(this.layerG.clap);
  }

  _arpNote(t, f, menu, step) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = menu ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 1;
    if (menu) {
      flt.frequency.value = 1600;
    } else {
      flt.frequency.setValueAtTime(3600, t);
      flt.frequency.exponentialRampToValueAtTime(650, t + 0.14);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(menu ? 0.4 : 0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (menu ? 0.26 : 0.17));
    o.connect(flt); flt.connect(g); g.connect(this.layerG.arp);
    g.connect(this.delaySend); // dotted-8th sparkle
    this._go(o, t, menu ? 0.3 : 0.2);
    if (ac.createStereoPanner && !menu) { // alternate 16ths for width
      const p = ac.createStereoPanner();
      p.pan.value = (step & 1) ? 0.3 : -0.3;
      g.disconnect();
      g.connect(p); p.connect(this.layerG.arp);
      p.connect(this.delaySend);
    }
  }

  _leadNote(t, f, dur) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = ac.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = f;
    o2.detune.value = 9;
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 2400; flt.Q.value = 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.015);
    g.gain.setValueAtTime(0.4, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt); o2.connect(flt); flt.connect(g);
    g.connect(this.layerG.lead);
    g.connect(this.delaySend);
    this._go(o, t, dur + 0.05);
    this._go(o2, t, dur + 0.05);
  }

  // ---- SFX bank ---------------------------------------------------------------

  sfx(name, opts) {
    this._play(name, opts && opts.x);
  }

  _play(name, x) {
    if (!this.ac || !this.unlocked || this.disabled) return; // silent no-op pre-unlock
    const c = this.sfxCounts;
    c[name] = (c[name] || 0) + 1;
    const t = this.ac.currentTime + 0.02;
    switch (name) {
      case 'coin': this._coin(t, x, this.coinTier); break;
      case 'jump': this._jump(t); break;
      case 'slide': this._slide(t); break;
      case 'land': this._land(t, x); break;
      case 'crash': this._crash(t, x); break;
      case 'nearMiss': case 'near-miss': this._nearMiss(t, x); break;
      case 'uiClick': this._uiClick(t); break;
      case 'uiConfirm': this._uiConfirm(t); break;
      case 'runStart': this._runStart(t); break;
      case 'phaseWarp': this._phaseWarp(t); break;
      case 'mysteryBox': this._mysteryBox(t); break;
      case 'missionComplete': this._missionComplete(t); break;
      case 'revive': this._revive(t); break;
      case 'comboUp': this._comboUp(t, x || 1); break;
      case 'toast': this._toast(t, x); break;
      case 'speedUp': this._speedUp(t); break;
      case 'stylePerfect': this._stylePerfect(t); break;
      case 'styleDrift': this._styleDrift(t); break;
      case 'lane': this._lane(t); break;
      default: break;
    }
  }

  // stereo placement from a world x (lanes ±2.6) — subtle, never hard-panned
  _pan(dest, x) {
    if (!this.ac.createStereoPanner || !x) return dest;
    const p = this.ac.createStereoPanner();
    p.pan.value = clamp(x / 3.2, -0.75, 0.75);
    p.connect(dest);
    return p;
  }

  _blip(t, f0, f1, dur, type, vol, dest) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    this._go(o, t, dur + 0.03);
  }

  _coin(t, x, tier) {
    const dest = this._pan(this.sfxBus, x);
    const semi = [0, 2, 4, 7, 9][clamp(tier - 1, 0, 4)]; // pitch rises with combo
    const f = SEMI(1318.5, semi);
    this._blip(t, f * 0.75, 0, 0.09, 'triangle', 0.3, dest);
    this._blip(t + 0.065, f, 0, 0.32, 'triangle', 0.34, dest);
    this._blip(t + 0.065, f * 2, 0, 0.2, 'sine', 0.09, dest);
  }

  _jump(t) {
    this._blip(t, 300, 880, 0.14, 'triangle', 0.28, this.sfxBus);
    const n = this._noise(t, 0.08);
    const hp = this.ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2400;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(hp); hp.connect(g); g.connect(this.sfxBus);
  }

  _slide(t) {
    const ac = this.ac;
    const n = this._noise(t, 0.34);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(1600, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.3);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
  }

  _land(t, impact) {
    const v = impact ? clamp(impact, 0.3, 1) : 1; // x carries impact 0.3..1 here
    this._blip(t, 140, 52, 0.1, 'sine', 0.45 * v, this.sfxBus);
    const n = this._noise(t, 0.04);
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.2 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
  }

  _crash(t, x) {
    const ac = this.ac;
    const dest = this._pan(this.sfxBus, x);
    const n = this._noise(t, 0.75);
    const shaper = ac.createWaveShaper();
    shaper.curve = this.distCurve;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3800, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.65);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.75, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(shaper); shaper.connect(lp); lp.connect(g); g.connect(dest);
    this._blip(t, 90, 30, 0.55, 'sine', 0.7, dest); // sub drop
    this._duckMusic(0.22, 0.55, 0.3);
  }

  _nearMiss(t, x) {
    const ac = this.ac;
    const dest = this._pan(this.sfxBus, x);
    const n = this._noise(t, 0.3);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(800, t + 0.26);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    n.connect(bp); bp.connect(g); g.connect(dest);
    this._blip(t + 0.12, 2300, 0, 0.03, 'square', 0.16, dest); // tick
  }

  _uiClick(t) {
    this._blip(t, 1800, 0, 0.045, 'square', 0.14, this.sfxBus);
    this._blip(t, 900, 0, 0.06, 'sine', 0.12, this.sfxBus);
  }

  _uiConfirm(t) {
    this._blip(t, 659.3, 0, 0.1, 'triangle', 0.22, this.sfxBus);
    this._blip(t + 0.08, 987.8, 0, 0.18, 'triangle', 0.24, this.sfxBus);
  }

  _runStart(t) {
    this._blip(t, 120, 45, 0.25, 'sine', 0.5, this.sfxBus);       // launch thump
    this._uiConfirm(t + 0.02);
    const n = this._noise(t, 0.4);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.38);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
  }

  // 1.5 s transition: ~1.2 s riser, impact lands as the new phase enters.
  _phaseWarp(t) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 1.15);
    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass'; flt.Q.value = 2;
    flt.frequency.setValueAtTime(300, t);
    flt.frequency.exponentialRampToValueAtTime(4000, t + 1.15);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    o.connect(flt); flt.connect(g); g.connect(this.sfxBus);
    this._go(o, t, 1.3);
    const n = this._noise(t, 1.25);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 1.15);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.28, t + 1.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    n.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    // impact
    const ti = t + 1.2;
    this._blip(ti, 160, 38, 0.4, 'sine', 0.85, this.sfxBus);
    const cn = this._noise(ti, 0.3);
    const clp = ac.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.setValueAtTime(3000, ti);
    clp.frequency.exponentialRampToValueAtTime(300, ti + 0.28);
    const cg = ac.createGain();
    cg.gain.setValueAtTime(0.4, ti);
    cg.gain.exponentialRampToValueAtTime(0.0001, ti + 0.3);
    cn.connect(clp); clp.connect(cg); cg.connect(this.sfxBus);
    this._duckMusic(0.38, 0.8, 1.15);
  }

  _mysteryBox(t) {
    const notes = [659.3, 784, 987.8, 1318.5]; // E5 G5 B5 E6
    for (let i = 0; i < 4; i++) {
      this._blip(t + i * 0.06, notes[i], 0, 0.2, 'triangle', 0.26, this.sfxBus);
      this._blip(t + i * 0.06, notes[i] * 2, 0, 0.12, 'sine', 0.08, this.sfxBus);
    }
    const n = this._noise(t, 0.35);
    const hp = this.ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    n.connect(hp); hp.connect(g); g.connect(this.sfxBus);
  }

  _missionComplete(t) {
    const notes = [523.3, 659.3, 784, 1046.5]; // C5 E5 G5 C6
    for (let i = 0; i < 4; i++) {
      this._blip(t + i * 0.09, notes[i], 0, 0.3, 'triangle', 0.28, this.sfxBus);
    }
    for (let i = 0; i < 4; i++) { // echo
      this._blip(t + 0.45 + i * 0.09, notes[i], 0, 0.2, 'triangle', 0.09, this.sfxBus);
    }
  }

  _revive(t) {
    const chord = [440, 554.4, 659.3, 880]; // A4 C#5 E5 A5 — lifted, hopeful
    for (let i = 0; i < chord.length; i++) {
      const ac = this.ac;
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = chord[i];
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.3);
      g.gain.setValueAtTime(0.16, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g); g.connect(this.sfxBus);
      this._go(o, t, 1.55);
    }
  }

  _comboUp(t, tier) {
    const base = SEMI(523.3, (clamp(tier, 1, 5) - 1) * 2);
    this._blip(t, base, 0, 0.14, 'square', 0.16, this.sfxBus);
    this._blip(t + 0.055, base * 1.26, 0, 0.14, 'square', 0.18, this.sfxBus);
    this._blip(t + 0.11, base * 1.5, 0, 0.22, 'triangle', 0.22, this.sfxBus);
  }

  _toast(t, kind) {
    const f = kind === 'fever' ? 1174.7 : kind === 'phase' ? 880 : kind === 'style' ? 987.8 : 659.3;
    this._blip(t, f, 0, 0.05, 'triangle', 0.16, this.sfxBus);
    if (kind === 'fever' || kind === 'phase') this._blip(t + 0.06, f * 1.335, 0, 0.09, 'triangle', 0.16, this.sfxBus);
  }

  _speedUp(t) {
    const n = this._noise(t, 0.45);
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.42);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
  }

  _stylePerfect(t) {
    this._blip(t, 1568, 0, 0.22, 'sine', 0.22, this.sfxBus);
    this._blip(t + 0.02, 2093, 0, 0.3, 'sine', 0.14, this.sfxBus);
  }

  _styleDrift(t) {
    const n = this._noise(t, 0.3);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(800, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.26);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    this._blip(t, 220, 180, 0.18, 'triangle', 0.2, this.sfxBus);
  }

  _lane(t) {
    this._blip(t, 1150, 0, 0.025, 'square', 0.1, this.sfxBus);
  }

  // ---- bus + legacy wiring -----------------------------------------------------

  _wireBus() {
    const bus = this.bus;
    if (!bus) return;
    bus.on('run:start', () => { this._setMode('run'); this._setTier(1); this._play('runStart'); });
    bus.on('death', (p) => {
      this._play('crash', p && p.position ? p.position.x : 0);
      this._setTier(1);
    });
    bus.on('coin', (p) => this._play('coin', p ? p.x : 0));
    bus.on('coin:x', (p) => {
      const tier = (p && p.tier) || 2;
      const x = p && p.position ? p.position.x : 0;
      this._play('coin', x);
      this._play('stylePerfect', 0); // merged/chip coins shimmer on top
    });
    bus.on('near-miss', (p) => this._play('nearMiss', p ? p.x : 0));
    bus.on('box:open', () => this._play('mysteryBox'));
    bus.on('combo:change', (p) => {
      const t = (p && p.tier) || 1;
      const prev = this.tier;
      this._setTier(t);
      if (t > prev) this._play('comboUp', Math.min(t, 5));
    });
    bus.on('phase:transition', () => this._play('phaseWarp'));
    bus.on('phase:start', () => this._play('lane')); // soft tick on phase entry
    bus.on('speed:change', () => this._play('speedUp'));
    bus.on('style:perfect', () => this._play('stylePerfect'));
    bus.on('style:drift', () => this._play('styleDrift'));
    // style:near-miss is silent — the near-miss whoosh already covers it
    bus.on('ui:toast', (p) => this._play('toast', p && p.kind));
    bus.on('mission:complete', () => this._play('missionComplete'));
    bus.on('revive:offer', () => this._play('revive'));
    bus.on('ui:screen', (name) => {
      if (name === 'menu') { this._setMode('menu'); this._play('uiConfirm'); }
      else if (name === 'pause') { this._duckMusic(0.3, 0.4, 0.2); this._play('uiClick'); }
      else if (name === 'hud') { this._unduck(); this._play('uiClick'); }
      // 'death' screen: crash + tier drop already handled by the death event
    });
  }

  // core/Sound.js legacy call sites. Only names with NO bus equivalent are
  // mapped — coin/crash/near-miss/combo/ui/start/phase emit bus events too and
  // would double-trigger.
  _wireLegacy() {
    const LEGACY = { jump: 'jump', slide: 'slide', lane: 'lane' };
    setSoundProvider((name) => {
      const n = LEGACY[name];
      if (n) this._play(n, 0);
    });
  }

  // ---- QA probe ------------------------------------------------------------------

  _attachDebug() {
    if (typeof window === 'undefined') return;
    Object.defineProperty(window, '__NR_AUDIO_DEBUG', {
      configurable: true,
      get: () => ({
        unlocked: this.unlocked,
        ctxState: this.ac ? this.ac.state : 'none',
        musicPlaying: this.musicOn && this.unlocked,
        tier: this.tier,
        mode: this.mode,
        muted: this.muted,
        activeVoices: this.voices,
        sfxCounts: this.sfxCounts,
      }),
    });
  }
}

export const Audio = new AudioEngine();
