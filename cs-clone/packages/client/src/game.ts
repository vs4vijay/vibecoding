import * as THREE from 'three';
import type {
  Vec3, Vec2, PlayerState, GameSnapshot, InputState, Team, MatchState,
  WeaponState, EntityState,
} from '@cs-clone/shared';
import {
  WEAPONS, PLAYER_HEIGHT, PLAYER_RADIUS, DEFAULT_MAP,
  createDefaultWeaponState,
} from '@cs-clone/shared';
import { connect, sendInput, sendRespawn, getPlayerId, setCallbacks2 } from './network.js';
import { initUI } from './ui.js';

// ─── Globals ──────────────────────────────────────────────
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let clock: THREE.Clock;

// Player state (local)
const localPlayer: Partial<PlayerState> = {
  position: { x: 0, y: PLAYER_HEIGHT / 2, z: 0 },
  rotation: { x: 0, y: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  health: 100,
  armor: 100,
  isDead: false,
  isWalking: false,
  primaryWeapon: createDefaultWeaponState('ak47'),
  secondaryWeapon: createDefaultWeaponState('glock'),
  currentWeaponSlot: 'primary',
};

// Remote players (Three.js meshes + state)
const remotePlayers = new Map<string, {
  mesh: THREE.Group;
  state: PlayerState;
}>();

// World entities
const worldMeshes: THREE.Mesh[] = [];

// Game state
let currentSnapshot: GameSnapshot | null = null;
let matchState: MatchState | null = null;
let isPointerLocked = false;

// Input state
const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  walk: false,
  fire: false,
  reload: false,
  weaponSlot: null as 'primary' | 'secondary' | null,
  seq: 0,
};

// Weapon model (visible gun)
let weaponGroup: THREE.Group;

// Minimap context
let minimapCtx: CanvasRenderingContext2D | null = null;

// Kill feed entries
const killFeedEntries: { text: string; time: number }[] = [];

// ─── Initialization ───────────────────────────────────────
export async function initGame(canvas: HTMLCanvasElement) {
  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(DEFAULT_MAP.skyColor);
  scene.fog = new THREE.FogExp2(DEFAULT_MAP.skyColor, 0.008);

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, PLAYER_HEIGHT, 0);

  // Clock
  clock = new THREE.Clock();

  // Setup scene
  setupLighting();
  buildMap();
  createWeaponModel();
  setupInput();
  setupResize();

  // Minimap
  const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
  minimapCtx = minimapCanvas.getContext('2d');

  // Register network callbacks
  setCallbacks2({
    onSnapshot: handleSnapshot,
    onPlayerJoined: handlePlayerJoined,
    onPlayerLeft: handlePlayerLeft,
    onKill: handleKill,
    onDeath: handleDeath,
    onMatchStart: handleMatchStart,
    onMatchEnd: handleMatchEnd,
    onError: console.error,
  });

  // Start render loop
  requestAnimationFrame(renderLoop);
}

function setupLighting(): void {
  const ambient = new THREE.AmbientLight(0xffffff, DEFAULT_MAP.ambientLight);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 80, 30);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.left = -50;
  dirLight.shadow.camera.right = 50;
  dirLight.shadow.camera.top = 50;
  dirLight.shadow.camera.bottom = -50;
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3d2b1f, 0.4);
  scene.add(hemiLight);
}

function buildMap(): void {
  const map = DEFAULT_MAP;
  const entityMaterials: Record<string, THREE.Material> = {
    floor: new THREE.MeshStandardMaterial({
      color: 0xc2b280, // sand color
      roughness: 0.9,
      metalness: 0.1,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: 0xb8a882,
      roughness: 0.8,
      metalness: 0.05,
    }),
    box: new THREE.MeshStandardMaterial({
      color: 0x8b7355,
      roughness: 0.7,
      metalness: 0.1,
    }),
  };

  for (const entity of map.entities) {
    const geometry = new THREE.BoxGeometry(
      entity.size.x,
      entity.size.y,
      entity.size.z
    );
    const material = entityMaterials[entity.type] || entityMaterials.wall;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      entity.position.x,
      entity.position.y,
      entity.position.z
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    worldMeshes.push(mesh);
  }

  // Spawn point markers (invisible, for debugging)
  for (const spawn of map.spawnPoints) {
    const markerGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const markerMat = new THREE.MeshStandardMaterial({
      color: spawn.team === 'T' ? 0xf39c12 : 0x3498db,
      transparent: true,
      opacity: 0.3,
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(spawn.position.x, spawn.position.y, spawn.position.z);
    scene.add(marker);
  }
}

function createWeaponModel(): void {
  weaponGroup = new THREE.Group();

  // Gun body
  const bodyGeo = new THREE.BoxGeometry(0.06, 0.06, 0.45);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.8, roughness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  weaponGroup.add(body);

  // Gun barrel
  const barrelGeo = new THREE.BoxGeometry(0.03, 0.03, 0.3);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.9, roughness: 0.2 });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  barrel.position.set(0, 0.01, -0.35);
  weaponGroup.add(barrel);

  // Magazine
  const magGeo = new THREE.BoxGeometry(0.04, 0.12, 0.06);
  const magMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, metalness: 0.3, roughness: 0.6 });
  const magazine = new THREE.Mesh(magGeo, magMat);
  magazine.position.set(0, -0.08, 0.05);
  weaponGroup.add(magazine);

  // Stock
  const stockGeo = new THREE.BoxGeometry(0.04, 0.08, 0.2);
  const stockMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.8 });
  const stock = new THREE.Mesh(stockGeo, stockMat);
  stock.position.set(0, -0.01, 0.3);
  weaponGroup.add(stock);

  // Position weapon relative to camera
  weaponGroup.position.set(0.25, -0.2, -0.4);
  camera.add(weaponGroup);
  scene.add(camera);
}

