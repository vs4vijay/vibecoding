/**
 * Game audio content (Midtown Blitz, task 6.1) — everything the game layer
 * synthesizes on top of the engine audio manager (src/engine/audio.js),
 * per design Decision 8: fully synthesized WebAudio, no audio files.
 *
 * Content and routing (every chain ends in the audio manager's master gain,
 * so the settings volume/mute apply to all of it live; the manager's graph
 * itself is NOT modified — this module only builds content nodes into it):
 *
 *  - ENGINE  (driving): a sawtooth + a sub-octave triangle through a shared
 *    lowpass into `engineGain`. Pitch = idle 55 Hz rising to ~210 Hz with a
 *    speed/throttle blend (`0.85 * speedNorm + 0.15 * throttle`, so blipping
 *    the throttle revs it even standing still); a slow LFO adds wobble.
 *    Gain sits at a quiet idle and rises with throttle + speed. Fed from
 *    `update(dt, carState, controls)` once per sim tick while driving.
 *  - TIRE SKID (driving): a looping generated white-noise buffer through a
 *    bandpass into `skidGain`. The gain target follows |lateralSpeed| (slip)
 *    when moving fast enough, with a floor while the handbrake is held at
 *    speed (locked wheels scrape); all ramps use setTargetAtTime, so the
 *    loop never clicks.
 *  - IMPACT  (on demand): `impact(intensity)` fires a one-shot noise burst
 *    through a lowpass sweep (~2800 -> 150 Hz) plus a low sine thump — the
 *    "bang" behind main.js's camera shake on hard hits.
 *  - CHECKPOINT CHIME: `checkpointChime()` — a two-note sine envelope pair
 *    (880 Hz then ~1318 Hz). This is what replaces the audio.blip()
 *    placeholder: main.js passes it through a `{ blip }` shim as the race
 *    controller's chime and calls it directly for the ?debug test route.
 *  - UI CLICK: `uiClick()` — a ~30 ms high sine tick for menu/pause/results/
 *    settings buttons (quiet, tasteful).
 *  - MUSIC: a lightweight scheduled loop — soft triangle chord pads (one per
 *    bar over a 4-bar progression) with occasional sine plucks, ~104 BPM
 *    eighth-note grid, through `musicGain` (~0.16) into the master. The
 *    scheduler is a look-ahead pump on the AudioContext clock: every step is
 *    scheduled at an absolute time accumulated from exact step durations
 *    (never read back from currentTime), so the loop cannot drift over
 *    minutes. Stops cleanly: the pump halts and the bus ramps to 0 over the
 *    (<= look-ahead) already-scheduled tail.
 *
 * Lifecycle / autoplay policy:
 *  - The content graph is built lazily on the first sound this module makes
 *    (engine update, impact, chime, click, music) — never at creation.
 *  - Music additionally DEFERS while the manager has no AudioContext yet
 *    (state 'uninitialized'): `startMusic()` before the player's first
 *    gesture only flags the desire, and the loop actually starts when the
 *    first sound builds the graph (in practice the first UI click, which is
 *    itself a gesture). Nothing outside a gesture ever constructs a context.
 *  - Mode policy (owned by main.js through these calls): `setDriving(true)`
 *    in racing only — engine/skid are silent in menu/paused/results (the
 *    menu has music + clicks); music plays in menu/racing/paused and stops
 *    on results. Pause calls `setDriving(false)`, which ramps the engine and
 *    skid gains to 0 explicitly (the sim stops ticking, so update() would
 *    otherwise freeze the gains at their last values).
 *
 * Injectability (like loop.js/input.js/audio.js): a plain-node harness
 * supplies the manager with a fake AudioContext; `schedulerIntervalMs: null`
 * disables the real pump interval so the harness can advance
 * `context.currentTime` and call `pumpScheduler()` itself.
 */

import { DEFAULT_CAR_CONFIG } from './config.js';

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

