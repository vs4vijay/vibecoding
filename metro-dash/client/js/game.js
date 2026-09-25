import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createAtmosphere } from "./visual/atmosphere.js";
import { createBuildingMesh, createTrain, createBarrier, createGantry } from "./visual/props.js";
import { createPlayerRig } from "./visual/character.js";
import {
  createBallastTexture,
  createSleeperTexture,
  BALLAST_TILE,
  SLEEPER_TILE,
} from "./visual/textures.js";
import { createUiMotion } from "./visual/ui-motion.js";

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  LANE_COUNT: 3,
  LANE_WIDTH: 3,
  PLAYER_SPEED_BASE: 15,
  PLAYER_SPEED_MAX: 40,
  PLAYER_SPEED_INCREMENT: 0.3,
  PLAYER_JUMP_FORCE: 12,
  GRAVITY: -30,
  OBSTACLE_SPAWN_DISTANCE: 120,
  OBSTACLE_DESPAWN_DISTANCE: -20,
  COIN_SPAWN_DISTANCE: 100,
  BUILDING_SPAWN_DISTANCE: 150,
  GROUND_LENGTH: 200,
  PLAYER_LERP_SPEED: 12,
  COLLISION_RADIUS: 0.8,
  FOV: 65,
  FOV_MAX: 75,
  FOV_SMOOTHING: 5,
  CAMERA_HEIGHT: 8,
  CAMERA_DISTANCE: 12,
  CAM_KICK_DEPTH: 0.9,
  CAM_KICK_TIME: 0.3,
  FOG_NEAR: 60,
  FOG_FAR: 150,
};

const API_BASE = window.location.origin;

// ============================================================
// GAME STATE
// ============================================================
const GameState = {
  MENU: "menu",
  PLAYING: "playing",
  GAME_OVER: "gameover",
};

let state = GameState.MENU;
let score = 0;
let coins = 0;
let distance = 0;
let speed = CONFIG.PLAYER_SPEED_BASE;
let multiplier = 1;
let combo = 0;
let obstaclesDodged = 0;
let powerupsUsed = 0;
let maxCombo = 0;
let playStartTime = 0;
let playerId = null;

// Player lane (-1 = left, 0 = center, 1 = right)
let currentLane = 0;
let targetLane = 0;
let playerX = 0;
let playerY = 0;
let playerVelocityY = 0;
let isJumping = false;
let isRolling = false;
let rollTimer = 0;
const ROLL_DURATION = 0.6;
// Landing camera kick (D8): time remaining in the post-landing dip
let camKickTimer = 0;

// ============================================================
// THREE.JS SETUP
// ============================================================
const canvas = document.getElementById("gameCanvas");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Per-frame render stats (fps smoothing: 0.9/0.1 EMA)
window.__renderStats = { calls: 0, fps: 0, fov: CONFIG.FOV, camY: CONFIG.CAMERA_HEIGHT };

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, CONFIG.FOG_NEAR, CONFIG.FOG_FAR);

// Procedural IBL (RoomEnvironment) — ambient/specular env for Standard materials
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(
  CONFIG.FOV,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);

// ============================================================
// LIGHTING (warm key / cool fill; IBL carries ambient)
// ============================================================
scene.environmentIntensity = 0.7;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff2df, 2.2);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
dirLight.shadow.camera.left = -20;
dirLight.shadow.camera.right = 20;
dirLight.shadow.camera.top = 20;
dirLight.shadow.camera.bottom = -20;
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x8a7f72, 0.5);
scene.add(hemiLight);

// ============================================================
// MATERIALS (cached)
// ============================================================
const materials = {
  ground: new THREE.MeshStandardMaterial({ map: createBallastTexture(), roughness: 0.95, metalness: 0.0 }),
  sleeper: new THREE.MeshStandardMaterial({ map: createSleeperTexture(), roughness: 0.9, metalness: 0.0 }),
  rail: new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.3, metalness: 0.9 }),
  player: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.6, metalness: 0.0 }),
  playerHead: new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.6, metalness: 0.0 }),
  coin: new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xffa500,
    emissiveIntensity: 0.15,
    roughness: 0.2,
    metalness: 1.0,
  }),
  magnet: new THREE.MeshStandardMaterial({
    color: 0x8b5cf6,
    emissive: 0x7c3aed,
    emissiveIntensity: 0.3,
    roughness: 0.3,
    metalness: 0.5,
  }),
  jetpack: new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.3,
    roughness: 0.3,
    metalness: 0.5,
  }),
};