// ─── Input Handling ───────────────────────────────────────
function setupInput(): void {
  const canvas = renderer.domElement;

  // Pointer lock on click
  canvas.addEventListener('click', () => {
    if (!isPointerLocked) {
      canvas.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas;
  });

  // Mouse movement
  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked) return;
    const sensitivity = 0.002;
    if (localPlayer.rotation) {
      localPlayer.rotation.x -= e.movementX * sensitivity;
      localPlayer.rotation.y = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, localPlayer.rotation.y - e.movementY * sensitivity)
      );
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': input.forward = true; break;
      case 'KeyS': input.backward = true; break;
      case 'KeyA': input.left = true; break;
      case 'KeyD': input.right = true; break;
      case 'Space': input.jump = true; e.preventDefault(); break;
      case 'ShiftLeft': input.walk = true; break;
      case 'KeyR':
        if (localPlayer.isDead) {
          sendRespawn();
        } else {
          input.reload = true;
        }
        break;
      case 'Digit1': input.weaponSlot = 'primary'; break;
      case 'Digit2': input.weaponSlot = 'secondary'; break;
      case 'Tab':
        e.preventDefault();
        toggleScoreboard();
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': input.forward = false; break;
      case 'KeyS': input.backward = false; break;
      case 'KeyA': input.left = false; break;
      case 'KeyD': input.right = false; break;
      case 'Space': input.jump = false; break;
      case 'ShiftLeft': input.walk = false; break;
      case 'KeyR': input.reload = false; break;
      case 'Tab': toggleScoreboard(); break;
    }
  });

  // Mouse buttons
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.fire = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
  });
}

function setupResize(): void {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ─── Network Handlers ─────────────────────────────────────
function handleSnapshot(snapshot: GameSnapshot): void {
  currentSnapshot = snapshot;
  matchState = snapshot.match;

  // Update local player state from server
  const self = snapshot.players.find(p => p.id === getPlayerId());
  if (self) {
    Object.assign(localPlayer, {
      position: self.position,
      rotation: self.rotation,
      velocity: self.velocity,
      health: self.health,
      armor: self.armor,
      isDead: self.isDead,
      primaryWeapon: self.primaryWeapon,
      secondaryWeapon: self.secondaryWeapon,
      currentWeaponSlot: self.currentWeaponSlot,
    });

    // Update camera
    camera.position.set(
      self.position.x,
      self.position.y + PLAYER_HEIGHT * 0.5,
      self.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.x = self.rotation.x;
    camera.rotation.y = self.rotation.y;
  }

  // Update remote players
  for (const player of snapshot.players) {
    if (player.id === getPlayerId()) continue;
    updateRemotePlayer(player);
  }

  // Remove players that left
  for (const [id] of remotePlayers) {
    if (!snapshot.players.find(p => p.id === id)) {
      removeRemotePlayer(id);
    }
  }

  // Update UI
  updateHUD();
}

function handlePlayerJoined(player: PlayerState): void {
  if (player.id !== getPlayerId()) {
    createRemotePlayer(player);
  }
}

function handlePlayerLeft(playerId: string): void {
  removeRemotePlayer(playerId);
}

function handleKill(killerId: string, victimId: string, weaponName: string): void {
  const killer = currentSnapshot?.players.find(p => p.id === killerId);
  const victim = currentSnapshot?.players.find(p => p.id === victimId);
  if (killer && victim) {
    addKillFeedEntry(`${killer.username} [${weaponName}] ${victim.username}`);
  }
}

function handleDeath(killerId: string, weaponName: string): void {
  const killer = currentSnapshot?.players.find(p => p.id === killerId);
  showDeathScreen(killer?.username || 'Unknown', weaponName);
}

function handleMatchStart(_matchId: string): void {
  addKillFeedEntry('Match started!');
}

function handleMatchEnd(tScore: number, ctScore: number, winner: Team): void {
  addKillFeedEntry(`Match ended! Winner: ${winner} (${tScore}-${ctScore})`);
}

// ─── Remote Player Management ─────────────────────────────
function createRemotePlayer(player: PlayerState): void {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.BoxGeometry(0.6, 1.0, 0.4);
  const bodyColor = player.team === 'T' ? 0xf39c12 : 0x3498db;
  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.5;
  group.add(body);

  // Head
  const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffd59a });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.1;
  group.add(head);

  // Legs
  const legGeo = new THREE.BoxGeometry(0.2, 0.5, 0.25);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.15, 0.0, 0);
  group.add(leftLeg);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.15, 0.0, 0);
  group.add(rightLeg);

  // Weapon
  const gunGeo = new THREE.BoxGeometry(0.05, 0.05, 0.5);
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0.3, 0.7, -0.3);
  group.add(gun);

  group.position.set(player.position.x, player.position.y - PLAYER_HEIGHT / 2, player.position.z);
  scene.add(group);

  remotePlayers.set(player.id, { mesh: group, state: player });
}