/** Idle engine pitch in Hz. */
const ENGINE_IDLE_HZ = 55;
/** Engine pitch at top speed in Hz. */
const ENGINE_TOP_HZ = 210;
/** Time constant (s) for engine pitch/gain ramps (smooth, no clicks). */
const ENGINE_TC_S = 0.08;
/** Idle engine gain — audible rumble, not silent. */
const ENGINE_IDLE_GAIN = 0.045;
/** Extra engine gain at full throttle/speed (added to the idle level). */
const ENGINE_GAIN_RANGE = 0.21;
/** Engine lowpass base frequency in Hz (idle). */
const ENGINE_FILTER_BASE_HZ = 350;
/** Engine lowpass opening with speed in Hz. */
const ENGINE_FILTER_SPEED_HZ = 2600;
/** Engine lowpass opening with throttle in Hz. */
const ENGINE_FILTER_THROTTLE_HZ = 700;
/** LFO (wobble) rate in Hz and depth in Hz of pitch. */
const ENGINE_LFO_HZ = 13;
const ENGINE_LFO_DEPTH_HZ = 2.5;

/* ------------------------------------------------------------------ */
/* Tire skid                                                           */
/* ------------------------------------------------------------------ */

/** Minimum planar speed (m/s) before skid noise can rise at all. */
const SKID_MIN_SPEED_MS = 3.5;
/** Slip (|lateralSpeed| in m/s) at which the skid starts. */
const SKID_SLIP_FLOOR_MS = 1.2;
/** Slip range (m/s) over which the skid goes from start to full. */
const SKID_SLIP_RANGE_MS = 5;
/** Maximum skid gain. */
const SKID_MAX_GAIN = 0.22;
/** Skid bandpass center range (Hz) — widens with slip. */
const SKID_FILTER_BASE_HZ = 850;
const SKID_FILTER_RANGE_HZ = 750;
/** Skid gain ramp time constants (s): quick in, slightly slower out. */
const SKID_ATTACK_TC_S = 0.05;
const SKID_RELEASE_TC_S = 0.12;

/* ------------------------------------------------------------------ */
/* Impact                                                              */
/* ------------------------------------------------------------------ */

/** Impact lowpass sweep: start/end frequency in Hz. */
const IMPACT_SWEEP_FROM_HZ = 2800;
const IMPACT_SWEEP_TO_HZ = 150;
/** Impact envelope: attack time (s) and base decay (s, grows with intensity). */
const IMPACT_ATTACK_S = 0.005;
const IMPACT_DECAY_S = 0.16;
/** Impact noise-burst peak gain: min + range * intensity. */
const IMPACT_PEAK_MIN = 0.16;
const IMPACT_PEAK_RANGE = 0.44;
/** Sub thump: start/end frequency in Hz and peak gain min + range. */
const THUMP_FROM_HZ = 110;
const THUMP_TO_HZ = 45;
const THUMP_PEAK_MIN = 0.1;
const THUMP_PEAK_RANGE = 0.3;
/** Small scheduling lead (s) so one-shots never race the current quantum. */
const ONE_SHOT_LEAD_S = 0.015;

/* ------------------------------------------------------------------ */
/* Checkpoint chime + UI click                                         */
/* ------------------------------------------------------------------ */

/** Chime notes (Hz), the second a pure fifth+octave up from the first. */
const CHIME_NOTE_1_HZ = 880;
const CHIME_NOTE_2_HZ = 1318.51;
/** Chime second-note delay (s), attack (s), decay (s) and peak gain. */
const CHIME_NOTE_DELAY_S = 0.09;
const CHIME_ATTACK_S = 0.006;
const CHIME_DECAY_S = 0.28;
const CHIME_LEVEL = 0.22;
/** UI click: frequency (Hz), decay (s) and peak gain — short and quiet. */
const CLICK_FREQ_HZ = 2100;
const CLICK_DECAY_S = 0.03;
const CLICK_LEVEL = 0.1;

/* ------------------------------------------------------------------ */
/* Music                                                               */
/* ------------------------------------------------------------------ */