// ============================================================
// PLAYER (procedural rig with pose mixer, per visual-overhaul D6)
// ============================================================
const rig = createPlayerRig(materials, scene);
const player = rig.group;
scene.add(player);

// ============================================================
// GROUND & TRACK (procedural track bed, per visual-overhaul D4)
// ============================================================
const groundGroup = new THREE.Group();
scene.add(groundGroup);

// Repeats tile an integer number of times along GROUND_LENGTH (80 / 320), so
// no partial tile shows at the far end.
const TRACK_WIDTH = CONFIG.LANE_COUNT * CONFIG.LANE_WIDTH + 4;
const bedZ = CONFIG.GROUND_LENGTH / 2 - 30;
materials.ground.map.repeat.set(
  TRACK_WIDTH / BALLAST_TILE.meters,
  CONFIG.GROUND_LENGTH / BALLAST_TILE.meters,
);

// Main ground (ballast)
const groundGeo = new THREE.PlaneGeometry(TRACK_WIDTH, CONFIG.GROUND_LENGTH);
const ground = new THREE.Mesh(groundGeo, materials.ground);
ground.rotation.x = -Math.PI / 2;
ground.position.z = bedZ;
ground.receiveShadow = true;
groundGroup.add(ground);

// Sleeper strip: ties every SLEEPER_TILE.pitch of travel, spanning the rails
materials.sleeper.map.repeat.set(1, CONFIG.GROUND_LENGTH / SLEEPER_TILE.pitch);
const sleepers = new THREE.Mesh(
  new THREE.PlaneGeometry(10, CONFIG.GROUND_LENGTH),
  materials.sleeper,
);
sleepers.rotation.x = -Math.PI / 2;
sleepers.position.set(0, 0.006, bedZ);
sleepers.receiveShadow = true;
groundGroup.add(sleepers);

// Lane dividers (rails): profiled foot/web/head steel merged into one shared
// geometry — decorative only, gameplay collisions are independent
const railProfile = mergeGeometries([
  new THREE.BoxGeometry(0.16, 0.025, CONFIG.GROUND_LENGTH).translate(0, 0.0125, 0),
  new THREE.BoxGeometry(0.06, 0.115, CONFIG.GROUND_LENGTH).translate(0, 0.0825, 0),
  new THREE.BoxGeometry(0.08, 0.035, CONFIG.GROUND_LENGTH).translate(0, 0.1575, 0),
]);
for (let i = -1; i <= 1; i++) {
  const rail = new THREE.Mesh(railProfile, materials.rail);
  rail.position.set(i * CONFIG.LANE_WIDTH / 2 + CONFIG.LANE_WIDTH * 0.5, 0.006, bedZ);
  rail.castShadow = true;
  groundGroup.add(rail);
  const rail2 = new THREE.Mesh(railProfile, materials.rail);
  rail2.position.set(i * CONFIG.LANE_WIDTH / 2 - CONFIG.LANE_WIDTH * 0.5, 0.006, bedZ);
  rail2.castShadow = true;
  groundGroup.add(rail2);
}

// ============================================================
// SIDE BUILDINGS
// ============================================================
const buildings = [];

function createBuilding(x, z) {
  const mesh = createBuildingMesh(x, z);
  scene.add(mesh);
  buildings.push({ mesh, originalZ: z });
  return mesh;
}

// ============================================================
// OBSTACLES
// ============================================================
const obstacles = [];
const obstaclePool = [];

function createObstacle(z) {
  const lane = Math.floor(Math.random() * 3) - 1;
  const x = lane * CONFIG.LANE_WIDTH;
  const type = Math.random();

  let mesh;

  if (type < 0.4) {
    // Train (tall obstacle - must dodge left/right) — liveried subway car
    // (visual-overhaul D5); the group registers as one collision box
    mesh = createTrain(x, z);
  } else if (type < 0.7) {
    // Barrier (low obstacle - must jump) — striped work-zone barrier
    // (visual-overhaul D5); the group's bounds match the old plank box
    mesh = createBarrier(x, z);
  } else {
    // Overhead (must roll under) — truss signal gantry (visual-overhaul D5);
    // the beam assembly registers as the obstacle (origin rides on the beam,
    // keeping the y > 2.5 roll-under key), posts register separately like
    // the old support poles did
    const gantry = createGantry(x, z);
    mesh = gantry.beam;

    for (const post of gantry.posts) {
      scene.add(post);
      obstacles.push({ mesh: post, type: "obstacle" });
    }
  }

  mesh.castShadow = true;
  scene.add(mesh);
  obstacles.push({ mesh, type: "obstacle" });

  return mesh;
}

