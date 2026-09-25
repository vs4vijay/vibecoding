// Sky, fog, lighting and cloud atmosphere (per visual-overhaul D1) — distance ramp per D7

import * as THREE from "three";
import { createCloudTexture } from "./textures.js";

// ============================================================
// TUNABLES — day -> sunset -> night, then hold. The state is a
// pure function of run distance (D7): no time, no randomness, so
// resetGame's distance = 0 returns the world to day.
// ============================================================
const RAMP = {
  DAY_END: 1500, // full sunset at this distance (m)
  NIGHT_END: 3000, // full night at this distance (m)
};

// Curated 3-stop palette. Fog always rides the sky horizon color.
const STOPS = {
  day: {
    skyTop: 0x58a6ff,
    skyBottom: 0xc2e9fb,
    keyColor: 0xfff2df,
    keyIntensity: 2.2,
    hemiSky: 0x87ceeb,
    hemiGround: 0x8a7f72,
    hemiIntensity: 0.5,
    envIntensity: 0.7,
    ambient: 0.2,
    emissive: 0,
    cloud: 0xffffff, // clouds are white in full daylight
    cloudOpacity: 1,
  },
  sunset: {
    skyTop: 0x4b4e7e, // dusky indigo
    skyBottom: 0xff9e6b, // warm orange/pink horizon
    keyColor: 0xffb37e,
    keyIntensity: 1.7,
    hemiSky: 0xc98a6e,
    hemiGround: 0x6f5a54,
    hemiIntensity: 0.42,
    envIntensity: 0.45,
    ambient: 0.16,
    emissive: 0.35, // lit windows just beginning
    cloud: 0xffdcc8, // sunlit pale warm white — must stay BRIGHTER than the
    // orange low-dome sky or sunset clouds melt into it
    cloudOpacity: 0.95,
  },
  night: {
    skyTop: 0x0a1128, // dark navy
    skyBottom: 0x1f2536, // near-black horizon, faint city-glow warmth
    keyColor: 0x8fa8d8, // cool moonlight keeps the track readable
    keyIntensity: 0.55,
    hemiSky: 0x2b3a5c,
    hemiGround: 0x14161d,
    hemiIntensity: 0.28,
    envIntensity: 0.15, // dim IBL so it doesn't wash the night out
    ambient: 0.1,
    emissive: 1.1, // capped so lit facades don't blow out
    cloud: 0x546080, // faint moonlit gray-blue silhouettes
    cloudOpacity: 0.45,
  },
};

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const lerp = (a, b, t) => a + (b - a) * t;
// Smoothstep eases the dusk fall so night arrives gently
const smooth = (t) => t * t * (3 - 2 * t);
// Per-channel integer mix keeps the output exactly reproducible
function mixHex(a, b, t) {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

// Pure, deterministic state at a run distance. t: 0 = day, 1 = sunset,
// 2 = night (held beyond NIGHT_END). Day->sunset is linear so the warmth
// shows early in a natural run; sunset->night is eased.
export function atmosphereState(distance) {
  const t =
    distance < RAMP.DAY_END
      ? clamp01(distance / RAMP.DAY_END)
      : 1 + smooth(clamp01((distance - RAMP.DAY_END) / (RAMP.NIGHT_END - RAMP.DAY_END)));
  const a = t <= 1 ? STOPS.day : STOPS.sunset;
  const b = t <= 1 ? STOPS.sunset : STOPS.night;
  const k = t <= 1 ? t : t - 1;
  const horizon = mixHex(a.skyBottom, b.skyBottom, k);
  return {
    t,
    skyTop: mixHex(a.skyTop, b.skyTop, k),
    skyBottom: horizon,
    fog: horizon, // fog = sky horizon (D7)
    keyColor: mixHex(a.keyColor, b.keyColor, k),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, k),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, k),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, k),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, k),
    envIntensity: lerp(a.envIntensity, b.envIntensity, k),
    ambient: lerp(a.ambient, b.ambient, k),
    buildingEmissive: lerp(a.emissive, b.emissive, k),
    cloudColor: mixHex(a.cloud, b.cloud, k),
    cloudOpacity: lerp(a.cloudOpacity, b.cloudOpacity, k),
  };
}

// ============================================================
// CLOUD BILLBOARDS (D7) — a fixed pool of soft sprites sharing one
// CanvasTexture, recycled ahead of the camera exactly like buildings.
// Sprites are the cheapest billboard (no addons); every material is
// created once here, so the steady-state frame allocates nothing.
// ============================================================
const CLOUDS = {
  COUNT: 8,
  Y_MIN: 24, // altitude band: above the ~24m building tops (they must not
  Y_MAX: 34, // silhouette through clouds) yet under the ~20deg frame top
  X_MIN: 15, // lateral spread, clear of the track corridor
  X_MAX: 55,
  BEHIND: 20, // recycle once a cloud drifts this far behind the camera
  SCALE_MIN: 8, // world-unit width range (heights ride the texture aspect)
  SCALE_MAX: 20,
  FADE_NEAR: 115, // clouds closer than this hold full opacity
  FADE_FAR: 145, // clouds at this range are fully transparent
  BASE_OPACITY_MIN: 0.5, // per-cloud depth cue: nearer clouds read denser
  BASE_OPACITY_MAX: 0.9,
  RESEED_JUMP: 500, // distance discontinuity (reset/menu) reseeds the pool
};

