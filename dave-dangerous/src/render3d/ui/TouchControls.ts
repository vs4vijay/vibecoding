// src/render3d/ui/TouchControls.ts — on-screen touch controls (design D2).
// Self-contained overlay following the UI.ts pattern: builds its own DOM and
// scoped stylesheet (`ddtc-*` prefix), no sim imports. game.ts wires the
// callbacks straight into Input's injection API. The overlay mounts ONLY on
// coarse-pointer devices (zero DOM on desktop) and is visible only during the
// "playing" flow.

export type TouchAction = "left" | "right" | "jump" | "jetpack";

/** Capability gate, node-safe: importing this module must not touch window. */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;
}

/**
 * Pure pointerId → action multi-map (unit-tested in node). An action stays
 * held until its LAST pointer lifts (two fingers on one pad: lifting one
 * keeps the hold). "fire" is accepted for tracking only — the FIRE pad is
 * edge-triggered, but a lingering tap finger still needs a cleanup path — and
 * is never reported as a held action by release/cancel/releaseAll.
 */
export class PointerActionMap {
  private ids = new Map<number, TouchAction | "fire">();

  press(id: number, action: TouchAction | "fire"): void {
    if (this.ids.has(id)) return; // one pointer = one entry, even on repeat downs
    this.ids.set(id, action);
  }

  /** Actions no longer held after removing this pointer ([] when others still hold them). */
  release(id: number): TouchAction[] {
    const action = this.ids.get(id);
    if (action === undefined) return [];
    this.ids.delete(id);
    if (action === "fire" || this.isTracked(action)) return [];
    return [action];
  }

  cancel(id: number): TouchAction[] {
    return this.release(id);
  }

  /** Distinct held actions, then clears everything. */
  releaseAll(): TouchAction[] {
    const held = this.heldActions();
    this.ids.clear();
    return held;
  }

  held(action: TouchAction): boolean {
    return this.isTracked(action);
  }

  private isTracked(action: TouchAction): boolean {
    for (const a of this.ids.values()) if (a === action) return true;
    return false;
  }

  private heldActions(): TouchAction[] {
    const out: TouchAction[] = [];
    for (const a of this.ids.values()) if (a !== "fire" && !out.includes(a)) out.push(a);
    return out;
  }
}

export interface TouchCallbacks {
  onPress(action: TouchAction): void;   // held pads: left/right/jump/jetpack
  onRelease(action: TouchAction): void; // mirrors onPress, only after a press
  onFire(): void;                       // FIRE pad: edge-triggered, once per tap
  onPause(): void;                      // pause chip tap
}

// --- stylesheet (scoped to .ddtc-*; tokens mirror the UI.ts/palette glass-gold look)
const CSS = `
.ddtc-root {
  --ddtc-panel: rgba(10, 15, 20, 0.62);
  --ddtc-hairline: rgba(217, 164, 65, 0.4);
  --ddtc-ember-hot: #ffd27a;
  --ddtc-text: #e8ecf2;
  --ddtc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ddtc-font-ui: "Outfit", "Sora", system-ui, sans-serif;

  position: absolute;
  inset: 0;
  z-index: 25;
  display: none;
  pointer-events: none;
  font-family: var(--ddtc-font-ui);
  color: var(--ddtc-text);
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.ddtc-root.is-visible { display: block; }
.ddtc-root * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
.ddtc-root button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; touch-action: none; }

/* clusters pinned to the bottom corners inside the device safe area */
.ddtc-cluster { position: absolute; bottom: calc(16px + env(safe-area-inset-bottom)); pointer-events: none; }
.ddtc-cluster--left { left: calc(16px + env(safe-area-inset-left)); display: flex; gap: 16px; }
.ddtc-cluster--right { right: calc(16px + env(safe-area-inset-right)); width: 192px; height: 140px; }

.ddtc-pad {
  pointer-events: auto;
  width: 64px;
  height: 64px;
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ddtc-hairline);
  border-radius: 50%;
  background: var(--ddtc-panel);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  box-shadow: 0 8px 24px rgba(5, 8, 12, 0.45);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-indent: 0.16em;
  color: var(--ddtc-text);
  transition: background 0.16s var(--ddtc-ease), border-color 0.16s var(--ddtc-ease), color 0.16s var(--ddtc-ease), box-shadow 0.16s var(--ddtc-ease), transform 0.16s var(--ddtc-ease);
}
/* action arc (fan around the right-thumb pivot): JUMP low-left, JET mid-top,
   FIRE low-right. JET sits low enough that its top edge clears the lifted HUD
   bottom row (which ends at y≈712 on an 844-tall viewport) while staying above
   the JUMP/FIRE row; the 192px cluster keeps all three 64px circles separated */
.ddtc-pad--jump { position: absolute; left: 0; bottom: 0; }
.ddtc-pad--jetpack { position: absolute; left: 64px; bottom: 26px; }
.ddtc-pad--fire { position: absolute; left: 128px; bottom: 0; }
.ddtc-pad--left, .ddtc-pad--right { font-size: 17px; letter-spacing: 0; text-indent: 0; }
.ddtc-pad.is-down {
  background: rgba(255, 179, 71, 0.24);
  border-color: var(--ddtc-ember-hot);
  color: var(--ddtc-ember-hot);
  box-shadow: 0 0 20px rgba(255, 179, 71, 0.35), inset 0 0 14px rgba(255, 179, 71, 0.2);
  transform: scale(0.94);
}

/* pause chip: below the HUD's top chips, right-aligned to the HUD gutter */
.ddtc-pause {
  position: absolute;
  top: calc(96px + env(safe-area-inset-top));
  right: calc(28px + env(safe-area-inset-right));
  pointer-events: auto;
  touch-action: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 44px;
  min-height: 44px;
  padding: 10px 16px 11px;
  border: 1px solid var(--ddtc-hairline);
  border-radius: 6px;
  background: var(--ddtc-panel);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.26em;
  text-indent: 0.26em;
  color: var(--ddtc-text);
  transition: background 0.16s var(--ddtc-ease), border-color 0.16s var(--ddtc-ease), color 0.16s var(--ddtc-ease);
}
`;