function updateRemotePlayer(player: PlayerState): void {
  const remote = remotePlayers.get(player.id);
  if (!remote) {
    createRemotePlayer(player);
    return;
  }

  const { mesh, state } = remote;

  // Smooth position update
  mesh.position.set(
    player.position.x,
    player.position.y - PLAYER_HEIGHT / 2,
    player.position.z
  );

  // Update rotation (facing direction)
  mesh.rotation.y = player.rotation.x;

  // Update color based on health
  const bodyMesh = mesh.children[0] as THREE.Mesh;
  const baseColor = player.team === 'T' ? new THREE.Color(0xf39c12) : new THREE.Color(0x3498db);
  const healthRatio = player.health / 100;
  if (player.isDead) {
    bodyMesh.material = new THREE.MeshStandardMaterial({
      color: 0x333333,
      transparent: true,
      opacity: 0.5,
    });
    mesh.rotation.y += Math.PI / 2; // Lay down
    mesh.position.y = player.position.y - PLAYER_HEIGHT + 0.3;
  } else {
    bodyMesh.material = new THREE.MeshStandardMaterial({
      color: baseColor.clone().lerp(new THREE.Color(0xff0000), (1 - healthRatio) * 0.3),
    });
  }

  // Update team color if changed
  if (state.team !== player.team) {
    state.team = player.team;
  }
}

function removeRemotePlayer(playerId: string): void {
  const remote = remotePlayers.get(playerId);
  if (remote) {
    scene.remove(remote.mesh);
    remotePlayers.delete(playerId);
  }
}

// ─── UI Updates ───────────────────────────────────────────
function updateHUD(): void {
  initUI({
    health: localPlayer.health ?? 100,
    armor: localPlayer.armor ?? 100,
    isDead: localPlayer.isDead ?? false,
    currentWeapon: localPlayer.currentWeaponSlot === 'primary'
      ? localPlayer.primaryWeapon ?? null
      : localPlayer.secondaryWeapon ?? null,
    matchState,
    playerCount: currentSnapshot?.players.length ?? 0,
    playerTeam: localPlayer.team ?? null,
  });

  // Update minimap
  drawMinimap();

  // Update weapon model
  updateWeaponModel();
}

function updateWeaponModel(): void {
  if (!weaponGroup) return;

  const weapon = localPlayer.currentWeaponSlot === 'primary'
    ? localPlayer.primaryWeapon
    : localPlayer.secondaryWeapon;

  if (!weapon) return;

  const weaponType = WEAPONS[weapon.typeId];
  if (!weaponType) return;

  // Change color based on weapon type
  const bodyMesh = weaponGroup.children[0] as THREE.Mesh;
  if (weaponType.id === 'glock') {
    bodyMesh.scale.set(0.6, 0.6, 0.6);
  } else {
    bodyMesh.scale.set(1, 1, 1);
  }

  // Recoil animation
  const timeSinceFire = Date.now() - weapon.lastFireTime;
  if (timeSinceFire < 100) {
    weaponGroup.position.z = -0.4 + (1 - timeSinceFire / 100) * 0.05;
    weaponGroup.rotation.x = (1 - timeSinceFire / 100) * 0.1;
  } else {
    weaponGroup.position.z = -0.4;
    weaponGroup.rotation.x = 0;
  }

  // Reload animation
  if (weapon.isReloading) {
    const elapsed = Date.now() - weapon.reloadStartTime;
    const progress = Math.min(elapsed / weaponType.reloadTime, 1);
    weaponGroup.position.y = -0.2 - Math.sin(progress * Math.PI) * 0.3;
  } else {
    weaponGroup.position.y = -0.2;
  }
}

