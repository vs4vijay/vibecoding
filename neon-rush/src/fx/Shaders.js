// The real sky + floor (W1-VIS). Replaces the W0 placeholder factories.
//   makeSky()  → dome Mesh (gradient, banded sun, stars, nebula, dither)
//   makeFloor()→ grid floor Mesh — factory contract identical to Track's default:
//                uniforms uScroll/uTime are fed by Track.applyRender (userData.isDefault)
// All shader meshes self-animate via onBeforeRender (uTime), so no per-frame
// wiring is needed and photo-mode renders still animate coherently.
import * as THREE from 'three';
import { COL } from '../core/Palette.js';

const GLSL_COMMON = /* glsl */`
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
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

// ---------------------------------------------------------------------------
// SKY DOME
// ---------------------------------------------------------------------------
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: COL.deep.clone() },
      uMagenta: { value: COL.magenta.clone() },
      uGold: { value: COL.gold.clone() },
      uOrange: { value: COL.orange.clone() },
      uCyanHaze: { value: COL.cyan.clone() },
      // per-scene sun budget (visual only): phases with a bright emissive
      // target of their own (stack's gold perfect zone) pull the sun down so
      // the two hot regions stay separable. Default 1 — no other scene changes.
      uSunGain: { value: 1.0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position; // raw position — normalized PER FRAGMENT in the shader
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uMagenta;
      uniform vec3 uGold;
      uniform vec3 uOrange;
      uniform vec3 uCyanHaze;
      uniform float uSunGain;
      varying vec3 vDir;
      ${GLSL_COMMON}

      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;

        // ---- multi-stop gradient -------------------------------------------
        vec3 cZenith  = uDeep * 1.25;                                  // #0e0620-ish
        vec3 cHigh    = vec3(0.055, 0.020, 0.150);                     // deep violet
        vec3 cMid     = vec3(0.160, 0.055, 0.360);                     // purple
        vec3 cLow     = vec3(0.420, 0.110, 0.520);                     // magenta-purple
        vec3 above = mix(cLow, cMid, smoothstep(0.045, 0.16, h));
        above = mix(above, cHigh, smoothstep(0.16, 0.42, h));
        above = mix(above, cZenith, smoothstep(0.42, 0.85, h));

        // below the horizon: sink to near-black so the fogged floor merges
        vec3 below = mix(uDeep * 1.15, uDeep * 0.55, smoothstep(0.0, -0.30, h));
        vec3 col = mix(above, below, smoothstep(0.012, -0.014, h));

        // ---- horizon glow band (sits just above the true horizon) ----------
        float glowBand = exp(-abs(h - 0.038) * 30.0);
        col += uMagenta * glowBand * 0.50;
        col += vec3(1.0, 0.42, 0.78) * exp(-abs(h - 0.030) * 70.0) * 0.38;
        col += uCyanHaze * exp(-abs(h - 0.004) * 190.0) * 0.12;
        col += uMagenta * 0.10 * exp(-abs(h - 0.05) * 9.0);   // wide soft wash

        // ---- slow nebula bands (upper-mid sky) -----------------------------
        vec2 np = vec2(atan(dir.x, dir.z) * 2.6, h * 7.0);
        float n1 = vnoise(np * 1.4 + vec2(uTime * 0.006, 0.0));
        float n2 = vnoise(np * 3.1 + vec2(uTime * 0.011, 7.7));
        float neb = n1 * 0.65 + n2 * 0.35;
        float nebMask = smoothstep(0.08, 0.30, h) * smoothstep(0.95, 0.45, h);
        col += mix(vec3(0.10, 0.03, 0.22), vec3(0.0, 0.10, 0.16), n2) *
               pow(neb, 2.4) * nebMask * 0.85;

        // ---- banded retro sun ----------------------------------------------
        vec3 sunDir = normalize(vec3(0.0, 0.115, -1.0));
        float ang = acos(clamp(dot(dir, sunDir), -1.0, 1.0));
        float R = 0.132;
        if (ang < R * 2.6) {
          float edge = smoothstep(R + 0.004, R - 0.012, ang);
          float band = clamp((dir.y - (sunDir.y - R)) / (2.0 * R), 0.0, 1.0);
          float wob = 0.030 * sin(uTime * 0.55 + band * 9.0)
                    + 0.016 * sin(uTime * 1.6 - band * 23.0);
          float phase = band * 9.5 - uTime * 0.20 + wob;
          float stripe = smoothstep(0.10, 0.34, abs(fract(phase) - 0.5) * 2.0);
          float gapW = smoothstep(0.66, 0.10, band);      // gaps only low on the disc
          float cut = 1.0 - gapW * (1.0 - stripe);
          vec3 sunCol = mix(vec3(1.0, 0.96, 0.80), uGold, smoothstep(1.0, 0.70, band));
          sunCol = mix(sunCol, uOrange * 1.25, smoothstep(0.72, 0.34, band));
          sunCol = mix(sunCol, uMagenta * 1.25, smoothstep(0.36, 0.02, band));
          col = mix(col, sunCol * 1.9 * uSunGain, edge * cut);
          col += sunCol * edge * 0.12 * uSunGain;          // hot rim behind the cuts
          // halo: tight + wide. r12: the wide gold falloff tightened (2.6 →
          // 3.15, 0.34 → 0.30) and the horizontal flare trimmed (0.14 → 0.115,
          // narrower spread) — at run speed the old halo pooled over the
          // vanishing point and softened far-road hazard contrast. Sun core,
          // bands and rim untouched (menu read 8.7 on exactly that look).
          col += uGold * exp(-pow(ang / R, 2.0) * 3.15) * 0.30 * uSunGain;
          col += uMagenta * exp(-ang * 7.5) * 0.30 * uSunGain;
          // horizontal flare streak at the sun's latitude
          col += vec3(1.0, 0.62, 0.85) *
                 exp(-pow((dir.y - sunDir.y) * 26.0, 2.0)) * exp(-abs(dir.x) * 9.0) * 0.115 * uSunGain;
        }

        // ---- stars (upper sky, sparse, twinkling) ---------------------------
        float starField = 0.0;
        if (h > 0.16) {
          vec3 sp = dir * 110.0;
          vec3 cell = floor(sp);
          vec3 j = vec3(hash13(cell), hash13(cell + 17.1), hash13(cell + 43.7));
          float d = length(fract(sp) - j);
          float pick = step(0.955, hash13(cell + 91.3));
          float tw = 0.55 + 0.45 * sin(uTime * (0.6 + j.x * 2.4) + j.y * 40.0);
          starField = smoothstep(0.16, 0.02, d) * pick * tw;
          starField *= smoothstep(0.16, 0.34, h);                    // fade in high
          starField *= 1.0 - smoothstep(0.10, 0.42, 1.0 - ang / R);  // not over the sun
          col += vec3(0.85, 0.92, 1.0) * starField * 1.05;
        }

        // ---- dither (kills gradient banding) --------------------------------
        col += (hash12(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 28), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
  return sky;
}

// ---------------------------------------------------------------------------
// GRID FLOOR
// ---------------------------------------------------------------------------
export function makeFloor() {
  const geo = new THREE.PlaneGeometry(120, 1600);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    depthWrite: true,
    uniforms: {
      uScroll: { value: 0 },
      uTime: { value: 0 },
      uDeep: { value: COL.deep.clone() },
      uGrid: { value: COL.grid.clone() },
      uCyan: { value: COL.cyan.clone() },
      uMagenta: { value: COL.magenta.clone() },
      uGold: { value: COL.gold.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uScroll;
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uGrid;
      uniform vec3 uCyan;
      uniform vec3 uMagenta;
      uniform vec3 uGold;
      varying vec3 vWorld;
      varying float vDist;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // anti-aliased line mask: coord in world units, cell = spacing,
      // halfW = line half-width in world units. Fades out before it can moiré.
      float lineAA(float coord, float cell, float halfW) {
        float q = coord / cell;
        float d = abs(fract(q - 0.5) - 0.5) * cell;
        float aa = max(fwidth(coord), 1e-4);
        float m = 1.0 - smoothstep(halfW - aa, halfW + aa, d);
        float fp = aa * 2.0;                       // pixel footprint
        m *= smoothstep(cell * 1.6, cell * 0.8, fp); // fade before aliasing
        return m;
      }

      void main() {
        float x = vWorld.x;
        float z = vWorld.z - uScroll;              // track-space coordinate
        float ax = abs(x);

        // base: slightly darker "road" between the rails, deep neon floor outside
        float road = smoothstep(5.1, 4.35, ax);
        vec3 col = mix(uDeep * 1.35, uDeep * 0.95, road);

        // ---- grid lines (minor + major), fading to fog with distance --------
        // roadway mask: the survey grid lives OUTSIDE the rails only — full-width
        // scanlines used to cut straight through the lane rails (r1 critic).
        // r2 fix: the far flank keeps a faint MAJOR grid + sparse lit "data
        // shards" so the outer third of frame is never a dead black void.
        // r6: the Mz major line was ALSO composited unmasked (Mz * 0.50) — it
        // sliced full-width across the road every 40 m of track, reading as a
        // chunk-seam artifact at rest (run/menu/stack). Major z lines now live
        // on the far flank only, same as the majors in x.
        float sideFade = (1.0 - smoothstep(14.0, 38.0, ax)) * smoothstep(4.62, 5.65, ax);
        float sideFar = smoothstep(4.62, 6.2, ax) * (1.0 - smoothstep(34.0, 88.0, ax));
        float distGlow = min(vDist * 0.0006, 0.05);
        float mx = lineAA(x, 2.6, 0.030 + distGlow) * sideFade;
        float Mx = lineAA(x, 13.0, 0.052 + distGlow);
        float MxNear = Mx * sideFade;
        float MxFar = Mx * sideFar * 0.30;
        float mz = lineAA(z, 8.0, 0.026 + distGlow) * sideFade;
        float MzFar = lineAA(z, 40.0, 0.048 + distGlow) * sideFar * 0.30;
        vec3 lineCol = uGrid * (mx * 0.38 + mz * 0.28)
                     + mix(uGrid, uCyan, 0.22) * (MxNear * 0.70)
                     + mix(uGrid, uMagenta, 0.30) * (MxFar + MzFar);

        // lane divider dashes (scroll with the track → speed you can feel)
        float dashPhase = fract(z / 6.0);
        float dash = step(dashPhase, 0.40);
        float dxa = max(fwidth(x), 1e-4);
        float dxm = min(abs(x - 1.3), abs(x + 1.3));
        float dl = 1.0 - smoothstep(0.055 - dxa, 0.055 + dxa, dxm);
        lineCol += mix(uCyan, uGrid, 0.35) * dl * dash * 0.30;

        // ---- flank data shards: sparse emissive plots (the "city glow" life
        // that keeps the outer frame alive at r2) -----------------------------
        vec2 shardCell = floor(vec2(x / 4.8, z / 7.2));
        float sh = hash12(shardCell + 7.31);
        if (sh > 0.90 && ax > 6.0) {
          vec2 lp = fract(vec2(x / 4.8, z / 7.2)) - 0.5;
          float d2 = dot(lp, lp);
          float core = smoothstep(0.045, 0.004, d2);
          float halo = smoothstep(0.16, 0.02, d2) * 0.30;
          vec3 shardCol = sh > 0.975 ? uGold : sh > 0.94 ? uMagenta : uCyan;
          float tw = 0.75 + 0.25 * sin(uTime * (0.6 + sh * 2.2) + sh * 44.0);
          lineCol += shardCol * (core * 1.05 + halo) * tw
                   * smoothstep(5.4, 7.5, ax) * (1.0 - smoothstep(30.0, 80.0, ax));
        }

        // ---- lane rails: white-hot core, cyan body, magenta halo ------------
        float rd = abs(ax - 4.55);
        float raa = max(fwidth(rd), 1e-4);
        float core = 1.0 - smoothstep(0.045 - raa, 0.045 + raa, rd);
        float body = 1.0 - smoothstep(0.10, 0.30, rd);
        float halo = 1.0 - smoothstep(0.18, 1.35, rd);
        lineCol += vec3(1.0) * core * 1.15
                 + uCyan * body * 0.85
                 + uMagenta * halo * 0.30;

        // ---- pulse wave sweeping down the track ------------------------------
        // rides grid + rails only (the old constant term washed the whole
        // roadway with a full-width scanline)
        float pf = fract((z + uTime * 34.0) / 150.0);
        float pulse = exp(-pf * pf * 800.0);
        lineCol += uCyan * pulse * 0.16 * (mx * 0.4 + mz * 0.4 + body * 0.6);

        // ---- sun reflection column (shimmering, far ahead) -------------------
        float refl = exp(-x * x * 0.55)
                   * smoothstep(30.0, 200.0, -z)
                   * (0.60 + 0.40 * sin(z * 1.9 - uTime * 2.4));
        lineCol += mix(uMagenta, uGold, 0.35) * refl * 0.12 * (road * 0.7 + 0.3);

        col += lineCol;

        // fog match (FogExp2 #0b0518, density 0.0075)
        float fade = exp(-pow(vDist * 0.0075, 2.0));
        col = mix(uDeep, col, fade);
        col += (hash12(gl_FragCoord.xy) - 0.5) * (1.2 / 255.0); // subtle dither
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, -380);
  // Track contract: isDefault=true → applyRender feeds uScroll/uTime
  mesh.userData.isDefault = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// DRIFT RIBBON — road + shoulders in ONE mesh (1 draw call). uv.x encodes the
// lateral region: road verts span [-2,-1] (interpolating -1.5 = centerline),
// shoulder verts span [0..1] with 1 = inner edge (kiss the rails). uv.y is the
// track-space distance so every pattern scrolls with the world for free.
// ---------------------------------------------------------------------------
export function makeDriftRibbonMaterial() {
  const mat = new THREE.ShaderMaterial({
    fog: false,
    depthWrite: true,
    uniforms: {
      uScroll: { value: 0 },
      uTime: { value: 0 },
      uDeep: { value: COL.deep.clone() },
      uGrid: { value: COL.grid.clone() },
      uCyan: { value: COL.cyan.clone() },
      uMagenta: { value: COL.magenta.clone() },
      uGold: { value: COL.gold.clone() },
    },
    vertexShader: /* glsl */`
      attribute vec2 aRib;
      varying vec2 vRib;
      varying float vDist;
      void main() {
        vRib = aRib;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uScroll;
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uGrid;
      uniform vec3 uCyan;
      uniform vec3 uMagenta;
      uniform vec3 uGold;
      varying vec2 vRib;
      varying float vDist;
      ${GLSL_COMMON}

      void main() {
        float edge = vRib.x;             // -2..-1 road (center -1.5) · 0..1 shoulder
        float u = vRib.y;                // track-space distance
        vec3 col;

        if (edge < -0.5) {
          // ---- roadway: dark asphalt + flowing center dashes + cross banding
          float t = clamp(-edge - 1.0, 0.0, 1.0);          // 0..1 across the road
          col = mix(vec3(0.024, 0.015, 0.052), vec3(0.034, 0.021, 0.070),
                    0.5 + 0.5 * sin(u * 0.9));
          // lane dashes ride the centerline (speed cue)
          float dash = step(fract((u + uTime * 0.0) / 6.0), 0.38);
          float dc = 1.0 - smoothstep(0.05, 0.16, abs(t - 0.5));
          col += mix(uCyan, uGrid, 0.4) * dash * dc * 0.38;
          // faint grid keeping the asphalt from reading as a flat slab
          float gx = abs(fract(u / 13.0) - 0.5) * 13.0;
          col += uGrid * (1.0 - smoothstep(0.05, 0.14, gx)) * 0.045;
        } else {
          // ---- shoulder: violet dusk field, hot magenta kiss at the rails,
          // flowing energy bands + sparse light pools. r2f: per-cell mottle +
          // faint cross grid so the field never reads as one flat magenta
          // plane (the horizon terrain plane carries the far flank).
          float k = clamp(edge, 0.0, 1.0);
          vec3 outer = vec3(0.013, 0.007, 0.034);
          vec3 inner = vec3(0.078, 0.022, 0.092);
          col = mix(outer, inner, pow(k, 1.6));
          // per-cell luminance mottle (kills the single-plane read)
          float mote = hash12(floor(vec2(k * 3.0, u / 7.5)) + 1.7);
          col *= 0.88 + 0.24 * mote;
          // faint cross grid (survey language, continues the run floor's)
          float gxx = abs(fract(k * 3.0) - 0.5);
          float gzx = abs(fract(u / 9.0) - 0.5) * 9.0;
          float gridm = (1.0 - smoothstep(0.03, 0.085, gxx)) * 0.5
                      + (1.0 - smoothstep(0.10, 0.26, gzx)) * 0.5;
          col += mix(uGrid, uMagenta, 0.35) * gridm * 0.045 * smoothstep(0.1, 0.7, k);
          // rails-adjacent hot edge (mirrors the run floor's magenta halo)
          col += uMagenta * (1.0 - smoothstep(0.0, 0.30, k)) * 0.42;
          col += vec3(1.0, 0.42, 0.85) * (1.0 - smoothstep(0.0, 0.05, k)) * 0.55;
          // energy bands flowing toward the camera (phase speed feel)
          float band = fract(u / 16.0 - uTime * 0.55);
          float flow = exp(-pow((band - 0.5) * 7.0, 2.0));
          col += uMagenta * flow * 0.13 * smoothstep(0.15, 0.9, k);
          float band2 = fract(u / 44.0 - uTime * 0.22 + 0.37);
          float flow2 = exp(-pow((band2 - 0.5) * 5.0, 2.0));
          col += mix(uMagenta, uCyan, 0.3) * flow2 * 0.05 * smoothstep(0.2, 1.0, k);
          // sparse cyan survey pools
          vec2 cell = floor(vec2(k * 3.0, u / 9.0));
          float h = hash12(cell + 3.7);
          if (h > 0.86) {
            float lp = fract(u / 9.0) - 0.5;
            col += uCyan * exp(-lp * lp * 42.0) * (0.22 + 0.28 * h)
                   * smoothstep(0.1, 0.8, k);
          }
        }

        // fog match (FogExp2 #0b0518, density 0.0075)
        float fade = exp(-pow(vDist * 0.0075, 2.0));
        col = mix(uDeep, col, fade);
        col += (hash12(gl_FragCoord.xy) - 0.5) * (1.2 / 255.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return mat;
}

// ---------------------------------------------------------------------------
// ORB ARENA FLOOR — the open-field stretch keeps the run road's full neon
// language (white-hot rails, lane dashes, sun column, pulse) while the survey
// grid lives strictly OUTSIDE the roadway. Mesh-fixed pattern (the phase moves
// the plane with world scroll) → zero seams, uniform dashes, no crawling.
// ---------------------------------------------------------------------------
export function makeOrbFloor(width = 90, length = 300) {
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uW: { value: width },
      uL: { value: length },
      uDeep: { value: COL.deep.clone() },
      uGrid: { value: COL.grid.clone() },
      uCyan: { value: COL.cyan.clone() },
      uMagenta: { value: COL.magenta.clone() },
      uGold: { value: COL.gold.clone() },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uW;
      uniform float uL;
      uniform vec3 uDeep;
      uniform vec3 uGrid;
      uniform vec3 uCyan;
      uniform vec3 uMagenta;
      uniform vec3 uGold;
      varying vec2 vUv;
      varying float vDist;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float lineAA(float coord, float cell, float halfW) {
        float q = coord / cell;
        float d = abs(fract(q - 0.5) - 0.5) * cell;
        float aa = max(fwidth(coord), 1e-4);
        float m = 1.0 - smoothstep(halfW - aa, halfW + aa, d);
        m *= smoothstep(cell * 1.6, cell * 0.8, aa * 2.0);
        return m;
      }

      void main() {
        float x = (vUv.x - 0.5) * uW;          // plane-local, mesh-fixed
        float d = (0.5 - vUv.y) * uL;          // +d = toward the camera
        float ax = abs(x);

        // base: run-road asphalt strip between the rails, deep field outside
        float road = smoothstep(5.1, 4.35, ax);
        vec3 col = mix(uDeep * 0.95, uDeep * 1.32, road);

        // ---- survey grid strictly outside the roadway -------------------------
        float side = smoothstep(4.72, 5.55, ax) * (1.0 - smoothstep(26.0, 44.0, ax));
        float distGlow = min(vDist * 0.0006, 0.05);
        float mx = lineAA(x, 2.6, 0.030 + distGlow) * side;
        float Mx = lineAA(x, 13.0, 0.052 + distGlow) * side;
        float mz = lineAA(d, 8.0, 0.026 + distGlow) * side;
        float Mz = lineAA(d, 40.0, 0.048 + distGlow) * side;
        vec3 lineCol = uGrid * (mx * 0.38 + mz * 0.28)
                     + mix(uGrid, uCyan, 0.22) * (Mx * 0.70 + Mz * 0.50);

        // ---- lane divider dashes (uniform rhythm, mesh-fixed) -----------------
        float dashPhase = fract(d / 6.0);
        float dash = step(dashPhase, 0.40);
        float dxa = max(fwidth(x), 1e-4);
        float dxm = min(abs(x - 1.3), abs(x + 1.3));
        float dl = 1.0 - smoothstep(0.055 - dxa, 0.055 + dxa, dxm);
        lineCol += mix(uCyan, uGrid, 0.35) * dl * dash * 0.32;

        // ---- lane rails: white-hot core, cyan body, magenta halo --------------
        float rd = abs(ax - 4.55);
        float raa = max(fwidth(rd), 1e-4);
        float core = 1.0 - smoothstep(0.045 - raa, 0.045 + raa, rd);
        float body = 1.0 - smoothstep(0.10, 0.30, rd);
        float halo = 1.0 - smoothstep(0.18, 1.35, rd);
        lineCol += vec3(1.0) * core * 1.15
                 + uCyan * body * 0.85
                 + uMagenta * halo * 0.30;

        // ---- pulse wave sweeping down the arena -------------------------------
        float pf = fract((d + uTime * 34.0) / 150.0);
        float pulse = exp(-pf * pf * 800.0);
        lineCol += uCyan * pulse * 0.16 * (mx * 0.4 + mz * 0.4 + body * 0.6);

        // ---- sun reflection column shimmering far ahead ------------------------
        float refl = exp(-x * x * 0.55)
                   * smoothstep(30.0, 140.0, -d)
                   * (0.60 + 0.40 * sin(d * 1.9 - uTime * 2.4));
        lineCol += mix(uMagenta, uGold, 0.35) * refl * 0.14 * (road * 0.7 + 0.3);

        col += lineCol;

        // fog match (FogExp2 #0b0518, density 0.0075)
        float fade = exp(-pow(vDist * 0.0075, 2.0));
        col = mix(uDeep, col, fade);
        col += (hash12(gl_FragCoord.xy) - 0.5) * (1.2 / 255.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
  return mesh;
}