export class TouchControls {
  private map = new PointerActionMap();
  private rootEl: HTMLDivElement | null = null;
  private pads = new Map<TouchAction | "fire", HTMLButtonElement>();
  private coarseMq: MediaQueryList | null = null;
  private hoverMq: MediaQueryList | null = null;
  private coarse = isCoarsePointer();
  private flow = "menu";
  private visible = false;

  constructor(private container: HTMLElement, private cb: TouchCallbacks) {
    // capability-change listeners are cheap and not DOM: attached even where the
    // gate skipped mounting, so a late switch to coarse input still gets controls
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.coarseMq = window.matchMedia("(pointer: coarse)");
      this.hoverMq = window.matchMedia("(hover: none)");
      this.coarseMq.addEventListener("change", this.onCapabilityChange);
      this.hoverMq.addEventListener("change", this.onCapabilityChange);
    }
    if (this.coarse) this.mount();
  }

  /** Per-frame visibility gate: shown iff coarse-capable AND flow === "playing". */
  setVisible(flow: string): void {
    this.flow = flow;
    if (this.coarse) this.applyVisibility();
  }

  dispose(): void {
    this.coarseMq?.removeEventListener("change", this.onCapabilityChange);
    this.hoverMq?.removeEventListener("change", this.onCapabilityChange);
    this.coarseMq = null;
    this.hoverMq = null;
    this.releaseHeld();
    this.unmount();
  }

  private onCapabilityChange = (): void => {
    const coarse = isCoarsePointer();
    if (coarse === this.coarse) return; // the two queries fire for one real change
    this.coarse = coarse;
    if (coarse) this.mount();
    this.applyVisibility();
    if (!coarse) this.unmount(); // keep the zero-DOM rule on fine-pointer devices
  };

  private applyVisibility(): void {
    const show = this.flow === "playing";
    if (show === this.visible) return;
    this.visible = show;
    this.rootEl?.classList.toggle("is-visible", show);
    if (!show) this.releaseHeld(); // a lift during pause must never leave a stuck key
  }

  /** Releases every held action through the callbacks and un-flashes the pads. */
  private releaseHeld(): void {
    const released = this.map.releaseAll();
    for (const pad of this.pads.values()) pad.classList.remove("is-down");
    for (const action of released) this.cb.onRelease(action);
  }

  private mount(): void {
    if (this.rootEl) return;
    const root = document.createElement("div");
    root.className = "ddtc-root";
    const style = document.createElement("style");
    style.textContent = CSS; // removed with the root in unmount(), like UI.ts
    root.appendChild(style);

    const left = document.createElement("div");
    left.className = "ddtc-cluster ddtc-cluster--left";
    left.appendChild(this.pad("left", "◀", "Move left"));
    left.appendChild(this.pad("right", "▶", "Move right"));
    root.appendChild(left);

    const right = document.createElement("div");
    right.className = "ddtc-cluster ddtc-cluster--right";
    right.appendChild(this.pad("jump", "JUMP", "Jump"));
    right.appendChild(this.pad("jetpack", "JET", "Jetpack"));
    right.appendChild(this.pad("fire", "FIRE", "Fire"));
    root.appendChild(right);

    root.appendChild(this.pauseChip());
    this.container.appendChild(root);
    this.rootEl = root;
  }

  private unmount(): void {
    this.rootEl?.remove(); // per-control listeners go with the elements
    this.rootEl = null;
    this.pads.clear();
  }

  private pad(action: TouchAction | "fire", label: string, ariaLabel: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = -1; // pointer-only controls; keyboard players have the real keys
    el.className = `ddtc-pad ddtc-pad--${action}`;
    el.setAttribute("aria-label", ariaLabel);
    el.textContent = label;
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault(); // no compat mouse events, no focus on tap
      try {
        el.setPointerCapture(e.pointerId); // sliding off the pad keeps the hold
      } catch { /* pointer already inactive */ }
      this.map.press(e.pointerId, action);
      el.classList.add("is-down");
      if (action === "fire") this.cb.onFire();
      else this.cb.onPress(action);
    });
    const end = (e: PointerEvent): void => {
      const released = this.map.release(e.pointerId);
      // pointerup + the implicit lostpointercapture both land here: the second
      // release is a map no-op, and held() keeps is-down while a twin finger stays
      el.classList.toggle("is-down", action !== "fire" && this.map.held(action));
      for (const releasedAction of released) this.cb.onRelease(releasedAction);
    };
    // both cancel paths release: browser gesture takeover or capture lost mid-hold
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);
    this.pads.set(action, el);
    return el;
  }

  private pauseChip(): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = -1;
    el.className = "ddtc-pause";
    el.setAttribute("aria-label", "Pause");
    el.textContent = "⏸ PAUSE";
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      this.cb.onPause();
    });
    return el;
  }
}
