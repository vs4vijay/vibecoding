// Phase 4/6/11 sanity check: run the AI brains against real tank physics on a
// real circuit — no rendering, no shells. Reports lap times, wall contact,
// and full-race times per AI.
// Run: bun scripts/sim-ai.ts [dust-bowl|canyon-run|glacier-loop]  (default: all)
import { createTankMesh, createTankState, updateTankPhysics } from "../src/tank";
import {
  applySurfaceGrip,
  checkBoostPads,
  collideWithWalls,
  createTankProgress,
  createTrack,
  placeTankAtGridSlot,
  TRACK_DEFS,
  updateTankProgress,
  TOTAL_LAPS,
} from "../src/track";
import { closestOnSpline } from "../src/spline";
import { AI_PERSONALITIES, createAIController } from "../src/ai";
import type { World } from "../src/game";
import type { TankState } from "../src/tank";

// Bun runtime globals are not typed here (no @types/node in this project) —
// only the argument vector and exit are needed.
declare const process: { argv: string[]; exit(code?: number): void };

const START_T = 0.005;
const DT = 1 / 60;
const MAX_SIM_TIME = 480; // s

const arg = process.argv[2];
const selectedDefs = arg
  ? TRACK_DEFS.filter((d) => d.id === arg || d.name.toLowerCase() === arg.toLowerCase())
  : TRACK_DEFS;
if (selectedDefs.length === 0) {
  console.error(`Unknown track "${arg}". Available: ${TRACK_DEFS.map((d) => d.id).join(", ")}`);
  process.exit(1);
}

for (const def of selectedDefs) {
  simulateTrack(def);
}

function simulateTrack(def: (typeof TRACK_DEFS)[number]): void {
  const track = createTrack(def);
  const wallDist = track.halfWidth - 0.6; // just inside the wall-collision boundary
  const grid = [
    { t: START_T - 0.003, lateral: -3.6 },
    { t: START_T - 0.003, lateral: 3.6 },
    { t: START_T - 0.006, lateral: 0 },
  ];

  const tanks: TankState[] = [];
  const controllers = [];
  const finishes: (number | null)[] = AI_PERSONALITIES.map(() => null);
  const lapStarts = AI_PERSONALITIES.map(() => 0);
  const wallHits = new Array(AI_PERSONALITIES.length).fill(0);
  const lapTimes: number[][] = AI_PERSONALITIES.map(() => []);

  // "Player" for rubber-banding purposes = first AI (neutral rubber for it).
  let playerTank: TankState | null = null;

  for (let i = 0; i < AI_PERSONALITIES.length; i++) {
    const pers = AI_PERSONALITIES[i];
    const tank = createTankState(createTankMesh(pers.hullColor, pers.turretColor));
    placeTankAtGridSlot(tank, track, grid[i].t, grid[i].lateral);
    tanks.push(tank);
    if (!playerTank) playerTank = tank;
  }

  const racers = tanks.map((tk, i) => ({
    tank: tk,
    progress: createTankProgress(grid[i].t),
    finishTime: null, // Racer shape (unused by the sim, required by the type)
  }));

  const world = {
    tanks,
    player: playerTank!,
    racers,
    standings: racers.slice(),
    playerPosition: 1,
    track,
    phase: "idle",
  } as unknown as World;

  for (let i = 0; i < AI_PERSONALITIES.length; i++) {
    controllers.push(createAIController(AI_PERSONALITIES[i], racers[i], track));
  }

  let simTime = 0;
  while (simTime < MAX_SIM_TIME && finishes.some((f) => f === null)) {
    simTime += DT;
    for (let i = 0; i < tanks.length; i++) {
      const d = controllers[i].think(DT, world);
      tanks[i].input.throttle = d.throttle;
      tanks[i].input.steer = d.steer;
      // Phase 11: stage surface grip before physics, same as the game loop
      applySurfaceGrip(track, tanks[i], racers[i].progress.lastT);
      updateTankPhysics(tanks[i], DT);
      collideWithWalls(track, tanks[i]);
      const after = closestOnSpline(track.table, tanks[i].position.x, tanks[i].position.z);
      if (after.distSq > wallDist * wallDist) wallHits[i] += 1;
      checkBoostPads(track, tanks[i]);
      const ev = updateTankProgress(racers[i].progress, after.t, DT, def.gates);
      if (ev === "lap") {
        lapTimes[i].push(simTime - lapStarts[i]);
        lapStarts[i] = simTime;
        if (racers[i].progress.lap > TOTAL_LAPS && finishes[i] === null) {
          finishes[i] = simTime;
        }
      }
    }
  }

  console.log(
    `\n=== ${def.name} (${TOTAL_LAPS} laps, dt=${DT.toFixed(3)}) ===`,
  );
  for (let i = 0; i < AI_PERSONALITIES.length; i++) {
    const name = AI_PERSONALITIES[i].name;
    const f = finishes[i];
    const laps = lapTimes[i].map((t) => t.toFixed(1)).join(", ");
    console.log(
      `${name.padEnd(7)} finish: ${f !== null ? format(f) : "DNF"} | laps: ${laps || "-"} | wall-frames: ${wallHits[i]} (${((wallHits[i] * DT) / Math.max(simTime, 1) * 100).toFixed(1)}% of race)`,
    );
  }
  console.log(`sim wall-clock length: ${format(simTime)}`);
}

function format(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}
