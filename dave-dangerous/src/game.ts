// src/game.ts
import { GameLoop } from "./core/GameLoop";
import { Input } from "./core/Input";
import { Renderer, scaleToFit } from "./render/Renderer";
import { HUD } from "./render/HUD";
import { DebugOverlay } from "./render/DebugOverlay";
import { World } from "./world/World";
import { GameState } from "./state/GameState";
import { SaveState } from "./state/SaveState";
import { AudioEngine } from "./audio/AudioEngine";
import { RNG } from "./core/RNG";
import { LEVEL_1, LEVELS, BONUS_ROOMS } from "./levels/levels";
import { on } from "./core/Events";
import type { LevelData } from "./core/types";

export const GAME_FLOW = ["playing", "gameover"] as const;
export type GameFlow = (typeof GAME_FLOW)[number];
export const GAME_FLOW_KEYS: Record<GameFlow, GameFlow> = {
  playing: "playing",
  gameover: "gameover",
};

export class Game {
  private renderer: Renderer;
  private hud: HUD;
  private debug: DebugOverlay;
  private audio: AudioEngine;
  private input = new Input();
  private state: GameState;
  private world: World | null = null;
  private currentLevel: LevelData = LEVEL_1;
  private loop: GameLoop;
  private flow: GameFlow = GAME_FLOW_KEYS.playing;
  private rng: RNG;
  private inBonus = false;
  private paused = false;
  private clearTimer = 0;

  constructor(container: HTMLElement) {
    const scale = scaleToFit(window.innerWidth, window.innerHeight);
    this.renderer = new Renderer(container, scale);
    this.hud = new HUD(this.renderer);
    this.debug = new DebugOverlay(this.renderer);
    this.audio = new AudioEngine(); // no ctx — lazily ensured on first playSfx
    this.state = new GameState();
    const saved = SaveState.load();
    if (saved) this.state.restore(saved);
    this.rng = new RNG(Date.now() >>> 0);
    this.loop = new GameLoop({
      update: dt => this.update(dt),
      render: alpha => this.render(alpha),
    });
  }

  start(): void {
    this.input.attach(window);
    this.startLevel(1);
    on("dave:die", () => this.onDeath());
    on("level:complete", () => this.onComplete());
    this.wireAudio();
    window.addEventListener("keydown", e => {
      if (e.code === "Backquote") {
        e.preventDefault();
        this.debug.toggle();
      }
      if (e.code === "KeyP" || e.code === "Escape") {
        e.preventDefault();
        this.togglePause();
      }
      if (e.code === "KeyM") {
        e.preventDefault();
        this.toggleMute();
      }
      if (e.code === "KeyR" && this.flow === GAME_FLOW_KEYS.gameover) {
        e.preventDefault();
        this.restart();
      }
    });
    // attach exactly once and never stop(): GameLoop.stop() is dead (rafId never assigned)
    this.loop.attach(f => requestAnimationFrame(f));
  }

  private startLevel(levelId: number): void {
    this.currentLevel = (this.inBonus ? BONUS_ROOMS : LEVELS)[levelId] ?? LEVEL_1;
    this.world?.destroy();
    this.state.level = levelId;
    this.state.currentScreen = 0;
    this.world = new World(this.currentLevel, this.state);
    this.world.spawnEnemies(this.rng);
    // Carried T18 pointer: push restored/carried gear INTO dave before the first
    // World.update — its backfill (state.jetpackFuel = dave.jetpackFuel) would
    // otherwise clobber a restored save's fuel/gun with a fresh Dave's 0.
    this.world.dave.hasGun = this.state.hasGun;
    this.world.dave.jetpackFuel = this.state.jetpackFuel;
    this.rng = RNG.deserialize((Date.now() & 0xffffffff) >>> 0);
    this.flow = GAME_FLOW_KEYS.playing;
  }

  private update(_dt: number): void {
    const world = this.world;
    if (!world || this.paused) return;
    if (this.clearTimer > 0) {
      this.clearTimer--;
      if (this.clearTimer === 0) this.finishClear();
      return;
    }
    const input = this.input.read(); // consumes the fire edge
    jetpackHeld = input.jetpack;
    if (this.flow === GAME_FLOW_KEYS.gameover) {
      if (input.fire) this.restart(); // R handled by the keydown listener; fire also accepted
      return;
    }
    if (input.fire) {
      world.fire();
      this.audio.playSfx("shoot");
    }
    world.update(input, this.rng);
    this.input.tick();
  }

