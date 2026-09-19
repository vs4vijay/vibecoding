// Combat arena (D2/D5/D7): one Three scene hosting the battle. Owns entities
// + systems; combat takes a plain `controls` object per sim step so it stays
// DOM-free (module boundary rule) and deterministic.

import * as THREE from 'three';
import { palette } from '../data/palette.js';
import { enemies as enemyDefs, boss as bossDef, weapons, cars } from '../data/content.js';
import { combat as cbt, driving as drt } from '../data/tuning.js';
import { createRng } from '../rng.js';
import { nextId, weaponDef, reloadTime } from '../state.js';
import { makeDrivingState, stepDriving, pushOutOfAABB, dampAlongNormal, resolveCarPair } from './driving.js';
import { buildCarMesh, buildRockMesh, buildScrubMesh, buildHealthBar, burntMat } from './meshes.js';
import { createFx } from './fx.js';
import { makeMounts, tryFire, stepMounts, aimSide, muzzlePos } from '../weapons/mounts.js';
import { archetypes } from './ai.js';

const HALF = cbt.arenaSize / 2; // walls at ±HALF

const archetypeMesh = {
  scout: { body: palette.scoutBody, scale: 0.9 },
  bruiser: { body: palette.bruiserBody, scale: 1.15 },
  gunner: { body: palette.gunnerBody, scale: 1.0 },
};