/** Music tempo in BPM; the grid is eighth notes (2 per beat). */
const MUSIC_BPM = 104;
/** Seconds per grid step (one eighth note). */
const MUSIC_STEP_DUR_S = 60 / MUSIC_BPM / 2;
/** Grid steps (eighths) per bar and bars in the chord progression. */
const MUSIC_STEPS_PER_BAR = 8;
const MUSIC_BARS = 4;
/** Total steps in one full progression pass. */
const MUSIC_TOTAL_STEPS = MUSIC_STEPS_PER_BAR * MUSIC_BARS;
/** Chord pads (Hz): A minor, F major, C major, G major — mid register. */
const MUSIC_CHORDS = Object.freeze([
  Object.freeze([220.0, 261.63, 329.63]), // Am (A3 C4 E4)
  Object.freeze([174.61, 220.0, 261.63]), // F  (F3 A3 C4)
  Object.freeze([196.0, 261.63, 329.63]), // C  (G3 C4 E4)
  Object.freeze([196.0, 246.94, 293.66]), // G  (G3 B3 D4)
]);
/** Pad peak gain per chord tone; pluck peak gain. */
const MUSIC_PAD_LEVEL = 0.05;
const MUSIC_PLUCK_LEVEL = 0.09;
/** Music bus level (applied on top of the master volume). */
const MUSIC_BUS_LEVEL = 0.16;
/** Look-ahead pump interval (ms) and scheduling horizon (s). */
const MUSIC_PUMP_INTERVAL_MS = 25;
const MUSIC_LOOKAHEAD_S = 0.12;
/** Lead-in (s) between startMusic and the first note. */
const MUSIC_LEAD_IN_S = 0.06;

/**
 * Clamp a number to [lo, hi]; non-finite input reads as lo.
 * @param {number} v Value to clamp.
 * @param {number} lo Lower bound.
 * @param {number} hi Upper bound.
 * @returns {number} The clamped value.
 */
function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Game audio content handle (see the module header for the audio design).
 *
 * @typedef {object} GameAudio
 * @property {(dt: number, carState: { speed?: number, forwardSpeed?: number,
 *   lateralSpeed?: number, slipAngle?: number }, controls: { throttle?: number,
 *   handbrake?: boolean }) => void} update Feed the engine + skid voices from
 *   the live car state (once per sim tick while driving). No-op unless
 *   `setDriving(true)` is active. `dt` is accepted for signature symmetry —
 *   smoothing is done by the param ramps.
 * @property {(driving: boolean) => void} setDriving Gate the engine/skid
 *   voices. `false` (pause/menu/results) ramps both gains to 0 immediately
 *   and makes `update` a no-op; `true` re-arms them (the next `update`
 *   writes the gains).
 * @property {(intensity: number) => void} impact Fire one impact burst;
 *   intensity 0..1 scales the lowpass-swept noise burst + sub thump.
 * @property {() => void} checkpointChime Two-note pass confirmation.
 * @property {() => void} uiClick Short UI tick (menu/pause/results buttons).
 * @property {() => void} startMusic Enable + start the music loop (deferred
 *   until the graph exists if the player has not interacted yet).
 * @property {() => void} stopMusic Stop the loop; the bus ramps to 0 over
 *   the short already-scheduled tail. Safe when not playing.
 * @property {() => boolean} isMusicPlaying Whether the scheduler is running.
 * @property {() => void} pumpScheduler Run one scheduler pass manually.
 *   The browser calls this from an interval; harnesses call it after
 *   advancing the fake context's time.
 * @property {() => void} dispose Stop the scheduler and all sustained
 *   sources (engine/skid/music); one-shots become no-ops. Idempotent.
 */

/**
 * Create the game audio content layer on top of an audio manager.
 * @param {import('../engine/audio.js').AudioManager} audioManager The engine
 *   audio manager (provides the lazily-created AudioContext + master gain).
 * @param {object} [options] Configuration.
 * @param {number | null} [options.schedulerIntervalMs=MUSIC_PUMP_INTERVAL_MS]
 *   Music pump interval in ms; `null` disables the interval entirely (plain-
 *   node harnesses then drive `pumpScheduler()` manually).
 * @param {number} [options.topSpeedMs=DEFAULT_CAR_CONFIG.engine.topSpeedMs]
 *   Car top speed in m/s — the engine pitch/gain normalization reference.
 * @returns {GameAudio} The handle.
 */