// ============================================================
// COINS
// ============================================================
const coinObjects = [];
const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12);

function createCoinRow(z) {
  const lane = Math.floor(Math.random() * 3) - 1;
  const count = 3 + Math.floor(Math.random() * 5);
  const coinGroup = [];

  for (let i = 0; i < count; i++) {
    const coin = new THREE.Mesh(coinGeo, materials.coin);
    coin.rotation.x = Math.PI / 2;
    coin.position.set(lane * CONFIG.LANE_WIDTH, 1.5, z - i * 1.5);
    coin.castShadow = true;
    scene.add(coin);
    coinObjects.push(coin);
    coinGroup.push(coin);
  }

  return coinGroup;
}

// ============================================================
// POWER-UPS
// ============================================================
const powerupObjects = [];
const powerupGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);

function createPowerup(z) {
  if (Math.random() > 0.15) return; // 15% chance

  const lane = Math.floor(Math.random() * 3) - 1;
  const type = Math.random();

  let mat;
  let pType;

  if (type < 0.33) {
    mat = materials.magnet;
    pType = "magnet";
  } else {
    mat = materials.jetpack;
    pType = "jetpack";
  }

  const mesh = new THREE.Mesh(powerupGeo, mat);
  mesh.position.set(lane * CONFIG.LANE_WIDTH, 2, z);
  mesh.castShadow = true;
  scene.add(mesh);
  powerupObjects.push({ mesh, type: pType });
}

