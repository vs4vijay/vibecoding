// src/render3d/GameView.ts — core-owned orchestrator. Agents extend modules behind it.
import * as THREE from "three";
import { LightingRig } from "./Lighting";
import { WorldView } from "./WorldView";
import { DaveView } from "./DaveView";
import { EntitiesView } from "./EntitiesView";
import { Particles } from "./Particles";
import { PostFX } from "./PostFX";
import { CameraRig } from "./CameraRig";
import { worldCenter, PALETTE, TILE } from "./palette";
import type { World } from "../world/World";
import type { DaveView as DaveState, RenderUiState, FxHooks } from "./viewTypes";

const PLAY_TILES_W = 20;
const PLAY_TILES_H = 13;
const TICK_HZ = 60; // sim ticks per second; sim velocity is px per tick

export class GameView {
  readonly fx: FxHooks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private lighting: LightingRig;
  private worldView: WorldView;
  private daveView: DaveView;
  private entities: EntitiesView;
  private particles: Particles;
  private postfx: PostFX;
  private rig: CameraRig;
  private builtFor: unknown = null;
  private menuMode = false;
  private time = 0;
  private jetpackOn = false;
  private trophyLight: THREE.PointLight | null = null;
  private doorLight: THREE.PointLight | null = null;
  // per-frame scratch (the render path stays allocation-free)
  private followTarget = new THREE.Vector3();
  private exhaustAt = { x: 0, y: 0 };

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PALETTE.cavernDeep);
    this.scene.fog = new THREE.FogExp2(PALETTE.cavernFog, 0.028);

    this.lighting = new LightingRig(this.scene);
    this.worldView = new WorldView(this.scene, this.lighting);
    this.daveView = new DaveView(this.scene);
    this.entities = new EntitiesView(this.scene);
    this.particles = new Particles(this.scene);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera);

    const self = this;
    this.fx = {
      collect(kind, at) { self.particles.burst("collect", at, 16, 3); self.rig.pulse(0.02); },
      death(at) {
        self.particles.burst("death", at, 26, 4.5);
        self.lighting.addEmitter(worldCenter(at.x, at.y).setZ(0.6), 0xff6a3a, 14, 7, { ttl: 0.5, fade: 0.5 });
        self.rig.shake(0.5, 0.45);
        self.postfx.hitPulse(1);
      },
      land(at) { self.particles.burst("dust", at, 8, 1.6); self.rig.shake(0.12, 0.16); },
      shoot(at) { self.particles.burst("spark", at, 5, 2); },
      enemyDie(at) { self.particles.burst("death", at, 14, 3); self.rig.pulse(0.02); },
      doorOpen(at) { self.particles.burst("spark", at, 20, 3.4); self.rig.pulse(0.035); },
      jetpack(on) {
        if (on !== self.jetpackOn) self.jetpackOn = on;
      },
      warp() { self.rig.pulse(0.06); },
    };

    window.addEventListener("resize", this.onResize);
  }

  setMenuMode(on: boolean): void {
    if (this.menuMode === on) return;
    this.menuMode = on;
    this.rig.setMenuMode(on, this.time);
    this.postfx.setMenuGrade(on);
  }

  /** Per-render-frame sync from the simulation. dtReal: real seconds since last call. */
  sync(world: World, dtReal: number, ui: RenderUiState): void {
    const dt = Math.min(dtReal, 0.1);
    this.time += dt;

    if (this.builtFor !== world.map) {
      this.builtFor = world.map;
      this.worldView.buildFromTileMap(world.map);
      this.placeLightEmitters(world);
    }

    const dave = world.dave as unknown as DaveState;
    this.daveView.sync(dave, { jetpackHeld: this.jetpackOn && dave.jetpackFuel > 0, facing: dave.vel.x >= 0 ? 1 : -1 });
    this.entities.syncItems(world.items);
    this.entities.syncDoor(world.door);
    this.entities.syncEnemies(world.enemies);
    this.entities.syncBullets(world.projectiles);

    // parallax reference: Dave's offset from the playfield centre (0,0 neutral)
    this.worldView.setParallax(
      dave.pos.x / TILE + 0.5 - PLAY_TILES_W / 2,
      -(dave.pos.y / TILE) - 0.5 + PLAY_TILES_H / 2,
    );

    if (this.trophyLight) {
      this.trophyLight.position.set(dave.pos.x / TILE + 0.5, -(dave.pos.y / TILE) - 0.5, 0.8);
    }
    if (this.doorLight) {
      this.doorLight.intensity += ((world.door.opened ? 6 : 1.2) - this.doorLight.intensity) * dt * 6;
    }

    this.worldView.update(dt, this.time);
    this.daveView.update(dt, this.time);
    this.entities.update(dt, this.time);
    this.particles.update(dt);
    this.lighting.update(dt, this.time);

    // jetpack exhaust: feed DaveView's world-space flame anchor to the pool
    if (this.jetpackOn && dave.jetpackFuel > 0 && dave.alive) {
      const anchor = this.daveView.exhaustAnchor();
      this.exhaustAt.x = anchor.x;
      this.exhaustAt.y = anchor.y;
      this.particles.jetpackExhaust(this.exhaustAt, dt);
    }

    if (!this.menuMode) {
      // inline worldCenter() here — the per-frame path stays allocation-free
      this.followTarget.set(dave.pos.x / TILE + 0.5, -(dave.pos.y / TILE) - 0.5, 0);
      this.rig.follow(
        this.followTarget,
        dt,
        (dave.vel.x * TICK_HZ) / TILE,
        (dave.vel.y * TICK_HZ) / TILE,
      );
    }
    this.rig.update(dt, this.time);
    this.postfx.update(dt);
    this.postfx.render();
    void ui;
  }

  private placeLightEmitters(world: World): void {
    // lava trenches glow; door and trophy carry their own lights
    for (let ty = 0; ty < world.map.height; ty += 2) {
      for (let tx = 0; tx < world.map.width; tx += 3) {
        const def = world.map.at(tx, ty);
        if (def?.id === 3) {
          this.lighting.addEmitter(new THREE.Vector3(tx + 0.5, -(ty + 0.5), 0.7), PALETTE.lavaCore, 4.5, 4.2, { speed: 6 });
        }
      }
    }
    this.doorLight = this.lighting.addEmitter(worldCenter(world.door.pos.x, world.door.pos.y).setZ(0.9), PALETTE.emberHot, 1.2, 3.5, { speed: 5 });
    this.trophyLight = this.lighting.addEmitter(new THREE.Vector3(0, 0, 0.8), PALETTE.ember, 0, 3, { speed: 7 });
  }

  /** Resize to CSS pixel dimensions (DESIGN contract): renderer, camera and
   *  composer all track the same size. */
  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.rig.resize(w / Math.max(h, 1));
    this.postfx.resize(w, h);
  }

  private onResize = (): void => {
    this.resize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.worldView.dispose();
    this.daveView.dispose();
    this.entities.dispose();
    this.particles.dispose();
    this.postfx.dispose();
    this.rig.dispose();
    this.lighting.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
