import type { World } from "./game";
import type { TankState } from "./tank";
import { TOTAL_LAPS } from "./track";

/** Boost pads use ×1.5; pickup boost is ×1.4 — used to distinguish the slot text. */
const PICKUP_BOOST_MULT = 1.4;

/** Phase 13 player accents (match the on-screen tank liveries). */
const P1_COLOR = "#41d9ff";
const P2_COLOR = "#ffa04d";
const AI_DOT_COLOR = "#e05a4e";

interface PanelRefs {
  speed: HTMLDivElement;
  lap: HTMLDivElement;
  pos: HTMLDivElement;
  time: HTMLDivElement;
  healthFill: HTMLDivElement;
  power: HTMLDivElement;
}

/** Last-rendered values per panel — DOM is only touched on change. */
interface PanelCache {
  speed: number;
  lap: string;
  pos: string;
  time: string;
  hpPct: number;
  hpColor: string;
  power: string | null;
}

interface Panel {
  tank: TankState;
  posOf(): number;
  refs: PanelRefs;
  cache: PanelCache;
}

export interface Hud {
  /** Rebuild the HUD layout for the given mode (Phase 13). */
  setMode(twoPlayer: boolean): void;
}

/**
 * Phase 2/8/13 HUD. In 1P this is the classic layout (unchanged ids/CSS).
 * In 2P split-screen each half gets a compact color-coded panel and ONE
 * minimap sits centered between the halves, highlighting both players.
 */