// ============================================================
// SKYBOX (simple gradient)
// ============================================================
const skyGeo = new THREE.SphereGeometry(90, 16, 16);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    topColor: { value: new THREE.Color(0x58a6ff) },
    bottomColor: { value: new THREE.Color(0xc2e9fb) },
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    varying vec3 vWorldPosition;
    void main() {
      // camera-relative: normalizing world position flattens the gradient as
      // the run leaves the origin (surfaced by the D7 distance ramp)
      float h = normalize(vWorldPosition - cameraPosition).y;
      gl_FragColor = vec4(mix(bottomColor, topColor, max(h, 0.0)), 1.0);
    }
  `,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);

// ============================================================
// ATMOSPHERE (distance-driven day -> sunset -> night ramp, per D7)
// ============================================================
const atmosphere = createAtmosphere({
  skyMaterial: skyMat,
  scene,
  dirLight,
  hemiLight,
  ambientLight,
  camera, // cloud pool recycles relative to the live camera (D7)
});

// ============================================================
// INPUT HANDLING
// ============================================================
const keys = {};

window.addEventListener("keydown", (e) => {
  if (keys[e.key]) return;
  keys[e.key] = true;

  if (state !== GameState.PLAYING) return;

  switch (e.key) {
    case "ArrowLeft":
    case "a":
    case "A":
      moveLane(-1);
      break;
    case "ArrowRight":
    case "d":
    case "D":
      moveLane(1);
      break;
    case "ArrowUp":
    case "w":
    case "W":
    case " ":
      jump();
      break;
    case "ArrowDown":
    case "s":
    case "S":
      roll();
      break;
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key] = false;
});

// Touch / swipe support
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

window.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

window.addEventListener("touchend", (e) => {
  if (state !== GameState.PLAYING) return;

  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const dt = Date.now() - touchStartTime;

  if (dt > 500) return; // too slow
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx < 20 && absDy < 20) return; // too small

  if (absDx > absDy) {
    // Horizontal swipe
    if (dx > 30) moveLane(1);
    else if (dx < -30) moveLane(-1);
  } else {
    // Vertical swipe
    if (dy < -30) jump();
    else if (dy > 30) roll();
  }
}, { passive: true });

function moveLane(direction) {
  targetLane = Math.max(-1, Math.min(1, targetLane + direction));
  combo++;
  if (combo > maxCombo) maxCombo = combo;
}

function jump() {
  if (!isJumping) {
    isJumping = true;
    playerVelocityY = CONFIG.PLAYER_JUMP_FORCE;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  }
}

function roll() {
  if (!isRolling && !isJumping) {
    isRolling = true;
    rollTimer = ROLL_DURATION;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  }
}

// ============================================================
// COLLISION DETECTION
// ============================================================
function checkCollisions() {
  const playerBox = new THREE.Box3().setFromObject(player);
  // Shrink player collision box a bit
  playerBox.expandByScalar(-0.2);

  // Check obstacles
  for (const obs of obstacles) {
    if (obs.type !== "obstacle") continue;
    const obsBox = new THREE.Box3().setFromObject(obs.mesh);
    obsBox.expandByScalar(-0.1);

    if (playerBox.intersectsBox(obsBox)) {
      // Check if overhead obstacle and player is rolling
      if (obs.mesh.position.y > 2.5 && isRolling) {
        continue; // rolled under it
      }
      gameOver();
      return;
    }
  }

  // Check coins
  for (let i = coinObjects.length - 1; i >= 0; i--) {
    const coin = coinObjects[i];
    const coinBox = new THREE.Box3().setFromObject(coin);
    coinBox.expandByScalar(0.2);

    if (playerBox.intersectsBox(coinBox)) {
      scene.remove(coin);
      coinObjects.splice(i, 1);
      coins++;
      score += 10 * multiplier;
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      updateHUD();
    }
  }

  // Check power-ups
  for (let i = powerupObjects.length - 1; i >= 0; i--) {
    const pu = powerupObjects[i];
    const puBox = new THREE.Box3().setFromObject(pu.mesh);
    puBox.expandByScalar(0.2);

    if (playerBox.intersectsBox(puBox)) {
      scene.remove(pu.mesh);
      powerupObjects.splice(i, 1);
      powerupsUsed++;

      if (pu.type === "magnet") {
        multiplier = Math.min(multiplier + 1, 10);
      } else if (pu.type === "jetpack") {
        isJumping = true;
        playerVelocityY = CONFIG.PLAYER_JUMP_FORCE * 2;
      }

      updateHUD();
    }
  }
}

// ============================================================
// SPAWNING
// ============================================================
let nextObstacleZ = 40;
let nextCoinZ = 30;
let nextBuildingZ = 20;
let nextPowerupZ = 50;

function spawnObjects(delta) {
  // Spawn obstacles
  while (nextObstacleZ < player.position.z + CONFIG.OBSTACLE_SPAWN_DISTANCE) {
    createObstacle(nextObstacleZ);
    nextObstacleZ += 15 + Math.random() * 20;
  }

  // Spawn coins
  while (nextCoinZ < player.position.z + CONFIG.COIN_SPAWN_DISTANCE) {
    createCoinRow(nextCoinZ);
    nextCoinZ += 10 + Math.random() * 15;
  }

  // Spawn buildings
  while (nextBuildingZ < player.position.z + CONFIG.BUILDING_SPAWN_DISTANCE) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const offset = CONFIG.LANE_COUNT * CONFIG.LANE_WIDTH * 0.5 + 3 + Math.random() * 4;
    createBuilding(side * offset, nextBuildingZ);
    nextBuildingZ += 5 + Math.random() * 8;
  }

  // Spawn power-ups
  while (nextPowerupZ < player.position.z + 80) {
    createPowerup(nextPowerupZ);
    nextPowerupZ += 30 + Math.random() * 40;
  }
}

// ============================================================
// CLEANUP
// ============================================================
function cleanupObjects() {
  const despawnZ = player.position.z + CONFIG.OBSTACLE_DESPAWN_DISTANCE;

  // Clean obstacles
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];
    if (obs.mesh.position.z < despawnZ) {
      scene.remove(obs.mesh);
      obstacles.splice(i, 1);
    }
  }

  // Clean coins
  for (let i = coinObjects.length - 1; i >= 0; i--) {
    const coin = coinObjects[i];
    if (coin.position.z < despawnZ) {
      scene.remove(coin);
      coinObjects.splice(i, 1);
    }
  }

  // Clean power-ups
  for (let i = powerupObjects.length - 1; i >= 0; i--) {
    const pu = powerupObjects[i];
    if (pu.mesh.position.z < despawnZ) {
      scene.remove(pu.mesh);
      powerupObjects.splice(i, 1);
    }
  }

  // Clean buildings
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (b.mesh.position.z < despawnZ - 20) {
      scene.remove(b.mesh);
      buildings.splice(i, 1);
    }
  }
}

// ============================================================
// GAME LOGIC
// ============================================================
function updateGame(delta) {
  // Move player forward
  const moveDelta = speed * delta;
  player.position.z += moveDelta;
  distance += moveDelta;

  // Speed up over time
  speed = Math.min(speed + CONFIG.PLAYER_SPEED_INCREMENT * delta, CONFIG.PLAYER_SPEED_MAX);

  // Score increases with distance
  score += Math.floor(moveDelta * multiplier);

  // Lane movement (smooth lerp)
  // Camera looks down +z from behind the player, so world +x renders on screen-left;
  // negate so lane +1 (ArrowRight / swipe right) moves screen-right.
  const targetX = -targetLane * CONFIG.LANE_WIDTH;
  playerX = THREE.MathUtils.lerp(playerX, targetX, CONFIG.PLAYER_LERP_SPEED * delta);
  player.position.x = playerX;

  // Jump physics
  if (isJumping) {
    playerVelocityY += CONFIG.GRAVITY * delta;
    playerY += playerVelocityY * delta;

    if (playerY <= 0) {
      playerY = 0;
      playerVelocityY = 0;
      isJumping = false;
      camKickTimer = CONFIG.CAM_KICK_TIME; // landing camera dip (D8)
    }
  }

  // Rolling (rig owns the tumble pose; timer drives the state window)
  if (isRolling) {
    rollTimer -= delta;
    if (rollTimer <= 0) {
      isRolling = false;
    }
  }

  player.position.y = playerY;

  // Rig pose: run cycle / jump tuck / roll tumble / lane lean (D6)
  rig.update(delta, {
    isJumping,
    isRolling,
    rollProgress: isRolling ? 1 - rollTimer / ROLL_DURATION : 0,
    grounded: !isJumping,
    distance,
    lean: targetLane * CONFIG.LANE_WIDTH - playerX,
  });

  // Camera follow
  const camTargetX = playerX * 0.3;
  camera.position.x = THREE.MathUtils.lerp(
    camera.position.x,
    camTargetX,
    5 * delta,
  );
  // Landing kick (D8): a timed dip below follow height, easing back up over
  // CAM_KICK_TIME — reads as suspension compression, not a pop.
  if (camKickTimer > 0) {
    camKickTimer = Math.max(camKickTimer - delta, 0);
  }
  const camKick =
    -CONFIG.CAM_KICK_DEPTH * Math.sin((Math.PI * camKickTimer) / CONFIG.CAM_KICK_TIME);
  camera.position.y = CONFIG.CAMERA_HEIGHT + (isJumping ? 3 : 0) + camKick;
  camera.position.z = player.position.z - CONFIG.CAMERA_DISTANCE;

  // Speed-reactive FOV (D8): widen from FOV toward FOV_MAX as speed ramps
  // base → max, smoothed frame-rate independently to avoid jitter.
  const speedProgress = THREE.MathUtils.clamp(
    (speed - CONFIG.PLAYER_SPEED_BASE) / (CONFIG.PLAYER_SPEED_MAX - CONFIG.PLAYER_SPEED_BASE),
    0,
    1,
  );
  const targetFov = THREE.MathUtils.lerp(CONFIG.FOV, CONFIG.FOV_MAX, speedProgress);
  const smoothedFov = THREE.MathUtils.lerp(
    camera.fov,
    targetFov,
    1 - Math.exp(-CONFIG.FOV_SMOOTHING * delta),
  );
  if (Math.abs(targetFov - camera.fov) > 0.01) {
    camera.fov = smoothedFov;
    camera.updateProjectionMatrix();
  }

  camera.lookAt(
    player.position.x * 0.5,
    2,
    player.position.z + 15,
  );

  // Light follows
  dirLight.position.z = player.position.z + 10;
  dirLight.target.position.z = player.position.z;
  dirLight.target.updateMatrixWorld();

  // Sky follows
  sky.position.x = camera.position.x;
  sky.position.z = camera.position.z;

  // Distance-driven atmosphere: sky, fog, lights, window emissive (D7)
  atmosphere.update(distance, { buildings });

  // Track bed follows the player (recycled — static bed ran out past z=170).
  // The strip spans [player.z - 30, player.z + 170]; shifts snap to
  // BALLAST_TILE.meters (2.5m = 1 ballast tile = 4 sleeper pitches) so every
  // move lands on whole repeats of both track textures — pattern never jumps.
  groundGroup.position.z =
    Math.floor(player.position.z / BALLAST_TILE.meters) * BALLAST_TILE.meters;

  // Spawn & cleanup
  spawnObjects(delta);
  cleanupObjects();

  // Check collisions
  checkCollisions();

  // Update HUD every few frames
  if (Math.floor(distance * 2) % 3 === 0) {
    updateHUD();
  }
}

// ============================================================
// HUD
// ============================================================
const hudEl = document.getElementById("hud");
const scoreEl = document.getElementById("score-value");
const coinsEl = document.getElementById("coins-value");
const multiplierEl = document.getElementById("multiplier-display");
const multiplierValueEl = document.getElementById("multiplier-value");
const comboEl = document.getElementById("combo-display");
const comboValueEl = document.getElementById("combo-value");

function updateHUD() {
  uiMotion.setScore(score);
  uiMotion.setCoins(coins);
  uiMotion.setMultiplier(multiplier);
  uiMotion.setCombo(combo);
}

// ============================================================
// GAME FLOW
// ============================================================
const menuScreen = document.getElementById("menu-screen");
const gameoverScreen = document.getElementById("gameover-screen");
const loadingScreen = document.getElementById("loading-screen");

// HUD/screen motion layer (visual-overhaul 7.3): count-up tweens, combo
// punch, crash flash, screen fades, play vignette.
const uiMotion = createUiMotion({
  scoreEl,
  coinsEl,
  comboEl,
  comboValueEl,
  multiplierEl,
  multiplierValueEl,
  screens: { menu: menuScreen, hud: hudEl, gameover: gameoverScreen },
});

function startGame() {
  const usernameInput = document.getElementById("username-input");
  const username = usernameInput.value.trim() || "player";

  // Get or create player
  fetch(`${API_BASE}/api/players/get-or-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      displayName: username,
    }),
  })
    .then((res) => res.json())
    .then((player) => {
      playerId = player.id;
      loadMenuStats(player);
    })
    .catch(() => {
      playerId = "local";
    })
    .finally(() => {
      resetGame();
      state = GameState.PLAYING;
      playStartTime = Date.now();
      uiMotion.hideScreen("menu");
      uiMotion.showScreen("hud");
      uiMotion.setPlaying(true);
    });
}

