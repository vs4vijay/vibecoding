import type { World } from "./game";
import { TOTAL_LAPS } from "./track";

/** Boost pads use ×1.5; pickup boost is ×1.4 — used to distinguish the slot text. */
const PICKUP_BOOST_MULT = 1.4;

/** Phase 2 HUD: speed readout, lap counter, lap timer, minimap canvas. */
export function initHud(world: World): void {
  const root = document.getElementById("hud");
  if (!root) return;

  // --- Speed (bottom-right) -------------------------------------------------
  const speed = document.createElement("div");
  speed.id = "hud-speed";
  root.appendChild(speed);

  // --- Health bar (bottom-left) ----------------------------------------------
  const healthBlock = document.createElement("div");
  healthBlock.id = "hud-health";
  const healthBar = document.createElement("div");
  healthBar.id = "hud-health-bar";
  const healthFill = document.createElement("div");
  healthFill.id = "hud-health-fill";
  healthBar.appendChild(healthFill);
  healthBlock.appendChild(healthBar);
  root.appendChild(healthBlock);

  // --- Power-up slot indicator (above the health bar) -------------------------
  const power = document.createElement("div");
  power.id = "hud-power";
  root.appendChild(power);


  // --- Lap + position + time block (top-right) -------------------------------
  const raceBlock = document.createElement("div");
  raceBlock.id = "hud-race";
  const lap = document.createElement("div");
  lap.id = "hud-lap";
  const pos = document.createElement("div");
  pos.id = "hud-pos";
  const time = document.createElement("div");
  time.id = "hud-time";
  raceBlock.appendChild(lap);
  raceBlock.appendChild(pos);
  raceBlock.appendChild(time);
  root.appendChild(raceBlock);

  // --- Minimap (top-left) -----------------------------------------------------
  const minimap = document.createElement("canvas");
  minimap.id = "hud-minimap";
  minimap.width = 170;
  minimap.height = 170;
  root.appendChild(minimap);
  const ctx = minimap.getContext("2d")!;

  // Precompute spline outline in canvas space (rebuilt if the track changes)
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
      (minimap.width - MARGIN * 2) / (maxX - minX),
      (minimap.height - MARGIN * 2) / (maxZ - minZ),
    );
    outlinePts = world.track.outline.map(toCanvas);
    hudTrack = world.track;
  }

  const toCanvas = (p: { x: number; z: number }): [number, number] => [
    (p.x - minX) * scale + (minimap.width - (maxX - minX) * scale) / 2,
    (p.z - minZ) * scale + (minimap.height - (maxZ - minZ) * scale) / 2,
  ];
  recomputeMinimap();

  function drawMinimap(): void {
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

    // Tanks — player highlighted
    for (const racer of world.racers) {
      const [x, y] = toCanvas(racer.tank.position);
      const isPlayer = racer.tank === world.player;
      ctx.fillStyle = isPlayer ? "#41d9ff" : "#e05a4e";
      ctx.beginPath();
      ctx.arc(x, y, isPlayer ? 4 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let shownSpeed = -1;
  let shownLapText = "";
  let shownPosText = "";
  let shownTime = "";
  let shownHealthPct = -1;
  let shownHealthColor = "";
  let shownPowerText: string | null = null;
  function update() {
    // Track switched on the title screen → recompute minimap geometry once
    if (world.track !== hudTrack) recomputeMinimap();

    const s = Math.abs(Math.round(world.player.velocity.length() * 3.6)); // fake km/h
    if (s !== shownSpeed) {
      shownSpeed = s;
      speed.textContent = `${s} km/h`;
    }

    const prog = world.racers.find((r) => r.tank === world.player)?.progress;
    if (prog) {
      const lapText = `LAP ${Math.min(prog.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`;
      if (lapText !== shownLapText) {
        shownLapText = lapText;
        lap.textContent = lapText;
      }
      const timeText = formatLapTime(prog.lapTime);
      if (timeText !== shownTime) {
        shownTime = timeText;
        time.textContent = timeText;
      }
    }

    // --- Race position: only touch the DOM when it changes -------------------
    const posText = `POS ${world.playerPosition}/${world.tanks.length}`;
    if (posText !== shownPosText) {
      shownPosText = posText;
      pos.textContent = posText;
    }

    // --- Health bar: only touch the DOM when the integer % changes -----------
    // Phase 7: normalized against the selected tank's max HP
    const hpPct = Math.max(
      0,
      Math.round((world.player.hp / world.player.maxHp) * 100),
    );
    if (hpPct !== shownHealthPct) {
      shownHealthPct = hpPct;
      healthFill.style.width = `${hpPct}%`;
    }
    const healthColor =
      hpPct > 60 ? "#41d977" : hpPct > 30 ? "#ffc23d" : "#e05a4e";
    if (healthColor !== shownHealthColor) {
      shownHealthColor = healthColor;
      healthFill.style.background = healthColor;
    }

    // --- Power-up slot: armed pickup only (boost auto-consumes) ---------------
    const p = world.player;
    const powerText = p.tripleShots > 0
      ? `TRIPLE x${p.tripleShots}`
      : p.shield
      ? "SHIELD"
      : p.boostTimer > 0 && p.boostMultiplier === PICKUP_BOOST_MULT
      ? "BOOST"
      : "";
    if (powerText !== shownPowerText) {
      shownPowerText = powerText;
      power.textContent = powerText;
      power.style.opacity = powerText ? "1" : "0.35";
    }

    drawMinimap();
    requestAnimationFrame(update);
  }
  update();
}

function formatLapTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}