  private render(_alpha: number): void {
    const r = this.renderer;
    r.clear();
    const world = this.world;
    if (!world) return;
    const map = world.map;
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        r.drawTile(map.at(tx, ty)?.id ?? 0, tx, ty);
      }
    }
    for (const it of world.items) {
      if (!it.collected) r.drawSprite(itemSpriteName(it.type), it.pos.x, it.pos.y);
    }
    r.drawSprite(world.door.opened ? "door_open" : "door_closed", world.door.pos.x, world.door.pos.y);
    for (const e of world.enemies) {
      if (!e.dead) r.drawSprite("spider", e.pos.x, e.pos.y);
    }
    for (const p of world.projectiles) {
      if (!p.spent) r.drawSprite("bullet", p.pos.x, p.pos.y);
    }
    if (world.dave.alive) {
      const d = world.dave;
      const sprite = d.vel.y < 0 ? "dave_jump" : d.jetpackFuel > 0 && jetpackHeld ? "dave_jetpack" : "dave_stand";
      r.drawSprite(sprite, d.pos.x, d.pos.y);
    }
    this.hud.draw(this.state);
    this.debug.draw(world);
    this.syncCards();
  }

  private onDeath(): void {
    if (!this.world) return;
    this.audio.playSfx("die");
    const alive = this.state.loseLife();
    if (!alive) {
      this.flow = GAME_FLOW_KEYS.gameover;
      return;
    }
    // respawn on the floor top at the level's dave spawn; resurrecting mid-emit
    // is the expected shape (World's contact loop guards on dave.alive per iteration)
    this.world.dave.pos = respawnPos(this.currentLevel);
    this.world.dave.vel = { x: 0, y: 0 };
    this.world.dave.grounded = false;
    this.world.dave.alive = true;
  }

  private onComplete(): void {
    SaveState.persist(this.state.snapshot());
    this.clearTimer = 150; // freeze on the LEVEL CLEAR card, then finishClear() advances
  }

  /** delayed second half of onComplete: advance once the clear card has shown */
  finishClear(): void {
    this.clearTimer = 0;
    this.inBonus = !this.inBonus;
    this.startLevel(1); // table picked by inBonus: LEVELS[1] or BONUS_ROOMS[1]
  }

  restart(): void {
    this.state.reset(1); // lives/score are drained after game over — start fresh
    this.inBonus = false;
    this.paused = false;
    this.clearTimer = 0;
    this.startLevel(1);
  }

  private wireAudio(): void {
    on("dave:collect", e => this.audio.playSfx(e.item === "trophy" ? "trophy" : "collect"));
    on("gun:pickup", () => this.audio.playSfx("gun"));
    on("jetpack:pickup", () => this.audio.playSfx("jetpack"));
    on("oneup:pickup", () => this.audio.playSfx("oneup"));
    on("level:complete", () => this.audio.playSfx("warp"));
  }

  togglePause(): boolean {
    if (this.flow !== GAME_FLOW_KEYS.playing || this.clearTimer > 0) return this.paused;
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

  private card(id: string): HTMLElement | null {
    return typeof document === "undefined" ? null : document.getElementById(id);
  }

  /** show/hide DOM cards to match flow state; called every frame, no-ops without DOM */
  private syncCards(): void {
    const show = (id: string, visible: boolean): void => {
      const el = this.card(id);
      if (el) el.hidden = !visible;
    };
    show("dd-pause", this.paused);
    show("dd-clear", this.clearTimer > 0);
    const over = this.flow === GAME_FLOW_KEYS.gameover;
    show("dd-over", over);
    if (over) {
      const score = this.card("dd-over-score");
      if (score) score.textContent = `Score ${this.state.score} — press R or hit Restart`;
    }
  }
}

/** Dave respawn point: the level's dave EntitySpawn in pixels — same source of
 *  truth as the initial spawn, so respawns always land standing on the floor top. */
export function respawnPos(level: LevelData): { x: number; y: number } {
  const spawn = level.screens[level.startScreen]!.entities.find(e => e.type === "dave");
  if (!spawn) throw new Error("level missing dave");
  return { x: spawn.x * 16, y: spawn.y * 16 };
}

function itemSpriteName(type: string): string {
  switch (type) {
    case "orb": return "orb";
    case "blueDiamond": return "blue_diamond";
    case "redDiamond": return "red_diamond";
    case "ring": return "ring";
    case "crown": return "crown";
    case "scepter": return "scepter";
    case "trophy": return "trophy";
    case "gun": return "gun";
    case "jetpack": return "jetpack";
    case "oneUp": return "oneup";
    default: return "orb";
  }
}

/** mirrored from Input each update tick; render reads it for the jetpack sprite pick */
let jetpackHeld = false;
