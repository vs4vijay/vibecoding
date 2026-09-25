// "The Static" — chaser wall behind the player (W1-VIS). A curved shader wall
// lurks just behind the camera (never visible during a run) and SWALLOWS the
// screen on death; a torn static fringe bleeds in from the top screen edge as
// intensity rises (near-misses, phase escalation — Temple-Run chaser dread).
// API: Static.init(scene, bus, camera) · Static.setIntensity(0..1)
// Per-frame work happens in onBeforeRender — no main-loop wiring needed.
import * as THREE from 'three';

const WALL_R = 46;
const WALL_Z = 56;          // nearest surface z = WALL_Z - WALL_R = 10 (behind camera at 7.6)
const WALL_H = 170;
const WALL_ARC = 3.6;       // arc wide enough that its ends never clip the frustum
                            // even when the wall has swallowed forward to z=-27

const NOISE_GLSL = /* glsl */`
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
      mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
  }
`;

const state = {
  I: 0.12,            // current intensity 0..1
  base: 0.12,         // passive baseline (rises within a phase)
  phaseT0: 0,
  swallow: 0,
  swallowT: 0,
  last: 0,
};

let wall = null;
let wallMat = null;
let fringe = null;
let fringeMat = null;
let pool = null;
let poolMat = null;
let cam = null;

