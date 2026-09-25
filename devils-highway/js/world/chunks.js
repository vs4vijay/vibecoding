/**
 * @file world/chunks.js
 * Chunk builders composing the endless desert interstate: road furniture,
 * scrub/rock/mesa dressing and the wrecked evacuation convoy (the hero set
 * piece). Everything shares a small library of merged, instanced archetype
 * geometries. Static dressing (rails/posts/lights/scrub/rocks/mesas/signs/
 * wheels/debris/contact shadows/night lamp kit) streams through ONE
 * world-owned InstancedMesh per material group (createDressingPool), so
 * dressing costs a flat handful of draws regardless of chunk count; vehicle
 * hulls stay per-chunk instanced meshes (paint-variant bucketing).
 *
 * Placement invariants (QA cameras + menu dolly depend on them):
 *  - the corridor |x| < CONFIG.CORRIDOR_CLEAR stays free at all z;
 *  - children use local z in [0, CHUNK_LEN); group sits at z = zStart;
 *  - gameplay builds (factory ctx gameplay flag, design 4) shift wreck
 *    hulls to the shoulders: the 3-lane corridor (|x| < 5.1) stays free of
 *    dressing vehicles; attract builds are byte-identical (same rng stream,
 *    only x shifted).
 */
import * as THREE from "three";
import { CONFIG } from "../core/config.js";

// Small math helpers (boot-time placement only).
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const wrapN = (n, p) => ((n % p) + p) % p;
const srgbLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Build-time time-of-day gate for the night light kit (QA contract: the only
// night path is ?time=night; dusk and ?time=<seconds> both stay dusk). Time
// of day never changes mid-session, so chunk builders may bake it in.
const NIGHT = new URLSearchParams(window.location.search).get("time") === "night";

// Shambler dressing (round-6 hero subject — the menu/attract frame's focal
// figure). Tunables colocate here because config.js is frozen for this
// slice; every value is metres / seconds / m/s. Placement band is lateral
// distance from the road centreline: lane edges sit at ±5.1, guardrail at
// ±6.55, so [xMin, xMax] keeps figures on the shoulder/verge and every
// pacing excursion stays clear of the lanes (and CORRIDOR_CLEAR = 1.55).
const SHAMBLER = {
  maxInstances: 32, // worst case: 10 active chunks x 3 + night lamp extras
  count: { plain: [1, 2], wreck: [1, 2], convoy: [2, 3] },
  xMin: 5.7, xMax: 9.5, // lateral band per side (straddles guardrail line)
  roadEdge: 5.6, // pacing excursions never carry a figure inside this
  speed: [0.4, 0.7], // peak pacing speed m/s (sinusoid avg ~0.64x — zombie)
  amp: [3, 6], // pacing excursion along the drift path, m
  acrossChance: 0.35, // rest pace along the shoulder
  bobY: 0.03, bobHz: 1.6, roll: 0.035, // shamble bob + weight-shift roll
  // Authored chunk-1 focal figure: right shoulder, world z 46-53 = 26-33 m
  // ahead of the menu dolly start (z 20) — inside the 15-35 m window, clear
  // of the bus (left flank) and the trailer/cab cluster (z >= 62).
  hero: { x: [6.8, 7.6], z: [6, 13] },
  nearZMin: 32.5, // chunk-0 figures start at world z >= this: distance from
  // the menu camera (0, 2.35, 20) >= sqrt(12.5^2 + 5.7^2) = 13.7 m — the
  // 12 m near-camera rule for the menu/attract opening frame.
};

// ---------------------------------------------------------------
// Merged-geometry helper (boot-time only; not a hot path)
// ---------------------------------------------------------------
const _m4 = new THREE.Matrix4();
const _eu = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _vec = new THREE.Vector3();
const _scl = new THREE.Vector3();

/**
 * Concatenate transformed BoxGeometry-style parts into one non-indexed
 * geometry with material groups. parts: { g, mat, x,y,z, rx,ry,rz, sx,sy,sz }.
 */
function mergeParts(parts) {
  const pos = [], nor = [], uv = [];
  let vOff = 0;
  for (const p of parts) {
    const g = (p.g.index ? p.g.toNonIndexed() : p.g).clone();
    _eu.set(p.rx || 0, p.ry || 0, p.rz || 0);
    _quat.setFromEuler(_eu);
    _vec.set(p.x || 0, p.y || 0, p.z || 0);
    _scl.set(p.sx || 1, p.sy || 1, p.sz || 1);
    _m4.compose(_vec, _quat, _scl);
    g.applyMatrix4(_m4);
    const pa = g.attributes.position.array;
    const na = g.attributes.normal.array;
    const ua = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < pa.length; i++) {
      pos.push(pa[i]);
      nor.push(na[i]);
    }
    const uvCount = (pa.length / 3) * 2;
    if (ua) for (let i = 0; i < uvCount; i++) uv.push(ua[i]);
    else for (let i = 0; i < uvCount; i++) uv.push(0);
    g.dispose();
    const count = pa.length / 3;
    const matIndex = p.mat || 0;
    // Group per part (three merges draws per materialIndex automatically).
    p._group = { start: vOff, count, materialIndex: matIndex };
    vOff += count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  for (const p of parts) geo.addGroup(p._group.start, p._group.count, p._group.materialIndex);
  return geo;
}

const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s, 1);

/**
 * Clustered scatter (CONFIG.SCATTER): a few patch centres per chunk plus
 * strays, so dressing gathers in drifts instead of uniform confetti. The
 * per-chunk rng keeps it deterministic; x stays on its centre's side of the
 * road and inside [xMin, xMax] (off the lanes), z wraps into [0, zLen).
 * @returns {number[][]} [x, z] positions.
 */
function scatter(rng, n, xMin, xMax, zLen) {
  const S = CONFIG.SCATTER;
  const k = Math.max(1, Math.round(n * 0.3));
  const centers = [];
  for (let c = 0; c < k; c++) centers.push([rng.sign() * rng.range(xMin, xMax), rng.range(0, zLen)]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    let x, z;
    if (rng.chance(S.clusterFrac)) {
      const c = centers[rng.int(0, k - 1)];
      const r = Math.sqrt(rng.next()) * S.spread;
      const a = rng.range(0, Math.PI * 2);
      x = c[0] + Math.cos(a) * r;
      z = wrapN(c[1] + Math.sin(a) * r, zLen);
      x = Math.sign(c[0]) * clamp(Math.abs(x), xMin, xMax); // same side, off-road
    } else {
      x = rng.sign() * rng.range(xMin, xMax);
      z = rng.range(0, zLen);
    }
    pts.push([x, z]);
  }
  return pts;
}

// ---------------------------------------------------------------
// Shared archetype geometries (built once per MaterialLibrary)
// ---------------------------------------------------------------
const ARCHETYPES = new WeakMap();

/** Vehicle/material group layout per paint variant:
 *  0 wreck paint, 1 paintedMetal, 2 rust, 3 wreckGlassA, 4 wreckGlassB,
 *  5 interior, 6 interior glow / amber side markers (shared reflector
 *  material), 7 charred, 8 taillight, 9 DOT contour tape (trailer rear).
 *  Windows are single quads on alternating glass roughness with a dark
 *  interior backing inset 0.06 behind the glass. */
const PAINT_VARIANTS = ["wreckWhite", "wreckRed", "wreckTeal"];

