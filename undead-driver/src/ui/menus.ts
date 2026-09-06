import { load, save } from "../core/storage";
import type { AudioEngine } from "../core/audio";

/** Persistence keys under the zh. namespace. */
const KEY_COACH = "coachSeen";

export const HOW_TO_LINES = [
  "DRAG ⇆ steer",
  "TAP side to SHOOT",
  "GRAZE obstacles to scrape zombies — don't hit head-on!",
];

/**
 * Title menu: logo, PLAY, HOW TO panel, best score and mute toggle.
 * Owns the game-over card too (cause, stats grid, NEW BEST badge, RETRY).
 */
export class Menus {
  private readonly root: HTMLElement;
  private readonly t: TitleRefs;
  private readonly o: OverRefs;
  private readonly playCbs = new Set<() => void>();

  constructor(root: HTMLElement, audio: AudioEngine) {
    this.root = root;
    this.t = buildTitle();
    this.o = buildOver();
    this.t.mute.textContent = audio.muted ? "🔇 SOUND OFF" : "🔊 SOUND ON";
    this.t.mute.addEventListener("click", () => {
      audio.setMuted(!audio.muted);
      this.syncMuteLabel(audio);
    });
    this.t.play.addEventListener("click", () => {
      for (const cb of this.playCbs) cb();
    });
    this.o.retry.addEventListener("click", () => {
      for (const cb of this.playCbs) cb();
    });

    this.root.append(this.t.wrap, this.o.wrap);
    this.t.wrap.classList.add("hidden");
    this.o.wrap.classList.add("hidden");
  }

  /** Subscribe to PLAY/RETRY; both start a fresh run. Returns off(). */
  onPlay(cb: () => void): () => void {
    this.playCbs.add(cb);
    return () => void this.playCbs.delete(cb);
  }

  showTitle(best: number): void {
    this.t.best.textContent =
      best > 0 ? `BEST ${best.toLocaleString()}` : "";
    this.t.wrap.classList.remove("hidden");
    this.o.wrap.classList.add("hidden");
  }

  /**
   * Game-over card; focuses RETRY so Space/Enter immediately restarts.
   */
  showGameOver(stats: {
    score: number;
    distanceM: number;
    kills: number;
    level: number;
    cause: "flip" | "crash";
  }, newBest: boolean): void {
    this.o.cause.textContent =
      stats.cause === "flip" ? "THE CAR FLIPPED" : "HEAD-ON COLLISION";
    this.o.stats.replaceChildren(
      stat("SCORE", stats.score.toLocaleString()),
      stat("DIST", `${Math.floor(stats.distanceM)}m`),
      stat("KILLS", String(stats.kills)),
      stat("LEVEL", String(stats.level)),
    );
    this.o.newBest.classList.toggle("hidden", !newBest);
    this.t.wrap.classList.add("hidden");
    this.o.wrap.classList.remove("hidden");
    this.o.retry.focus();
  }

  hideAll(): void {
    this.t.wrap.classList.add("hidden");
    this.o.wrap.classList.add("hidden");
  }

  /** True while the game-over card is on screen. */
  get gameOverVisible(): boolean {
    return !this.o.wrap.classList.contains("hidden");
  }

  /**
   * Defensive retry: activates RETRY even if programmatic focus was
   * dropped (guarantees the instant-restart contract on Space/Enter).
   */
  retryFromKey(): void {
    if (!this.gameOverVisible) return;
    if (document.activeElement !== this.o.retry) this.o.retry.click();
  }

  private syncMuteLabel(audio: AudioEngine): void {
    this.t.mute.textContent = audio.muted ? "🔇 SOUND OFF" : "🔊 SOUND ON";
  }
}

type TitleRefs = {
  wrap: HTMLElement;
  play: HTMLButtonElement;
  best: HTMLElement;
  mute: HTMLButtonElement;
};

type OverRefs = {
  wrap: HTMLElement;
  cause: HTMLElement;
  newBest: HTMLElement;
  stats: HTMLElement;
  retry: HTMLButtonElement;
};

function buildTitle(): TitleRefs {
  const wrap = elDiv("menu title-menu");
  const logo = elDiv("logo");
  logo.textContent = "UNDEAD HIGHWAY";
  const play = mkBtn("play-btn", "PLAY");
  const howto = elDiv("howto");
  for (const line of HOW_TO_LINES) {
    const row = elDiv("howto-line");
    row.textContent = line;
    howto.append(row);
  }
  const best = elDiv("best-line");
  const mute = mkBtn("mute-btn", "");
  wrap.append(logo, play, howto, best, mute);
  return { wrap, play, best, mute };
}

function buildOver(): OverRefs {
  const wrap = elDiv("menu over-menu");
  const cause = elDiv("cause");
  const newBest = elDiv("new-best hidden");
  newBest.textContent = "NEW BEST!";
  const stats = elDiv("stats-grid");
  const hint = elDiv("retry-hint");
  hint.textContent = "SPACE / ENTER to retry";
  const retry = mkBtn("retry-btn", "RETRY");
  wrap.append(cause, newBest, stats, retry, hint);
  return { wrap, cause, newBest, stats, retry };
}


/** True when the coach hints should run before this session's first run. */
export function coachPending(): boolean {
  return !load<boolean>(KEY_COACH, false);
}

export function markCoachSeen(): void {
  save(KEY_COACH, true);
}

function stat(label: string, value: string): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "stat";
  const k = document.createElement("span");
  k.className = "stat-label";
  k.textContent = label;
  const v = document.createElement("span");
  v.className = "stat-value";
  v.textContent = value;
  cell.append(k, v);
  return cell;
}


function mkBtn(className: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

function elDiv(className: string): HTMLElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}
