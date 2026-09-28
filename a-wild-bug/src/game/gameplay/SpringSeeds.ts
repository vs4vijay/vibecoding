import * as THREE from "three";
import { mulberry32, rangeRng } from "../util/Rng";
import type { Meadow } from "../world/Meadow";
import type { PlayerController } from "../player/PlayerController";
import type { Puffs } from "./Puffs";

/**
 * Spring seeds — the game's signature trick (seed mechanic v1, ONE plant
 * type). Fat teal seeds with a pale swirl sit at authored meadow spots; when
 * the ant lands on one, a springy helix stalk shoots up under it (the stalk
 * top IS walkable ground via Meadow.heightAt, so the ant rides it) and then
 * catapults the ant in a solved ballistic arc onto the apple's high ledge.
 *
 * The launch solve mirrors PlayerController physics exactly (gravity 26, and
 * launches set launchAir which disables the apex-hang gravity reduction), so
 * the ant lands where the math says — no aim assist, no scripted flight.
 */

export const SEED_TUNING = {
  /** Above the walkable ground so stepping on the dome triggers the sprout. */
  triggerHeight: 0.03,
  triggerRadius: 0.26,
  sproutTime: 0.34,
  stalkTopRadius: 0.15,
  /** Launch apex above the stalk-top launch point. */
  launchApex: 1.9,
  gravity: 26, // must match PLAYER_TUNING.gravity
  recoilTime: 0.45,
  wiltTime: 1.6,
  regrowCooldown: 6,
  streakInterval: 0.09,
} as const;

/** Authored anchors (seeded jitter ±0.15): near spawn, mid-field, far cluster. */
export const SPRING_SEED_ANCHORS: [number, number, number][] = [
  // [x, z, stalk height]
  [2.35, 4.35, 1.45], // tutorial view: visible from the mound, near the run lane
  [3.3, -0.4, 1.55], // mid-field
  [-3.1, -5.2, 1.5], // opposite side, serves the western clusters
  [9.3, -0.6, 1.6], // far cluster side; long dramatic arc to the apple
];

/** 0..1 grass density around the planted pods (static so the grass scatter
 *  can run before Game attaches the live SpringSeeds). */
export function springSeedGrassMask(x: number, z: number): number {
  let m = 1;
  for (const [ax, az] of SPRING_SEED_ANCHORS) {
    const d = Math.hypot(x - ax, z - az);
    m *= THREE.MathUtils.smoothstep(d, 0.3, 0.55);
    if (m < 0.01) return 0;
  }
  return m;
}

export interface SeedLaunchSolution {
  /** Launch point (stalk top). */
  p0: THREE.Vector3;
  /** Initial velocity. */
  v0: THREE.Vector3;
  apexY: number;
  target: THREE.Vector3;
}

export interface SeedContext {
  meadow: Meadow;
  controller: PlayerController;
  puffs: Puffs;
  /** Returns false while win/lose screens own the sim. */
  isPlaying: () => boolean;
  onLaunch: (seedIndex: number, first: boolean) => void;
}

interface SeedState {
  group: THREE.Group;
  pod: THREE.Mesh;
  stalk: THREE.Mesh;
  bud: THREE.Mesh;
  leaves: THREE.Mesh[];
  pos: THREE.Vector3; // base, on the ground
  stalkHeight: number;
  state: "idle" | "sprout" | "recoil" | "wilt" | "regrow";
  t: number;
  /** Ballistic solution, computed at sprout time. */
  solution: SeedLaunchSolution | null;
  launchCounter: number;
}

const STREAKS = {
  count: 3,
  colorA: 0xdff2ff,
  colorB: 0xffffff,
  speed: [0.15, 0.5] as [number, number],
  up: 0.08,
  gravity: 0,
  drag: 2.4,
  life: [0.2, 0.38] as [number, number],
  size: [0.018, 0.05] as [number, number],
};

const _v = new THREE.Vector3();

/** Small pointed leaf for the stalk (declared first: used in static inits). */
class AppleLikeLeaf {
  static build(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.09, 0.05, 0.17, 0.005);
    s.quadraticCurveTo(0.09, -0.05, 0, 0);
    const geo = new THREE.ShapeGeometry(s, 8);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0.06, 0, 0);
    return geo;
  }
}

