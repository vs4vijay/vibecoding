/**
 * @file core/sky.js — dusk/night sky, sun rig, fog, environment.
 * - Scatter-gradient dome with sun disc (dusk) / moon + stars (night), pinned
 *   to the far plane so the backdrop never clips.
 * - Fog color is an ANALYTIC mirror of the dome gradient sampled just above
 *   the horizon down the road axis (+Z, toward the city), then deepened —
 *   no render-target readback (readPixels stalled the GL driver in QA).
 * - scene.environment via PMREM over a sky-only scene (PBR reflects the sky
 *   the fog matches).
 * - Key sun rakes diagonally; shadow frustum follows the camera with texel
 *   snapping (apply snap DELTA to anchor — verified technique, do not
 *   "simplify" into transforming the anchor vector itself). Night swaps sun
 *   for shadow-casting moonlight + faint red-orange city fill.
 * - City glow: canvas skyline + additive haze on the far horizon, flicker
 *   driven by sim time (deterministic under freeze).
 */
import * as THREE from "three";
import { CONFIG } from "./config.js";
import { materialLibrary } from "./assets.js";

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

const PALETTE = {
  dusk: { zenith: 0x0a1c2e, mid: 0x24425c, horizonCool: 0x83766f, horizonWarm: 0xe8763a, sunTint: 0xffd9a0, night: 0 },
  night: { zenith: 0x04060d, mid: 0x081020, horizonCool: 0x131c2c, horizonWarm: 0x4a1808, sunTint: 0x8a5a30, night: 1 },
};

const dirFrom = (elevDeg, azimDeg) =>
  new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), THREE.MathUtils.degToRad(azimDeg));

function skyUniforms(timeOfDay) {
  const p = PALETTE[timeOfDay] || PALETTE.dusk;
  // At night the warm horizon scatter hugs the burning-city azimuth (+Z).
  const night = p.night;
  const warmDir = night ? dirFrom(2.5, 0) : dirFrom(CONFIG.SUN.elevationDeg, CONFIG.SUN.azimuthDeg);
  return {
    uZenith: { value: lin(p.zenith) },
    uMid: { value: lin(p.mid) },
    uHorizonCool: { value: lin(p.horizonCool) },
    uHorizonWarm: { value: lin(p.horizonWarm) },
    uSunTint: { value: lin(p.sunTint) },
    uSunRed: { value: lin(0xff5a22) }, // horizon-red the disc/corona mix toward
    uScatterTint: { value: lin(0xff9a50) }, // broad forward-scatter lobe
    uSunDir: { value: warmDir },
    uMoonDir: { value: dirFrom(CONFIG.MOON.elevationDeg, CONFIG.MOON.azimuthDeg) },
    uNight: { value: night },
    uHorizonSpan: { value: night ? CONFIG.SKY.horizonSpan.night : CONFIG.SKY.horizonSpan.dusk },
    uWash: { value: night ? CONFIG.SKY.warmWash.night : CONFIG.SKY.warmWash.dusk },
    uHorizonGlow: { value: night ? CONFIG.SKY.horizonGlow.night : CONFIG.SKY.horizonGlow.dusk },
    uFogDeep: { value: new THREE.Vector3(CONFIG.FOG_DEEPEN.r, CONFIG.FOG_DEEPEN.g, CONFIG.FOG_DEEPEN.b) },
  };
}

