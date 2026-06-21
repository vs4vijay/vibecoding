import { describe, it, expect, afterAll } from 'bun:test';
import { resolve } from 'path';

const __dirname = import.meta.dir;

// ─── Start server ────────────────────────────────────────
const TEST_PORT = 3099;
const serverProcess = Bun.spawn(
  ['bun', 'run', resolve(__dirname, 'packages/server/src/index.ts')],
  { cwd: __dirname, env: { ...process.env, SERVER_PORT: String(TEST_PORT) } }
);

await new Promise<void>(r => {
  const reader = serverProcess.stdout.pipeThrough(new TextDecoderStream()).getReader();
  (async () => {
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += value;
      if (buf.includes('CS Clone Server running')) { r(); break; }
    }
  })();
  setTimeout(r, 5000);
});

afterAll(() => serverProcess.kill());

// ─── Helpers ─────────────────────────────────────────────
async function joinGame(username: string, team: 'T' | 'CT'): Promise<{ ws: WebSocket; playerId: string; initialSnapshot: any }> {
  const ws = new WebSocket(`ws://localhost:${TEST_PORT}/ws`);
  const joined = new Promise<{ playerId: string; initialSnapshot: any }>((res, rej) => {
    ws.onmessage = msg => { const d = JSON.parse(msg.data); if (d.type === 'joined') res({ playerId: d.playerId, initialSnapshot: d.snapshot }); };
    setTimeout(() => rej(new Error(`${username} join timeout`)), 5000);
  });
  return new Promise((res, rej) => {
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', username, team })); joined.then(res).catch(rej); };
    ws.onerror = rej;
  }).then(r => ({ ws, playerId: r.playerId, initialSnapshot: r.initialSnapshot }));
}

async function captureSnapshots(ws: WebSocket, count: number): Promise<any[]> {
  return new Promise((res, rej) => {
    const snaps: any[] = [];
    const handler = (msg: MessageEvent) => {
      const d = JSON.parse(msg.data);
      if (d.type === 'snapshot') { snaps.push(d.snapshot); if (snaps.length >= count) { ws.removeEventListener('message', handler); res(snaps); } }
    };
    ws.addEventListener('message', handler);
    setTimeout(() => rej(new Error('Snapshot timeout')), 5000);
  });
}

// ─── Integration Tests ───────────────────────────────────

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.ok).toBe(true);
    expect((await res.json()).status).toBe('ok');
  });
});

describe('Player Join & Snapshot', () => {
  it('single player joins and gets valid snapshot', async () => {
    const { ws, playerId, initialSnapshot } = await joinGame('SoloBot', 'T');
    expect(playerId).toMatch(/^p_\d+$/);
    expect(initialSnapshot.tick).toBeGreaterThan(0);
    expect(initialSnapshot.players.length).toBeGreaterThanOrEqual(1);
    expect(initialSnapshot.entities.length).toBeGreaterThan(0);
    expect(initialSnapshot.match.mapName).toBe('de_dust');
    const me = initialSnapshot.players.find((p: any) => p.id === playerId);
    expect(me.username).toBe('SoloBot');
    expect(me.team).toBe('T');
    expect(me.health).toBe(100);
    expect(me.armor).toBe(100);
    expect(me.primaryWeapon.typeId).toBe('ak47');
    expect(me.secondaryWeapon.typeId).toBe('glock');
    ws.close();
    await new Promise(r => setTimeout(r, 200));
  });

  it('two players join and see each other', async () => {
    const p1 = await joinGame('Alpha', 'T');
    const p2 = await joinGame('Bravo', 'CT');
    expect(p1.playerId).not.toBe(p2.playerId);
    const snapshots = await captureSnapshots(p1.ws, 3);
    for (const snap of snapshots) {
      const ids = snap.players.map((p: any) => p.id);
      expect(ids).toContain(p1.playerId);
      expect(ids).toContain(p2.playerId);
    }
    p1.ws.close();
    p2.ws.close();
    await new Promise(r => setTimeout(r, 300));
  });

  it('three players, two teams', async () => {
    const p1 = await joinGame('CT1', 'CT');
    const p2 = await joinGame('T1', 'T');
    const p3 = await joinGame('CT2', 'CT');
    const [snap] = await captureSnapshots(p1.ws, 1);
    expect(snap.players.length).toBeGreaterThanOrEqual(3);
    const teams = snap.players.map((p: any) => p.team);
    expect(teams).toContain('CT');
    expect(teams).toContain('T');
    p1.ws.close();
    p2.ws.close();
    p3.ws.close();
    await new Promise(r => setTimeout(r, 300));
  });
});

describe('Input & Movement', () => {
  it('player moves forward when sending input', async () => {
    const { ws, playerId } = await joinGame('Mover', 'T');
    const [initSnap] = await captureSnapshots(ws, 1);
    const initPos = initSnap.players.find((p: any) => p.id === playerId)!.position;
    let seq = 0;
    for (let i = 0; i < 10; i++) {
      seq++;
      ws.send(JSON.stringify({ type: 'input', data: { forward: true, backward: false, left: false, right: false, jump: false, walk: false, fire: false, reload: false, weaponSlot: null, yaw: 0, pitch: 0, seq, timestamp: Date.now() } }));
    }
    await new Promise(r => setTimeout(r, 300));
    const [movedSnap] = await captureSnapshots(ws, 1);
    const newPos = movedSnap.players.find((p: any) => p.id === playerId)!.position;
    const dx = newPos.x - initPos.x;
    const dz = newPos.z - initPos.z;
    expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(0.01);
    ws.close();
    await new Promise(r => setTimeout(r, 200));
  });
});

