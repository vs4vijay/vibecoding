/**
 * @file core/scheme.js
 * Input-scheme detection + first-touch latching (ui-ux-pass design D1).
 *
 * Boot-time detection is a latched coarse-pointer check: `(pointer: coarse)`
 * means the primary input is a touch screen -> "touch"; anything else
 * (fine pointer, missing matchMedia, sandboxed environment) safely defaults
 * to "keys". Hybrid devices can guess wrong at boot, so the first real
 * `touchstart` re-latches the session to "touch" and refreshes the
 * <html data-scheme> attribute — CSS uses it to show/hide scheme-specific
 * glyphs and main.js re-renders its hint copy through applyHints().
 */

let scheme = null; // "touch" | "keys" (null until detectScheme runs)
let latched = false; // a real touchstart has been seen this session
let listenerInstalled = false;
let onLatched = null; // optional consumer callback (main.js re-applies hints)

/** Publish the current scheme on <html data-scheme="..."> for CSS. */
function applyAttribute() {
  try {
    document.documentElement.dataset.scheme = scheme;
  } catch {
    /* no DOM in this environment — detection still works */
  }
}

/**
 * Boot-time detection. Coarse primary pointer -> "touch", otherwise
 * (fine pointer, missing API, throwing matchMedia) -> "keys".
 * After a touch latch, always reports "touch" for the session.
 * @returns {"touch"|"keys"}
 */
export function detectScheme() {
  if (latched) {
    scheme = "touch";
  } else {
    let coarse = false;
    try {
      coarse = !!(
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches
      );
    } catch {
      coarse = false; // failed media query -> safe keyboard default
    }
    scheme = coarse ? "touch" : "keys";
  }
  applyAttribute();
  return scheme;
}

/** Live scheme for hint rendering (detects first if needed). */
export function currentScheme() {
  return scheme === "touch" || scheme === "keys" ? scheme : detectScheme();
}

/** One-shot first-touch handler (module-level so it can remove itself). */
function onFirstTouch() {
  try {
    window.removeEventListener("touchstart", onFirstTouch);
  } catch {
    /* no removeEventListener here — the latch below still applies */
  }
  if (latched) return;
  latched = true;
  scheme = "touch";
  applyAttribute();
  if (typeof onLatched === "function") {
    try {
      onLatched("touch");
    } catch {
      /* a broken consumer must never break input */
    }
  }
}

/**
 * Install the one-shot first-`touchstart` latch (passive). Idempotent:
 * calling it again only refreshes the optional latch callback, never
 * adds a second listener.
 * @param {(scheme: "touch") => void} [cb] Called once when touch latches.
 */
export function latchTouch(cb) {
  if (typeof cb === "function") onLatched = cb;
  if (listenerInstalled) return;
  listenerInstalled = true;
  try {
    window.addEventListener("touchstart", onFirstTouch, { passive: true });
  } catch {
    listenerInstalled = false; // no window here; a later call can retry
  }
}
