// UI transitions and motion effects (per visual-overhaul 7.3 / D9):
// score/coin count-up tween, combo punch-scale, crash damage flash, faded
// screen transitions (menu/hud/gameover) and the play vignette. Everything
// animates opacity/transform only — no per-frame layout reads.

const COUNTER_SETTLE_MS = 300; // score/coin tween settle time
const SCREEN_FADE_MS = 300; // screen/vignette fade (spec cap ~400ms)

// Exponential-approach counter: the displayed value chases the target with a
// rate constant sized to settle in ~COUNTER_SETTLE_MS. Restart-free on rapid
// events — the target simply moves and the chase never lags more than a few
// units behind (a restarted fixed-length tween would stack lag instead).
function createCounter(el, format = (v) => v.toLocaleString()) {
  // e^(-kappa * settle) ≈ 0.01 → visually settled at the target time
  const KAPPA = 4.6 / (COUNTER_SETTLE_MS / 1000);
  let target = 0;
  let shown = 0;
  let raf = 0;
  let lastT = 0;

  function tick(t) {
    const dt = Math.min((t - lastT) / 1000, 0.1);
    lastT = t;
    const diff = target - shown;
    if (Math.abs(diff) < 0.5) {
      shown = target;
      raf = 0;
      el.textContent = format(target);
      return;
    }
    shown += diff * (1 - Math.exp(-KAPPA * dt));
    el.textContent = format(Math.round(shown));
    raf = requestAnimationFrame(tick);
  }

  return {
    set(value) {
      target = value;
      if (!raf) {
        lastT = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    // Jump straight to the target — used on retry so the displays zero
    // instantly instead of counting down from the previous run.
    snap() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      shown = target;
      el.textContent = format(target);
    },
  };
}

// Re-trigger a CSS animation class: remove, force a reflow so the restart
// registers, re-add. The class is dropped on animationend so the element
// returns to its base styles (e.g. the multiplier's infinite pulse resumes).
function pulse(el, className, animationName) {
  el.classList.remove(className);
  void el.offsetWidth; // flush styles so the animation can restart
  el.classList.add(className);
  el.addEventListener(
    "animationend",
    (e) => {
      if (e.animationName === animationName) el.classList.remove(className);
    },
    { once: true },
  );
}

// Wires the motion layer to the DOM. `screens` maps logical names ("menu",
// "hud", "gameover") to the overlay elements; any of them still carrying the
// instant `.hidden` class is migrated to the fade classes at init, so
// index.html needs no changes. The vignette and damage-flash overlays are
// created here too (see style.css "UI Motion" for their rules).
export function createUiMotion({
  scoreEl,
  coinsEl,
  comboEl,
  comboValueEl,
  multiplierEl,
  multiplierValueEl,
  screens = {},
}) {
  const scoreTween = createCounter(scoreEl);
  const coinsTween = createCounter(coinsEl);

  const vignette = document.createElement("div");
  vignette.id = "play-vignette";
  document.body.appendChild(vignette);

  const damageFlash = document.createElement("div");
  damageFlash.id = "damage-flash";
  document.body.appendChild(damageFlash);

  for (const el of Object.values(screens)) {
    if (!el) continue;
    el.classList.add("screen");
    if (el.classList.contains("hidden")) {
      el.classList.remove("hidden");
      el.classList.add("screen-hidden");
    }
  }
  vignette.classList.add("screen", "screen-hidden");

  let lastCombo = 0;
  let lastMultiplier = 1;
  let playing = false;

  function setScore(value) {
    scoreTween.set(value);
  }

  function setCoins(value) {
    coinsTween.set(value);
  }

  function snapCounters() {
    scoreTween.snap();
    coinsTween.snap();
  }

  function setCombo(value) {
    if (value > 1) {
      comboEl.classList.remove("hidden");
      comboValueEl.textContent = value;
      if (value > lastCombo) pulse(comboEl, "punch", "combo-punch");
    } else {
      comboEl.classList.add("hidden");
    }
    lastCombo = value;
  }

  function setMultiplier(value) {
    if (value > 1) {
      multiplierEl.classList.remove("hidden");
      multiplierValueEl.textContent = value;
      if (value > lastMultiplier) pulse(multiplierEl, "punch", "combo-punch");
    } else {
      multiplierEl.classList.add("hidden");
    }
    lastMultiplier = value;
  }

  function crashFlash() {
    pulse(damageFlash, "flash-active", "damage-flash");
  }

  function showScreen(name) {
    const el = screens[name];
    if (el) el.classList.remove("screen-hidden");
  }

  function hideScreen(name) {
    const el = screens[name];
    if (el) el.classList.add("screen-hidden");
  }

  function setPlaying(value) {
    playing = value;
    vignette.classList.toggle("screen-hidden", !value);
  }

  return {
    setScore,
    setCoins,
    snapCounters,
    setCombo,
    setMultiplier,
    crashFlash,
    showScreen,
    hideScreen,
    setPlaying,
    isPlaying: () => playing,
  };
}