describe('Disconnect & Reconnect', () => {
  it('graceful disconnect then reconnect', async () => {
    const { ws } = await joinGame('Flaky1', 'T');
    ws.close();
    await new Promise(r => setTimeout(r, 500));
    const { ws: ws2, playerId } = await joinGame('Flaky2', 'T');
    expect(playerId).toMatch(/^p_\d+$/);
    ws2.close();
    await new Promise(r => setTimeout(r, 200));
  });
});

// ─── Unit Tests ──────────────────────────────────────────

describe('Game Engine', () => {
  it('createGameState + addPlayer + tick', async () => {
    const engine = await import('./packages/server/src/game/engine.ts');
    const gs = engine.createGameState();
    const player = engine.addPlayer(gs, 'UnitTest', 'T');
    expect(player.health).toBe(100);
    expect(player.team).toBe('T');
    const snap = engine.tick(gs);
    expect(snap).toBeDefined();
    expect(snap!.tick).toBe(1);
    expect(snap!.players.length).toBe(1);
  });

  it('multiple ticks increment counter', async () => {
    const engine = await import('./packages/server/src/game/engine.ts');
    const gs = engine.createGameState();
    engine.addPlayer(gs, 'Tiker', 'T');
    let snapCount = 0;
    for (let i = 0; i < 10; i++) {
      const snap = engine.tick(gs);
      if (snap) snapCount++;
    }
    // Snapshots emitted every 2 ticks, so ~5 of 10
    expect(snapCount).toBeGreaterThan(0);
    expect(gs.tick).toBe(10);
  });

  it('damagePlayer reduces health (accounts for armor absorption)', async () => {
    const engine = await import('./packages/server/src/game/engine.ts');
    const playerMod = await import('./packages/server/src/game/player.ts');
    const gs = engine.createGameState();
    const p = engine.addPlayer(gs, 'Tank', 'T');
    expect(p.health).toBe(100);
    expect(p.armor).toBe(100);

    // Damage with armor: armor absorbs 66%, rest hits health
    playerMod.damagePlayer(p, 25);
    // Armor absorbs min(100, 25*0.66=16.5) = 16.5, actual damage = 8.5
    expect(p.health).toBeCloseTo(91.5, 1);
    expect(p.armor).toBeCloseTo(83.5, 1);

    // Massive damage to kill (armor absorbs 66%, remaining hits health)
    playerMod.damagePlayer(p, 100);
    expect(p.health).toBeCloseTo(57.5, 1); // 91.5 - (100 - min(83.5, 66)) = 57.5

    // Enough damage to actually kill
    playerMod.damagePlayer(p, 200);
    expect(p.health).toBe(0);
    expect(p.isDead).toBe(true);
  });
});