export function initHud(world: World): Hud {
  const rootEl = document.getElementById("hud");
  if (!rootEl) return { setMode() { /* no #hud in DOM */ } };
  const root: HTMLElement = rootEl;

  // --- Minimap canvas + geometry caches (survive setMode rebuilds) ----------
  let minimap: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let panels: Panel[] = [];

  const MARGIN = 12;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  let scale = 1;
  let outlinePts: [number, number][] = [];
  let hudTrack = world.track;

  function recomputeMinimap(): void {
    minX = Infinity; maxX = -Infinity; minZ = Infinity; maxZ = -Infinity;
    for (const p of world.track.outline) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    scale = Math.min(
      (minimap!.width - MARGIN * 2) / (maxX - minX),
      (minimap!.height - MARGIN * 2) / (maxZ - minZ),
    );
    outlinePts = world.track.outline.map(toCanvas);
    hudTrack = world.track;
  }

  const toCanvas = (p: { x: number; z: number }): [number, number] => [
    (p.x - minX) * scale + (minimap!.width - (maxX - minX) * scale) / 2,
    (p.z - minZ) * scale + (minimap!.height - (maxZ - minZ) * scale) / 2,
  ];

  // --- Element helpers -------------------------------------------------------
  function div(id?: string, className?: string): HTMLDivElement {
    const d = document.createElement("div");
    if (id) d.id = id;
    if (className) d.className = className;
    return d;
  }

  function makeMinimap(className?: string): void {
    minimap = document.createElement("canvas");
    minimap.id = "hud-minimap";
    if (className) minimap.className = className;
    minimap.width = 170;
    minimap.height = 170;
    root.appendChild(minimap);
    ctx = minimap.getContext("2d")!;
  }

  function mkPanel(tank: TankState, posOf: () => number, refs: PanelRefs): Panel {
    return {
      tank,
      posOf,
      refs,
      cache: {
        speed: -1, lap: "", pos: "", time: "",
        hpPct: -1, hpColor: "", power: null,
      },
    };
  }

  /** Phase 13 compact panel inside one half of a .hud-half container. */
  function buildCompactHalf(half: HTMLElement, accentClass: string, tag: string, tank: TankState, posOf: () => number): void {
    const raceBlock = div(undefined, "hud-race");
    const lap = div(undefined, `hud-lap ${accentClass}`);
    const pos = div(undefined, `hud-pos ${accentClass}`);
    const time = div(undefined, "hud-time");
    raceBlock.append(lap, pos, time);

    const speed = div(undefined, "hud-speed");
    const power = div(undefined, "hud-power");
    const healthBlock = div(undefined, "hud-health");
    const healthBar = div(undefined, "hud-health-bar");
    const healthFill = div(undefined, "hud-health-fill");
    healthBar.appendChild(healthFill);
    healthBlock.appendChild(healthBar);

    const label = div(undefined, `hud-player-tag ${accentClass}`);
    label.textContent = tag;

    half.append(label, power, healthBlock, speed, raceBlock);
    panels.push(mkPanel(tank, posOf, { speed, lap, pos, time, healthFill, power }));
  }

  /** Build the whole HUD for the active mode; wipes whatever existed. */
  function buildHud(twoPlayer: boolean): void {
    root.innerHTML = "";
    panels = [];

    if (!twoPlayer) {
      // Classic single-player layout (ids unchanged since Phase 2)
      const speed = div("hud-speed");
      root.appendChild(speed);

      const healthBlock = div("hud-health");
      const healthBar = div("hud-health-bar");
      const healthFill = div("hud-health-fill");
      healthBar.appendChild(healthFill);
      healthBlock.appendChild(healthBar);
      root.appendChild(healthBlock);

      const power = div("hud-power");
      root.appendChild(power);

      const raceBlock = div("hud-race");
      const lap = div("hud-lap");
      const pos = div("hud-pos");
      const time = div("hud-time");
      raceBlock.append(lap, pos, time);
      root.appendChild(raceBlock);

      makeMinimap();

      panels.push(
        mkPanel(world.player, () => world.playerPosition, {
          speed, lap, pos, time, healthFill, power,
        }),
      );
      return;
    }

    // Split-screen: vertical divider + two compact color-coded halves
    const divider = div(undefined, "hud-split-divider");
    root.appendChild(divider);

    const left = div(undefined, "hud-half left");
    const right = div(undefined, "hud-half right");
    root.appendChild(left);
    root.appendChild(right);

    buildCompactHalf(left, "accent-p1", "P1", world.player, () => world.playerPosition);
    buildCompactHalf(right, "accent-p2", "P2", world.player2!, () => world.playerPosition2);

    // ONE minimap, centered between the halves
    makeMinimap("centered");
  }

  // --- Per-frame updates -------------------------------------------------------

  function updatePanel(p: Panel): void {
    const t = p.tank;
    const c = p.cache;

    const s = Math.abs(Math.round(t.velocity.length() * 3.6)); // fake km/h
    if (s !== c.speed) {
      c.speed = s;
      p.refs.speed.textContent = `${s} km/h`;
    }

    const prog = world.racers.find((r) => r.tank === t)?.progress;
    if (prog) {
      const lapText = `LAP ${Math.min(prog.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
      if (lapText !== c.lap) {
        c.lap = lapText;
        p.refs.lap.textContent = lapText;
      }
      const timeText = formatLapTime(prog.lapTime);
      if (timeText !== c.time) {
        c.time = timeText;
        p.refs.time.textContent = timeText;
      }
    }

    const posText = `POS ${p.posOf()}/${world.tanks.length}`;
    if (posText !== c.pos) {
      c.pos = posText;
      p.refs.pos.textContent = posText;
    }

    // Health bar: only touch the DOM when the integer % changes
    const hpPct = Math.max(0, Math.round((t.hp / t.maxHp) * 100));
    if (hpPct !== c.hpPct) {
      c.hpPct = hpPct;
      p.refs.healthFill.style.width = `${hpPct}%`;
    }
    const hpColor = hpPct > 60 ? "#41d977" : hpPct > 30 ? "#ffc23d" : "#e05a4e";
    if (hpColor !== c.hpColor) {
      c.hpColor = hpColor;
      p.refs.healthFill.style.background = hpColor;
    }

    // Power-up slot: armed pickup only (boost auto-consumes)
    const powerText = t.tripleShots > 0
      ? `TRIPLE x${t.tripleShots}`
      : t.shield
      ? "SHIELD"
      : t.boostTimer > 0 && t.boostMultiplier === PICKUP_BOOST_MULT
      ? "BOOST"
      : "";
    if (powerText !== c.power) {
      c.power = powerText;
      p.refs.power.textContent = powerText;
      p.refs.power.style.opacity = powerText ? "1" : "0.35";
    }
  }

  function drawMinimap(): void {
    if (!ctx || !minimap) return;
    ctx.clearRect(0, 0, minimap.width, minimap.height);
    ctx.fillStyle = "rgba(10, 14, 20, 0.55)";
    ctx.beginPath();
    ctx.roundRect(0, 0, minimap.width, minimap.height, 8);
    ctx.fill();

    // Track outline
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(outlinePts[0][0], outlinePts[0][1]);
    for (const [x, y] of outlinePts) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.stroke();

    // Start line tick
    const [sx, sy] = toCanvas(world.track.points[0]);
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(sx - 3, sy - 3, 6, 6);

    // Boost pads
    ctx.fillStyle = "#ff8c00";
    for (const pad of world.track.pads) {
      const [px, py] = toCanvas({ x: pad.cx, z: pad.cz });
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tanks — both humans highlighted in their own accent colors (Phase 13)
    for (const racer of world.racers) {
      const [x, y] = toCanvas(racer.tank.position);
      const isP1 = racer.tank === world.player;
      const isP2 = world.twoPlayer && racer.tank === world.player2;
      ctx.fillStyle = isP1 ? P1_COLOR : isP2 ? P2_COLOR : AI_DOT_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, isP1 || isP2 ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      if (isP1 || isP2) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  function update() {
    // Track switched on the title screen → recompute minimap geometry once
    if (world.track !== hudTrack) recomputeMinimap();
    for (const p of panels) updatePanel(p);
    drawMinimap();
    requestAnimationFrame(update);
  }

  buildHud(world.twoPlayer);
  update();

  return {
    setMode(twoPlayer: boolean) {
      if (
        (twoPlayer && panels.length === 2) ||
        (!twoPlayer && panels.length === 1)
      ) {
        return; // already in the requested layout
      }
      buildHud(twoPlayer);
    },
  };
}

function formatLapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}