export class SpringSeeds {
  readonly group = new THREE.Group();
  readonly seeds: SeedState[] = [];

  private readonly ctx: SeedContext;
  private streakClock = 0;
  private launchedOnce = false;

  constructor(ctx: SeedContext, seed: number) {
    this.ctx = ctx;
    const rng = mulberry32(seed);

    for (let i = 0; i < SPRING_SEED_ANCHORS.length; i++) {
      const [ax, az, stalkHeight] = SPRING_SEED_ANCHORS[i];
      const x = ax + rangeRng(rng, -0.15, 0.15);
      const z = az + rangeRng(rng, -0.15, 0.15);
      this.seeds.push(this.buildSeed(i, x, z, stalkHeight, rng));
    }
  }

  // --- construction -----------------------------------------------------------

  private buildSeed(_index: number, x: number, z: number, stalkHeight: number, rng: ReturnType<typeof mulberry32>): SeedState {
    const group = new THREE.Group();
    const pos = new THREE.Vector3(x, this.ctx.meadow.heightAt(x, z), z);
    group.position.copy(pos);

    const pod = new THREE.Mesh(SpringSeeds.podGeo, SpringSeeds.podMat);
    pod.scale.setScalar(1);
    pod.rotation.y = rng() * Math.PI * 2;
    pod.position.y = 0.075;
    pod.castShadow = true;
    group.add(pod);

    // A small disturbed-earth ring reads as "something is planted here".
    const dirt = new THREE.Mesh(SpringSeeds.dirtGeo, SpringSeeds.dirtMat);
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.y = 0.012;
    dirt.renderOrder = 1;
    group.add(dirt);

    // Helix stalk: unit height, scaled to the live stalk height each tick.
    const stalk = new THREE.Mesh(SpringSeeds.stalkGeo, SpringSeeds.stalkMat);
    stalk.castShadow = true;
    stalk.visible = false;
    group.add(stalk);

    const bud = new THREE.Mesh(SpringSeeds.budGeo, SpringSeeds.budMat);
    bud.castShadow = true;
    bud.visible = false;
    group.add(bud);

    const leaves: THREE.Mesh[] = [];
    for (let l = 0; l < 2; l++) {
      const leaf = new THREE.Mesh(SpringSeeds.leafGeo, SpringSeeds.leafMat);
      leaf.visible = false;
      leaf.rotation.y = l * 2.4 + rng() * 1.2;
      group.add(leaf);
      leaves.push(leaf);
    }

    this.group.add(group);
    return {
      group,
      pod,
      stalk,
      bud,
      leaves,
      pos,
      stalkHeight,
      state: "idle",
      t: 0,
      solution: null,
      launchCounter: _index, // stagger the round-robin across seeds
    };
  }

  // --- heightfield contribution ----------------------------------------------

  /**
   * Walkable extra height at (x, z): the idle seed dome (the trigger pad), or
   * the sprouting stalk's top plateau while one is active.
   */
  heightAt(x: number, z: number): number {
    for (const s of this.seeds) {
      const dx = x - s.pos.x;
      const dz = z - s.pos.z;
      const d2 = dx * dx + dz * dz;
      if (s.state === "sprout") {
        const h = s.stalkHeight * Math.min(1, s.t / SEED_TUNING.sproutTime);
        if (d2 < SEED_TUNING.stalkTopRadius * SEED_TUNING.stalkTopRadius) return s.pos.y + h;
        const skirt = Math.sqrt(d2);
        if (skirt < SEED_TUNING.stalkTopRadius + 0.09) {
          const f = 1 - (skirt - SEED_TUNING.stalkTopRadius) / 0.09;
          return s.pos.y + h * f * f;
        }
      } else if (s.state === "idle" || s.state === "regrow") {
        if (d2 < 0.05) return s.pos.y + 0.075 * (1 - d2 / 0.05);
      }
    }
    return 0;
  }

  // --- simulation -------------------------------------------------------------