export function createArena({ state, seed, audio, waves = [], bountyTarget = null, onOutcome, onEvent }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.horizon, 120, 260);

  const hemi = new THREE.HemisphereLight(0xfff3d6, 0x6e5537, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 1.5);
  sun.position.set(40, 70, 25);
  scene.add(sun);

  const rng = createRng(seed);
  const fx = createFx(scene);
  const obstacles = []; // AABBs {minX,maxX,minZ,maxZ}
  const entities = [];
  const projectiles = [];
  let outcomeSent = false;
  let outcomeTimer = -1;
  let outcomeResult = null;
  let waveIndex = 0;
  let waveDelay = 0;
  let simTime = 0;
  let over = false;

  // ------------------------------------------------------------ world build

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshLambertMaterial({ color: palette.sand })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // cross roads through the arena
  function roadStrip(w, d, x, z) {
    const r = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ color: palette.road })
    );
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, 0.02, z);
    scene.add(r);
  }
  roadStrip(500, cbt.roadHalfWidth * 2, 0, 0);
  roadStrip(cbt.roadHalfWidth * 2, 500, 0, 0);
  // worn center lines
  const lineMat = new THREE.MeshBasicMaterial({ color: palette.roadLine });
  for (let x = -HALF + 4; x < HALF; x += 12) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.04, 0);
    scene.add(l);
  }

  // boundary walls (visual + AABB)
  const wallMat = new THREE.MeshLambertMaterial({ color: palette.rockDark });
  function wall(w, d, x, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), wallMat);
    m.position.set(x, 1.2, z);
    scene.add(m);
    obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, wall: true });
  }
  wall(cbt.arenaSize + 12, 4, 0, -HALF - 2);
  wall(cbt.arenaSize + 12, 4, 0, HALF + 2);
  wall(4, cbt.arenaSize + 12, -HALF - 2, 0);
  wall(4, cbt.arenaSize + 12, HALF + 2, 0);

  // rocks off the roads (seeded, readable silhouette, no clutter on road)
  for (let i = 0; i < 16; i++) {
    const x = rng.range(-HALF + 8, HALF - 8);
    const z = rng.range(-HALF + 8, HALF - 8);
    if (isOnRoad(x, z) || Math.hypot(x, z) < 18) continue;
    const w = rng.range(3, 6.5);
    const d = rng.range(3, 6.5);
    const m = buildRockMesh(w, d, rng.chance(0.5) ? palette.rock : palette.rockDark);
    m.position.set(x, 0, z);
    scene.add(m);
    obstacles.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  // sparse scrub
  for (let i = 0; i < 22; i++) {
    const x = rng.range(-HALF, HALF);
    const z = rng.range(-HALF, HALF);
    if (isOnRoad(x, z)) continue;
    const s = buildScrubMesh();
    s.position.set(x, 0, z);
    scene.add(s);
  }

  function isOnRoad(x, z) {
    return Math.abs(z) <= cbt.roadHalfWidth || Math.abs(x) <= cbt.roadHalfWidth;
  }

  // ------------------------------------------------------------ entities

  function spawnPlayer() {
    const def = cars[state.carId];
    const mesh = buildCarMesh({ body: palette.playerBody, stripe: palette.playerStripe });
    mesh.group.position.set(0, 0, 26);
    scene.add(mesh.group);
    const car = {
      id: nextId(),
      kind: 'player',
      x: 0,
      z: 26,
      prevX: 0,
      prevZ: 26,
      heading: -Math.PI / 2,
      prevHeading: -Math.PI / 2,
      vx: 0,
      vz: 0,
      health: state.carHealth,
      maxHealth: def.maxHealth,
      radius: Math.max(def.width * 0.62, 1.6),
      drive: makeDrivingState(def),
      mounts: makeMounts(state),
      mesh,
      dead: false,
      deathTimer: 0,
      skidTimer: 0,
    };
    entities.push(car);
    return car;
  }

  function spawnEnemy(archetype, opts = {}) {
    const isBoss = archetype === 'boss';
    const eDef = isBoss
      ? { cost: 0, xp: bossDef.xp, maxHealth: bossDef.maxHealth, weapon: 'enemyMg' }
      : enemyDefs[archetype];
    const look = isBoss
      ? { body: palette.bossBody, scale: 1.4 }
      : archetypeMesh[archetype] ?? archetypeMesh.scout;
    const mesh = buildCarMesh({ body: opts.bodyColor ?? look.body, stripe: isBoss ? palette.bossTrim : null, scale: look.scale });
    const angle = opts.angle ?? rng.range(0, Math.PI * 2);
    const dist = opts.dist ?? rng.range(30, 46);
    const x = opts.x ?? Math.cos(angle) * dist;
    const z = opts.z ?? Math.sin(angle) * dist;
    mesh.group.position.set(x, 0, z);
    scene.add(mesh.group);
    const maxHealth = opts.maxHealth ?? eDef.maxHealth;
    const enemy = {
      id: nextId(),
      kind: 'enemy',
      archetype: isBoss ? 'bruiser' : archetype,
      name: opts.name ?? (isBoss ? bossDef.name : null),
      isBoss,
      x,
      z,
      prevX: x,
      prevZ: z,
      heading: Math.atan2(-z, -x),
      prevHeading: 0,
      vx: 0,
      vz: 0,
      health: maxHealth,
      maxHealth,
      xp: eDef.xp,
      radius: 1.7 * (look.scale ?? 1),
      weapon: eDef.weapon,
      reloadLeft: rng.range(0.4, 1.4),
      aimWobble: isBoss ? 0.8 : 1,
      phase2: false,
      drive: makeDrivingState(
        isBoss
          ? {
              topSpeed: bossDef.topSpeed,
              accel: bossDef.accel,
              turnRate: bossDef.turnRate,
              grip: bossDef.grip,
              offroad: bossDef.offroad,
            }
          : {
              topSpeed: eDef.topSpeed,
              accel: eDef.accel,
              turnRate: eDef.turnRate,
              grip: eDef.grip,
              offroad: eDef.offroad,
            }
      ),
      ai: { orbitDir: rng.sign(), orbitRadius: rng.range(13, 19), phase: 0, burstCooldown: 0 },
      mesh,
      dead: false,
      deathTimer: 0,
      skidTimer: 0,
    };
    enemy.prevHeading = enemy.heading;
    // floating health bar for damaged specials (bounty targets / boss)
    if (opts.name || isBoss) {
      enemy.healthBar = buildHealthBar(look.scale ?? 1);
      mesh.group.add(enemy.healthBar.group);
    }
    entities.push(enemy);
    return enemy;
  }

  const player = spawnPlayer();

  // ------------------------------------------------------------ combat API
  // Small surface handed to weapons/AI so they can act without touching scene
  // internals directly.

  const combat = {
    rng,
    entities,
    obstacles,
    player,
    sfx(name) {
      audio.sfx(name);
    },
    isOnRoad,
    spawnTracer: fx.spawnTracer,
    spawnMuzzle: fx.spawnMuzzle,
    spawnSpark: fx.spawnSpark,
    spawnRocket,
    castRay(x, z, dx, dz, range, shooter) {
      let bestT = range;
      let bestEntity = null;
      for (const o of obstacles) {
        const t = rayAABB(x, z, dx, dz, o);
        if (t !== null && t < bestT) {
          bestT = t;
          bestEntity = null;
        }
      }
      for (const e of entities) {
        if (e === shooter || e.dead) continue;
        const t = rayCircle(x, z, dx, dz, e.x, e.z, e.radius);
        if (t !== null && t < bestT) {
          bestT = t;
          bestEntity = e;
        }
      }
      return { x: x + dx * bestT, z: z + dz * bestT, entity: bestEntity, t: bestT };
    },
    applyDamage(entity, dmg, src) {
      if (entity.dead || over) return;
      entity.health -= dmg;
      fx.spawnSpark(entity.x, entity.z);
      if (entity.health <= 0) killEntity(entity, src);
    },
  };

  function killEntity(entity, src) {
    entity.dead = true;
    entity.deathTimer = 0;
    entity.vx = 0;
    entity.vz = 0;
    fx.spawnExplosion(entity.x, entity.z);
    audio.sfx('explosion');
    // burnt husk: recolor and sink the existing mesh
    entity.mesh.group.traverse((o) => {
      if (o.isMesh && o.material) o.material = burntMat;
    });
    entity.mesh.group.position.y = -0.15;
    if (entity.kind === 'player') {
      scheduleOutcome({ type: 'defeat', at: simTime + 1.4 });
    } else {
      // slight camera-shake-worthy pause on last kill handled via outcome delay
      checkWaveCleared();
    }
  }

  function scheduleOutcome(result) {
    if (outcomeSent) return;
    outcomeSent = true;
    outcomeTimer = result.at - simTime;
    outcomeResult = result;
  }

  // ------------------------------------------------------------ waves

  function spawnWave(index) {
    const wave = waves[index];
    if (!wave) return false;
    for (const spec of wave.comp) {
      if (typeof spec === 'string') spawnEnemy(spec);
      else spawnEnemy(spec.archetype, spec);
    }
    onEvent?.({ type: 'wave', label: wave.label, index });
    return true;
  }

  function checkWaveCleared() {
    if (over) return;
    const alive = entities.some((e) => e.kind !== 'player' && !e.dead);
    if (alive) return;
    if (waveIndex < waves.length - 1) {
      waveDelay = 1.6;
    } else {
      over = true;
      const xp = entities.reduce((s, e) => s + (e.kind !== 'player' ? e.xp : 0), 0);
      const kills = entities.filter((e) => e.kind !== 'player').length;
      scheduleOutcome({ type: 'victory', at: simTime + 1.1, xp, kills, bountyTarget });
    }
  }

  if (waves.length) spawnWave(0);
  else waveDelay = -1; // no waves: pure test arena

  // ------------------------------------------------------------ sim step

  function update(step, controls) {
    if (outcomeTimer > 0) {
      outcomeTimer -= step;
      if (outcomeTimer <= 0) {
        onOutcome?.(outcomeResult);
        return;
      }
    }
    simTime += step;

    // player controls
    if (!player.dead) {
      player.drive.throttle = controls.throttle;
      player.drive.steer = controls.steer;
    } else {
      player.drive.throttle = 0;
      player.drive.steer = 0;
    }

    // AI
    for (const e of entities) {
      if (e.kind === 'enemy' && !e.dead && !e.frozen) {
        if (e.reloadLeft > 0) e.reloadLeft -= step;
        // boss phase change at 50% health (8.3): faster, meaner
        if (e.isBoss && !e.phase2 && e.health <= e.maxHealth * bossDef.phase2At) {
          e.phase2 = true;
          e.drive.def.topSpeed = bossDef.phase2Speed;
          e.aimWobble = 0.55;
          onEvent?.({ type: 'phase2' });
          fx.spawnSpark(e.x, e.z, palette.explosion);
        }
        const update = archetypes[e.archetype] ?? archetypes.scout;
        update(combat, e, step);
      }
    }

    // driving + transform memory
    for (const e of entities) {
      if (e.dead || e.frozen) {
        if (e.dead) e.deathTimer += step;
        continue;
      }
      e.prevX = e.x;
      e.prevZ = e.z;
      e.prevHeading = e.heading;
      stepDriving(e, e.drive, step, isOnRoad(e.x, e.z));

      // skid marks while sliding
      if (e.drive.drifting && e.drive.speedFwd > 6) {
        e.skidTimer -= step;
        if (e.skidTimer <= 0) {
          e.skidTimer = 0.05;
          const bx = e.x - Math.cos(e.heading) * 1.4;
          const bz = e.z - Math.sin(e.heading) * 1.4;
          const l = { x: Math.sin(e.heading), z: -Math.cos(e.heading) };
          fx.spawnSkid(bx + l.x * 0.9, bz + l.z * 0.9, e.heading);
          fx.spawnSkid(bx - l.x * 0.9, bz - l.z * 0.9, e.heading);
        }
      }
    }

    // collisions: car pairs then static obstacles
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        if (a.dead || b.dead) continue;
        resolveCarPair(a, b);
      }
    }
    for (const e of entities) {
      if (e.dead) continue;
      for (const o of obstacles) {
        const n = pushOutOfAABB(e, o);
        if (n) dampAlongNormal(e, n);
      }
    }

    // player firing: the mount matching the aim side fires (D9)
    if (!player.dead && controls.fire && controls.aim) {
      const side = aimSide(player, controls.aim.x, controls.aim.z);
      const mount = player.mounts[side];
      const wDef = weaponDef(state, side);
      if (wDef && mount.weaponId) {
        const res = tryFire(combat, player, mount, side, controls.aim.x, controls.aim.z, wDef, reloadTime(state, mount.weaponId));
        if (res.ok) {
          const mz = muzzlePos(player, side);
          fx.spawnMuzzle(mz.x, mz.z);
        }
      }
    }
    stepMounts(combat, player, player.mounts, step, weapons, (id) => reloadTime(state, id));

    // enemy contact push-away from player already handled by pair resolution

    // projectiles (rockets)
    stepProjectiles(step);

    // dead enemy cleanup after husk lingers
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.dead && e.kind === 'enemy' && e.deathTimer > 4) {
        scene.remove(e.mesh.group);
        entities.splice(i, 1);
      }
    }

    // wave pacing
    if (!over && waves.length && waveDelay > 0) {
      waveDelay -= step;
      if (waveDelay <= 0) {
        waveIndex += 1;
        spawnWave(waveIndex);
        waveDelay = 0;
      }
    }
    if (!over && waves.length && waveDelay === 0 && waveIndex >= 0) {
      checkWaveCleared();
    }

    // engine audio follows the player
    audio.setEngine(!player.dead, Math.min(1, Math.abs(player.drive.speedFwd) / player.drive.def.topSpeed));
  }

  // ------------------------------------------------------------ projectiles

  function spawnRocket(shooter, x, z, dirX, dirZ, def) {
    const geo = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8);
    const mat = new THREE.MeshLambertMaterial({ color: palette.explosion });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = -Math.atan2(dirZ, dirX);
    m.rotation.z = Math.PI / 2;
    m.position.set(x, 1.2, z);
    scene.add(m);
    projectiles.push({
      x,
      z,
      vx: dirX * def.projectileSpeed,
      vz: dirZ * def.projectileSpeed,
      life: 2.6,
      owner: shooter,
      def,
      mesh: m,
      trailTimer: 0,
    });
  }

  function stepProjectiles(step) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= step;
      p.x += p.vx * step;
      p.z += p.vz * step;
      p.mesh.position.set(p.x, 1.2, p.z);
      p.trailTimer -= step;
      if (p.trailTimer <= 0) {
        p.trailTimer = 0.05;
        fx.spawnSpark(p.x - p.vx * 0.02, p.z - p.vz * 0.02, palette.smoke);
      }
      let hit = p.life <= 0;
      let hitEntity = null;
      if (!hit) {
        for (const o of obstacles) {
          if (p.x > o.minX && p.x < o.maxX && p.z > o.minZ && p.z < o.maxZ) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const e of entities) {
          if (e.dead || e === p.owner) continue;
          if (Math.hypot(e.x - p.x, e.z - p.z) < e.radius + 0.5) {
            hit = true;
            hitEntity = e;
            break;
          }
        }
      }
      if (hit) {
        explode(p, hitEntity);
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        projectiles.splice(i, 1);
      }
    }
  }

  function explode(p, directEntity) {
    fx.spawnExplosion(p.x, p.z);
    audio.sfx('explosion');
    const R = p.def.splashRadius;
    for (const e of entities) {
      if (e.dead) continue;
      if (e === directEntity) {
        combat.applyDamage(e, p.def.damage, p.owner);
        continue;
      }
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < R) {
        const k = 1 - d / R;
        const dmg = p.def.damage * (p.def.splashMin + (1 - p.def.splashMin) * k);
        const scaled = e === p.owner ? dmg * 0.5 : dmg; // own splash stings, doesn't kill as hard
        combat.applyDamage(e, scaled, p.owner);
      }
    }
  }

  // ------------------------------------------------------------ render

  function render(dt, alpha, camera) {
    for (const e of entities) {
      const ix = e.dead ? e.x : e.prevX + (e.x - e.prevX) * alpha;
      const iz = e.dead ? e.z : e.prevZ + (e.z - e.prevZ) * alpha;
      e.mesh.group.position.x = ix;
      e.mesh.group.position.z = iz;
      if (!e.dead) {
        let h = e.prevHeading + shortAngle(e.prevHeading, e.heading) * alpha;
        e.mesh.group.rotation.y = -h;
        for (const w of e.mesh.wheels) {
          w.tire.rotation.x = e.drive.wheelSpin;
          w.group.rotation.y = (w.front ? -e.drive.steer * 0.42 : 0) * -1;
        }
        // health bar tracks damage; hidden while full, drains with hull
        if (e.healthBar) {
          const frac = Math.max(0, e.health / e.maxHealth);
          const show = frac < 0.999;
          e.healthBar.group.visible = show && !over;
          e.healthBar.fill.scale.x = frac;
        }
      }
    }
    fx.update(dt);
    if (camera) {
      const heading = { x: Math.cos(player.heading), z: Math.sin(player.heading) };
      camera.follow(
        { x: player.mesh.group.position.x, y: 0, z: player.mesh.group.position.z },
        heading,
        { x: player.vx, z: player.vz },
        dt
      );
    }
  }

  function dispose() {
    audio.setEngine(false);
    fx.clear();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose?.();
    });
  }

  return {
    scene,
    player,
    entities,
    update,
    render,
    dispose,
    isOnRoad,
    spawnEnemy,
    combat,
    get over() {
      return over;
    },
    get waveIndex() {
      return waveIndex;
    },
  };
}

// ------------------------------------------------------------ ray helpers

function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const mx = ox - cx;
  const mz = oz - cz;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - r * r;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  return t;
}

function rayAABB(ox, oz, dx, dz, o) {
  let tmin = 0;
  let tmax = Infinity;
  for (const [p, d, lo, hi] of [
    [ox, dx, o.minX, o.maxX],
    [oz, dz, o.minZ, o.maxZ],
  ]) {
    if (Math.abs(d) < 1e-8) {
      if (p < lo || p > hi) return null;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

function shortAngle(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
