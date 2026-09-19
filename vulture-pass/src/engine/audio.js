// Audio manager (2.4, D11): WebAudio, gesture-gated, fully synthesized so the
// build ships zero audio files and stays original-IP clean.
//
// Channels: master → { sfx, engine, music }. Every call before the first user
// gesture is a no-op (autoplay policy).

export function createAudio() {
  let ctx = null;
  let master;
  let sfxBus;
  let engineBus;
  let musicBus;
  let unlocked = false;
  let engineNodes = null;

  const balance = { master: 0.8, sfx: 0.9, engine: 0.32, music: 0.65 };

  function buildBuses() {
    master = ctx.createGain();
    master.gain.value = balance.master;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = balance.sfx;
    sfxBus.connect(master);
    engineBus = ctx.createGain();
    engineBus.gain.value = 0; // fades in with the engine loop
    engineBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = balance.music;
    musicBus.connect(master);
  }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      buildBuses();
    }
    if (ctx.state === 'suspended') ctx.resume();
    // Only treat real user gestures (isTrusted → context runs) as unlocking.
    if (!unlocked && ctx.state === 'running') unlocked = true;
  }

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);

  // ------------------------------------------------------------ primitives

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function playNoise({ seconds = 0.1, gain = 0.5, filter = 'lowpass', from = 2000, to = null, q = 0.8, delay = 0, bus = sfxBus }) {
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(seconds);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(from, t0);
    if (to !== null) f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + seconds);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    src.connect(f).connect(g).connect(bus);
    src.start(t0);
    src.stop(t0 + seconds + 0.02);
  }

  function playTone({ type = 'sine', from = 440, to = null, seconds = 0.15, gain = 0.3, delay = 0, bus = sfxBus }) {
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(g).connect(bus);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  // Plucked-string-ish tone (fast-attack triangle with a bright partial).
  function pluck(freq, { seconds = 0.9, gain = 0.35, delay = 0 } = {}) {
    const t0 = ctx.currentTime + delay;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 6, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.5), t0 + seconds);
    for (const [type, mult, amp] of [
      ['triangle', 1, 1],
      ['sawtooth', 2.01, 0.28],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = amp;
      osc.connect(og).connect(lp);
      osc.start(t0);
      osc.stop(t0 + seconds + 0.05);
    }
    lp.connect(g).connect(musicBus);
  }

  // ------------------------------------------------------------ sfx bank

  const bank = {
    uiClick() {
      playTone({ type: 'square', from: 660, to: 520, seconds: 0.045, gain: 0.14 });
    },
    uiOpen() {
      playTone({ type: 'triangle', from: 320, to: 480, seconds: 0.09, gain: 0.18 });
    },
    cash() {
      playTone({ type: 'sine', from: 880, seconds: 0.07, gain: 0.2 });
      playTone({ type: 'sine', from: 1320, seconds: 0.12, gain: 0.16, delay: 0.07 });
    },
    pistol() {
      playNoise({ seconds: 0.09, gain: 0.5, filter: 'bandpass', from: 1800, q: 0.7 });
      playTone({ type: 'square', from: 210, to: 60, seconds: 0.06, gain: 0.22 });
    },
    shotgun() {
      playNoise({ seconds: 0.28, gain: 0.7, filter: 'lowpass', from: 1400, to: 300 });
      playTone({ type: 'sine', from: 95, to: 40, seconds: 0.22, gain: 0.4 });
    },
    mgShot() {
      playNoise({ seconds: 0.045, gain: 0.3, filter: 'highpass', from: 900 });
      playTone({ type: 'square', from: 160, to: 90, seconds: 0.035, gain: 0.12 });
    },
    rocketFire() {
      playNoise({ seconds: 0.5, gain: 0.5, filter: 'lowpass', from: 300, to: 2400 });
      playTone({ type: 'sawtooth', from: 70, to: 130, seconds: 0.4, gain: 0.2 });
    },
    explosion() {
      playNoise({ seconds: 0.9, gain: 0.9, filter: 'lowpass', from: 2600, to: 90 });
      playTone({ type: 'sine', from: 70, to: 28, seconds: 0.7, gain: 0.55 });
      playTone({ type: 'square', from: 120, to: 35, seconds: 0.25, gain: 0.2 });
    },
    hit() {
      playNoise({ seconds: 0.05, gain: 0.25, filter: 'bandpass', from: 2600, q: 2 });
    },
    skid() {
      playNoise({ seconds: 0.18, gain: 0.12, filter: 'bandpass', from: 700, q: 3 });
    },
    victory() {
      // short original guitar sting: descending arpeggio
      const notes = [329.63, 261.63, 196.0, 164.81];
      notes.forEach((f, i) => pluck(f, { delay: i * 0.12, gain: 0.4, seconds: 0.8 }));
      pluck(98, { delay: 0.48, gain: 0.5, seconds: 1.4 });
    },
    sting() {
      const notes = [196.0, 233.08, 293.66, 392.0];
      notes.forEach((f, i) => pluck(f, { delay: i * 0.16, gain: 0.35, seconds: 1.0 }));
    },
    defeat() {
      playTone({ type: 'sawtooth', from: 220, to: 55, seconds: 1.1, gain: 0.25 });
    },
    levelUp() {
      playTone({ type: 'triangle', from: 523, seconds: 0.09, gain: 0.22 });
      playTone({ type: 'triangle', from: 659, seconds: 0.09, gain: 0.22, delay: 0.09 });
      playTone({ type: 'triangle', from: 784, seconds: 0.16, gain: 0.25, delay: 0.18 });
    },
  };

  function sfx(name) {
    if (!unlocked || !ctx) return false;
    const fn = bank[name];
    if (!fn) return false;
    fn();
    return true;
  }

  // ------------------------------------------------------------ engine loop

  function setEngine(active, rate01 = 0) {
    if (!unlocked || !ctx) return;
    if (active && !engineNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      const subG = ctx.createGain();
      subG.gain.value = 0.4;
      osc.connect(lp);
      sub.connect(subG).connect(lp);
      lp.connect(g).connect(engineBus);
      osc.start();
      sub.start();
      engineNodes = { osc, sub, lp, g };
      engineBus.gain.setTargetAtTime(balance.engine, ctx.currentTime, 0.3);
    }
    if (!active && engineNodes) {
      engineBus.gain.setTargetAtTime(0.0, ctx.currentTime, 0.2);
      const nodes = engineNodes;
      engineNodes = null;
      setTimeout(() => {
        try {
          nodes.osc.stop();
          nodes.sub.stop();
        } catch {
          /* already stopped */
        }
      }, 800);
      return;
    }
    if (engineNodes) {
      const t = ctx.currentTime;
      const speed = 42 + 95 * Math.min(1, Math.max(0, rate01));
      engineNodes.osc.frequency.setTargetAtTime(speed, t, 0.08);
      engineNodes.sub.frequency.setTargetAtTime(speed / 2, t, 0.08);
      engineNodes.lp.frequency.setTargetAtTime(240 + 700 * rate01, t, 0.1);
      engineNodes.g.gain.setTargetAtTime(0.25 + 0.5 * Math.min(1, rate01 * 1.4), t, 0.1);
    }
  }

  return {
    sfx,
    setEngine,
    unlock,
    get unlocked() {
      return unlocked;
    },
    get balance() {
      return balance;
    },
  };
}