  update(dt: number): void {
    const c = this.ctx;
    for (const s of this.seeds) {
      switch (s.state) {
        case "idle": {
          // Gently pulsing seed (deterministic clock comes from the caller's
          // fixed step; the pod scale uses the seed's own phase).
          if (!c.isPlaying()) break;
          const dx = c.controller.position.x - s.pos.x;
          const dz = c.controller.position.z - s.pos.z;
          const onPad =
            c.controller.grounded &&
            dx * dx + dz * dz < SEED_TUNING.triggerRadius * SEED_TUNING.triggerRadius &&
            c.controller.position.y > s.pos.y + SEED_TUNING.triggerHeight;
          if (onPad) this.startSprout(s);
          break;
        }
        case "sprout": {
          s.t += dt;
          if (s.t >= SEED_TUNING.sproutTime) {
            s.t = SEED_TUNING.sproutTime;
            this.launch(s);
          }
          break;
        }
        case "recoil": {
          s.t += dt;
          if (s.t >= SEED_TUNING.recoilTime) {
            s.state = "wilt";
            s.t = 0;
          }
          break;
        }
        case "wilt": {
          s.t += dt;
          if (s.t >= SEED_TUNING.wiltTime) {
            s.state = "regrow";
            s.t = 0;
          }
          break;
        }
        case "regrow": {
          s.t += dt;
          if (s.t >= SEED_TUNING.regrowCooldown) {
            s.state = "idle";
            s.t = 0;
            s.solution = null;
          }
          break;
        }
      }
      this.applyPose(s);
    }

    // Wind-streak streams while the ant is in launch flight.
    if (c.controller.launchAir && c.isPlaying()) {
      this.streakClock += dt;
      if (this.streakClock >= SEED_TUNING.streakInterval) {
        this.streakClock = 0;
        const p = c.controller.position;
        const v = c.controller.velocity;
        _v.copy(p).addScaledVector(v, 0.05);
        c.puffs.burst(_v, { ...STREAKS, velocity: _streakVel.copy(v).multiplyScalar(-0.28) });
      }
    } else {
      this.streakClock = SEED_TUNING.streakInterval;
    }
  }

  private startSprout(s: SeedState): void {
    s.state = "sprout";
    s.t = 0;
    const launchPos = new THREE.Vector3(s.pos.x, s.pos.y + s.stalkHeight, s.pos.z);
    // Alternate the authored apple-top landing pads (kept clear of the patch).
    const apple = this.ctx.meadow.apple;
    const target = apple.landingSpot(s.launchCounter).clone();
    s.launchCounter++;
    s.solution = {
      p0: launchPos,
      v0: SpringSeeds.solve(launchPos, target, SEED_TUNING.launchApex),
      apexY: launchPos.y + SEED_TUNING.launchApex,
      target,
    };
    this.ctx.puffs.burst(s.pos, {
      count: 10,
      colorA: 0x9fd08a,
      colorB: 0x557a3a,
      speed: [0.3, 0.8],
      up: 0.8,
      gravity: 2.4,
      drag: 2,
      life: [0.3, 0.5],
      size: [0.014, 0.03],
    });
  }

  private launch(s: SeedState): void {
    if (!s.solution) return;
    const c = this.ctx;
    const first = !this.launchedOnce;
    this.launchedOnce = true;
    const v = s.solution.v0;
    c.controller.launch(v.x, v.y, v.z);
    s.state = "recoil";
    s.t = 0;
    c.puffs.burst(s.pos, {
      count: 14,
      colorA: 0xd8ecd0,
      colorB: 0x7aa85a,
      speed: [0.5, 1.4],
      up: 1.2,
      gravity: 2.6,
      drag: 1.6,
      life: [0.3, 0.55],
      size: [0.014, 0.032],
    });
    c.onLaunch(this.seeds.indexOf(s), first);
  }

