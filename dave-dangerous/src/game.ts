// src/game.ts
import { GameLoop } from "./core/GameLoop";
import { Input } from "./core/Input";
import { World } from "./world/World";
import { GameState } from "./state/GameState";
import { SaveState } from "./state/SaveState";
import { CinematicAudio } from "./audio/CinematicAudio";
import { RNG } from "./core/RNG";
import { LEVEL_1, LEVELS, BONUS_ROOMS } from "./levels/levels";
import { on } from "./core/Events";
import { GameView } from "./render3d/GameView";
import { UI } from "./render3d/ui/UI";
import type { RenderUiState } from "./render3d/viewTypes";
import type { LevelData } from "./core/types";

export const GAME_FLOW = ["playing", "gameover"] as const;
export type GameFlow = (typeof GAME_FLOW)[number];
export const GAME_FLOW_KEYS: Record<GameFlow, GameFlow> = {
  playing: "playing",
  gameover: "gameover",
};

type Mode = "menu" | "ingame";

export class Game {
  private view: GameView;
  private ui: UI;
  private audio = new CinematicAudio();
  private input = new Input();
  private state: GameState;
  private world: World | null = null;
  private currentLevel: LevelData = LEVEL_1;
  private loop: GameLoop;
  private flow: GameFlow = GAME_FLOW_KEYS.playing;
  private mode: Mode = "menu";
  private rng: RNG;
  private inBonus = false;
  private paused = false;
  private clearTimer = 0;
  private lastRenderMs: number | null = null;
  private prevVelY = 0;
  private jetpackSfxCooldown = 0;
  private jetpackFxOn = false;

  constructor(container: HTMLElement) {
    this.view = new GameView(container);
    this.state = new GameState();
    const saved = SaveState.load();
    if (saved) this.state.restore(saved);
    this.rng = new RNG(Date.now() >>> 0);
    this.ui = new UI(container, {
      onStart: () => this.startGame(),
      onResume: () => { if (this.paused) this.togglePause(); },
      onRestart: () => this.startGame(true),
      onNext: () => this.finishClear(),
      onToggleMute: () => { this.toggleMute(); },
      onGesture: () => this.unlockAudio(),
    });
    this.loop = new GameLoop({
      update: dt => this.update(dt),
      render: () => this.render(),
    });
  }

  start(): void {
    this.input.attach(window);
    this.startLevel(1); // world exists for the title-screen diorama (sim frozen in menu)
    on("dave:die", () => this.onDeath());
    on("level:complete", () => this.onComplete());
    this.wireAudio();
    window.addEventListener("keydown", e => {
      this.ui.setMuted(this.audio.muted);
      if (e.code === "Backquote") {
        e.preventDefault();
        return;
      }
      if (e.code === "Enter" && this.mode === "menu") {
        e.preventDefault();
        this.startGame();
        return;
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        e.preventDefault();
        if (this.mode === "ingame") this.togglePause();
        return;
      }
      if (e.code === "KeyM") {
        e.preventDefault();
        this.toggleMute();
        this.ui.setMuted(this.audio.muted);
        return;
      }
      if (e.code === "KeyR" && this.flow === GAME_FLOW_KEYS.gameover) {
        e.preventDefault();
        this.startGame(true);
      }
    });
    this.loop.attach(f => requestAnimationFrame(f));
  }

  /** leave the title screen (or game over) and (re)enter play */
  startGame(fromGameOver = false): void {
    void fromGameOver;
    this.unlockAudio();
    this.mode = "ingame";
    this.paused = false;
    this.clearTimer = 0;
    if (this.flow === GAME_FLOW_KEYS.gameover || this.state.lives <= 0) this.state.reset(1);
    this.inBonus = false;
    this.startLevel(1);
    this.audio.playMusic("cave");
  }

  private startLevel(levelId: number): void {
    this.currentLevel = (this.inBonus ? BONUS_ROOMS : LEVELS)[levelId] ?? LEVEL_1;
    this.world?.destroy();
    this.state.level = levelId;
    this.state.currentScreen = 0;
    this.world = new World(this.currentLevel, this.state);
    this.world.spawnEnemies(this.rng);
    this.world.dave.hasGun = this.state.hasGun;
    this.world.dave.jetpackFuel = this.state.jetpackFuel;
    this.rng = RNG.deserialize((Date.now() & 0xffffffff) >>> 0);
    this.flow = GAME_FLOW_KEYS.playing;
    this.prevVelY = 0;
  }

  private update(dt: number): void {
    const world = this.world;
    if (!world || this.mode === "menu" || this.paused) return;
    if (this.clearTimer > 0) {
      this.clearTimer -= dt * 60;
      if (this.clearTimer <= 0) { this.clearTimer = 0; this.finishClear(); }
      return;
    }
    const input = this.input.read(); // consumes the fire edge
    if (this.flow === GAME_FLOW_KEYS.gameover) {
      if (input.fire) this.startGame(true);
      return;
    }
    if (input.fire) {
      world.fire();
      this.audio.playSfx("shoot");
      this.view.fx.shoot({ x: world.dave.pos.x, y: world.dave.pos.y });
    }
    if (input.jetpack !== this.jetpackFxOn) {
      this.jetpackFxOn = input.jetpack;
      this.view.fx.jetpack(this.jetpackFxOn);
    }
    const wasGrounded = world.dave.grounded;
    const fallSpeed = this.prevVelY;
    world.update(input, this.rng);
    this.prevVelY = world.dave.vel.y;
    if (!wasGrounded && world.dave.grounded && fallSpeed > 2.5) {
      this.view.fx.land({ x: world.dave.pos.x, y: world.dave.pos.y });
      this.audio.playSfx("land");
    }
    if (input.jump && wasGrounded) this.audio.playSfx("jump");
    // jetpack layer
    this.jetpackSfxCooldown -= dt;
    if (input.jetpack && world.dave.jetpackFuel > 0) {
      if (this.jetpackSfxCooldown <= 0) { this.audio.playSfx("jetpack"); this.jetpackSfxCooldown = 0.09; }
    }
    this.input.tick();
  }