// Small self-contained PRNG for the pool: cloud variety stays independent of
// any global Math.random state (and the module stays deterministic per seed,
// like the ramp above).
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One cloud = sprite + its random base opacity, kept in a parallel record so
// the per-frame pass never touches userData.
function createCloudPool(scene, camera) {
  const texture = createCloudTexture();
  const rand = mulberry32((Math.random() * 0xffffffff) | 0);
  const pool = [];
  for (let i = 0; i < CLOUDS.COUNT; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false, // soft volumes, never occluders
        fog: false, // fog washes white puffs into the pale horizon; the
        // explicit distance fade below is the only softening they need
      }),
    );
    sprite.material.opacity = 0; // invisible until the first seed tints it in
    scene.add(sprite);
    pool.push({ sprite, base: 0 });
  }

  // Fresh random lateral/altitude/scale/depth-cue at a given slot relZ
  // (distance ahead of the live camera). x/y/scale vary per slot; the slot
  // itself is decided by the seed (ring) or the recycle rule.
  function reposition(cloud, relZ) {
    const side = rand() < 0.5 ? -1 : 1;
    const width = CLOUDS.SCALE_MIN + rand() * (CLOUDS.SCALE_MAX - CLOUDS.SCALE_MIN);
    cloud.sprite.position.set(
      camera.position.x + side * (CLOUDS.X_MIN + rand() * (CLOUDS.X_MAX - CLOUDS.X_MIN)),
      CLOUDS.Y_MIN + rand() * (CLOUDS.Y_MAX - CLOUDS.Y_MIN),
      camera.position.z + relZ,
    );
    cloud.sprite.scale.set(width, width * (0.55 + rand() * 0.2), 1);
    cloud.base = CLOUDS.BASE_OPACITY_MIN + rand() * (CLOUDS.BASE_OPACITY_MAX - CLOUDS.BASE_OPACITY_MIN);
  }

  return {
    // Lay the ring: COUNT evenly spaced slots spanning the whole cycle
    // relative to the current camera (first frame, and after resetGame /
    // returning to menu snaps the world back to z=0).
    seed() {
      const spacing = (CLOUDS.FADE_FAR + CLOUDS.BEHIND) / CLOUDS.COUNT;
      pool.forEach((cloud, i) => {
        reposition(cloud, -CLOUDS.BEHIND + (i + 0.5) * spacing);
      });
    },
    // Recycle behind-camera clouds and ride the ramp: per-cloud base opacity
    // scaled by the distance fade-in and the day/sunset/night tint.
    update(state) {
      const camZ = camera.position.z;
      const fadeBand = CLOUDS.FADE_FAR - CLOUDS.FADE_NEAR;
      const cycle = CLOUDS.FADE_FAR + CLOUDS.BEHIND;
      const spacing = cycle / CLOUDS.COUNT;
      for (const cloud of pool) {
        if (cloud.sprite.position.z < camZ - CLOUDS.BEHIND) {
          // one slot beyond the current farthest cloud, wrapping through the
          // invisible zone: always transparent at spawn (no pop) and always
          // evenly spaced (no gaps)
          let farthest = -CLOUDS.BEHIND;
          for (const other of pool) {
            farthest = Math.max(farthest, other.sprite.position.z - camZ);
          }
          let rel = farthest + spacing;
          if (rel > CLOUDS.FADE_FAR) rel -= cycle;
          reposition(cloud, rel);
        }
        const dist = cloud.sprite.position.distanceTo(camera.position);
        const fade = 1 - clamp01((dist - CLOUDS.FADE_NEAR) / fadeBand);
        cloud.sprite.material.color.setHex(state.cloudColor);
        cloud.sprite.material.opacity = cloud.base * state.cloudOpacity * fade;
      }
    },
  };
}

// Factory: binds the ramp to the live scene. game.js calls update() once per
// frame with the run distance; buildings pass through so the night emissive
// lands on alive meshes only (no registry, nothing to leak). The camera drives
// cloud recycling; its live position is read every frame.
export function createAtmosphere({ skyMaterial, scene, dirLight, hemiLight, ambientLight, camera }) {
  const sky = skyMaterial.uniforms;
  const clouds = createCloudPool(scene, camera);
  let lastDistance = null;
  return {
    update(distance, world = {}) {
      const s = atmosphereState(distance);
      sky.topColor.value.setHex(s.skyTop);
      sky.bottomColor.value.setHex(s.skyBottom);
      scene.fog.color.setHex(s.fog);
      dirLight.color.setHex(s.keyColor);
      dirLight.intensity = s.keyIntensity;
      hemiLight.color.setHex(s.hemiSky);
      hemiLight.groundColor.setHex(s.hemiGround);
      hemiLight.intensity = s.hemiIntensity;
      scene.environmentIntensity = s.envIntensity;
      ambientLight.intensity = s.ambient;
      // Clouds reseed across the whole band on the first frame or whenever
      // distance jumps (resetGame / back to menu); otherwise just recycle.
      if (lastDistance === null || Math.abs(distance - lastDistance) > CLOUDS.RESEED_JUMP) {
        clouds.seed();
      }
      lastDistance = distance;
      clouds.update(s);
      if (world.buildings) {
        for (const b of world.buildings) {
          b.mesh.material.emissiveIntensity = s.buildingEmissive;
        }
      }
      return s;
    },
  };
}
