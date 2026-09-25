// Beauty-frustum vs chunk-1 seed-1 placement simulation (round-6 item 4).
// Reproduces the EXACT chunk build (rngFor(seed, TAG.convoy=3, index)) with a
// stubbed window/lib, then ray-tests the staged beauty camera's bottom-right
// corner region against every instance's world AABB.
globalThis.window = { location: { search: "" } };
const THREE = await import("three");
const { CONFIG } = await import("/workspace/endless/js/core/config.js");
const { rngFor } = await import("/workspace/endless/js/core/rng.js");
const { registerWorldChunks } = await import("/workspace/endless/js/world/chunks.js");

const matKeys = [];
const lib = {
  get: (k) => { matKeys.push(k); return { name: k }; },
  canvas: () => null,
};
const factories = {};
const world = { registerChunkType: (n, f) => { factories[n] = f; } };
registerWorldChunks(world, lib, 1);

const SEED = 1, INDEX = 1, GZ = INDEX * CONFIG.CHUNK_LEN;
const TAG = { plain: 1, wreck: 2, convoy: 3 };
const group = factories.convoy(rngFor(SEED, TAG.convoy, INDEX), { index: INDEX, zStart: GZ });
group.position.z = GZ;

// ---- collect instance world AABBs ------------------------------------------
const entries = [];
group.traverse((o) => {
  if (!o.isMesh && !o.isInstancedMesh) return;
  const geo = o.geometry;
  geo.computeBoundingBox();
  const label = o.name || (Array.isArray(o.material) ? o.material.map((m) => m.name || "?").join("+") : o.material?.name) || "mesh";
  const kind = o.geometry === geo ? geo.type : "?";
  if (o.isInstancedMesh) {
    const m = new THREE.Matrix4();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      entries.push({ label: `${label}[${i}]`, geoType: geo.type, bb: geo.boundingBox, m: m.clone() });
    }
  } else {
    entries.push({ label, geoType: geo.type, bb: geo.boundingBox, m: o.matrixWorld });
  }
});
group.updateMatrixWorld(true);

// world AABB per entry (group offset folded in via matrix translation? the
// instance matrices are group-local, so add GZ to z afterwards)
const aabbs = entries.map((e) => {
  const bb = e.bb, pts = [];
  for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) for (let cz = 0; cz < 2; cz++) {
    pts.push(new THREE.Vector3(cx ? bb.max.x : bb.min.x, cy ? bb.max.y : bb.min.y, cz ? bb.max.z : bb.min.z).applyMatrix4(e.m));
  }
  const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9);
  for (const p of pts) { mn.min(p); mx.max(p); }
  mn.z += GZ; mx.z += GZ;
  return { ...e, mn, mx };
});

// ---- beauty camera ----------------------------------------------------------
const S = CONFIG.STAGED_BEAUTY;
const cam = new THREE.PerspectiveCamera(S.fov, 1600 / 900, 0.3, 1600);
cam.position.set(...S.pos);
cam.lookAt(...S.look);
cam.updateMatrixWorld(true);
cam.updateProjectionMatrix();