function makeWall() {
  wallMat = new THREE.ShaderMaterial({
    fog: false,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.12 },
      uSwallow: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying float vY;
      void main() {
        vUv = uv;
        vY = position.y / ${ (WALL_H / 2).toFixed(1) };
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uIntensity;
      uniform float uSwallow;
      varying vec2 vUv;
      varying float vY;
      ${NOISE_GLSL}
      void main() {
        float I = max(uIntensity, uSwallow);
        float y = vY * 0.5 + 0.5;

        // per-pixel CRT grain (re-rolled ~20x/s) — the "static" in The Static
        float grain = hash12(gl_FragCoord.xy + floor(uTime * 20.0) * 7.31);

        // ---- STRUCTURED VERTICAL GLITCH BARS (the chaser's silhouette) ----
        // ~44 towers of corruption across the arc; each column re-rolls its
        // height/brightness on its own clock and slides vertically, so the
        // wall reads as a WALL — not a faint random red haze (r3 critic).
        float colW = 1.0 / 44.0;
        float cid = floor(vUv.x / colW);
        float cu = fract(vUv.x / colW);
        float cSeed = hash12(vec2(cid, 7.31));
        float cTick = floor(uTime * (1.5 + cSeed * 4.5) + cSeed * 40.0);
        float cR = hash12(vec2(cid * 13.73, cTick));
        float colOn = step(1.0 - (0.30 + I * 0.45), cR);
        // vertical slide + height mask per column (bars are taller low — they
        // loom over the road the player is being chased down)
        float slide = (hash12(vec2(cid * 3.71, cTick)) - 0.5) * 0.35;
        float yc = fract(y * 1.15 + slide);
        float colH = 0.55 + 0.45 * hash12(vec2(cid * 5.17, cTick * 0.7));
        float colMask = colOn * (1.0 - smoothstep(colH - 0.12, colH + 0.05, yc))
                              * smoothstep(0.02, 0.10, yc);
        // feathered hot edge on one side of each bar (the "maw" lighting)
        float side = step(0.5, hash12(vec2(cid * 9.31, 1.7)));
        float edgeX = (side > 0.5) ? cu : 1.0 - cu;   // GLSL ternary needs a bool
        float barEdge = (1.0 - smoothstep(0.0, 0.16, edgeX)) * colMask;
        // coarse signal texture inside the bars
        float barN = vnoise(vec2(vUv.x * 46.0, y * 22.0 - uTime * 1.6));
        float barBody = colMask * (0.35 + 0.65 * barN);

        // horizontal tear rows: shift + re-roll on a fast clock
        float row = floor(y * 90.0);
        float rowSeed = hash12(vec2(row, floor(uTime * 9.0)));
        float tearOn = step(1.0 - (0.10 + I * 0.30), rowSeed);
        float xShift = (rowSeed - 0.5) * 0.22 * tearOn;

        // RGB-split sampled structural noise (coarse, for shape)
        float off = 0.010 + I * 0.024 + uSwallow * 0.012;
        float t = uTime * 0.5;
        float nr = vnoise(vec2(vUv.x * 14.0 + xShift + off, y * 7.0 - t));
        float nb = vnoise(vec2(vUv.x * 14.0 + xShift - off, y * 7.0 - t));
        float tear = tearOn * (0.20 + 0.55 * nr);

        vec3 col = vec3(0.008, 0.002, 0.016);
        // bar core + hot feathered edge (hue-dominant red — never white)
        col += vec3(0.42, 0.025, 0.085) * barBody * (0.75 + 0.5 * I);
        col += vec3(1.25, 0.10, 0.24) * barEdge * (0.65 + 0.55 * sin(uTime * 7.0 + cid));
        col += vec3(1.0, 0.10, 0.24) * tear;                        // torn row glow
        col += vec3(1.0, 0.05, 0.20) * nr * 0.16;                   // red channel split
        col += vec3(0.05, 0.55, 0.75) * nb * 0.12;                  // cyan counter-split
        col += vec3(0.65, 0.03, 0.40) * abs(nr - nb) * 0.30;        // magenta fringe
        col += vec3(1.0, 0.14, 0.28) * pow(grain, 5.0) * (0.22 + I * 0.42); // red grain
        // dim red ambient across the whole wall — lifts the dark quadrants
        // (the bottom-left used to read as a dead void behind the death UI)
        col += vec3(0.085, 0.008, 0.022) * (0.35 + 0.65 * I);
        // r4b: hot foot — the chaser's leading edge where it meets the road,
        // so the wall grounds on the horizon instead of floating as haze
        float foot = exp(-pow((y - 0.5) * 30.0, 2.0));
        col += vec3(1.30, 0.15, 0.28) * foot * (0.30 + 0.70 * uSwallow) * (0.45 + 0.55 * nr);
        col *= 0.80 + 0.20 * sin(y * 900.0 + uTime * 34.0);         // fine scanlines
        col *= mix(0.42, 1.15, smoothstep(1.0, 0.22, y));           // dark crown (lifted)

        // veil: edge-weighted so the world stays readable behind the death UI.
        // edgeU feathers the cylinder's arc ends — the raw mesh edge used to
        // show as a hard vertical seam at the top of the death frame.
        float edgeU = smoothstep(0.0, 0.10, vUv.x) * (1.0 - smoothstep(0.90, 1.0, vUv.x));
        float center = 1.0 - smoothstep(0.10, 0.52, abs(vUv.x - 0.5) * 2.0);
        float alpha = 1.0;
        float holes = vnoise(vec2(vUv.x * 26.0, y * 18.0 + uTime * 0.5));
        alpha *= smoothstep(0.03, 0.30, holes + uSwallow * 0.42);           // sparse torn holes
        alpha *= smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(0.84, 1.0, y));
        alpha *= edgeU;
        alpha *= mix(1.0, 0.30, center * (0.35 + 0.65 * uSwallow));         // clearer center
        // bars push their own alpha so the silhouette survives the veil
        alpha = max(alpha, (barBody * 0.62 + barEdge * 0.85) * (0.30 + 0.70 * uSwallow));
        alpha *= 0.44 + 0.18 * nr;                                          // world stays visible

        gl_FragColor = vec4(col * 1.6, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.CylinderGeometry(WALL_R, WALL_R, WALL_H, 48, 1, true,
    Math.PI - WALL_ARC / 2, WALL_ARC);
  const m = new THREE.Mesh(geo, wallMat);
  m.position.set(0, WALL_H / 2 - 4, WALL_Z);
  m.frustumCulled = false;
  m.visible = false;
  m.renderOrder = 800;
  return m;
}

function makeFringe() {
  fringeMat = new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uAlpha: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uAlpha;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 g = vec2(vUv.x * 90.0, vUv.y * 26.0);
        vec2 id = floor(g);
        float cellH = hash12(id);
        float stepT = floor(uTime * 8.0 + cellH * 13.0);
        float corrupt = hash12(id + stepT);
        float n = vnoise(vec2(vUv.x * 30.0, vUv.y * 6.0 - uTime * 1.4));

        // torn "eating" edge along the bottom of the band
        float edgeN = vnoise(vec2(vUv.x * 14.0, 3.7)) * 0.5 + n * 0.5;
        float body = smoothstep(0.0, 0.20 + edgeN * 0.55, vUv.y);

        // scanline/RGB-shift corruption: thin tear rows + channel split. The
        // old whole-cell white flashes and magenta posterize blobs read as
        // broken placeholder geometry at the top of the hopper camera — the
        // band is now pure signal corruption: tears + grain + scanlines.
        float row = floor(vUv.y * 90.0);
        float rowSeed = hash12(vec2(row, floor(uTime * 9.0)));
        float tear = step(0.90 - corrupt * 0.12, rowSeed);
        vec3 col = vec3(0.020, 0.004, 0.020);
        col += vec3(1.0, 0.12, 0.30) * tear * (0.30 + 0.5 * n);
        col += vec3(0.05, 0.50, 0.70) * pow(n, 2.0) * 0.35;
        col += vec3(1.0, 0.16, 0.84) * pow(max(0.0, n - 0.72), 2.0) * 0.55;
        float grain = hash12(gl_FragCoord.xy + floor(uTime * 20.0) * 7.31);
        col += vec3(1.0, 0.14, 0.26) * pow(grain, 4.0) * 0.55;
        col *= 0.82 + 0.18 * sin(vUv.y * 260.0 + uTime * 20.0);

        float a = uAlpha * body * (0.30 + 0.70 * n) * (0.45 + 0.55 * corrupt);
        gl_FragColor = vec4(col * 1.6, clamp(a, 0.0, 1.0) * 0.75);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fringeMat);
  m.frustumCulled = false;
  m.renderOrder = 900;
  m.visible = false;
  return m;
}

// r4b ground corruption pool — the swallow was depth-occluded by the road
// below the horizon line, so the lower frame (death UI's flanks) had no chaser
// presence at all: the bottom-left read as a dead void. This additive pool
// spreads the same structured corruption across the tarmac itself, anchored in
// world space around the camera. Death-only (drives with uSwallow).
function makePool() {
  poolMat = new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSwallow: { value: 0 },
      uCam: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uSwallow;
      uniform vec2 uCam;
      varying vec2 vUv;
      varying vec3 vW;
      ${NOISE_GLSL}
      void main() {
        float dx = vW.x - uCam.x;
        float dz = vW.z - uCam.y;
        float d = length(vec2(dx, dz));
        // world-anchored angular columns — the same corruption language as the
        // wall, so pool + wall read as ONE chaser
        float ang = atan(dz, dx);
        float u = ang * 5.73;                       // ~1 unit per 10°
        float colW = 1.0 / 40.0;
        float cid = floor(u / colW);
        float cu = fract(u / colW);
        float cSeed = hash12(vec2(cid, 3.1));
        float cTick = floor(uTime * (1.5 + cSeed * 4.0) + cSeed * 40.0);
        float cR = hash12(vec2(cid * 13.73, cTick));
        float colOn = step(1.0 - 0.55, cR);
        float colH = 0.35 + 0.65 * hash12(vec2(cid * 5.17, cTick * 0.7));
        // radial "reach" of the corruption (hot near the camera, tendrils out)
        float reach = smoothstep(1.05, 0.10, d / 44.0);
        float colMask = colOn * reach * (1.0 - smoothstep(colH - 0.15, colH, d / 44.0));
        float n = vnoise(vec2(vW.x * 0.55, vW.z * 0.55 - uTime * 1.4));
        float body = colMask * (0.30 + 0.70 * n);
        // feathered leading edge on one side of each column
        float side = step(0.5, hash12(vec2(cid * 9.31, 1.7)));
        float edgeX = (side > 0.5) ? cu : 1.0 - cu;
        float edge = (1.0 - smoothstep(0.0, 0.14, edgeX)) * colMask;
        float grain = hash12(gl_FragCoord.xy + floor(uTime * 20.0) * 7.31);

        vec3 col = vec3(0.020, 0.002, 0.010);
        col += vec3(0.38, 0.02, 0.075) * body * 1.1;
        col += vec3(1.15, 0.10, 0.22) * edge * (0.55 + 0.45 * sin(uTime * 7.0 + cid));
        col += vec3(0.85, 0.07, 0.18) * vnoise(vec2(vW.x * 1.7, vW.z * 1.7 + uTime * 2.2)) * reach * 0.35;
        col += vec3(1.0, 0.13, 0.26) * pow(grain, 5.0) * 0.40 * reach;
        col += vec3(0.05, 0.45, 0.62) * pow(n, 3.0) * 0.18 * reach;   // cyan counter-glint
        // tearing rifts radiating out (the road being eaten open)
        float rift = pow(max(0.0, sin(ang * 14.0 + n * 5.0) * 0.5 + 0.5), 7.0);
        col += vec3(1.1, 0.16, 0.30) * rift * reach * (0.25 + 0.55 * n);
        col *= 0.85 + 0.15 * sin(d * 7.0 - uTime * 22.0);             // pulse rings

        float a = uSwallow * (0.16 + 0.84 * (body + edge * 0.7)) * reach;
        gl_FragColor = vec4(col * 1.5, clamp(a, 0.0, 0.85));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(46, 40), poolMat);
  m.rotation.x = -Math.PI / 2;
  m.frustumCulled = false;
  m.renderOrder = 790;
  m.visible = false;
  return m;
}

function reset() {
  state.I = 0.12;
  state.base = 0.12;
  state.swallowT = 0;
  state.phaseT0 = state.last;
}

function update() {
  const t = performance.now() / 1000;
  let dt = t - state.last;
  state.last = t;
  if (dt <= 0 || dt > 0.5) dt = 0.016;
  if (state.swallowT > 0) {
    state.swallow = Math.min(1, state.swallow + dt * 5.0);
  } else if (state.swallow > 0) {
    state.swallow = Math.max(0, state.swallow - dt * 3.0);
  }
  // passive rise within a phase + relax toward baseline
  const phaseRise = Math.min(1, (t - state.phaseT0) / 45) * 0.18;
  const target = Math.min(1, state.base + phaseRise);
  state.I += (Math.max(target, state.I) - state.I) * Math.min(1, dt * 0.6);
  if (state.I > target) state.I += (target - state.I) * Math.min(1, dt * 0.30);

  if (wallMat) {
    wallMat.uniforms.uTime.value = t;
    wallMat.uniforms.uIntensity.value = state.I;
    wallMat.uniforms.uSwallow.value = state.swallow;
    wall.position.z = WALL_Z - state.swallow * 37;   // nearest face 10 → -27 (swallows camera)
    wall.visible = state.swallow > 0.002;
  }
  if (poolMat && cam) {
    poolMat.uniforms.uTime.value = t;
    poolMat.uniforms.uSwallow.value = state.swallow;
    poolMat.uniforms.uCam.value.set(cam.position.x, cam.position.z);
    pool.position.set(cam.position.x, 0.05, cam.position.z);
    pool.visible = state.swallow > 0.004;
  }
  if (fringeMat && cam) {
    fringeMat.uniforms.uTime.value = t;
    // only bleed in on real danger — at the passive baseline (~0.12-0.30) the
    // band read as a broken post effect drifting over calm gameplay
    const it = THREE.MathUtils.smoothstep(state.I, 0.42, 0.95);
    fringeMat.uniforms.uAlpha.value = it * (1 - state.swallow) * 0.85;
    const d = 3.0;
    const hh = Math.tan(cam.fov * Math.PI / 360) * d;
    const hw = hh * Math.max(cam.aspect, 0.5);
    const intrude = it * hh * 1.05;
    const H = hh * 1.2;
    const yBottom = hh - intrude;
    fringe.scale.set(hw * 2.3, H, 1);
    fringe.position.set(0, yBottom + H / 2, -d);
    fringe.visible = fringeMat.uniforms.uAlpha.value > 0.004;
  }
}

export const Static = {
  init(scene, bus, camera) {
    if (wall) return;
    cam = camera;
    scene.add(camera);              // so the camera-locked fringe renders
    wall = makeWall();
    scene.add(wall);
    pool = makePool();
    scene.add(pool);
    fringe = makeFringe();
    camera.add(fringe);
    state.last = performance.now() / 1000;

    bus.on('near-miss', () => { state.I = Math.min(1, state.I + 0.16); });
    bus.on('death', () => { state.I = 1; state.swallowT = 1; });
    bus.on('run:start', reset);
    bus.on('phase:start', () => { state.I = Math.min(state.I, 0.30); state.base = 0.12; state.phaseT0 = state.last; });
    bus.on('ui:screen', (s) => { if (s === 'menu') reset(); });

    // runs on every render (renderer calls scene.onBeforeRender unconditionally)
    scene.onBeforeRender = update;
  },

  // external override (later waves may wire mistake/fever drivers)
  setIntensity(v) {
    state.I = Math.min(1, Math.max(0, v));
    state.base = state.I;
  },
  get intensity() { return state.I; },
};