  /**
   * Exact ballistic solve under SEED_TUNING.gravity (the controller runs the
   * same gravity with NO apex reduction while launchAir, so this arc lands
   * exactly on the target).
   */
  private static solve(from: THREE.Vector3, target: THREE.Vector3, apexAbove: number): THREE.Vector3 {
    const g = SEED_TUNING.gravity;
    const dy = target.y - from.y;
    const apex = Math.max(apexAbove, dy + 0.5);
    const vy = Math.sqrt(2 * g * apex);
    const tUp = vy / g;
    const tDown = Math.sqrt(2 * Math.max(0.05, apex - dy) / g);
    const t = tUp + tDown;
    return new THREE.Vector3((target.x - from.x) / t, vy, (target.z - from.z) / t);
  }

  /** The staged/live arc the given seed will fly (shot director + tests). */
  getSolution(index: number): SeedLaunchSolution | null {
    const s = this.seeds[index];
    if (!s) return null;
    if (s.solution) return s.solution;
    // Compute on demand without mutating state (staging).
    const apple = this.ctx.meadow.apple;
    const target = apple.landingSpot(s.launchCounter);
    const p0 = new THREE.Vector3(s.pos.x, s.pos.y + s.stalkHeight, s.pos.z);
    return { p0, v0: SpringSeeds.solve(p0, target, SEED_TUNING.launchApex), apexY: p0.y + SEED_TUNING.launchApex, target };
  }

  // --- visuals ----------------------------------------------------------------

  private applyPose(s: SeedState): void {
    const t = s.t;
    switch (s.state) {
      case "idle": {
        const pulse = 1 + Math.sin(this.simTimeFor(s) * 2.1 + s.pos.x * 3.7) * 0.045;
        s.pod.scale.setScalar(pulse);
        s.pod.position.y = 0.075;
        s.pod.visible = true;
        s.pod.rotation.x = 0;
        s.stalk.visible = false;
        s.bud.visible = false;
        for (const l of s.leaves) l.visible = false;
        break;
      }
      case "sprout": {
        const u = t / SEED_TUNING.sproutTime;
        const h = s.stalkHeight * u;
        s.pod.visible = u < 0.5;
        s.pod.scale.setScalar(Math.max(0.001, 1 - u * 2.1));
        s.pod.position.y = 0.075 - u * 0.07;
        s.stalk.visible = true;
        s.stalk.scale.set(1 + (1 - u) * 0.25, Math.max(0.001, h), 1 + (1 - u) * 0.25);
        s.bud.visible = true;
        s.bud.position.y = h;
        s.bud.scale.setScalar(0.7 + u * 0.5);
        this.placeLeaves(s, h);
        break;
      }
      case "recoil": {
        // The spring snaps: a quick over-extended whip then settle.
        const u = t / SEED_TUNING.recoilTime;
        const h = s.stalkHeight * (1 + Math.sin(u * Math.PI) * 0.12) * (1 - u * 0.55);
        s.stalk.scale.set(1 - u * 0.2, Math.max(0.001, h), 1 - u * 0.2);
        s.stalk.rotation.z = Math.sin(u * Math.PI * 2) * 0.18;
        s.bud.position.y = h;
        s.bud.visible = u < 0.8;
        s.pod.visible = false;
        this.placeLeaves(s, h);
        break;
      }
      case "wilt": {
        const u = t / SEED_TUNING.wiltTime;
        const h = s.stalkHeight * 0.45 * (1 - u) * (1 - u);
        s.stalk.visible = h > 0.02;
        s.stalk.scale.set(1, Math.max(0.001, h), 1);
        s.stalk.rotation.z = u * 0.5;
        s.bud.visible = false;
        s.pod.visible = u > 0.55;
        s.pod.scale.setScalar(Math.max(0.001, (u - 0.55) * 2.2));
        s.pod.position.y = 0.075;
        if (!s.stalk.visible) for (const l of s.leaves) l.visible = false;
        else this.placeLeaves(s, h);
        break;
      }
      case "regrow": {
        s.pod.visible = true;
        s.pod.scale.setScalar(1);
        s.pod.position.y = 0.075;
        s.stalk.visible = false;
        s.bud.visible = false;
        for (const l of s.leaves) l.visible = false;
        break;
      }
    }
  }