function resetGame() {
  // Clear all objects
  obstacles.forEach((obs) => scene.remove(obs.mesh));
  coinObjects.forEach((coin) => scene.remove(coin));
  powerupObjects.forEach((pu) => scene.remove(pu.mesh));
  buildings.forEach((b) => scene.remove(b.mesh));
  obstacles.length = 0;
  coinObjects.length = 0;
  powerupObjects.length = 0;
  buildings.length = 0;

  // Reset player
  player.position.set(0, 0, 0);
  player.scale.set(1, 1, 1);
  rig.reset();

  // Reset state
  currentLane = 0;
  targetLane = 0;
  playerX = 0;
  playerY = 0;
  playerVelocityY = 0;
  isJumping = false;
  isRolling = false;
  camKickTimer = 0;
  score = 0;
  coins = 0;
  distance = 0;
  speed = CONFIG.PLAYER_SPEED_BASE;
  multiplier = 1;
  combo = 0;
  obstaclesDodged = 0;
  powerupsUsed = 0;
  maxCombo = 0;
  nextObstacleZ = 40;
  nextCoinZ = 30;
  nextBuildingZ = 20;
  nextPowerupZ = 50;

  // Reset camera
  camera.position.set(0, CONFIG.CAMERA_HEIGHT, -CONFIG.CAMERA_DISTANCE);
  camera.lookAt(0, 2, 15);
  camera.fov = CONFIG.FOV;
  camera.updateProjectionMatrix();

  // Reset track bed offset (bed re-centers on the player as the run advances)
  groundGroup.position.z = 0;

  updateHUD();
  uiMotion.snapCounters(); // retry zeroes instantly — no count-down from the last run
}