function makeSkyMesh(timeOfDay) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: skyUniforms(timeOfDay),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w * 0.99999; // pin dome to the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uMid, uHorizonCool, uHorizonWarm, uSunTint, uSunRed, uScatterTint, uSunDir, uMoonDir, uFogDeep;
      uniform float uNight, uHorizonSpan, uWash, uHorizonGlow;
      varying vec3 vWorld;
      float hash3( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
      void main() {
        // Direction is rebuilt PER FRAGMENT from the world position: the old
        // varying carried the interpolated vertex position, so the gradient
        // inherited the dome tessellation as faint straight facets (read
        // through against the night glow).
        vec3 dir = normalize( vWorld - cameraPosition );
        float h = clamp( dir.y, -1.0, 1.0 );
        float elev = clamp( h, 0.0, 1.0 );
        vec3 dh = normalize( vec3( dir.x, 0.0, dir.z ) );
        vec3 sh = normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) );
        vec3 horiz = mix( uHorizonCool, uHorizonWarm, pow( max( dot( dh, sh ), 0.0 ), 2.0 ) );
        vec3 col = mix( mix( uMid, uZenith, pow( elev, 0.5 ) ), horiz, 1.0 - smoothstep( 0.015, uHorizonSpan, elev ) );
        float sd = max( dot( dir, uSunDir ), 0.0 );
        col += uHorizonWarm * pow( sd, 5.0 ) * uWash * ( 1.0 - elev * 0.75 ); // broad wash
        col += uSunTint * pow( sd, 40.0 ) * 0.40 * uNight; // night city-azimuth ember (dusk uses the corona below)
        // Dusk sun: broad forward-scatter + tight corona + hot core. Round-4
        // re-author — the old core plateau (full beyond a 0.96-deg radius)
        // plus the pow-120 corona stacked with the base sky past 1.0 out to
        // ~1.3 deg, so the UnsignedByte composer clamped a ~2.6-deg white
        // ball that bloom read as an oversized glowing disc. Now only the
        // core saturates: the ramp (0.48-0.89 deg, peak 1.35) keeps a soft
        // limb and a ~1.4-deg disc; the pow-160 corona (half-energy ~5.3 deg,
        // 0.42) and pow-10 scatter (0.14) bridge it into the sky. Added HDR
        // peaks ~1.89 at the disc centre (scatter ~0.12 + corona 0.42 + core
        // 1.35). Near the horizon sunCol mixes toward deep red (uSunRed) by
        // clamp(1 - elev*6, 0, 1): full red below ~9.6 deg, so the corona
        // skirt under the 11.5-deg disc bleeds red into the mesa line, and
        // any lower sun reddens the disc itself.
        float dusk = 1.0 - uNight;
        vec3 sunCol = mix( uSunTint, uSunRed, clamp( 1.0 - elev * 6.0, 0.0, 1.0 ) );
        col += uScatterTint * pow( sd, 10.0 ) * 0.14 * dusk * ( 1.0 - elev * 0.6 );
        col += sunCol * pow( sd, 160.0 ) * 0.42 * dusk;
        col += sunCol * smoothstep( 0.99988, 0.999965, sd ) * 1.35 * dusk; // hot core, soft limb
        float sdM = max( dot( dir, uMoonDir ), 0.0 );
        col += vec3( 0.75, 0.82, 0.95 ) * pow( sdM, 30.0 ) * 0.10 * uNight;
        col += vec3( 0.92, 0.95, 1.0 ) * smoothstep( 0.99990, 0.99997, sdM ) * 2.4 * uNight;
        // Stars: cell-hash points (2 sizes, no twinkle cost) with a
        // zenith-weighted density gradient (pow(elev,0.4)) plus a faint
        // tilted galaxy band that raises density ~+35% and adds milky
        // scatter along a great circle (band plane normal below). Round-4:
        // "large" stars are the top 2% of the candidate band (threshold
        // scales with the gate — the old flat 0.9988 cut made ~18% of stars
        // large) and their radius is capped at 1.4x the small one, so none
        // read as oversized dots. Round-5 smudge fix: the milky variation
        // was hash3(floor(dir*5)) — ~11-deg blocky direction cells whose
        // planar cut edges read as a grey angular smudge across the upper
        // sky. It is now a smooth band-limited sine product, the band mask
        // edge widened (0.86 -> 0.80), the milky peak lowered 0.05 -> 0.035
        // and clamped away from the horizon glow strip.
        vec3 sp = dir * 170.0;
        float rnd = hash3( floor( sp ) );
        float dens = pow( elev, 0.4 );
        float gal = smoothstep( 0.80, 0.995, 1.0 - abs( dot( dir, normalize( vec3( -0.54, 0.67, -0.51 ) ) ) ) );
        float gate = 0.9935 + ( 1.0 - dens ) * 0.0055 - gal * 0.0025;
        float bigT = 1.0 - 0.02 * ( 1.0 - gate );
        float star = smoothstep( mix( 0.24, 0.336, step( bigT, rnd ) ), 0.02, length( fract( sp ) - 0.5 ) ) * step( gate, rnd );
        col += vec3( 0.85, 0.9, 1.0 ) * star * uNight * ( 0.35 + 0.75 * dens ) * ( 0.4 + rnd * 0.9 );
        float neb = 0.5 + 0.5 * sin( dir.x * 9.0 + dir.y * 5.0 ) * sin( dir.z * 7.0 - dir.y * 6.0 );
        col += vec3( 0.62, 0.66, 0.78 ) * gal * gal * ( 0.55 + 0.9 * neb ) * 0.035 * uNight * smoothstep( 0.02, 0.10, elev );
        // Horizon seam grade (round 4): the desert shell ends at
        // DESERT_HALF_W with fog only ~50-85% saturated there, so the dome
        // carries the last value step. Below the horizon the sky eases from
        // the horizon color to the analytic fog tone (horiz * uFogDeep —
        // matches scene.fog) over ~2 deg instead of the old flat murky
        // horiz*0.45 cut, and a thin warm glow strip (city-glow family)
        // peaked ON the horizon line fades out within ~2 deg of it, so the
        // desert->sky transition reads graded, not stepped.
        col = mix( col, horiz * uFogDeep, smoothstep( 0.0, 0.035, -h ) );
        col += uHorizonWarm * uHorizonGlow * ( 1.0 - smoothstep( 0.0, 0.035, abs( h ) ) );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
  sky.scale.setScalar(2);
  sky.frustumCulled = false;
  return sky;
}

