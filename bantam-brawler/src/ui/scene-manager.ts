// src/ui/scene-manager.ts — stack machine over DOM-overlay scenes (§1 table).
// One active scene + a separate overlay stack; Pause rides the overlay stack so
// it never becomes a scene and the battle scene beneath stays mounted (spec §4).
// Transitions are a 150 ms fade on the shared #ui host.

export interface Scene {
  /** Called when the scene becomes active (mount/reveal); ctx present once the
   * manager is mounted — bare unit-test scenes may omit it. */
  enter(ctx?: SceneCtx): void;
  exit(): void;
  update(dtMs: number): void;
  /** The scene's DOM subtree root, mounted under the manager's host element. */
  root: HTMLElement;
}

/** Services handed to every scene on enter(). */
export interface SceneCtx {
  sm: SceneManager;
  audio: AudioBridge;
  goto(title: "title" | "mode" | "select" | "stage-select" | "battle" | "results", arg?: unknown): void;
  /** Payload delivered by the most recent goto() — set by createSceneCtx; scenes read it in enter(). */
  gotoArg: unknown;
  quit(): void;
}

/** Subset of the audio engine scenes may use. */
export interface AudioBridge {
  onEvent(e: unknown): void;
  playMusic(stageId: string): void;
  toggleMute(): boolean;
}

const FADE_MS = 150;

interface Overlay {
  root: HTMLElement;
}

export class SceneManager {
  private stack: Scene[] = [];
  private overlays: Overlay[] = [];
  private host: HTMLElement | null = null;
  private ctx: SceneCtx | null = null;
  private fadeEl: HTMLElement | null = null;
  private fadeUntil = 0;

  /**
   * Attach to a host element (#ui). Mounts a fade-veil child that covers the
   * screen during transitions.
   */
  mount(host: HTMLElement, ctx: SceneCtx): void {
    this.host = host;
    this.ctx = ctx;
    const veil = document.createElement("div");
    veil.style.cssText =
      "position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity 150ms linear;";
    host.appendChild(veil);
    this.fadeEl = veil;
  }

  get hasMountedHost(): boolean {
    return this.host !== null;
  }

  /** Replace the whole stack with `scene` (forward navigation). */
  replace(scene: Scene): void {
    this.withFade(() => {
      while (this.stack.length > 0) this.popScene();
      this.pushScene(scene);
    });
  }

  /** Push on top of the current scene (back navigation keeps what's below). */
  push(scene: Scene): void {
    this.withFade(() => this.pushScene(scene));
  }

  /** Unwind one level; re-enters the revealed scene. Refused on the bottom
   * scene — menus always keep an anchor below, and Quit navigates explicitly. */
  pop(): void {
    if (this.stack.length <= 1) return;
    this.withFade(() => this.popScene());
  }

  /** Push a transient layer (pause menu, remap capture) — never a scene.
   * Accepts a bare element or any `{root}` carrier (e.g. a Scene object). */
  overlay(rootOrCarrier: HTMLElement | { root: HTMLElement }): void {
    const el = isElementLike(rootOrCarrier) ? rootOrCarrier : rootOrCarrier.root;
    this.overlays.push({ root: el });
    if (this.host !== null) this.host.appendChild(el);
  }


  /** Pop the topmost overlay and return its root, or null when none open. */
  closeOverlay(): HTMLElement | null {
    const ov = this.overlays.pop();
    if (ov === undefined) return null;
    ov.root.remove();
    return ov.root;
  }

  get overlayOpen(): boolean {
    return this.overlays.length > 0;
  }

  /** Top of the scene stack; null before the first replace/push. */
  active(): Scene | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Tick the active scene only; overlays are inert DOM, not ticked. */
  update(dtMs: number): void {
    const top = this.active();
    if (top !== null) top.update(dtMs);
  }

  /** Scenes own canvas rendering themselves; the manager owns only the fade veil. */
  draw(): void {
    if (this.host === null || this.fadeEl === null) return;
    const remaining = this.fadeUntil - performance.now();
    this.fadeEl.style.opacity = String(remaining > 0 ? Math.min(1, remaining / FADE_MS) : 0);
  }

  private pushScene(scene: Scene): void {
    const prev = this.active();
    prev?.exit();
    this.mountRoot(scene.root);
    scene.enter(this.ctx ?? undefined);
    this.stack.push(scene);
  }

  private popScene(): void {
    const top = this.stack.pop();
    if (top === undefined) return;
    top.exit();
    if (typeof top.root.remove === "function") top.root.remove();
    const next = this.active();
    if (next !== null) {
      this.mountRoot(next.root);
      next.enter(this.ctx ?? undefined);
    }
    // Bare stack after popping the last scene is legal mid-transition; the
    // caller (replace) immediately pushes the successor.
  }

  private mountRoot(root: HTMLElement): void {
    if (this.host === null) return;
    root.style.position = "absolute";
    root.style.inset = "0";
    this.host.appendChild(root);
  }

  private withFade(fn: () => void): void {
    fn();
    this.fadeUntil = performance.now() + FADE_MS;
  }
}

/** Structural DOM-element check: bare test fakes carry remove/appendChild/style. */
function isElementLike(v: HTMLElement | { root: HTMLElement }): v is HTMLElement {
  return typeof (v as Partial<HTMLElement>).remove === "function"
    && typeof (v as Partial<HTMLElement>).appendChild === "function";
}