function gameOver() {
  state = GameState.GAME_OVER;
  uiMotion.crashFlash(); // red spike now; the game-over screen fades in under it
  uiMotion.hideScreen("hud");
  uiMotion.setPlaying(false);

  const playTimeSeconds = (Date.now() - playStartTime) / 1000;

  // Show game over screen
  document.getElementById("go-score").textContent = score.toLocaleString();
  document.getElementById("go-distance").textContent = `${Math.floor(distance)}m`;
  document.getElementById("go-coins").textContent = coins.toLocaleString();

  // Check high score
  const currentHigh = parseInt(localStorage.getItem("subway_high_score") || "0");
  if (score > currentHigh) {
    localStorage.setItem("subway_high_score", score);
    document.getElementById("new-high-score").classList.remove("hidden");
  } else {
    document.getElementById("new-high-score").classList.add("hidden");
  }

  uiMotion.showScreen("gameover");

  // Save run to server
  if (playerId && playerId !== "local") {
    fetch(`${API_BASE}/api/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId,
        score,
        distance,
        coinsCollected: coins,
        multiplier,
        obstaclesDodged,
        powerupsUsed,
        maxCombo,
        playTimeSeconds,
      }),
    }).catch(() => {
      // Silently fail - data saved locally
    });
  }

  // Save locally
  localStorage.setItem("subway_last_run", JSON.stringify({
    score,
    distance: Math.floor(distance),
    coins,
    date: new Date().toISOString(),
  }));
}

function showMenu() {
  state = GameState.MENU;
  uiMotion.hideScreen("gameover");
  uiMotion.showScreen("menu");
  uiMotion.setPlaying(false);

  // Load player stats
  if (playerId && playerId !== "local") {
    fetch(`${API_BASE}/api/players/${playerId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.player) {
          loadMenuStats(data.player);
        }
      })
      .catch(() => {});
  }
}