export class SkySystem {
  constructor(scene, renderer, preset, timeOfDay = "dusk") {
    this.scene = scene;
    this.preset = preset;
    this.timeOfDay = timeOfDay;
    const night = timeOfDay === "night";
    this.skyDir = dirFrom(CONFIG.SUN.elevationDeg, CONFIG.SUN.azimuthDeg);
    this.moonDir = dirFrom(CONFIG.MOON.elevationDeg, CONFIG.MOON.azimuthDeg);

    this.sky = makeSkyMesh(timeOfDay);
    scene.add(this.sky);

    const horizon = this._analyticFog();
    scene.fog = new THREE.Fog(horizon, preset.fogNear, this._fogFar(preset));
    this._horizonColor = horizon;

    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(makeSkyMesh(timeOfDay)); // separate instance; never shared
      this._envRT = pmrem.fromScene(envScene);
      scene.environment = this._envRT.texture;
      pmrem.dispose();
    } catch {
      scene.environment = null; // keep rendering without reflections
    }

    // Key light rig. Only the ACTIVE key light joins the scene — unused
    // lights still count in every standard-material program (uniform arrays
    // + shadow sampling code), which measurably slows software-GL compiles.
    const S = CONFIG.SUN.shadow;
    this.sun = new THREE.DirectionalLight(CONFIG.SUN.color, night ? 0 : CONFIG.SUN.intensity);
    this.sun.castShadow = preset.shadowsEnabled && !night;
    this.moon = new THREE.DirectionalLight(CONFIG.MOON.color, night ? CONFIG.MOON.intensity : 0);
    this.moon.castShadow = night && preset.shadowsEnabled;
    for (const light of [this.sun, this.moon]) {
      light.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      Object.assign(light.shadow.camera, { left: S.left, right: S.right, top: S.top, bottom: S.bottom, near: S.near, far: S.far });
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.bias = CONFIG.SUN.bias;
      light.shadow.normalBias = CONFIG.SUN.normalBias;
    }
    if (night) scene.add(this.moon, this.moon.target);
    else scene.add(this.sun, this.sun.target);
    // Burning-city fill (night only), no shadows.
    this.cityLight = new THREE.DirectionalLight(CONFIG.CITY_LIGHT.color, night ? CONFIG.CITY_LIGHT.intensity : 0);
    this.cityLight.position.set(0, 14, 100);
    if (night) scene.add(this.cityLight, this.cityLight.target);