// slab ray-AABB
function rayHits(rOrigin, rDir, mn, mx) {
  let t0 = 0.3, t1 = 1e4;
  for (const ax of ["x", "y", "z"]) {
    const inv = 1 / rDir[ax];
    let ta = (mn[ax] - rOrigin[ax]) * inv, tb = (mx[ax] - rOrigin[ax]) * inv;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

// sample the bottom-right corner region (and edges) in NDC
const hits = new Map();
const samples = [];
for (let ix = 0; ix <= 12; ix++) {
  for (let iy = 0; iy <= 12; iy++) {
    const nx = 0.45 + (ix / 12) * 0.55; // 0.45 .. 1.0
    const ny = -0.45 - (iy / 12) * 0.55; // -0.45 .. -1.0
    samples.push([nx, ny]);
    const v = new THREE.Vector3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize();
    for (const a of aabbs) {
      const t = rayHits(cam.position, v, a.mn, a.mx);
      if (t !== null) {
        const key = a.label;
        if (!hits.has(key)) hits.set(key, { n: 0, tMin: t, mn: a.mn, mx: a.mx, geoType: a.geoType });
        hits.get(key).n++;
        hits.get(key).tMin = Math.min(hits.get(key).tMin, t);
      }
    }
  }
}

console.log("=== instances intersecting the bottom-right corner region (NDC x .45..1, y -.45..-1) ===");
for (const [k, h] of [...hits.entries()].sort((a, b) => b[1].n - a[1].n)) {
  const c = h.mn.clone().add(h.mx).multiplyScalar(0.5);
  console.log(`${h.n.toString().padStart(3)} samples  t=${h.tMin.toFixed(1)}m  center=(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})  ${h.geoType}  ${k}`);
}

// ---- full placement dump: vehicles + wheels --------------------------------

// ---- detached-wheel identification + sway-extreme corner tests --------------
const cfgWheels = CONFIG.WRECKS.convoy.wheels;
const totalWheels = aabbs.filter((a) => a.label.startsWith("rubber")).length;
console.log(`\n=== detached wheels (last ${cfgWheels} of ${totalWheels}) ===`);
const ndcExt = (mn, mx) => {
  const cs = [];
  for (let cx = 0; cx < 2; cx++) for (let cy = 0; cy < 2; cy++) for (let cz = 0; cz < 2; cz++) {
    cs.push(new THREE.Vector3(cx ? mx.x : mn.x, cy ? mx.y : mn.y, cz ? mx.z : mn.z).project(cam));
  }
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  return `NDC x ${Math.min(...xs).toFixed(2)}..${Math.max(...xs).toFixed(2)}  y ${Math.min(...ys).toFixed(2)}..${Math.max(...ys).toFixed(2)}`;
};
for (const a of aabbs) {
  if (!a.label.startsWith("rubber")) continue;
  const idx = parseInt(a.label.split("+")[2] || a.label.match(/\[(\d+)\]$/)[1], 10);
  if (idx < totalWheels - cfgWheels) continue;
  console.log(`${a.label}  ${ndcExt(a.mn, a.mx)}  center=(${a.mn.clone().add(a.mx).multiplyScalar(0.5).toArray().map((v) => v.toFixed(2)).join(", ")})`);
}
// sway extremes: main.js outPos.x = S.pos[0] + sin(t*0.1)*0.12, bob y +-0.04
for (const sway of [-0.12, 0.12]) {
  for (const bob of [-0.04, 0.04]) {
    const c2 = new THREE.PerspectiveCamera(S.fov, 1600 / 900, 0.3, 1600);
    c2.position.set(S.pos[0] + sway, S.pos[1] + bob, S.pos[2]);
    c2.lookAt(...S.look);
    c2.updateMatrixWorld(true);
    c2.updateProjectionMatrix();
    const corner = new THREE.Vector3(1, -1, 0.5).unproject(c2).sub(c2.position).normalize();
    console.log(`sway ${sway} bob ${bob}: BR-corner ray ground hit x=${(c2.position.x + corner.x * (c2.position.y / -corner.y)).toFixed(2)} z=${(c2.position.z + corner.z * (c2.position.y / -corner.y)).toFixed(2)}`);
    // which detached wheels does the corner ray region (NDC 0.85..1.05, -0.5..-1.05) touch?
    for (const a of aabbs) {
      if (!a.label.startsWith("rubber")) continue;
      const idx = parseInt(a.label.match(/\[(\d+)\]$/)[1], 10);
      if (idx < totalWheels - cfgWheels) continue;
      let n = 0;
      for (let ix = 0; ix <= 6; ix++) for (let iy = 0; iy <= 6; iy++) {
        const nx = 0.85 + (ix / 6) * 0.2, ny = -0.5 - (iy / 6) * 0.55;
        const v = new THREE.Vector3(nx, ny, 0.5).unproject(c2).sub(c2.position).normalize();
        if (rayHits(c2.position, v, a.mn, a.mx) !== null) n++;
      }
      if (n) console.log(`  sway ${sway}: ${a.label} hits ${n}/49 corner samples`);
    }
  }
}
console.log("\n=== all wheel instances (screen NDC of center) ===");
const ndcOf = (p) => {
  const v = p.clone().project(cam);
  return `x=${v.x.toFixed(2)} y=${v.y.toFixed(2)} ${v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05 ? "OUT" : "in "}`;
};
for (const a of aabbs) {
  const c = a.mn.clone().add(a.mx).multiplyScalar(0.5);
  if (a.label.startsWith("rubber") || a.label.startsWith("contactShadow") || a.label.startsWith("charred[")) {
    console.log(`${ndcOf(c)}  center=(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})  size=(${(a.mx.x - a.mn.x).toFixed(2)}, ${(a.mx.y - a.mn.y).toFixed(2)}, ${(a.mx.z - a.mn.z).toFixed(2)})  ${a.label}`);
  }
}
console.log("\n=== vehicle hulls ===");
for (const a of aabbs) {
  const c = a.mn.clone().add(a.mx).multiplyScalar(0.5);
  if (/^wreck(White|Red|Teal)/.test(a.label)) {
    console.log(`${ndcOf(c)}  center=(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})  ${a.label}`);
  }
}
console.log("\n=== shamblers ===", JSON.stringify(group.userData.shamblers || null));
console.log("=== materials used ===", matKeys.join(","));