function buildArchetypes(lib) {
  const cached = ARCHETYPES.get(lib);
  if (cached) return cached;

  const A = {};

  // Sedan: burned-out passenger car, hood + trunk popped, glass gone.
  // Hull/trim merge into one part per material so groups (draws) stay low.
  const sedanHull = mergeParts([
    { g: box(1.82, 0.5, 4.5), y: 0.62 }, // body
    { g: box(1.66, 0.48, 2.3), y: 1.1, z: -0.25 }, // cabin
    { g: box(1.6, 0.07, 1.25), y: 1.02, z: 1.62, rx: -0.62 }, // hood open
    { g: box(1.6, 0.07, 1.1), y: 1.0, z: -2.05, rx: 0.5 }, // trunk open
  ]);
  const sedanTrim = mergeParts([
    { g: box(1.88, 0.16, 0.24), y: 0.42, z: 2.3 }, // front bumper
    { g: box(1.88, 0.16, 0.24), y: 0.42, z: -2.3 }, // rear bumper
    { g: box(1.7, 0.16, 4.2), y: 0.3 }, // chassis rail
  ]);
  // Window quads ride 0.06 proud of the interior backing (cabin ±0.83).
  A.sedan = mergeParts([
    { g: sedanHull, mat: 0 },
    { g: new THREE.PlaneGeometry(1.9, 0.34), mat: 3, x: 0.895, y: 1.06, z: -0.25, ry: Math.PI / 2 },
    { g: new THREE.PlaneGeometry(1.9, 0.34), mat: 4, x: -0.895, y: 1.06, z: -0.25, ry: -Math.PI / 2 },
    { g: box(1.67, 0.34, 1.9), mat: 5, y: 1.06, z: -0.25 }, // interior behind glass
    { g: sedanTrim, mat: 2 },
  ]);
  A.sedanWheels = [
    [0.82, 1.45], [-0.82, 1.45], [0.82, -1.45], [-0.82, -1.45],
  ];

  // Evacuation bus: long body, window band, collapsed skirt, roof box.
  // Side windows: individual quads between the mullions on ALTERNATING
  // glass roughness, a very dark warm interior box inset 0.06 behind the
  // band, and two tiny warm interior lights (one dead, merged into the
  // glassA part) — never a continuous emissive strip.
  const busHull = mergeParts([
    { g: box(2.5, 2.25, 11.5), y: 1.5 },
    ...[-1.27, 1.27].flatMap((x) =>
      Array.from({ length: 13 }, (_, i) => ({ g: box(0.05, 0.72, 0.1), x, y: 1.98, z: -4.8 + i * 0.8 }))),
  ]);
  // Window bays: 12 between the mullions (mullion i at z = -4.8 + i*0.8,
  // 0.1 deep) plus the two end bays out to the band ends (±5.2).
  const busBays = [];
  for (let i = 0; i < 12; i++) busBays.push(-4.4 + i * 0.8);
  busBays.push(-5.025, 5.025);
  const busQuad = (x, z, w) => ({
    g: new THREE.PlaneGeometry(w, 0.72), x, y: 1.98, z,
    ry: x > 0 ? Math.PI / 2 : -Math.PI / 2,
  });
  const busGlassParts = [[], []]; // [glassA quads, glassB quads]
  for (const x of [1.312, -1.312]) {
    busBays.forEach((z, i) => busGlassParts[i % 2].push(busQuad(x, z, i < 12 ? 0.7 : 0.35)));
  }
  busGlassParts[0].push({ g: box(0.06, 0.16, 0.34), x: 1.29, y: 1.98, z: 3.2 }); // dead interior light
  busGlassParts[0].push({ g: new THREE.PlaneGeometry(2.2, 0.66), y: 2.0, z: 5.816 }); // windshield quad
  const busInterior = mergeParts([
    { g: box(2.51, 0.72, 10.44), y: 1.98 }, // cabin backing behind the band
    { g: box(2.2, 0.64, 0.02), y: 2.0, z: 5.756 }, // behind the windshield quad
  ]);
  const busGlow = mergeParts([
    { g: box(0.03, 0.16, 0.34), x: 1.29, y: 1.98, z: -2.6 },
    { g: box(0.03, 0.16, 0.34), x: -1.29, y: 1.98, z: 0.6 },
  ]);
  const busMetal = mergeParts([
    { g: box(1.6, 0.32, 3.4), y: 2.79, z: -1.0 }, // roofline AC box
    { g: box(2.6, 0.28, 0.2), y: 0.5, z: 5.8 }, // front bumper bar
  ]);
  // Skirt + door seam lines share the rust group (draw budget: one group).
  const busSkirt = mergeParts([
    { g: box(2.56, 0.5, 11.4), y: 0.62 }, // skirt
    ...[2.15, 3.05, -1.85, -0.95].flatMap((z) => [
      { g: box(0.012, 1.14, 0.05), x: 1.256, y: 1.02, z }, // door seam lines
      { g: box(0.012, 1.14, 0.05), x: -1.256, y: 1.02, z },
    ]),
  ]);
  A.bus = mergeParts([
    { g: busHull, mat: 0 },
    { g: mergeParts(busGlassParts[0]), mat: 3 },
    { g: mergeParts(busGlassParts[1]), mat: 4 },
    { g: busInterior, mat: 5 },
    { g: busSkirt, mat: 2 },
    { g: busMetal, mat: 1 },
    { g: busGlow, mat: 6 },
  ]);
  A.busWheels = [
    [1.18, 4.1], [-1.18, 4.1], [1.18, -3.4], [-1.18, -3.4], [1.18, -4.7], [-1.18, -4.7],
  ];

  // Semi cab with exposed engine (hood tilted) + exhaust stacks.
  const cabHull = mergeParts([
    { g: box(2.4, 1.85, 2.0), y: 1.85, z: -0.8 },
    { g: box(2.0, 1.0, 1.6), y: 0.95, z: 1.15 }, // engine hood
    { g: box(1.9, 0.08, 1.5), y: 1.5, z: 1.35, rx: -0.7 }, // hood lid open
  ]);
  const cabTrim = mergeParts([
    { g: box(1.9, 0.34, 4.4), y: 0.55 }, // chassis
    { g: box(2.3, 0.2, 0.3), y: 0.6, z: 2.15 }, // front bumper
    { g: cyl(0.07, 0.07, 1.5, 6), x: 1.05, y: 2.6, z: -1.4 },
    { g: cyl(0.07, 0.07, 1.5, 6), x: -1.05, y: 2.6, z: -1.4 },
    // Rear access ladder below the windshield line (2 rails + 3 rungs).
    { g: box(0.05, 1.15, 0.05), x: 0.55, y: 1.275, z: -1.85 },
    { g: box(0.05, 1.15, 0.05), x: -0.55, y: 1.275, z: -1.85 },
    { g: box(1.15, 0.05, 0.05), y: 0.95, z: -1.85 },
    { g: box(1.15, 0.05, 0.05), y: 1.3, z: -1.85 },
    { g: box(1.15, 0.05, 0.05), y: 1.65, z: -1.85 },
  ]);
  const cabTail = mergeParts([
    { g: box(0.14, 0.32, 0.06), x: -1.02, y: 1.1, z: -1.84 },
    { g: box(0.14, 0.32, 0.06), x: 1.02, y: 1.1, z: -1.84 },
  ]);
  A.cab = mergeParts([
    { g: cabHull, mat: 0 },
    { g: new THREE.PlaneGeometry(2.1, 0.6), mat: 3, y: 2.2, z: -1.866, ry: Math.PI }, // windshield quad
    { g: box(2.04, 0.56, 0.02), mat: 5, y: 2.2, z: -1.806 }, // interior behind glass
    { g: cabTrim, mat: 2 },
    { g: cabTail, mat: 8 },
  ]);
  A.cabWheels = [[1.0, 1.7], [-1.0, 1.7], [1.0, -1.5], [-1.0, -1.5]];

  // Box trailer, jackknifed: variant paint over a scorch band. Round-4: the
  // rear DOORS ride the paint-variant group (they were in the rust trim
  // group, albedo ~0.1 linear — the backlit rear read as a pure black slab
  // even with the round-3 markers); the charred band stays confined to the
  // one front end panel + lower band, and the belly rail/bumper keep the
  // rust read. The rear keeps the round-3 lighting floor: mudflaps + door
  // seam lines for structure, two red taillight markers on the doors and
  // three tiny amber side markers down the right-edge (local -x) top rail,
  // so the backlit rear reads as a vehicle, not a black box.
  const trailerDoors = mergeParts([
    { g: box(2.5, 2.45, 0.12), y: 2.0, z: -4.76 }, // rear doors
  ]);
  const trailerTrim = mergeParts([
    { g: box(2.64, 0.55, 9.2), y: 0.78 }, // belly rail
    { g: box(2.64, 0.26, 0.18), y: 0.72, z: 4.8 }, // front bumper bar
  ]);
  const trailerFlaps = mergeParts([
    { g: box(0.42, 0.52, 0.05), x: -0.95, y: 0.32, z: -4.52 },
    { g: box(0.42, 0.52, 0.05), x: 0.95, y: 0.32, z: -4.52 },
  ]);
  const trailerSeams = mergeParts([
    { g: box(0.03, 2.3, 0.03), y: 2.0, z: -4.84 }, // door centre split
    { g: box(0.03, 2.3, 0.03), x: -1.22, y: 2.0, z: -4.82 },
    { g: box(0.03, 2.3, 0.03), x: 1.22, y: 2.0, z: -4.82 },
  ]);
  const trailerTail = mergeParts([
    { g: box(0.16, 0.4, 0.06), x: -1.08, y: 1.0, z: -4.86 },
    { g: box(0.16, 0.4, 0.06), x: 1.08, y: 1.0, z: -4.86 },
  ]);
  const trailerAmber = mergeParts([
    { g: box(0.04, 0.1, 0.1), x: -1.32, y: 3.24, z: -4.3 },
    { g: box(0.04, 0.1, 0.1), x: -1.32, y: 3.24, z: 0 },
    { g: box(0.04, 0.1, 0.1), x: -1.32, y: 3.24, z: 4.3 },
  ]);
  // DOT-style reflective contour tape (group 9, flat unlit read): vertical
  // strips on the door edges + a bottom rail across the doors — the classic
  // semi-trailer rear read. 0.06 m band, 14 mm proud of the door face
  // (z -4.82); the vertical strips rotate rz 90 deg so the dotTape canvas's
  // dash axis (texture u) runs along their 2.3 m height.
  const trailerTape = mergeParts([
    { g: box(2.3, 0.06, 0.014), x: -1.21, y: 2.0, z: -4.827, rz: Math.PI / 2 },
    { g: box(2.3, 0.06, 0.014), x: 1.21, y: 2.0, z: -4.827, rz: Math.PI / 2 },
    { g: box(2.46, 0.06, 0.014), y: 0.81, z: -4.827 },
  ]);
  A.trailer = mergeParts([
    { g: box(2.6, 2.7, 9.5), mat: 0, y: 2.0 },
    { g: trailerDoors, mat: 0 }, // paint-variant rear (was rust trim — black slab)
    { g: box(2.64, 1.3, 3.4), mat: 7, y: 1.2, z: 2.4 }, // scorch band: one end panel
    { g: trailerTrim, mat: 2 },
    { g: trailerFlaps, mat: 7 },
    { g: trailerSeams, mat: 2 },
    { g: trailerTail, mat: 8 },
    { g: trailerAmber, mat: 6 },
    { g: trailerTape, mat: 9 },
  ]);
  A.trailerWheels = [[0.95, -2.9], [-0.95, -2.9], [0.95, -4.1], [-0.95, -4.1]];

  // Wheel (CONFIG.WRECKS.wheel): tire torus + rim disc + hub + through-
  // spokes merged into one 2-group geometry (0 rubber, 1 rim metal), axle
  // along X (vehicle sides). Base outer radius = tireR + tube; buildWrecks
  // scales instances by wheelR / baseR so tire bottoms sit at y = 0.
  const W = CONFIG.WRECKS.wheel;
  const tire = new THREE.TorusGeometry(W.tireR, W.tube, W.radial, W.tubular);
  tire.rotateY(Math.PI / 2);
  const rimParts = [
    { g: cyl(W.rimR, W.rimR, W.rimW, 12), mat: 1, rz: Math.PI / 2 },
    { g: cyl(W.hubR, W.hubR, W.hubW, 8), mat: 1, rz: Math.PI / 2 },
  ];
  for (let s = 0; s < W.spokes; s++) {
    rimParts.push({ g: box(W.spokeT, W.spokeLen, W.spokeW), mat: 1, rx: (s / W.spokes) * Math.PI * 2 });
  }
  A.wheel = mergeParts([{ g: tire, mat: 0 }, { g: mergeParts(rimParts), mat: 1 }]);

  // Contact-shadow blob: unit plane stretched to each hull in buildWrecks.
  A.shadow = new THREE.PlaneGeometry(1, 1);
  A.shadow.rotateX(-Math.PI / 2);

  // Per-archetype fake-shadow footprint (hull bbox + soft skirt).
  for (const key of ["sedan", "bus", "cab", "trailer"]) {
    A[key].computeBoundingBox();
    const bb = A[key].boundingBox;
    A[key + "Shadow"] = [bb.max.x - bb.min.x + 0.9, bb.max.z - bb.min.z + 1.1];
  }

  // Dead streetlight: base plate + leaning pole + arm + dead head.
  A.streetlight = mergeParts([
    { g: box(0.55, 0.14, 0.55), y: 0.07 }, // base plate: pole meets the shoulder
    { g: cyl(0.1, 0.16, 8.6, 7), y: 4.3 },
    { g: cyl(0.06, 0.09, 2.6, 6), rz: Math.PI / 2, x: -1.3, y: 8.5 },
    { g: box(0.85, 0.18, 0.34), x: -2.45, y: 8.42 },
    { g: box(0.6, 0.07, 0.24), mat: 2, x: -2.45, y: 8.28 }, // dead lamp
  ]);
  // Lamp-head anchor (streetlight-local) for the night light kit below.
  A.streetlightLamp = { x: -2.45, y: 8.28 };

  // Guardrail: W-beam rail (scaled per instance) + delineator post
  // (CONFIG.GUARDRAIL.postH tall). The amber reflector dot moved out of the
  // post archetype into its own InstancedMesh: instanceColor only scales
  // diffuse in r172 (emissive is immune), so per-post "catch" variation
  // needs a basic-material dot (see buildDressing).
  A.railPost = mergeParts([
    { g: box(0.12, CONFIG.GUARDRAIL.postH, 0.18), mat: 0, y: CONFIG.GUARDRAIL.postH / 2 },
    { g: box(...CONFIG.GUARDRAIL.reflector.size), mat: 1, y: CONFIG.GUARDRAIL.postH - 0.12, z: -CONFIG.GUARDRAIL.reflector.zOff },
  ]);
  A.reflector = box(...CONFIG.GUARDRAIL.reflector.size);
  A.railBeam = box(0.06, 0.32, CONFIG.CHUNK_LEN + 0.4);

  // Guide sign: rust posts (instanced) on small base plates, backing + panel.
  A.signPost = mergeParts([
    { g: box(0.3, 0.14, 0.3), y: 0.07 }, // base plate
    { g: box(0.09, 2.83, 0.09), y: 1.485 },
  ]);
  A.signBacking = box(2.7, 1.4, 0.06);
  A.signPanel = new THREE.PlaneGeometry(2.6, 1.3);

  // Mesa: lathe silhouettes — talus base, bench facets, flat top that
  // catches the dusk key. THREE hand-jittered profile variants (no two
  // consecutive segments share a slope — collinear runs read as straight
  // faceted diagonals) at 30 segments, so flat-shaded facet bands stay
  // sub-10-degrees. A chunk picks ONE variant so twin-peak setups share a
  // single InstancedMesh; yaw + non-uniform scale still vary per instance.
  const mesaProfiles = [
    [
      [1.0, 0.0], [0.955, 0.05], [0.905, 0.12], [0.86, 0.19], [0.815, 0.28],
      [0.79, 0.36], [0.775, 0.42], [0.72, 0.5], [0.69, 0.57], [0.65, 0.64],
      [0.6, 0.71], [0.575, 0.78], [0.545, 0.85], [0.52, 0.92], [0.505, 1.0], [0.02, 1.0],
    ],
    [
      [1.0, 0.0], [0.97, 0.04], [0.93, 0.1], [0.875, 0.17], [0.8, 0.26],
      [0.735, 0.35], [0.7, 0.44], [0.685, 0.52], [0.625, 0.6], [0.565, 0.68],
      [0.53, 0.76], [0.5, 0.84], [0.475, 0.92], [0.46, 1.0], [0.02, 1.0],
    ],
    [
      [1.0, 0.0], [0.94, 0.07], [0.895, 0.15], [0.855, 0.24], [0.83, 0.33],
      [0.775, 0.43], [0.725, 0.52], [0.7, 0.6], [0.66, 0.68], [0.62, 0.76],
      [0.58, 0.84], [0.55, 0.92], [0.535, 1.0], [0.02, 1.0],
    ],
  ];
  A.mesaVariants = mesaProfiles.map(
    (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 30),
  );
  A.boulder = new THREE.DodecahedronGeometry(1, 0);
  const quad = new THREE.PlaneGeometry(1.2, 0.9);
  quad.translate(0, 0.45, 0);
  const quad2 = quad.clone();
  quad2.rotateY(Math.PI / 2);
  A.scrub = mergeParts([
    { g: quad, mat: 0 },
    { g: quad2, mat: 0 },
  ]);
  A.debris = box(0.5, 0.22, 0.72);

  // Shambler (round-6 hero subject): a lone walking-dead silhouette, ~1.75 m,
  // 10 logical parts merged into ONE 3-group geometry (0 sickly skin, 1 dark
  // clothing, 2 amber eye dots — materials wired in createShamblerManager).
  // 216 tris. Parts pre-merge PER MATERIAL (the A.wheel pattern) — mergeParts
  // emits one group per top-level part, so flat parts would cost a draw each;
  // this way every shambler costs 3 draws total for ALL instances (2 at dusk:
  // the eye group's material is visible=false). Silhouette-first: 8-deg
  // forward hunch (torso/head lean +z), one arm reaching, one hanging,
  // mid-stride legs — reads as a hunched human at 20-40 m. The pose is
  // static (merged); bob/roll/drift ride the per-instance matrix (see the
  // manager), lean is baked here.
  const shamblerSkin = mergeParts([
    { g: new THREE.SphereGeometry(0.105, 7, 5), y: 1.64, z: 0.12 }, // head
    { g: box(0.09, 0.14, 0.1), y: 1.53, z: 0.075, rx: 0.2 }, // neck
    { g: box(0.09, 0.6, 0.1), x: 0.27, y: 1.17, z: -0.05, rx: 0.16 }, // hanging arm
    { g: box(0.09, 0.58, 0.1), x: -0.27, y: 1.2, z: 0.12, rx: -0.55, rz: 0.06 }, // reaching arm
  ]);
  const shamblerClothes = mergeParts([
    { g: cyl(0.34, 0.26, 0.5, 4), ry: Math.PI / 4, sz: 0.55, y: 1.32, rx: 0.14 }, // tapered torso
    { g: box(0.3, 0.2, 0.22), y: 1.02, rx: 0.08 }, // pelvis
    { g: box(0.13, 0.46, 0.14), x: -0.09, y: 0.68, z: 0.05, rx: -0.25 }, // lead thigh
    { g: box(0.11, 0.4, 0.12), x: -0.09, y: 0.22, z: 0.14, rx: -0.06 }, // lead calf
    { g: box(0.11, 0.08, 0.26), x: -0.09, y: 0.04, z: 0.2 }, // lead foot
    { g: box(0.13, 0.46, 0.14), x: 0.09, y: 0.68, z: -0.06, rx: 0.28 }, // trail thigh
    { g: box(0.11, 0.4, 0.12), x: 0.09, y: 0.24, z: -0.16, rx: 0.12 }, // trail calf
    { g: box(0.11, 0.08, 0.26), x: 0.09, y: 0.05, z: -0.22, rx: 0.35 }, // toe-down trail foot
  ]);
  A.shambler = mergeParts([
    { g: shamblerSkin, mat: 0 },
    { g: shamblerClothes, mat: 1 },
    { g: mergeParts([ // eye dots on the head's forward (+z) face, ~3 cm wide
      { g: box(0.03, 0.016, 0.012), x: 0.042, y: 1.665, z: 0.215 },
      { g: box(0.03, 0.016, 0.012), x: -0.042, y: 1.665, z: 0.215 },
    ]), mat: 2 },
  ]);

  ARCHETYPES.set(lib, A);
  return A;
}