  private render(): void {
    const world = this.world;
    if (!world) return;
    const now = performance.now();
    const dtReal = this.lastRenderMs === null ? 1 / 60 : (now - this.lastRenderMs) / 1000;
    this.lastRenderMs = now;

    this.audio.update(dtReal);
    const ui = this.uiState();
    this.view.setMenuMode(this.mode === "menu");
    this.view.sync(world, dtReal, ui);
    this.ui.setState(ui);
  }

  private uiState(): RenderUiState {
    const flow: RenderUiState["flow"] = this.mode === "menu"
      ? "menu"
      : this.paused ? "paused"
      : this.clearTimer > 0 ? "clear"
      : this.flow === GAME_FLOW_KEYS.gameover ? "gameover"
      : "playing";
    return {
      flow,
      score: this.state.score,
      lives: this.state.lives,
      level: this.state.level,
      hasGun: this.state.hasGun,
      fuel: this.state.jetpackFuel,
      fuelMax: 60,
      lowFuel: this.state.jetpackFuel > 0 && this.state.jetpackFuel < 15,
    };
  }

  private onDeath(): void {
    if (!this.world) return;
    this.audio.playSfx("die");
    this.view.fx.death({ x: this.world.dave.pos.x, y: this.world.dave.pos.y });
    const alive = this.state.loseLife();
    if (!alive) {
      this.flow = GAME_FLOW_KEYS.gameover;
      this.audio.playMusic("danger");
      return;
    }
    this.world.dave.pos = respawnPos(this.currentLevel);
    this.world.dave.vel = { x: 0, y: 0 };
    this.world.dave.grounded = false;
    this.world.dave.alive = true;
  }

  private onComplete(): void {
    SaveState.persist(this.state.snapshot());
    this.view.fx.doorOpen({ x: this.world?.door.pos.x ?? 0, y: this.world?.door.pos.y ?? 0 });
    this.view.fx.warp();
    this.audio.playSfx("warp");
    this.clearTimer = 2.5 * 60; // freeze on the LEVEL CLEAR card (frames @60), then finishClear() advances
  }

  /** delayed second half of onComplete: advance once the clear card has shown */
  finishClear(): void {
    this.clearTimer = 0;
    this.inBonus = !this.inBonus;
    this.startLevel(1);
  }

  restart(): void {
    this.state.reset(1);
    this.inBonus = false;
    this.paused = false;
    this.clearTimer = 0;
    this.startLevel(1);
  }

  private wireAudio(): void {
    on("dave:collect", e => {
      this.audio.playSfx(e.item === "trophy" ? "trophy" : "collect");
      this.view.fx.collect(e.item, this.world?.dave.pos ?? { x: 0, y: 0 });
      this.ui.toast(e.item === "trophy" ? "TROPHY SECURED — the door awakens" : `+${e.value}`, "item");
    });
    on("gun:pickup", () => { this.audio.playSfx("gun"); this.ui.toast("PLASMA GUN acquired — SHIFT to fire", "item"); });
    on("jetpack:pickup", () => { this.audio.playSfx("jetpack"); this.ui.toast("JETPACK fueled — CTRL to ignite", "item"); });
    on("oneup:pickup", () => { this.audio.playSfx("oneup"); this.ui.toast("EXTRA LIFE", "info"); });
    on("enemy:die", () => {
      this.audio.playSfx("hurt");
      const e = this.world?.enemies.find(en => en.dead) ?? null;
      if (e) this.view.fx.enemyDie({ x: e.pos.x, y: e.pos.y });
    });
  }

  private unlockAudio(): void {
    this.audio.unlock();
    if (this.mode === "menu") this.audio.playMusic("menu");
  }

  togglePause(): boolean {
    if (this.mode !== "ingame" || this.clearTimer > 0) return this.paused;
    this.paused = !this.paused;
    return this.paused;
  }

  resume(): void {
    this.paused = false;
  }

  toggleMute(): boolean {
    this.audio.setMuted(!this.audio.muted);
    return this.audio.muted;
  }

  /** pause overlay may offer sound toggle; UI reads this */
  get muted(): boolean { return this.audio.muted; }
}

/** Dave respawn point: the level's dave EntitySpawn in pixels — same source of
 *  truth as the initial spawn, so respawns always land standing on the floor top. */
export function respawnPos(level: LevelData): { x: number; y: number } {
  const spawn = level.screens[level.startScreen]!.entities.find(e => e.type === "dave");
  if (!spawn) throw new Error("level missing dave");
  return { x: spawn.x * 16, y: spawn.y * 16 };
}