function drawMinimap(): void {
  if (!minimapCtx || !currentSnapshot) return;

  const ctx = minimapCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const scale = 2.5;

  // Clear
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, w, h);

  // Draw walls
  ctx.fillStyle = 'rgba(100, 100, 100, 0.8)';
  for (const entity of currentSnapshot.entities) {
    if (entity.type === 'wall' || entity.type === 'box') {
      const cx = w / 2 + (entity.position.x - (localPlayer.position?.x || 0)) * scale;
      const cy = h / 2 + (entity.position.z - (localPlayer.position?.z || 0)) * scale;
      ctx.fillRect(
        cx - entity.size.x * scale / 2,
        cy - entity.size.z * scale / 2,
        entity.size.x * scale,
        entity.size.z * scale
      );
    }
  }

  // Draw players
  for (const player of currentSnapshot.players) {
    if (player.isDead) continue;
    const cx = w / 2 + (player.position.x - (localPlayer.position?.x || 0)) * scale;
    const cy = h / 2 + (player.position.z - (localPlayer.position?.z || 0)) * scale;

    if (cx < 0 || cx > w || cy < 0 || cy > h) continue;

    ctx.beginPath();
    ctx.arc(cx, cy, player.id === getPlayerId() ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = player.team === 'T' ? '#f39c12' : '#3498db';
    ctx.fill();

    // Draw direction indicator for local player
    if (player.id === getPlayerId()) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx - Math.sin(localPlayer.rotation?.x || 0) * 8,
        cy - Math.cos(localPlayer.rotation?.x || 0) * 8
      );
      ctx.stroke();
    }
  }
}

function addKillFeedEntry(text: string): void {
  killFeedEntries.push({ text, time: Date.now() });
  if (killFeedEntries.length > 8) killFeedEntries.shift();

  const feed = document.getElementById('kill-feed');
  if (!feed) return;

  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.textContent = text;
  feed.appendChild(entry);

  setTimeout(() => {
    feed.removeChild(entry);
  }, 4000);
}

function showDeathScreen(killerName: string, weaponName: string): void {
  const screen = document.getElementById('deathScreen');
  if (!screen) return;

  screen.classList.remove('hidden');
  document.getElementById('killerName')!.textContent = `Killed by ${killerName} [${weaponName}]`;

  document.exitPointerLock();
}

function toggleScoreboard(): void {
  const board = document.getElementById('scoreboard');
  if (!board) return;

  if (board.classList.contains('hidden')) {
    board.classList.remove('hidden');
    updateScoreboard();
  } else {
    board.classList.add('hidden');
  }
}

function updateScoreboard(): void {
  if (!currentSnapshot) return;
  const tbody = document.getElementById('scoreboardBody');
  if (!tbody) return;

  const players = currentSnapshot.players.map(p => ({
    name: p.username,
    team: p.team,
    kills: 0, // Would need server-side tracking
    deaths: 0,
    score: p.health,
  }));

  players.sort((a, b) => b.score - a.score);

  tbody.innerHTML = players.map(p => `
    <tr>
      <td style="color: ${p.team === 'T' ? '#f39c12' : '#3498db'}">${p.name}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${p.score}</td>
    </tr>
  `).join('');
}

// ─── Game Loop ────────────────────────────────────────────
function renderLoop(): void {
  requestAnimationFrame(renderLoop);

  const dt = Math.min(clock.getDelta(), 0.05);

  // Send input to server
  if (isPointerLocked && getPlayerId() && !localPlayer.isDead) {
    input.seq++;
    const inputState: InputState = {
      ...input,
      yaw: localPlayer.rotation?.x || 0,
      pitch: localPlayer.rotation?.y || 0,
      seq: input.seq,
      timestamp: Date.now(),
    };
    sendInput(inputState);
  }

  // Update minimap periodically
  drawMinimap();

  // Render
  renderer.render(scene, camera);
}

// ─── Public API ───────────────────────────────────────────
export async function connectAndPlay(username: string, team: Team): Promise<void> {
  await connect(username, team);

  // Show HUD, hide login
  document.getElementById('loginScreen')?.classList.add('hidden');
  document.getElementById('hud')?.classList.remove('hidden');
}

export function getLocalPlayer(): Partial<PlayerState> {
  return localPlayer;
}