  private placeLeaves(s: SeedState, h: number): void {
    for (let i = 0; i < s.leaves.length; i++) {
      const leaf = s.leaves[i];
      leaf.visible = h > 0.3;
      const f = 0.4 + i * 0.28;
      leaf.position.y = h * f;
      leaf.rotation.x = -0.4 - i * 0.2;
      // 1.55×: at authored leaf size the sprouted stalk read as a bare dead
      // twig in the launch shot — the leaves must carry the "plant" read.
      leaf.scale.setScalar((0.8 + i * 0.3) * 1.55);
    }
  }

  /** Deterministic idle-pulse clock (fixed-step sim time, staged per seed). */
  private simClock = 0;
  private simTimeFor(_s: SeedState): number {
    return this.simClock;
  }

  /** Called by Game each fixed step so idle pulses stay deterministic. */
  tickClock(dt: number): void {
    this.simClock += dt;
  }

  /**
   * Pins the idle-pulse clock for a staged shot: the live clock counts from
   * page boot, so it depends on how long the page ran (font load) before the
   * director staged — the one unpinned visual in early shots (pod scale
   * wobbled ±4.5% between otherwise identical captures).
   */
  stageIdleClock(t: number): void {
    this.simClock = t;
    for (const s of this.seeds) {
      if (s.state === "idle") this.applyPose(s);
    }
  }

  // --- staging (ShotDirector) --------------------------------------------------

  /** Freezes seed `i` mid-recoil with the stalk fully extended. */
  stageFlight(index: number): void {
    const s = this.seeds[index];
    if (!s) return;
    s.state = "recoil";
    s.t = SEED_TUNING.recoilTime * 0.25;
    if (!s.solution) this.getSolution(index); // caches for the shot's arc math
    this.applyPose(s);
  }

  /** Returns every seed to its planted idle state (day restart). */
  reset(): void {
    for (const s of this.seeds) {
      s.state = "idle";
      s.t = 0;
      s.solution = null;
      this.applyPose(s);
    }
    this.streakClock = SEED_TUNING.streakInterval;
  }

  // --- shared geometry / materials ---------------------------------------------

  /** Fat teal seed with a pale spiral swirl baked into vertex colors. */
  private static podGeo = (() => {
    const geo = new THREE.SphereGeometry(1, 22, 16);
    geo.scale(0.115, 0.088, 0.115);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0x3f8f76);
    const dark = new THREE.Color(0x2e6b58);
    const swirl = new THREE.Color(0xdcecd2);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ang = Math.atan2(z, x);
      const spiral = Math.sin(ang * 2 + y * 26);
      c.copy(base).lerp(dark, THREE.MathUtils.smoothstep(-y, 0, 0.09) * 0.7);
      c.lerp(swirl, THREE.MathUtils.smoothstep(spiral, 0.55, 0.95) * 0.85);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  })();

  private static podMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.8,
  });

  private static dirtGeo = new THREE.CircleGeometry(0.24, 20);
  private static dirtMat = new THREE.MeshStandardMaterial({
    color: 0x6d5940,
    roughness: 1,
    transparent: true,
    opacity: 0.85,
  });

  /** Unit-height helix spring (scaled to the live stalk height). */
  private static stalkGeo = (() => {
    const pts: THREE.Vector3[] = [];
    const coils = 2.75;
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const ang = f * coils * Math.PI * 2;
      const taper = 1 - f * 0.35;
      pts.push(new THREE.Vector3(Math.cos(ang) * 0.085 * taper, f, Math.sin(ang) * 0.085 * taper));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 72, 0.017, 6, false);
    return geo;
  })();

  private static stalkMat = new THREE.MeshStandardMaterial({
    color: 0x6fa84e,
    roughness: 0.68,
  });

  private static budGeo = new THREE.CylinderGeometry(0.13, 0.09, 0.045, 12);
  private static budMat = new THREE.MeshStandardMaterial({
    color: 0xd3e492,
    roughness: 0.6,
  });

  private static leafGeo = AppleLikeLeaf.build();
  private static leafMat = new THREE.MeshStandardMaterial({
    color: 0x5f9a44,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
}

const _streakVel = new THREE.Vector3();