export function createGameAudio(audioManager, {
  schedulerIntervalMs = MUSIC_PUMP_INTERVAL_MS,
  topSpeedMs = DEFAULT_CAR_CONFIG.engine.topSpeedMs,
} = {}) {
  const topSpeed = topSpeedMs > 0 ? topSpeedMs : DEFAULT_CAR_CONFIG.engine.topSpeedMs;

  let disposed = false;
  let graph = null; // truthy once the content graph exists
  let driving = false;

  /** @type {AudioContext | null} The manager's context (post-ensure). */
  let ctx = null;
  /** @type {GainNode | null} The manager's master gain (post-ensure). */
  let master = null;

  // Engine voice.
  /** @type {OscillatorNode | null} */ let engineOsc = null;
  /** @type {OscillatorNode | null} */ let engineSub = null;
  /** @type {BiquadFilterNode | null} */ let engineFilter = null;
  /** @type {GainNode | null} */ let engineGain = null;
  /** @type {OscillatorNode | null} */ let engineLfo = null;
  /** @type {AudioNode | null} */ let engineLfoDepth = null;

  // Skid voice.
  /** @type {AudioBufferSourceNode | null} */ let skidSource = null;
  /** @type {BiquadFilterNode | null} */ let skidFilter = null;
  /** @type {GainNode | null} */ let skidGain = null;
  /** @type {AudioBuffer | null} */ let noiseBuffer = null;

  // Music.
  /** @type {GainNode | null} */ let musicGain = null;
  let musicEnabled = false;
  let musicPlaying = false;
  let musicStep = 0;
  let musicNextTime = 0;
  /** @type {ReturnType<typeof setInterval> | null} */
  let musicTimer = null;

  /**
   * Build the whole content graph exactly once (engine voice, skid voice,
   * music bus) into the manager's master gain, then start any deferred
   * music. Creation order is engine -> skid -> music (harnesses rely on
   * it for node identification).
   * @returns {boolean} False only after dispose().
   */
  function ensureGraph() {
    if (disposed) return false;
    if (graph) return true;
    ctx = audioManager.context;
    master = audioManager.master;
    const now = ctx.currentTime;

    // --- engine: saw + sub triangle -> lowpass -> gain -> master, LFO wobble
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = ENGINE_IDLE_HZ;
    engineSub = ctx.createOscillator();
    engineSub.type = 'triangle';
    engineSub.frequency.value = ENGINE_IDLE_HZ / 2;
    engineLfo = ctx.createOscillator();
    engineLfo.type = 'sine';
    engineLfo.frequency.value = ENGINE_LFO_HZ;
    engineLfoDepth = ctx.createGain();
    /** @type {GainNode} */ (engineLfoDepth).gain.value = ENGINE_LFO_DEPTH_HZ;
    engineLfo.connect(engineLfoDepth);
    /** @type {GainNode} */ (engineLfoDepth).connect(engineOsc.frequency);
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = ENGINE_FILTER_BASE_HZ;
    engineFilter.Q.value = 1.1;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0; // silent until the first driving update
    engineOsc.connect(engineFilter);
    engineSub.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start(now);
    engineSub.start(now);
    engineLfo.start(now);

    // --- skid: looping noise -> bandpass -> gain -> master
    const sampleRate = typeof ctx.sampleRate === 'number' ? ctx.sampleRate : 44100;
    const len = Math.floor(sampleRate * 1); // 1 s of white noise, looped
    noiseBuffer = ctx.createBuffer(1, len, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    skidSource = ctx.createBufferSource();
    skidSource.buffer = noiseBuffer;
    skidSource.loop = true;
    skidFilter = ctx.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = SKID_FILTER_BASE_HZ;
    skidFilter.Q.value = 0.9;
    skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    skidSource.connect(skidFilter);
    skidFilter.connect(skidGain);
    skidGain.connect(master);
    skidSource.start(now);

    // --- music bus (notes connect here, the bus feeds the master)
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);

    graph = true;
    if (musicEnabled) startScheduler();
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Engine + skid per-tick update                                     */
  /* ---------------------------------------------------------------- */

  /**
   * @param {number} dt Sim dt (s) — accepted, unused (ramps do the smoothing).
   * @param {{ speed?: number, forwardSpeed?: number, lateralSpeed?: number,
   *   slipAngle?: number }} carState Live car state.
   * @param {{ throttle?: number, handbrake?: boolean }} controls Live controls.
   * @returns {void}
   */
  function update(dt, carState, controls) {
    void dt;
    if (disposed || !driving || !ensureGraph()) return;
    const c = /** @type {AudioContext} */ (ctx);
    const now = c.currentTime;
    const state = carState || {};
    const ctrl = controls || {};

    // Engine: pitch from a speed/throttle blend, gain from throttle + speed.
    const fwd = Math.abs(Number.isFinite(state.forwardSpeed) ? /** @type {number} */ (state.forwardSpeed) : (Number(state.speed) || 0));
    const speedNorm = clamp(fwd / topSpeed, 0, 1);
    const throttle = clamp(Number(ctrl.throttle) || 0, 0, 1);
    const rev = 0.85 * speedNorm + 0.15 * throttle;
    const freq = ENGINE_IDLE_HZ + (ENGINE_TOP_HZ - ENGINE_IDLE_HZ) * rev;
    engineOsc.frequency.setTargetAtTime(freq, now, ENGINE_TC_S);
    engineSub.frequency.setTargetAtTime(freq / 2, now, ENGINE_TC_S);
    engineFilter.frequency.setTargetAtTime(
      ENGINE_FILTER_BASE_HZ + ENGINE_FILTER_SPEED_HZ * speedNorm + ENGINE_FILTER_THROTTLE_HZ * throttle,
      now,
      ENGINE_TC_S
    );
    const engineLevel =
      ENGINE_IDLE_GAIN + ENGINE_GAIN_RANGE * (0.35 * speedNorm + 0.65 * throttle);
    engineGain.gain.setTargetAtTime(engineLevel, now, ENGINE_TC_S);

    // Skid: slip-driven, handbrake gets a scrape floor while moving.
    const slip = Math.abs(Number.isFinite(state.lateralSpeed) ? /** @type {number} */ (state.lateralSpeed) : 0);
    let amount = 0;
    if (fwd > SKID_MIN_SPEED_MS && (ctrl.handbrake === true || slip > SKID_SLIP_FLOOR_MS)) {
      amount = clamp((slip - SKID_SLIP_FLOOR_MS) / SKID_SLIP_RANGE_MS, 0, 1);
      if (ctrl.handbrake === true) {
        amount = Math.max(amount, Math.min(0.7, fwd / 28));
      }
    }
    skidGain.gain.setTargetAtTime(
      amount * SKID_MAX_GAIN,
      now,
      amount > 0 ? SKID_ATTACK_TC_S : SKID_RELEASE_TC_S
    );
    skidFilter.frequency.setTargetAtTime(
      SKID_FILTER_BASE_HZ + SKID_FILTER_RANGE_HZ * amount,
      now,
      0.1
    );
  }

  /**
   * Gate the driving voices (see the typedef).
   * @param {boolean} nextDriving True while the sim is live (racing).
   * @returns {void}
   */
  function setDriving(nextDriving) {
    driving = Boolean(nextDriving);
    if (!graph || disposed || driving) return;
    const now = /** @type {AudioContext} */ (ctx).currentTime;
    // Explicit release: the sim stops ticking outside racing, so nothing
    // else would pull these gains back down.
    engineGain.gain.setTargetAtTime(0, now, ENGINE_TC_S);
    skidGain.gain.setTargetAtTime(0, now, SKID_RELEASE_TC_S);
  }

  /* ---------------------------------------------------------------- */
  /* One-shots: impact, chime, click                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Fire an impact burst (see the typedef). Intensity 0..1 scales peak
   * gain and decay; the lowpass sweeps down for the "body" of the bang.
   * @param {number} intensity 0..1.
   * @returns {void}
   */
  function impact(intensity) {
    if (!ensureGraph()) return;
    const c = /** @type {AudioContext} */ (ctx);
    const i = clamp(intensity, 0, 1);
    const t0 = c.currentTime + ONE_SHOT_LEAD_S;

    // Noise burst through a closing lowpass — the crash "body".
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(IMPACT_SWEEP_FROM_HZ, t0);
    lp.frequency.exponentialRampToValueAtTime(
      IMPACT_SWEEP_TO_HZ,
      t0 + IMPACT_DECAY_S + 0.1 * i
    );
    const env = c.createGain();
    const peak = IMPACT_PEAK_MIN + IMPACT_PEAK_RANGE * i;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + IMPACT_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + IMPACT_DECAY_S + 0.16 * i);
    src.connect(lp);
    lp.connect(env);
    env.connect(master);
    src.start(t0);
    src.stop(t0 + IMPACT_DECAY_S + 0.16 * i + 0.05);

    // Low sine thump — the chassis "whomp" under the noise.
    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(THUMP_FROM_HZ, t0);
    thump.frequency.exponentialRampToValueAtTime(THUMP_TO_HZ, t0 + 0.12);
    const thumpEnv = c.createGain();
    thumpEnv.gain.setValueAtTime(0, t0);
    thumpEnv.gain.linearRampToValueAtTime(THUMP_PEAK_MIN + THUMP_PEAK_RANGE * i, t0 + IMPACT_ATTACK_S);
    thumpEnv.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.16 + 0.08 * i);
    thump.connect(thumpEnv);
    thumpEnv.connect(master);
    thump.start(t0);
    thump.stop(t0 + 0.16 + 0.08 * i + 0.05);
  }

  /**
   * Schedule one enveloped sine note (chime/click building block).
   * @param {number} freq Frequency in Hz.
   * @param {number} at Absolute context time (s).
   * @param {number} decayS Decay time (s) after the attack.
   * @param {number} level Peak gain.
   * @returns {OscillatorNode} The scheduled oscillator (starts and stops itself).
   */
  function scheduleNote(freq, at, decayS, level) {
    const c = /** @type {AudioContext} */ (ctx);
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const env = c.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + CHIME_ATTACK_S);
    env.gain.exponentialRampToValueAtTime(0.0008, at + decayS);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + decayS + 0.03);
    return osc;
  }

  /** @returns {void} */
  function checkpointChime() {
    if (!ensureGraph()) return;
    const t0 = /** @type {AudioContext} */ (ctx).currentTime + ONE_SHOT_LEAD_S;
    scheduleNote(CHIME_NOTE_1_HZ, t0, CHIME_DECAY_S, CHIME_LEVEL);
    scheduleNote(CHIME_NOTE_2_HZ, t0 + CHIME_NOTE_DELAY_S, CHIME_DECAY_S + 0.04, CHIME_LEVEL);
  }

  /** @returns {void} */
  function uiClick() {
    if (!ensureGraph()) return;
    const t0 = /** @type {AudioContext} */ (ctx).currentTime + ONE_SHOT_LEAD_S;
    scheduleNote(CLICK_FREQ_HZ, t0, CLICK_DECAY_S, CLICK_LEVEL);
  }

  /* ---------------------------------------------------------------- */
  /* Music: look-ahead scheduler on the context clock                  */
  /* ---------------------------------------------------------------- */

  /**
   * Schedule one chord pad (3 triangle notes with a slow bar-length
   * envelope) at an absolute time.
   * @param {number} bar Bar index (chord selector).
   * @param {number} at Absolute start time (s).
   * @returns {void}
   */
  function schedulePad(bar, at) {
    const c = /** @type {AudioContext} */ (ctx);
    const chord = MUSIC_CHORDS[bar % MUSIC_CHORDS.length];
    const barDur = MUSIC_STEPS_PER_BAR * MUSIC_STEP_DUR_S;
    for (const freq of chord) {
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const env = c.createGain();
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(MUSIC_PAD_LEVEL, at + 0.5);
      env.gain.linearRampToValueAtTime(0.0001, at + barDur);
      osc.connect(env);
      env.connect(musicGain);
      osc.start(at);
      osc.stop(at + barDur + 0.05);
    }
  }

  /**
   * Schedule one pluck (short sine note, two octaves above a chord tone).
   * @param {number} step Grid step index (chord/arp selector).
   * @param {number} at Absolute start time (s).
   * @returns {void}
   */
  function schedulePluck(step, at) {
    const c = /** @type {AudioContext} */ (ctx);
    const bar = Math.floor(step / MUSIC_STEPS_PER_BAR);
    const chord = MUSIC_CHORDS[bar % MUSIC_CHORDS.length];
    const tone = chord[(Math.floor(step / 2) + 1) % chord.length] * 2;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = tone;
    const env = c.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(MUSIC_PLUCK_LEVEL, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0006, at + 0.25);
    osc.connect(env);
    env.connect(musicGain);
    osc.start(at);
    osc.stop(at + 0.3);
  }

  /**
   * Schedule one grid step's notes at an absolute time.
   * @param {number} step Step index in [0, MUSIC_TOTAL_STEPS).
   * @param {number} at Absolute time (s).
   * @returns {void}
   */
  function scheduleStep(step, at) {
    if (step % MUSIC_STEPS_PER_BAR === 0) schedulePad(step / MUSIC_STEPS_PER_BAR, at);
    if (step % MUSIC_STEPS_PER_BAR === 3 || step % MUSIC_STEPS_PER_BAR === 7) {
      schedulePluck(step, at);
    }
  }

  /**
   * One scheduler pass: schedule every grid step that falls inside the
   * look-ahead window. Times accumulate from exact step durations, so the
   * grid cannot drift against the clock over minutes.
   * @returns {void}
   */
  function pumpScheduler() {
    if (!musicPlaying || !ctx) return;
    while (musicNextTime < ctx.currentTime + MUSIC_LOOKAHEAD_S) {
      scheduleStep(musicStep, musicNextTime);
      musicNextTime += MUSIC_STEP_DUR_S;
      musicStep = (musicStep + 1) % MUSIC_TOTAL_STEPS;
    }
  }

  /**
   * Start the scheduler (graph must exist — callers ensure it).
   * @returns {void}
   */
  function startScheduler() {
    if (musicPlaying || disposed || !ctx) return;
    musicPlaying = true;
    musicStep = 0;
    musicNextTime = ctx.currentTime + MUSIC_LEAD_IN_S;
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setTargetAtTime(MUSIC_BUS_LEVEL, now, 0.15);
    pumpScheduler();
    if (schedulerIntervalMs !== null && schedulerIntervalMs > 0) {
      musicTimer = setInterval(pumpScheduler, schedulerIntervalMs);
    }
  }

  /** @returns {void} */
  function startMusic() {
    musicEnabled = true;
    if (disposed) return;
    // Defer while the manager has no context at all: constructing a context
    // outside the player's first gesture is exactly what the audio manager's
    // autoplay policy avoids. The first sound (UI click/chime/impact/engine)
    // builds the graph and the deferred loop starts right after.
    if (audioManager.state === 'uninitialized') return;
    void audioManager.resume(); // best-effort unlock, like the manager's blip
    if (!ensureGraph()) return;
    startScheduler();
  }

  /** @returns {void} */
  function stopMusic() {
    musicEnabled = false;
    if (!musicPlaying) return;
    musicPlaying = false;
    if (musicTimer !== null) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    if (musicGain) {
      // Fade over the <= look-ahead tail of already-scheduled notes.
      musicGain.gain.setTargetAtTime(0, /** @type {AudioContext} */ (ctx).currentTime, 0.08);
    }
  }

  /** @returns {boolean} Whether the scheduler is running. */
  function isMusicPlaying() {
    return musicPlaying;
  }

  /* ---------------------------------------------------------------- */
  /* Dispose                                                           */
  /* ---------------------------------------------------------------- */

  /** @returns {void} */
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopMusic();
    if (graph) {
      const now = /** @type {AudioContext} */ (ctx).currentTime;
      engineOsc.stop(now);
      engineSub.stop(now);
      engineLfo.stop(now);
      skidSource.stop(now);
    }
  }

  return {
    update,
    setDriving,
    impact,
    checkpointChime,
    uiClick,
    startMusic,
    stopMusic,
    isMusicPlaying,
    pumpScheduler,
    dispose,
  };
}