/**
 * Shambler manager (round-6): ONE pooled InstancedMesh poses every active
 * chunk's figures, so N shamblers cost a flat 2 draws at dusk (skin+clothes;
 * the eye group's material is visible=false) and 3 at night (eyes reuse the
 * amber rail-reflector material) plus 1 shadow draw. Chunk factories only
 * record seeded placement streams on group.userData.shamblers; the World
 * owns this mesh and calls update(dt, active) from its per-frame hook.
 */
function createShamblerManager(A, lib, refMat) {
  // Eyes: the rail-reflector read at night; at dusk the sockets stay dark
  // and the whole group is skipped (zero draws — dead eyes in daylight).
  const eyeMat = NIGHT
    ? refMat
    : new THREE.MeshBasicMaterial({ color: 0x0d0c09 });
  if (!NIGHT) eyeMat.visible = false;

  const mesh = new THREE.InstancedMesh(
    A.shambler,
    [lib.get("shambler"), lib.get("interior"), eyeMat],
    SHAMBLER.maxInstances,
  );
  mesh.name = "shamblers";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; // raking dusk key throws the figure's long shadow
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // instances stream with their chunks
  mesh.count = 0;
  mesh.visible = false;

  const dummy = new THREE.Object3D();
  let t = 0;

  return {
    mesh,
    /** Write this frame's pose per active-chunk shambler. Allocation-free:
     * one scratch Object3D, no per-frame Vector3s (bible hot-path rule). */
    update(dt, active) {
      t += dt;
      let n = 0;
      for (const chunk of active.values()) {
        const list = chunk.group.userData.shamblers;
        if (!list) continue;
        const gz = chunk.group.position.z;
        for (let i = 0; i < list.length && n < SHAMBLER.maxInstances; i++) {
          const s = list[i];
          const w = t * s.freq + s.phase;
          const c = Math.cos(w);
          // Facing follows the pacing velocity; turnarounds ease over
          // ~0.3 s (shortest-arc) so the flip reads as a stumbling pivot.
          const target = c >= 0 ? s.ry : s.ry + Math.PI;
          s.ryCur += Math.atan2(Math.sin(target - s.ryCur), Math.cos(target - s.ryCur)) *
            Math.min(1, dt * 3.5);
          dummy.position.set(
            s.x + s.ex * Math.sin(w),
            Math.sin(t * SHAMBLER.bobHz * Math.PI * 2 + s.bobPhase) * SHAMBLER.bobY,
            gz + s.z + s.ez * Math.sin(w),
          );
          // Weight-shift roll about the local forward axis at half the bob
          // rate (rotation order XYZ: roll applies in the yawed frame).
          dummy.rotation.set(0, s.ryCur, Math.sin(w * 0.5 + s.bobPhase) * SHAMBLER.roll);
          dummy.updateMatrix();
          mesh.setMatrixAt(n++, dummy.matrix);
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Per-variant vehicle material arrays: [paint, paintedMetal, rust, glassA,
 *  glassB, interior, reflector/glow, charred, taillight, dotTape] — paints
 *  share one PBR set, so all hulls stay instanced. The tape material is one
 *  shared MeshBasicMaterial across every variant (flat unlit read). */
function vehicleMats(lib, tapeMat) {
  const shared = [
    lib.get("paintedMetal"), lib.get("rust"),
    lib.get("wreckGlassA"), lib.get("wreckGlassB"), lib.get("interior"),
    lib.get("reflector"), lib.get("charred"), lib.get("taillight"),
  ];
  return PAINT_VARIANTS.map((key) => [lib.get(key), ...shared, tapeMat]);
}

/**
 * World-owned dressing pool (task 1.2 draw-call merge). ONE InstancedMesh per
 * material group serves EVERY active chunk — the shambler-manager pattern
 * scaled to static dressing — so N streamed chunks of rails/posts/scrub/
 * rocks/reflectors/... cost a flat number of draws instead of per-chunk
 * meshes (measured ~57 dusk / ~65 night main-pass draws saved). Chunk
 * factories record seeded placement streams on group.userData.dressing at
 * build time only; sync(active) rewrites preallocated instance buffers ONLY
 * when the active chunk set changes (streaming events, never per frame) —
 * zero per-frame and zero per-chunk allocation. Vehicle hulls stay chunk-
 * local (their paint-variant bucketing is per-build); everything else moves
 * here. Categories: placements [x,y,z,rx,ry,rz,sx,sy,sz,r?,g?,b?] (HDR
 * instanceColor tail on the color categories: reflectors, mesas).
 * @returns {{group: THREE.Group, sync: Function}}
 */
function createDressingPool(A, lib, refMat, kit, dummy, capChunks) {
  const group = new THREE.Group();
  group.name = "dressing";
  const cats = [];
  const cap = (per) => per * capChunks;

  /** Register one instanced category. `variant` selects the mesa lathe
   *  variant meshes (a chunk contributes to exactly one of the three). */
  function addCat(key, geo, mats, per, o = {}) {
    const total = cap(per);
    const im = new THREE.InstancedMesh(geo, mats, total);
    im.name = key;
    if (o.color) {
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    }
    im.count = 0;
    im.visible = false;
    im.frustumCulled = false; // instances stream with their chunks
    im.castShadow = !!o.cast;
    im.receiveShadow = !!o.recv;
    if (o.order !== undefined) im.renderOrder = o.order;
    group.add(im);
    cats.push({ key, im, total, color: !!o.color, variant: o.variant });
  }

  addCat("rails", A.railBeam, lib.get("paintedMetal"), 2, { recv: true });
  addCat("posts", A.railPost, lib.get("paintedMetal"), 20, { cast: true });
  addCat("streetlights", A.streetlight, lib.get("rust"), 1, { cast: true });
  addCat("scrub", A.scrub, lib.get("scrub"), CONFIG.SCRUB.perChunk);
  addCat("rocks", A.boulder, lib.get("rock"), CONFIG.ROCKS.perChunk);
  A.mesaVariants.forEach((geo, v) =>
    addCat("mesas", geo, lib.get("rock"), 4, { color: true, variant: v }));
  addCat("reflectors", A.reflector, refMat, 20, { color: true });
  addCat("wheels", A.wheel, [lib.get("rubber"), lib.get("rimMetal")], 32, { cast: true });
  addCat("shadows", A.shadow, lib.get("contactShadow"), 6);
  addCat("debris", A.debris, lib.get("charred"), CONFIG.WRECKS.convoy.debris);
  addCat("signPosts", A.signPost, lib.get("rust"), 2);
  addCat("signBacks", A.signBacking, lib.get("paintedMetal"), 1);
  addCat("signPanels", A.signPanel, lib.get("signGuide"), 1);
  if (kit) {
    addCat("lampHeads", kit.lampGeo, kit.lampMat, 1, { order: 1 });
    addCat("lampPools", kit.poolGeo, kit.poolMat, 1, { order: 1 });
    addCat("signSpills", kit.poolGeo, kit.signPoolMat, 1, { order: 1 });
  }

  return {
    group,
    /** Rewrite instance matrices/colors from the active chunks' streams.
     *  Early-outs unless the active index set changed since the last call. */
    sync(active) {
      let key = "";
      for (const index of active.keys()) key += `${index},`;
      if (key === this._key) return;
      this._key = key;
      for (const cat of cats) {
        let n = 0;
        const col = cat.color ? cat.im.instanceColor.array : null;
        for (const chunk of active.values()) {
          const d = chunk.group.userData.dressing;
          if (!d) continue;
          // Placements are chunk-local (z in [0, CHUNK_LEN)); the pool meshes
          // live at scene root, so translate by the chunk's world z exactly
          // like the shambler manager does for its pose streams.
          const gz = chunk.group.position.z;
          let list;
          if (cat.variant !== undefined) {
            if (!d.mesas || d.mesas.v !== cat.variant) continue;
            list = d.mesas.p;
          } else {
            list = d[cat.key];
          }
          if (!list) continue;
          for (let i = 0; i < list.length && n < cat.total; i++) {
            const p = list[i];
            dummy.position.set(p[0], p[1], p[2] + gz);
            dummy.rotation.set(p[3] || 0, p[4] || 0, p[5] || 0);
            if (p[6] !== undefined) {
              dummy.scale.set(p[6], p[7] === undefined ? p[6] : p[7], p[8] === undefined ? p[6] : p[8]);
            } else {
              dummy.scale.set(1, 1, 1);
            }
            dummy.updateMatrix();
            cat.im.setMatrixAt(n, dummy.matrix);
            if (col) {
              col[n * 3] = p[9] === undefined ? 1 : p[9];
              col[n * 3 + 1] = p[10] === undefined ? 1 : p[10];
              col[n * 3 + 2] = p[11] === undefined ? 1 : p[11];
            }
            n++;
          }
        }
        dummy.scale.set(1, 1, 1);
        cat.im.count = n;
        cat.im.visible = n > 0;
        cat.im.instanceMatrix.needsUpdate = true;
        if (col) cat.im.instanceColor.needsUpdate = true;
      }
    },
  };
}

// ---------------------------------------------------------------
// Chunk factories
// ---------------------------------------------------------------

/**
 * Register 'plain' / 'wreck' / 'convoy' chunk types on a World.
 * @param {import("./world.js").World} world
 * @param {import("../core/assets.js").materialLibrary} lib
 * @param {number} seed Run seed.
 * @returns {{shamblers: object, dressing: object}} World-owned dressing
 *   managers (shamblers pose per frame; dressing group + chunk-set sync).
 */
export function registerWorldChunks(world, lib, seed) {
  const A = buildArchetypes(lib);
  // DOT contour tape: one shared flat material (CONFIG.WRECKS.dotTape.color
  // tints the dotTape canvas's dash values into the red family — a basic
  // material reads as retroreflection, lit or backlit, dusk and night).
  const tapeMat = new THREE.MeshBasicMaterial({
    map: lib.canvas("dotTape"),
    color: CONFIG.WRECKS.dotTape.color,
  });
  tapeMat.name = "dotTape";
  const V = vehicleMats(lib, tapeMat);
  const CH = CONFIG.CHUNK_LEN;
  const dummy = new THREE.Object3D();

  // Shared light-kit resources, built once. Additive glows follow the sky.js
  // headlight-pool pattern (fog off, no depth write); chunk factories only
  // place meshes — never materials or geometry. Round-4: the additive lamp
  // cones are gone (hard-edged translucent triangles); the ground pool
  // carries the light (opacity 0.2 -> 0.26, see STREETLIGHT config).
  const refMat = new THREE.MeshBasicMaterial({ color: CONFIG.GUARDRAIL.reflector.color });
  const kit = NIGHT ? {
    lampGeo: new THREE.BoxGeometry(...CONFIG.STREETLIGHT.night.lamp.size),
    poolGeo: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    lampMat: lib.get("emissiveStrip"), // main.js drives emissiveIntensity 2.6 at night
    poolMat: new THREE.MeshBasicMaterial({
      map: lib.canvas("lightPool"), color: CONFIG.STREETLIGHT.night.pool.color,
      transparent: true, opacity: CONFIG.STREETLIGHT.night.pool.opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  } : null;
  if (kit) {
    // Guide-sign spill shares the pool material's program + texture — a
    // parameter clone (opacity only), so no new shader variant compiles.
    kit.signPoolMat = kit.poolMat.clone();
    kit.signPoolMat.opacity = CONFIG.SIGNS.night.pool.opacity;
  }
  // Taillight markers switch with time of day (build-time bake; the only
  // night path is ?time=night — see the NIGHT gate above).
  lib.get("taillight").emissiveIntensity =
    NIGHT ? CONFIG.VEHICLE_LIGHTS.taillightNight : CONFIG.VEHICLE_LIGHTS.taillightDusk;
  // Same bake for the shared reflector group: the bus interior glow boxes
  // (read through the window band) and the trailer amber side markers.
  // Night lifts them (VEHICLE_LIGHTS.glowNight) so every convoy bus reads
  // warm-lit — seed-independent; dusk keeps the authored 1.15 base.
  lib.get("reflector").emissiveIntensity =
    NIGHT ? CONFIG.VEHICLE_LIGHTS.glowNight : CONFIG.VEHICLE_LIGHTS.glowDusk;
  // Night sign read: dim the guide panel ~20% (color scalar — signGuide has
  // no emissive of its own; its white legend reads self-lit under moon+hemi
  // with zero spill) so the night spill pool below can ground it.
  if (NIGHT) lib.get("signGuide").color.setScalar(CONFIG.SIGNS.night.dim);

  // Shambler dressing (round-6): one global pooled InstancedMesh owned by
  // the World (returned below); chunk factories only write seeded placement
  // streams into group.userData.shamblers.
  const shamblers = createShamblerManager(A, lib, refMat);

  // Static dressing pool (task 1.2): same ownership pattern — the World adds
  // the group to the scene and re-syncs instance buffers when the streamed
  // chunk set changes. Worst-case window sizes every preallocated buffer.
  const dressingPool = createDressingPool(
    A, lib, refMat, kit, dummy,
    1 + CONFIG.STREAM.maxChunksBehind + world.maxChunksAhead,
  );

  /** Record a chunk's dressing placement stream for the world-owned pool
   *  (createDressingPool). Written once at chunk build; pooled chunk reuse
   *  replays the same stream — identical semantics to reusing its geometry.
   *  `variant` selects the mesa lathe variant for the "mesas" stream. */
  function record(group, key, placements, variant) {
    const d = group.userData.dressing || (group.userData.dressing = {});
    if (variant !== undefined) {
      d[key] = { v: variant, p: placements };
      return;
    }
    const list = d[key] || (d[key] = []);
    for (let i = 0; i < placements.length; i++) list.push(placements[i]);
  }

  /** Instance helper: fill an InstancedMesh from a placement list.
   *  Placement: [x, y, z, rx, ry, rz, sx, sy, sz, r?, g?, b?] — the optional
   *  RGB tail (HDR allowed) becomes instanceColor (e.g. mesa haze tint). */
  function inst(geo, mats, placements, castShadow) {
    const im = new THREE.InstancedMesh(geo, mats, placements.length);
    let colors = null;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(p[3] || 0, p[4] || 0, p[5] || 0);
      if (p[6] !== undefined) dummy.scale.set(p[6], p[7] === undefined ? p[6] : p[7], p[8] === undefined ? p[6] : p[8]);
      else dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      if (p[9] !== undefined) {
        if (!colors) {
          colors = new Float32Array(placements.length * 3);
          im.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        }
        colors[i * 3] = p[9]; colors[i * 3 + 1] = p[10]; colors[i * 3 + 2] = p[11];
      }
    }
    dummy.scale.set(1, 1, 1);
    if (colors) im.instanceColor.needsUpdate = true;
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = !!castShadow;
    im.receiveShadow = false;
    return im;
  }

  /** One shambler pose-stream entry, seeded from the chunk's own rng. All
   *  draws happen strictly AFTER every existing placement draw in the
   *  factory, so the r2-r6 chunk streams stay byte-identical. lampXz:
   *  chunk-local lit sodium lamp anchor — the night companion spawns inside
   *  its ground pool's footprint so the pool rims the silhouette. */
  function makeShambler(rng, index, slot, lampXz) {
    const S = SHAMBLER;
    const hero = lampXz === null && index === 1 && slot === 0;
    const side = rng.sign();
    // Drift path: the authored hero paces down the road axis (faces the
    // menu camera for the first half period); the rest pace the shoulder,
    // ~35% set across it. Ternary arms short-circuit: exactly one branch's
    // rng draws run, so the stream stays deterministic per (index, slot).
    const across = !hero && lampXz === null && rng.chance(S.acrossChance);
    const a = lampXz !== null
      ? rng.range(-0.35, 0.35)
      : hero
        ? Math.PI + rng.range(-0.25, 0.25)
        : across
          ? side * Math.PI / 2 + rng.range(-0.3, 0.3) * (rng.chance(0.5) ? 1 : -1)
          : (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.3, 0.3);
    const amp = rng.range(S.amp[0], S.amp[1]);
    let ex = Math.sin(a) * amp;
    let ez = Math.cos(a) * amp;
    let x, z;
    if (lampXz) {
      x = lampXz.x - Math.sign(lampXz.x) * rng.range(1.6, 2.4); // road-side of the head
      x = Math.sign(x || 1) * clamp(Math.abs(x), S.xMin, S.xMax + 1.5);
      z = lampXz.z + rng.range(-1.2, 1.6);
    } else if (hero) {
      x = rng.range(S.hero.x[0], S.hero.x[1]);
      z = rng.range(S.hero.z[0], S.hero.z[1]);
    } else if (across) {
      // Crossers start far enough out that their pace bottoms out at the
      // road-edge rule instead of walking into the traffic lanes.
      x = side * (S.roadEdge + Math.abs(ex) + rng.range(0.3, 2.0));
      z = rng.range(2, CH - 2);
    } else {
      x = side * rng.range(S.xMin, S.xMax);
      z = rng.range(2, CH - 2);
    }
    // Chunk 0 backs the menu dolly start (camera z 20): lift figures into
    // the >= 12 m near-camera band (see SHAMBLER.nearZMin). Lamp companions
    // take the minimal lift so they stay within ~10 m of their pool
    // (placeShamblers gates them on lamp.z >= nearZMin - 9).
    if (index === 0 && z < S.nearZMin) {
      z = lampXz ? S.nearZMin : S.nearZMin + rng.range(0, CH - 0.5 - S.nearZMin);
    }
    // Pacing excursions never carry a figure inside the road-edge rule.
    if (Math.abs(x) - Math.abs(ex) < S.roadEdge) {
      ex = Math.sign(ex || 1) * Math.max(0, Math.abs(x) - S.roadEdge);
    }
    // If the lateral leg got clipped away, keep an along-road leg so the
    // figure still visibly shuffles (path floors the speed math below).
    let path = Math.hypot(ex, ez);
    if (path < 1.2) {
      ez += (ez >= 0 ? 1 : -1) * (1.2 - path);
      path = Math.hypot(ex, ez);
    }
    const speed = rng.range(S.speed[0], S.speed[1]);
    const ry = Math.atan2(ex, ez);
    return {
      x, z, ex, ez,
      lamp: lampXz !== null, // QA/harness marker: night pool companion
      freq: speed / path, // peak pace = path * freq = speed (m/s)
      phase: rng.range(0, Math.PI * 2),
      bobPhase: rng.range(0, Math.PI * 2),
      ry, ryCur: ry,
    };
  }

  /** Append the chunk's shambler placement stream. Called LAST in every
   *  factory; the night lamp companion (chunks < forceLitChunks) spawns in
   *  the lit pool recorded by buildDressing. Chunk 1's lamp always sits at
   *  world z 45-75 so its companion never trips the nearZMin lift; chunk 0's
   *  lamp can sit close to the menu camera — there the companion is skipped
   *  rather than dragged > 10 m from its pool (chunk 1 guarantees the pair). */
  function placeShamblers(group, rng, kind, index) {
    const c = SHAMBLER.count[kind];
    const list = [];
    const n = rng.int(c[0], c[1]);
    for (let i = 0; i < n; i++) list.push(makeShambler(rng, index, i, null));
    const lamp = NIGHT && index >= 0 && index < CONFIG.STREETLIGHT.night.forceLitChunks
      ? group.userData.lamp
      : null;
    if (lamp && (index !== 0 || lamp.z >= SHAMBLER.nearZMin - 9)) {
      list.push(makeShambler(rng, index, n, lamp));
    }
    if (list.length) group.userData.shamblers = list;
  }

  /** Vehicle + wheel + contact-shadow placement for wreck/convoy chunks.
   *  index: chunk index — <= 1 backs the menu dolly / staged=beauty hero
   *  framings, where the trailer's rear-left flank is a named hero surface
   *  (round-6): its paint is forced to the lightest variant regardless of
   *  the seeded roll. Adding the flag costs no rng draws (paint assignment
   *  happens after placement), so every chunk stream stays byte-identical.
   *  gameplay: factory-ctx dressing flag (design 4) — every slot below is
   *  ON-road (|x| <= 5.9 vs lane edges 5.1), so all shift out to the
   *  shoulder row for the director's lane obstacles. Placement-only, AFTER
   *  the slot's rng draws: attract and gameplay builds consume an identical
   *  rng stream. */
  function buildWrecks(rng, kind, index, gameplay) {
    const cfgW = CONFIG.WRECKS[kind];
    const baseR = CONFIG.WRECKS.wheel.tireR + CONFIG.WRECKS.wheel.tube;
    const group = new THREE.Group();
    const veh = []; // { arch, v (paint variant), p } placements
    const wheelP = [];
    const shadowP = [];

    const addVeh = (archKey, opts) => {
      const { z, ry, rz = 0, sink = 0, missingWheel = -1 } = opts;
      // Gameplay shoulder shift (design 4): the archetype's bbox half-width
      // lands the inner flank shoulderGap outside the guardrail line (the
      // streetlight/sign roadside row), wheels + shadows following.
      let { x } = opts;
      if (gameplay) {
        const half = (A[archKey].boundingBox.max.x - A[archKey].boundingBox.min.x) / 2;
        x = Math.sign(x || 1) * Math.max(
          Math.abs(x),
          CONFIG.GUARDRAIL.xInner + half + CONFIG.WRECKS.gameplay.shoulderGap,
        );
      }
      veh.push({ arch: archKey, v: rng.int(0, PAINT_VARIANTS.length - 1), p: [x, sink, z, 0, ry, rz] });
      const [sw, sl] = A[archKey + "Shadow"];
      shadowP.push([x, 0.02, z, 0, ry, 0, sw, 1, sl]);
      const r = CONFIG.WRECKS.wheelR[archKey];
      const s = r / baseR; // tire bottoms sit exactly at y = 0
      const cos = Math.cos(ry), sin = Math.sin(ry);
      const wheelsLocal = A[archKey + "Wheels"];
      for (let w = 0; w < wheelsLocal.length; w++) {
        if (w === missingWheel) continue;
        const [wx, wz] = wheelsLocal[w];
        wheelP.push([x + wx * cos + wz * sin, r + sink, z - wx * sin + wz * cos, 0, ry, 0, s, s, s]);
      }
    };

    if (cfgW.bus) {
      addVeh("bus", {
        x: -rng.range(2.2, 2.9), z: rng.range(6, 14), ry: rng.range(0.1, 0.3), rz: 0.05,
      });
    }
    if (cfgW.trailer) {
      const tz = rng.range(22, 30);
      addVeh("trailer", { x: 3.9, z: tz, ry: -rng.range(0.4, 0.62) });
      addVeh("cab", {
        x: 2.6, z: tz + rng.range(5.2, 7.0), ry: rng.range(-0.3, -0.1),
      });
    }
    const nSedans = rng.int(cfgW.sedans[0], cfgW.sedans[1]);
    for (let s = 0; s < nSedans; s++) {
      const side = rng.sign();
      addVeh("sedan", {
        x: side * rng.range(2.35, 5.9),
        z: rng.range(3, CH - 3),
        ry: rng.range(0.1, 1.1) * (rng.chance(0.5) ? -1 : 1),
        rz: rng.range(0.02, 0.07),
        sink: rng.chance(0.3) ? -0.06 : 0,
        missingWheel: rng.chance(0.35) ? rng.int(0, 3) : -1,
      });
    }
    // Detached wheels as deliberate set dressing (round-3: free-scattered
    // wheels read as cropped debris at the beauty framing). Each wheel
    // anchors to a placed vehicle's most OUTBOARD seated wheel (world x
    // picked after yaw, so the corridor clamp below never detaches it):
    // even ones sit upright leaning against the hull flank, odd ones lie
    // flat overlapping the seated wheel. Instances scale to the anchor's
    // wheel size so a bus spare reads bus-sized. rng draws stay per-wheel
    // so the chunk stream stays deterministic.
    for (let w = 0; w < cfgW.wheels; w++) {
      if (!veh.length) break;
      const anchor = veh[w % veh.length];
      const [ax, asink, az, , ary] = anchor.p;
      const cos = Math.cos(ary), sin = Math.sin(ary);
      let bx = 0, bz = 0, blx = 1, blz = 0, absX = -1;
      for (const [cx, cz] of A[anchor.arch + "Wheels"]) {
        const px = ax + cx * cos + cz * sin;
        if (Math.abs(px) > absX) {
          absX = Math.abs(px);
          bx = px; bz = az - cx * sin + cz * cos; blx = cx; blz = cz;
        }
      }
      const r = CONFIG.WRECKS.wheelR[anchor.arch];
      const s = r / baseR;
      const dir = bx >= 0 ? 1 : -1;
      const jx = rng.range(-0.1, 0.1), jz = rng.range(-0.35, 0.35);
      let x, z, y, rx, ry, rz;
      if (w % 2 === 0) {
        // Upright spare leaning against the hull: OVERLAPPING the flank
        // (round-6: 0.32 off the flank read as an unattached black blob when
        // the frame edge cropped it — 0.12 stacks it against the seated
        // wheel/hull so it reads as a leaned spare; top still tilts in).
        x = bx + dir * (0.12 + jx);
        z = bz + jz;
        y = r * Math.cos(0.28) + asink;
        rx = 0; ry = ary; rz = (blx >= 0 ? 1 : -1) * 0.28;
      } else {
        // Flat spare dropped overlapping the seated wheel (0.6/0.3 -> 0.28/
        // 0.12: same frame-edge-blob fix — the disc must touch its host).
        x = bx + dir * (0.28 + jx);
        z = bz + 0.12 + jz;
        y = (CONFIG.WRECKS.wheel.hubW / 2) * s + asink;
        rx = Math.PI / 2;
        ry = ary + rng.range(0, Math.PI * 2);
        rz = 0;
      }
      // Wrap z into the chunk; the outboard anchor keeps |x| >= 1.9 (2-3 m
      // clear of the camera corridor) — clamp is a yaw-corner-case net.
      z = 1 + wrapN(z - 1, CH - 2);
      x = Math.sign(x || 1) * Math.max(Math.abs(x), 1.9);
      wheelP.push([x, y, z, rx, ry, rz, s, s, s]);
    }

    // Per-vehicle readability (round-4): a seeded brightness tone per
    // instance via instanceColor (CONFIG.WRECKS.tone, diffuse-only,
    // HDR allowed — same channel the mesa haze tint uses) so near-camera
    // hulls can sit among the brighter instances; AND the vehicle nearest
    // the camera (min local z) is forced to the lightest paint variant at
    // tone max — the beauty/close framings live or die on that first hull.
    // Round-5 bloom cap: tone is clamped so texelCeil-linear × tone stays
    // ≤ WRECKS.albedoCap, measured against the WHITEST grouped-part tint
    // (paintedMetal/trim carry no color tint = 1.0), hence no per-variant
    // color math here. The appended [.., tone, tone, tone] tail is the
    // inst() instanceColor slot (6-8 stay unset: vehicles keep scale 1).
    if (veh.length) {
      const nearest = veh.reduce((a, b) => (b.p[2] < a.p[2] ? b : a));
      const toneCap = CONFIG.WRECKS.albedoCap / srgbLin(CONFIG.WRECK_ART.texelCeil / 255);
      const heroShadow = CONFIG.WRECKS.heroShadow;
      // Night rim separation (round-5): the cool multi rides the same
      // instanceColor channel AFTER the tone clamp — blue-biased albedo so
      // hull edges catch the moon instead of filling black. Dusk: identity.
      const rim = NIGHT ? CONFIG.WRECKS.nightRim : null;
      const r0 = rim ? rim[0] : 1, r1 = rim ? rim[1] : 1, r2 = rim ? rim[2] : 1;
      veh.forEach((e, i) => {
        const hero = e === nearest;
        // Lightest paint on the nearest vehicle AND (hero chunks) the
        // trailer: the beauty camera's readable semi read must not depend
        // on which variant the seed rolled (chunk 1 seed 1 rolled dark).
        if (hero || (index <= 1 && e.arch === "trailer")) e.v = 0;
        const tone = Math.min(
          hero ? CONFIG.WRECKS.tone.max : lerp(CONFIG.WRECKS.tone.min, CONFIG.WRECKS.tone.max, rng.next()),
          toneCap,
        );
        e.p.push(undefined, undefined, undefined, tone * r0, tone * r1, tone * r2);
        if (hero) {
          // Shrink the hero's fake contact shadow (hull bbox + soft skirt):
          // at the beauty pose its full footprint reached ~6.5 m toward the
          // camera and blanketed the frame bottom. Parallel to veh[] order.
          shadowP[i][6] *= heroShadow;
          shadowP[i][8] *= heroShadow;
        }
      });
    }

    // One InstancedMesh per (archetype, paint variant): grouped materials
    // keep each hull to 3-5 draws, and every vehicle gets its own paint.
    for (const archKey of ["sedan", "bus", "cab", "trailer"]) {
      for (let v = 0; v < PAINT_VARIANTS.length; v++) {
        const list = veh.filter((e) => e.arch === archKey && e.v === v).map((e) => e.p);
        if (!list.length) continue;
        group.add(inst(A[archKey], V[v], list, true));
      }
    }
    // Wheels: one instanced 2-group mesh (tire rubber + rim metal).
    record(group, "wheels", wheelP);
    // Fake contact shadows ground the hulls (sun shadows alone read floaty).
    record(group, "shadows", shadowP);

    // Debris: charred panels strewn around the wrecked vehicles themselves
    // (clustered on the crash, off the corridor), a few strays farther out.
    const debris = [];
    const inner = 1.9, outer = 7.4; // shoulder band; CORRIDOR_CLEAR stays free
    for (let d = 0; d < cfgW.debris; d++) {
      let x, z;
      if (veh.length && rng.chance(CONFIG.SCATTER.clusterFrac)) {
        const anchor = veh[rng.int(0, veh.length - 1)].p;
        x = anchor[0] + rng.range(-3.2, 3.2);
        z = anchor[2] + rng.range(-5, 5);
        x = Math.sign(anchor[0]) * clamp(Math.abs(x), inner, outer);
        z = 1 + wrapN(z - 1, CH - 2);
      } else {
        x = rng.sign() * rng.range(inner, outer);
        z = rng.range(1, CH - 1);
      }
      debris.push([
        x, rng.range(0.05, 0.2), z,
        rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI),
        rng.range(0.4, 1.5) * rng.range(CONFIG.SCATTER.scaleMin, CONFIG.SCATTER.scaleMax),
        rng.range(0.4, 1.0) * rng.range(CONFIG.SCATTER.scaleMin, CONFIG.SCATTER.scaleMax),
        rng.range(0.4, 1.6) * rng.range(CONFIG.SCATTER.scaleMin, CONFIG.SCATTER.scaleMax),
      ]);
    }
    record(group, "debris", debris);
    return group;
  }

  /** Shared roadside dressing: guardrail, streetlight, scrub, rocks, mesa, sign.
   *  chunkIndex gates the night hero lamp (see forceLit below). */
  function buildDressing(group, rng, dense, chunkIndex) {
    const G = CONFIG.GUARDRAIL;
    // Round-5 night light story: the menu dolly opening frame and the
    // staged=beauty convoy (chunk indices < STREETLIGHT.night.forceLitChunks)
    // always place their streetlight AND run it lit — seed-independent, so
    // the captured night view can never be a lampless black road. Pooling
    // note: a chunk built for a hero index keeps the lamp when recycled at a
    // later index (harmless: more lit lamps, same determinism).
    const forceLit = NIGHT && chunkIndex < CONFIG.STREETLIGHT.night.forceLitChunks;

    // Guardrail: continuous W-beam + posts with amber reflectors.
    record(group, "rails", [
      [-G.xInner, G.railY, CH / 2], [G.xInner, G.railY, CH / 2],
    ]);
    const posts = [];
    for (let z = 2; z < CH; z += G.postSpacing) {
      for (const side of [-1, 1]) {
        posts.push([side * G.xInner, 0, z, 0, side > 0 ? Math.PI : 0, 0]);
      }
    }
    // Posts draw as one painted-metal mesh (the archetype's leftover
    // reflector box is inert); the visible amber dots are the dedicated
    // reflector placements at the end of this builder.
    record(group, "posts", posts);

    // Dead streetlight (leans), alternating sides. At night a fraction run
    // (patchy grid power): emissive head + warm ground pool — 2 extra draws
    // per lit lamp. Dusk lamps stay dead. (Round-4: the additive volumetric
    // cones deleted — they read as hard-edged translucent triangles; the
    // raised pool opacity carries the light instead.)
    if (forceLit || rng.chance(CONFIG.STREETLIGHT.chance)) {
      const side = rng.sign();
      const z = rng.range(5, CH - 5);
      const rx = rng.range(-0.02, 0.06);
      const rz = rng.range(-0.1, 0.1);
      const ry = side > 0 ? Math.PI : 0;
      record(group, "streetlights", [[
        side * CONFIG.STREETLIGHT.x, 0, z, rx, ry, rz,
      ]]);
      if (kit && (forceLit || rng.chance(CONFIG.STREETLIGHT.night.litChance))) {
        // Anchor on the archetype's lamp point through the instance matrix
        // (the lean shifts the head up to ~0.8 m); the pool hangs
        // world-upright beneath it so it never clips the ground.
        const SLN = CONFIG.STREETLIGHT.night;
        const lampP = A.streetlightLamp;
        dummy.position.set(side * CONFIG.STREETLIGHT.x, 0, z);
        dummy.rotation.set(rx, ry, rz);
        dummy.updateMatrix();
        _vec.set(lampP.x, lampP.y, 0).applyMatrix4(dummy.matrix);
        record(group, "lampHeads", [[_vec.x, _vec.y, _vec.z, rx, ry, rz]]);
        record(group, "lampPools", [[
          _vec.x, SLN.pool.y, _vec.z, 0, 0, 0, SLN.pool.w, 1, SLN.pool.l,
        ]]);
        // Shambler anchor (placeShamblers): the night companion spawns in
        // this pool so the sodium light grounds + rims its silhouette.
        group.userData.lamp = { x: _vec.x, z: _vec.z };
      }
    }

    // Scrub bushes + boulders on the desert floor, clustered in drifts with
    // wide per-item scale variety (CONFIG.SCATTER), always off the lanes.
    const scrub = [];
    const nScrub = Math.round(CONFIG.SCRUB.perChunk * (dense ? 0.6 : 1));
    for (const [x, z] of scatter(rng, nScrub, CONFIG.SCRUB.xMin, CONFIG.SCRUB.xMax, CH)) {
      const s = rng.range(0.7, 1.9) * rng.range(CONFIG.SCATTER.scaleMin, CONFIG.SCATTER.scaleMax);
      scrub.push([
        x, -0.05, z,
        0, rng.range(0, Math.PI * 2), 0, s, s * rng.range(0.7, 1.2), s,
      ]);
    }
    record(group, "scrub", scrub);

    const rocks = [];
    for (const [x, z] of scatter(rng, CONFIG.ROCKS.perChunk, CONFIG.ROCKS.xMin, CONFIG.ROCKS.xMax, CH)) {
      const s = rng.range(0.25, 1.4) * rng.range(CONFIG.SCATTER.scaleMin, CONFIG.SCATTER.scaleMax);
      rocks.push([
        x,
        -0.03 + s * 0.32, z,
        rng.range(0, Math.PI), rng.range(0, Math.PI), rng.range(0, Math.PI),
        s, s * rng.range(0.55, 0.8), s,
      ]);
    }
    record(group, "rocks", rocks);

    // Mesas: distant silhouettes, never shadowed (outside the frustum).
    // Aerial perspective: instanceColor tints each mesa toward the sky haze
    // with LATERAL distance (scene fog covers the along-road axis) — near-road
    // mesas stay crisp, far ones melt into the horizon. Dusk lifts toward the
    // pale cool haze; night pulls deep blue (ember kept in red) and roughly
    // doubles the hemi/moon-lit rock so silhouettes hold a ~6-10% luminance
    // floor instead of filling black. One lathe variant per chunk keeps twin
    // summits inside a single InstancedMesh.
    if (rng.chance(CONFIG.MESAS.chance)) {
      const M = CONFIG.MESAS;
      const haze = NIGHT ? M.hazeTintNight : M.hazeTint;
      const variantIndex = rng.int(0, A.mesaVariants.length - 1);
      const tintAt = (x) => {
        const t = smooth(clamp01((Math.abs(x) - M.fadeNear) / (M.fadeFar - M.fadeNear))) * M.fadeMax;
        return [lerp(1, haze[0], t), lerp(1, haze[1], t), lerp(1, haze[2], t)];
      };
      const mesas = [];
      const n = rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        const w = rng.range(M.wMin, M.wMax);
        const h = rng.range(M.hMin, M.hMax);
        const x = rng.sign() * rng.range(M.xMin, M.xMax);
        const z = rng.range(0, CH);
        const [tr, tg, tb] = tintAt(x);
        mesas.push([
          x, 0, z, 0, rng.range(0, Math.PI), 0, w, h, w * rng.range(0.7, 1.2),
          tr, tg, tb,
        ]);
        // Twin summit: overlapping shoulder peak beside the main one, so
        // ridgelines read as double-peak massifs instead of lone cones.
        if (rng.chance(M.twinChance)) {
          const w2 = w * rng.range(0.45, 0.7);
          const h2 = h * rng.range(0.55, 0.85);
          const x2 = x + Math.sign(x) * rng.range(0.35, 0.6) * w;
          const [tr2, tg2, tb2] = tintAt(x2);
          mesas.push([
            x2, 0, z + rng.range(-0.25, 0.25) * w, 0, rng.range(0, Math.PI), 0,
            w2, h2, w2 * rng.range(0.7, 1.2), tr2, tg2, tb2,
          ]);
        }
      }
      record(group, "mesas", mesas, variantIndex);
    }

    // Guide sign on the right shoulder (chance-gated). At night a small warm
    // lightPool quad under the panel grounds the dimmed legend (the sign
    // read as emissive with zero spill — see SIGNS.night config).
    if (rng.chance(CONFIG.SIGNS.chance)) {
      const sz = rng.range(6, CH - 6);
      record(group, "signPosts", [
        [CONFIG.SIGNS.x - 1.0, 1.45, sz], [CONFIG.SIGNS.x + 1.0, 1.45, sz],
      ]);
      record(group, "signBacks", [[CONFIG.SIGNS.x, 2.5, sz]]);
      record(group, "signPanels", [[
        // 6 mm proud of the backing, yaw PI to face oncoming traffic.
        CONFIG.SIGNS.x, 2.5, sz - 0.036, 0, Math.PI, 0,
      ]]);
      if (kit) {
        const SP = CONFIG.SIGNS.night.pool;
        record(group, "signSpills", [[CONFIG.SIGNS.x, SP.y, sz, 0, 0, 0, SP.w, 1, SP.l]]);
      }
    }

    // Reflector dots: one draw, per-post brightness from the chunk rng as HDR
    // instanceColor (retroreflection: some posts catch more than others).
    // Kept last so the shared rng stream for scrub/rocks/mesas/sign matches
    // the r2 captures.
    const R = CONFIG.GUARDRAIL.reflector;
    const refY = CONFIG.GUARDRAIL.postH - 0.12;
    const refs = [];
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      let b;
      if (NIGHT) b = lerp(R.night[0], R.night[1], rng.next());
      else if (rng.chance(R.dusk.glintChance)) b = rng.range(R.dusk.glint[0], R.dusk.glint[1]);
      else b = rng.range(R.dusk.dim[0], R.dusk.dim[1]);
      refs.push([
        p[0], refY, p[2] + (p[0] > 0 ? R.zOff : -R.zOff), 0, p[4], 0,
        1, 1, 1, b, b, b,
      ]);
    }
    record(group, "reflectors", refs);
  }

  world.registerChunkType("plain", (rng, ctx) => {
    const group = new THREE.Group();
    buildDressing(group, rng, false, ctx.index);
    placeShamblers(group, rng, "plain", ctx.index);
    return group;
  });

  world.registerChunkType("wreck", (rng, ctx) => {
    const group = buildWrecks(rng, "wreck", ctx.index, ctx.gameplay);
    buildDressing(group, rng, false, ctx.index);
    placeShamblers(group, rng, "wreck", ctx.index);
    return group;
  });

  world.registerChunkType("convoy", (rng, ctx) => {
    const group = buildWrecks(rng, "convoy", ctx.index, ctx.gameplay);
    buildDressing(group, rng, true, ctx.index);
    placeShamblers(group, rng, "convoy", ctx.index);
    return group;
  });

  return { shamblers, dressing: dressingPool };
}