    const hemi = night ? CONFIG.HEMI.night : CONFIG.HEMI.dusk;
    this.hemi = new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity);
    scene.add(this.hemi);

    // City glow backdrop (sky-owned; follows the camera). Card + haze get a
    // soft horizontal envelope from drawCity / a radial blob texture — no
    // hard rectangle edges against the dome (the old untextured additive
    // haze plane read as a grey band at night).
    const C = CONFIG.CITY;
    const glowTex = materialLibrary.canvas("lightPool");
    this._cityMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: night ? C.cardOpacity.night : C.cardOpacity.dusk,
      depthWrite: false, fog: false,
    });
    this._hazeMat = new THREE.MeshBasicMaterial({
      map: glowTex, color: 0xff8440,
      transparent: true, opacity: night ? C.hazeOpacity.night : C.hazeOpacity.dusk,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this._cityMat.userData.base = this._cityMat.opacity;
    this._hazeMat.userData.base = this._hazeMat.opacity;
    this._city = new THREE.Mesh(new THREE.PlaneGeometry(C.width, C.height), this._cityMat);
    this._city.rotation.y = Math.PI; // face the oncoming (-Z) camera
    this._haze = new THREE.Mesh(new THREE.PlaneGeometry(C.hazeWidth, C.hazeHeight), this._hazeMat);
    this._haze.rotation.y = Math.PI;
    this._haze.position.y = C.height * 0.35;
    this._cityGroup = new THREE.Group();
    this._cityGroup.add(this._city, this._haze);
    this._cityGroup.renderOrder = 1;
    scene.add(this._cityGroup);

    // Night headlight pools: two additive warm blobs on the asphalt ahead,
    // low and near-parallel to the road so they never intersect the sky.
    this._pools = null;
    this._shafts = null;
    if (night) {
      const P = CONFIG.POOL;
      const geo = new THREE.PlaneGeometry(P.width, P.length);
      this._poolMat = new THREE.MeshBasicMaterial({
        map: glowTex, color: P.color, transparent: true, opacity: P.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      this._pools = P.z.map(() => {
        const m = new THREE.Mesh(geo, this._poolMat);
        m.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(P.tiltDeg);
        m.renderOrder = 1;
        scene.add(m);
        return m;
      });
      this._poolX = P.laneOffset * CONFIG.LANE_W;
      // Implied light source (round-5): one soft vertical glow column per
      // pool — the SAME pool geometry stretched tall via scale, Y-billboard
      // to the camera in update() with a slight top-toward-camera lean.
      // Parameter clone of the pool material (same program, no new shader
      // variant, shares the lightPool texture); gradient-only falloff, so
      // the round-4 hard-cone failure cannot return.
      const S = P.shaft;
      this._shaftMat = this._poolMat.clone();
      this._shaftMat.opacity = S.opacity;
      this._shafts = P.z.map(() => {
        const m = new THREE.Mesh(geo, this._shaftMat);
        m.scale.set(S.w / P.width, S.h / P.length, 1);
        m.rotation.order = "YXZ";
        m.renderOrder = 1;
        scene.add(m);
        return m;
      });
      // City ember variation (round-5): two additive blobs sharing the haze
      // material (they breathe with its flicker) ride the city group just
      // under the horizon line, breaking the single-hue red band.
      const emberGeo = new THREE.PlaneGeometry(1, 1);
      this._embers = C.night.embers.map((e) => {
        const m = new THREE.Mesh(emberGeo, this._hazeMat);
        m.position.set(e.x * C.width, e.y - C.y, -1);
        m.scale.set(e.w, e.h, 1);
        m.rotation.y = Math.PI; // face the oncoming camera like the card
        m.renderOrder = 1;
        this._cityGroup.add(m);
        return m;
      });
    }
    this._simTime = 0;

    // Texel-snap scratch.
    this._rot = new THREE.Matrix4();
    this._rotInv = new THREE.Matrix4();
    this._anchor = new THREE.Vector3();
    this._lightPos = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Main assigns the generated skyline canvas texture. */
  attachCityTexture(tex) {
    this._cityMat.map = tex;
    this._cityMat.needsUpdate = true;
  }

  _fogFar(preset) {
    return this.timeOfDay === "night" ? preset.fogFar * (preset.nightFogScale || 0.75) : preset.fogFar;
  }

  /**
   * Analytic mirror of the dome fragment gradient, sampled just above the
   * horizon looking down the road axis (+Z, toward the city) — same math and
   * linear space as the shader, so scene.fog matches the sky without a
   * render-target readback (readPixels caused GPU stalls in QA). Disc, corona
   * (pow 160 of the ~0.807 sample sd) and star terms are ~0 at this sample
   * direction; the dusk scatter, night ember lobe and horizon-glow strip (the
   * sample sits ~1.15 deg above the line, inside the strip's 2-deg fade) are
   * mirrored exactly.
   */
  _analyticFog() {
    const U = this.sky.material.uniforms;
    const S = CONFIG.SKY;
    const night = this.timeOfDay === "night";
    const e = S.fogSampleElev; // sine of the sample elevation (~1.15 deg)
    const span = night ? S.horizonSpan.night : S.horizonSpan.dusk;
    const wash = night ? S.warmWash.night : S.warmWash.dusk;
    const dusk = night ? 0 : 1;
    const sun = U.uSunDir.value;
    // dir ≈ (0, e, √(1-e²)) on the road axis; dh·sh with dh = +Z.
    const inv = 1 / Math.hypot(sun.x, sun.z);
    const sd = sun.y * e + sun.z * Math.sqrt(1 - e * e);
    const horiz = new THREE.Color().copy(U.uHorizonCool.value).lerp(U.uHorizonWarm.value, (sun.z * inv) ** 2);
    const col = new THREE.Color().copy(U.uMid.value).lerp(U.uZenith.value, Math.sqrt(e));
    col.lerp(horiz, 1 - THREE.MathUtils.smoothstep(e, 0.015, span));
    const washK = Math.pow(sd, 5) * wash * (1 - e * 0.75);
    const emberK = night ? Math.pow(sd, 40) * 0.4 : 0; // shader gates it by uNight
    const sunCol = new THREE.Color().copy(U.uSunTint.value)
      .lerp(U.uSunRed.value, THREE.MathUtils.clamp(1 - e * 6, 0, 1));
    const scatterK = dusk * Math.pow(sd, 10) * 0.14 * (1 - e * 0.6);
    const coronaK = dusk * Math.pow(sd, 160) * 0.42; // ~1e-15 here; kept for exactness
    // Horizon-glow strip, ~1/3 of peak at the sample elevation.
    const glowK = (1 - THREE.MathUtils.smoothstep(e, 0, 0.035))
      * (night ? S.horizonGlow.night : S.horizonGlow.dusk);
    col.r += U.uHorizonWarm.value.r * (washK + glowK) + U.uSunTint.value.r * emberK
      + U.uScatterTint.value.r * scatterK + sunCol.r * coronaK;
    col.g += U.uHorizonWarm.value.g * (washK + glowK) + U.uSunTint.value.g * emberK
      + U.uScatterTint.value.g * scatterK + sunCol.g * coronaK;
    col.b += U.uHorizonWarm.value.b * (washK + glowK) + U.uSunTint.value.b * emberK
      + U.uScatterTint.value.b * scatterK + sunCol.b * coronaK;
    const D = CONFIG.FOG_DEEPEN;
    col.r *= D.r; col.g *= D.g; col.b *= D.b;
    return col;
  }

  get horizonColor() {
    return this._horizonColor;
  }

  /** Quality tier changes: fog distances + shadow map resolution. */
  applyPreset(preset) {
    this.preset = preset;
    this.scene.fog.near = preset.fogNear;
    this.scene.fog.far = this._fogFar(preset);
    for (const light of [this.sun, this.moon]) {
      light.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
      }
    }
  }

  /** Dome + city follow the camera; shadow rig follows with texel snapping. */
  update(camera, anchorX, anchorZ, dt, simTime) {
    this.sky.position.copy(camera.position);
    const C = CONFIG.CITY;
    this._cityGroup.position.set(camera.position.x, C.y, camera.position.z + C.dist);
    if (dt > 0) {
      this._simTime = simTime;
      const t = this._simTime;
      this._hazeMat.opacity = this._hazeMat.userData.base
        * (1 + Math.sin(t * 1.3) * 0.05 + Math.sin(t * 7.7) * 0.025);
      // Card flicker (round-5): slow fire-like breathing — ±6% at ~0.3 Hz
      // (t*1.9) plus the old slow term at reduced weight; no fast chatter
      // on the huge card (fast sine read as strobe, not fire).
      this._cityMat.opacity = this._cityMat.userData.base
        * (1 + Math.sin(t * 1.9) * 0.06 + Math.sin(t * 1.3) * 0.03);
    }
    const night = this.timeOfDay === "night";
    (night ? this.sun : this.moon).intensity = 0;
    this._placeShadowed(night ? this.moon : this.sun, night ? this.moonDir : this.skyDir, anchorX, anchorZ);
    this.cityLight.target.updateMatrixWorld();
    if (this._pools) {
      const P = CONFIG.POOL;
      for (let i = 0; i < this._pools.length; i++) {
        this._pools[i].position.set(
          camera.position.x + (i === 0 ? -this._poolX : this._poolX),
          P.y, camera.position.z + P.z[i],
        );
      }
      // Shafts stand on the pools, Y-billboarded to the camera, leaning a
      // few degrees top-toward-camera (the implied headlamp source sits
      // behind/below the camera). Tilt rides the post-yaw local X (YXZ).
      const S = P.shaft;
      for (let i = 0; i < this._shafts.length; i++) {
        const m = this._shafts[i];
        const x = camera.position.x + (i === 0 ? -this._poolX : this._poolX);
        const z = camera.position.z + P.z[i];
        m.position.set(x, S.y, z);
        m.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
        m.rotation.x = THREE.MathUtils.degToRad(S.tiltDeg);
      }
    }
  }

  /** Snap the shadow frustum to whole map texels so shadows never crawl. */
  _placeShadowed(light, dir, anchorX, anchorZ) {
    this._anchor.set(anchorX * 0.3, 0, anchorZ + CONFIG.SUN.anchorAhead);
    this._lightPos.copy(dir).multiplyScalar(CONFIG.SUN.lightDist).add(this._anchor);
    this._rot.lookAt(this._lightPos, this._anchor, this._up);
    this._rot.elements[12] = 0;
    this._rot.elements[13] = 0;
    this._rot.elements[14] = 0;
    this._rotInv.copy(this._rot).transpose();
    const cam = light.shadow.camera;
    const texel = (cam.right - cam.left) / light.shadow.mapSize.x;
    // world -> light space is the INVERSE (transposed) rotation, and the
    // anchor must be measured against a STATIONARY reference (origin): the
    // previous code applied the forward rotation to (anchor - lightPos),
    // which is just -lightDist*dir re-rotated — a constant, so the rounding
    // never tracked the anchor and the frustum glided with the camera
    // (crawling shadow edges) instead of stepping in whole texels.
    this._local.copy(this._anchor).applyMatrix4(this._rotInv);
    this._delta
      .set(Math.round(this._local.x / texel) * texel, Math.round(this._local.y / texel) * texel, this._local.z)
      .sub(this._local)
      .applyMatrix4(this._rot);
    light.target.position.copy(this._anchor).add(this._delta);
    // target + dir*lightDist keeps the light EXACTLY on the dome's sun
    // azimuth after the snap — the snap only translates the frustum.
    light.position.copy(light.target.position).addScaledVector(dir, CONFIG.SUN.lightDist);
    light.target.updateMatrixWorld();
  }
}