function loadMenuStats(player) {
  const statsEl = document.getElementById("menu-stats");
  document.getElementById("menu-high-score").textContent =
    player?.highScore?.toLocaleString() ||
    localStorage.getItem("subway_high_score") ||
    "0";
  document.getElementById("menu-coins").textContent =
    player?.totalCoins?.toLocaleString() || "0";
  document.getElementById("menu-games").textContent =
    player?.gamesPlayed?.toLocaleString() || "0";
  statsEl.classList.remove("hidden");
}

// ============================================================
// UI EVENT LISTENERS
// ============================================================
document.getElementById("play-btn").addEventListener("click", startGame);
document.getElementById("retry-btn").addEventListener("click", () => {
  uiMotion.hideScreen("gameover");
  resetGame();
  state = GameState.PLAYING;
  playStartTime = Date.now();
  uiMotion.showScreen("hud");
  uiMotion.setPlaying(true);
});
document.getElementById("menu-btn").addEventListener("click", showMenu);
document
  .getElementById("username-input")
  .addEventListener("keydown", (e) => {
    if (e.key === "Enter") startGame();
  });

// ============================================================
// WINDOW RESIZE
// ============================================================
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// GAME LOOP
// ============================================================
let lastTime = performance.now();

function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);

  const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;

  if (state === GameState.PLAYING) {
    updateGame(delta);
  }

  // Idle animation in menu
  if (state === GameState.MENU) {
    const t = currentTime * 0.001;
    camera.position.x = Math.sin(t * 0.5) * 2;
    camera.position.z = Math.cos(t * 0.3) * -CONFIG.CAMERA_DISTANCE;
    camera.lookAt(0, 2, 15);
    atmosphere.update(0, { buildings }); // menu always sits at day (D7)
  }

  // Rotate coins
  coinObjects.forEach((coin) => {
    coin.rotation.z += delta * 3;
  });

  // Bob power-ups
  powerupObjects.forEach((pu) => {
    pu.mesh.position.y = 2 + Math.sin(currentTime * 0.003 + pu.mesh.position.z) * 0.3;
    pu.mesh.rotation.y += delta * 2;
    pu.mesh.rotation.x += delta;
  });

  renderer.render(scene, camera);

  window.__renderStats.calls = renderer.info.render.calls;
  window.__renderStats.fps = window.__renderStats.fps * 0.9 + (1 / delta) * 0.1;
  window.__renderStats.fov = Number(camera.fov.toFixed(1));
  window.__renderStats.camY = camera.position.y;
}

// ============================================================
// INIT
// ============================================================
function init() {
  // Hide loading screen
  setTimeout(() => {
    loadingScreen.classList.add("hidden");
    menuScreen.classList.remove("hidden");
  }, 500);

  // Spawn initial environment
  for (let z = 10; z < 80; z += 6) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const offset = CONFIG.LANE_COUNT * CONFIG.LANE_WIDTH * 0.5 + 3 + Math.random() * 4;
    createBuilding(side * offset, z);
  }

  // Start game loop
  requestAnimationFrame(gameLoop);
}

init();