describe('Collision & Raycast', () => {
  it('intersectRayAABB hits a box', async () => {
    const collision = await import('./packages/server/src/game/collision.ts');
    const box = collision.entityToAABB({ type: 'box', position: { x: 5, y: 1, z: 0 }, size: { x: 2, y: 2, z: 2 } });
    const result = collision.intersectRayAABB({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box);
    expect(result).toBeDefined();
    expect(result!.t).toBeGreaterThan(0);
  });

  it('intersectRayAABB misses when above box', async () => {
    const collision = await import('./packages/server/src/game/collision.ts');
    const box = collision.entityToAABB({ type: 'box', position: { x: 5, y: 1, z: 0 }, size: { x: 2, y: 2, z: 2 } });
    expect(collision.intersectRayAABB({ x: 0, y: 10, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBeNull();
  });

  it('intersectAABB detects overlap', async () => {
    const collision = await import('./packages/server/src/game/collision.ts');
    const a = collision.entityToAABB({ type: 'box', position: { x: 1, y: 1, z: 1 }, size: { x: 2, y: 2, z: 2 } });
    const b = collision.entityToAABB({ type: 'box', position: { x: 2, y: 2, z: 2 }, size: { x: 2, y: 2, z: 2 } });
    expect(collision.intersectAABB(a, b)).toBe(true);
    const c = collision.entityToAABB({ type: 'box', position: { x: 10, y: 10, z: 10 }, size: { x: 1, y: 1, z: 1 } });
    expect(collision.intersectAABB(a, c)).toBe(false);
  });
});

describe('Weapon System', () => {
  it('canFire respects fire rate', async () => {
    const weaponMod = await import('./packages/server/src/game/weapon.ts');
    const engine = await import('./packages/server/src/game/engine.ts');
    const gs = engine.createGameState();
    const p = engine.addPlayer(gs, 'Shooter', 'T');
    expect(weaponMod.canFire(p.primaryWeapon, Date.now())).toBe(true);
    const now = Date.now();
    const result = weaponMod.fireWeapon(p.primaryWeapon, p, now);
    expect(result).toBeDefined();
    expect(result!.direction).toBeDefined();
    expect(weaponMod.canFire(p.primaryWeapon, now + 1)).toBe(false);
  });

  it('fireWeapon decrements ammo', async () => {
    const weaponMod = await import('./packages/server/src/game/weapon.ts');
    const engine = await import('./packages/server/src/game/engine.ts');
    const gs = engine.createGameState();
    const p = engine.addPlayer(gs, 'AmmoTest', 'T');
    const initialMag = p.primaryWeapon.ammoInMagazine;
    const now = Date.now();
    // AK-47 fireRate = 100ms, fire with 200ms spacing
    for (let i = 0; i < 3; i++) {
      weaponMod.fireWeapon(p.primaryWeapon, p, now + i * 200);
    }
    expect(p.primaryWeapon.ammoInMagazine).toBe(initialMag - 3);
  });

  it('reload refills magazine', async () => {
    const weaponMod = await import('./packages/server/src/game/weapon.ts');
    const engine = await import('./packages/server/src/game/engine.ts');
    const { WEAPONS } = await import('./packages/shared/src/constants.ts');
    const gs = engine.createGameState();
    const p = engine.addPlayer(gs, 'ReloadTest', 'T');
    const ak47 = WEAPONS['ak47'];
    // Fire all rounds (30 in mag, with fireRate spacing of 100ms)
    const now = Date.now();
    let fired = 0;
    for (let i = 0; i < ak47.magazineSize; i++) {
      const result = weaponMod.fireWeapon(p.primaryWeapon, p, now + i * 101);
      if (result) fired++;
    }
    expect(p.primaryWeapon.ammoInMagazine).toBe(0);

    // Start reload
    expect(weaponMod.startReload(p.primaryWeapon, now)).toBe(true);
    expect(p.primaryWeapon.isReloading).toBe(true);

    // Finish reload
    const reloadTime = ak47.reloadTime;
    expect(weaponMod.finishReload(p.primaryWeapon, now + reloadTime + 1)).toBe(true);
    expect(p.primaryWeapon.isReloading).toBe(false);
    expect(p.primaryWeapon.ammoInMagazine).toBeGreaterThan(0);
  });
});

describe('Shared Types & Config', () => {
  it('shared exports are correct', async () => {
    const shared = await import('./packages/shared/src/index.ts');
    expect(shared.PLAYER_HEIGHT).toBe(1.8);
    expect(shared.PLAYER_RADIUS).toBe(0.3);
    expect(shared.PLAYER_GRAVITY).toBe(20);
    expect(shared.PLAYER_JUMP_FORCE).toBe(8);
    expect(shared.WEAPONS).toBeDefined();
    expect(shared.DEFAULT_MAP).toBeDefined();
    expect(typeof shared.createDefaultWeaponState).toBe('function');
    expect(shared.WEAPONS['ak47'].damage).toBe(36);
    expect(shared.WEAPONS['glock'].name).toBe('Glock-18');
  });

  it('map has valid spawn points', async () => {
    const shared = await import('./packages/shared/src/index.ts');
    const map = shared.DEFAULT_MAP;
    expect(map.spawnPoints.filter(s => s.team === 'T').length).toBeGreaterThan(0);
    expect(map.spawnPoints.filter(s => s.team === 'CT').length).toBeGreaterThan(0);
    expect(map.entities.length).toBeGreaterThan(0);
  });

  it('server config validates', async () => {
    const config = await import('./packages/server/src/config.ts');
    expect(config.default.serverPort).toBeGreaterThan(0);
    expect(config.default.maxPlayers).toBeGreaterThan(0);
    expect(config.default.tickRate).toBeGreaterThan(0);
    expect(typeof config.default.serverHost).toBe('string');
  });
});

describe('PWA & Build Artifacts', () => {
  it('PWA manifest is valid', async () => {
    const fs = await import('fs');
    const manifest = JSON.parse(fs.readFileSync(resolve(__dirname, 'packages/client/manifest.json'), 'utf-8'));
    expect(manifest.name).toBeDefined();
    expect(manifest.short_name).toBeDefined();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('fullscreen');
    expect(Array.isArray(manifest.icons)).toBe(true);
  });

  it('client dist contains PWA files', async () => {
    const fs = await import('fs/promises');
    const files = await fs.readdir(resolve(__dirname, 'packages/client/dist'));
    expect(files).toContain('index.html');
    expect(files).toContain('sw.js');
    expect(files).toContain('manifest.webmanifest');
    expect(files.some(f => f.startsWith('workbox'))).toBe(true);
  });

  it('index.html has all HUD elements', async () => {
    const fs = await import('fs');
    const html = fs.readFileSync(resolve(__dirname, 'packages/client/index.html'), 'utf-8');
    for (const id of ['gameCanvas', 'healthValue', 'armorValue', 'weaponName', 'kill-feed', 'minimap', 'scoreboard', 'deathScreen', 'loginScreen']) {
      expect(html).toContain(id);
    }
  });
});
