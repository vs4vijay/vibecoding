/**
 * @file core/sky.js
 * Physically-plausible sky + sun rig + in-shader cloud band.
 *
 * - Stylized sky: zenith->horizon gradient + warm sun disc + sun glow, with
 *   procedural cumulus painted IN the dome fragment shader (3-octave
 *   tileable value-noise fbm over a cloud-plane projection, drifting via the
 *   uTime uniform) and a subtle horizon haze band. No sprites/billboards
 *   anywhere — the sprite renderer corrupts frames on the QA GPU.
 * - Fog color is SAMPLED from the rendered sky so distant geometry
 *   dissolves exactly into the backdrop.
 * - scene.environment from PMREMGenerator.fromScene(sky) so PBR metals
 *   reflect a real sky (clouds baked at uTime 0 — drift is imperceptible).
 * - DirectionalLight sun with shadow ortho that follows the player, snapped
 *   to the shadow-map texel grid to avoid shimmer.
 *
 * Determinism: uTime only advances through SkySystem.update(dt); ?freeze
 * never advances it and fast-forward feeds fixed dt, so screenshots are
 * reproducible for a given seed+time.
 */
import * as THREE from "three";

const SUN_ELEVATION_DEG = 48;
// Sun ahead-right of the +Z-running camera: shadows stretch left and back
// TOWARD the viewer across the ballast, so directionality always reads.
// Elevation keeps the corridor sunlit (a low sun lets the 4.6 m walls shadow
// the whole play space) while still casting readable long shadows.
const SUN_AZIMUTH_DEG = 66;
const SUN_LIGHT_DISTANCE = 90;

/** Shared sun direction (unit vector pointing FROM scene TO sun). */
function computeSunDirection() {
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
  return new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
}

// Stylized sky palette (matches the saturated mobile-game reference —
// Preetham physically-based skies read as hazy beige at these sun angles and
// can never hit the vivid cartoon-blue look the art direction needs).
const SKY_ZENITH = new THREE.Color(0x2565c8).convertSRGBToLinear();
const SKY_HORIZON = new THREE.Color(0xb9dcf5).convertSRGBToLinear();
const SKY_SUN_TINT = new THREE.Color(0xfff3d8).convertSRGBToLinear();

// Cloud band parameters. The band sits STRICTLY above the horizon haze
// (haze ends by h = 0.10; clouds start fading in at 0.13) and feathers to
// exactly zero alpha at both edges — no coverage steps anywhere.
const CLOUD_BAND_LO = 0.13; // band bottom edge (alpha 0)
const CLOUD_BAND_FULL = 0.175; // full coverage from here up
const CLOUD_BAND_HI0 = 0.32; // top fade starts
const CLOUD_BAND_HI = 0.55; // zero coverage above this
const CLOUD_COVER_LO = 0.50; // fbm below this = clear sky (blue stays vivid)
const CLOUD_COVER_HI = 0.66; // full cloud above this (wide feather)
const CLOUD_DRIFT = 0.0075; // band-space drift per second (barely perceptible)

/**
 * Build the sky dome: stylized zenith->horizon gradient + warm sun disc and
 * glow + procedural cumulus band + horizon haze. Used for the visible dome,
 * the fog-color sample and the PMREM environment alike so reflections, fog
 * and backdrop always agree.
 * @param {THREE.Vector3} sunDir
 * @returns {THREE.Mesh}
 */
function makeSkyMesh(sunDir) {
  const geo = new THREE.SphereGeometry(1000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: SKY_ZENITH },
      uHorizon: { value: SKY_HORIZON },
      uSunTint: { value: SKY_SUN_TINT },
      uSunDir: { value: sunDir.clone() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        // Dome radius exceeds the camera far plane: pin to the far plane so
        // the backdrop never clips (same trick the Sky addon uses).
        gl_Position.z = gl_Position.w * 0.99999;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uSunTint;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vDir;

      // Stateless hash -> tileable value noise -> 3-octave fbm.
      float hash21( vec2 p ) {
        p = fract( p * vec2( 127.1, 311.7 ) + 111.0 );
        p += dot( p, p + 34.45 );
        return fract( p.x * p.y );
      }
      float vnoise( vec2 p ) {
        vec2 i = floor( p );
        vec2 f = fract( p );
        vec2 u = f * f * ( 3.0 - 2.0 * f );
        float a = hash21( i );
        float b = hash21( i + vec2( 1.0, 0.0 ) );
        float c = hash21( i + vec2( 0.0, 1.0 ) );
        float d = hash21( i + vec2( 1.0, 1.0 ) );
        return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
      }
      float fbm3( vec2 p ) {
        float s = 0.0;
        float a = 0.5;
        for ( int k = 0; k < 3; k++ ) {
          s += a * vnoise( p );
          p = p * 2.17 + vec2( 19.7, 7.3 );
          a *= 0.5;
        }
        return s / 0.875;
      }

      void main() {
        vec3 dir = normalize( vDir );
        float h = clamp( dir.y, -1.0, 1.0 );
        vec3 col = mix( uHorizon, uZenith, pow( clamp( h, 0.0, 1.0 ), 0.28 ) );
        // Below the horizon: slightly darker ground haze.
        col = mix( col, uHorizon * 0.85, clamp( -h * 8.0, 0.0, 1.0 ) );

        // Subtle distant haze band hugging the horizon line.
        float haze = smoothstep( 0.012, 0.05, h ) * ( 1.0 - smoothstep( 0.06, 0.10, h ) );
        col = mix( col, mix( uHorizon, vec3( 1.0 ), 0.22 ), haze * 0.32 );

        // Sun disc + tight warm glow (drawn before clouds so puffs occlude).
        float sd = max( dot( dir, uSunDir ), 0.0 );
        col += uSunTint * ( pow( sd, 1200.0 ) * 4.0 + pow( sd, 14.0 ) * 0.15 );

        // Cumulus band: 3-octave tileable value-noise fbm projected on a
        // cloud plane, drifting slowly with uTime. No hard cutoffs anywhere:
        //   - the band mask fades alpha to exactly 0 at BOTH edges, with the
        //     bottom edge well above the haze band (no horizon streaks), and
        //   - the coverage smoothstep feathers over a wide 0.18 noise window.
        float band = smoothstep( ${CLOUD_BAND_LO}, ${CLOUD_BAND_FULL}, h )
          * ( 1.0 - smoothstep( ${CLOUD_BAND_HI0}, ${CLOUD_BAND_HI}, h ) );
        vec2 cuv = dir.xz / max( dir.y, 0.30 );
        cuv = cuv * 0.32 + vec2( uTime * ${CLOUD_DRIFT}, uTime * 0.0021 );
        float n = fbm3( cuv );
        // Compress the fbm range: deep noise valleys would otherwise punch
        // vivid-blue holes inside cloud masses (read as dark lenses).
        n = 0.5 + ( n - 0.5 ) * 0.72;
        float dens = smoothstep( ${CLOUD_COVER_LO}, ${CLOUD_COVER_HI}, n ) * band;
        // Shading: white tops, subtle warm-gray underside ONLY. The lit term
        // is floored at 0.35 so cloud color can never dip toward (let alone
        // below) the horizon color — no dark-blue bases or edge tints.
        float n2 = fbm3( cuv + normalize( uSunDir.xz + vec2( 1e-4 ) ) * 0.35 );
        float lit = clamp( 0.55 + ( n - n2 ) * 1.8, 0.35, 1.0 );
        vec3 cloudCol = mix( vec3( 0.87, 0.86, 0.82 ), vec3( 1.04, 1.02, 0.99 ), lit );
        col = mix( col, cloudCol, dens * 0.9 );

        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.scale.setScalar(2); // dome radius 2000 world units, follows the camera
  return sky;
}

export class SkySystem {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} preset Quality preset (fog distances, shadow map size).
   */
  constructor(scene, renderer, preset) {
    this.scene = scene;
    this.sunDir = computeSunDirection();

    // Visible sky.
    this.sky = makeSkyMesh(this.sunDir);
    scene.add(this.sky);

    // Fog color sampled from the sky shader itself (linear values).
    const horizon = this._sampleHorizonColor(renderer);
    scene.fog = new THREE.Fog(horizon, preset.fogNear, preset.fogFar);
    this._horizonColor = horizon;

    // Environment for PBR reflections (metals must reflect the sky).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSkyMesh(this.sunDir)); // separate instance; do not share
    this._envRT = pmrem.fromScene(envScene);
    scene.environment = this._envRT.texture;
    pmrem.dispose();

    // Sun: warm directional light, ortho shadows around the player.
    // Strong key light + restrained fill keeps shadow contrast readable.
    this.sun = new THREE.DirectionalLight(0xfff3dd, 4.6);
    this.sun.castShadow = preset.shadowsEnabled;
    this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 34;
    cam.bottom = -34;
    cam.near = 1;
    cam.far = SUN_LIGHT_DISTANCE * 2;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Sky/ground bounce. Neutral-warm sky tint so shadowed regions read
    // neutral rather than navy. 0.64 lifts the ambient floor inside big
    // shadows (bridge decks) so they read as shaded, not voids, while the
    // ~3.5:1 lit:shadow ratio from the 4.6 sun still holds.
    this.hemi = new THREE.HemisphereLight(0xcfe4f4, 0xa89070, 0.62);
    scene.add(this.hemi);

    // Cloud drift clock: advanced ONLY by update(dt) (0 during QA freeze,
    // fixed dt during fast-forward) so screenshots stay deterministic.
    this._cloudTime = 0;

    // Scratch objects for texel snapping.
    this._rot = new THREE.Matrix4();
    this._rotInv = new THREE.Matrix4();
    this._anchor = new THREE.Vector3();
    this._snappedAnchor = new THREE.Vector3();
    this._lightPos = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._delta = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * Render the sky alone into a tiny RT and read the horizon color.
   * Values are raw linear shader output (no tonemap/encoding on RT path).
   * @param {THREE.WebGLRenderer} renderer
   * @returns {THREE.Color}
   * @private
   */
  _sampleHorizonColor(renderer) {
    const fallback = new THREE.Color(0.45, 0.62, 0.88);
    try {
      const rt = new THREE.WebGLRenderTarget(8, 8);
      const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 10);
      cam.lookAt(0, 0.1, 1); // sample the bluer sky band just above the horizon
      const tmp = new THREE.Scene();
      tmp.add(makeSkyMesh(this.sunDir));
      renderer.setRenderTarget(rt);
      renderer.render(tmp, cam);
      renderer.setRenderTarget(null);
      const buf = new Uint8Array(8 * 8 * 4);
      renderer.readRenderTargetPixels(rt, 2, 2, 4, 4, buf);
      rt.dispose();
      let r = 0;
      let g = 0;
      let b = 0;
      const n = 16;
      for (let i = 0; i < n; i++) {
        r += buf[i * 4];
        g += buf[i * 4 + 1];
        b += buf[i * 4 + 2];
      }
      // Markedly deeper than the raw sample: distant geometry dissolves
      // into a bluer, darker haze instead of a white wash.
      return new THREE.Color(
        (r / n / 255) * 0.86,
        (g / n / 255) * 0.92,
        (b / n / 255) * 1.0,
      );
    } catch (err) {
      console.warn("SkySystem: horizon sampling failed, using fallback", err);
      return fallback;
    }
  }

  /** @returns {THREE.Color} Sampled horizon/fog color. */
  get horizonColor() {
    return this._horizonColor;
  }

  /**
   * Change shadow map resolution (quality tier changes). The existing map
   * is disposed so three.js reallocates on the next render.
   * @param {number} size
   */
  applyShadowMapSize(size) {
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  /**
   * Update fog distances (quality tier changes).
   * @param {object} preset
   */
  applyFogDistances(preset) {
    this.scene.fog.near = preset.fogNear;
    this.scene.fog.far = preset.fogFar;
  }

  /**
   * Per-frame update: sky follows the camera (clouds drift with dt); sun rig
   * follows the player with shadow-camera texel snapping.
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} playerX
   * @param {number} playerZ
   * @param {number} [dt] Frame delta for cloud drift (0 in freeze modes).
   */
  update(camera, playerX, playerZ, dt = 0) {
    this.sky.position.copy(camera.position);
    this._cloudTime += dt;
    this.sky.material.uniforms.uTime.value = this._cloudTime;

    // Anchor the shadow frustum slightly ahead of the player.
    this._anchor.set(playerX * 0.5, 0, playerZ + 10);
    this._lightPos.copy(this.sunDir).multiplyScalar(SUN_LIGHT_DISTANCE).add(this._anchor);

    // Light-space basis (rotation only, no translation).
    this._rot.lookAt(this._lightPos, this._anchor, this._up);
    this._rot.elements[12] = 0;
    this._rot.elements[13] = 0;
    this._rot.elements[14] = 0;
    this._rotInv.copy(this._rot).transpose();

    // Texel snap: quantize the anchor's light-space XY to whole shadow
    // texels, then apply the (tiny) world-space delta to the anchor. The
    // frustum only ever moves in texel increments, so shadows never crawl,
    // while the camera stays centered on the player.
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    this._local.copy(this._anchor).sub(this._lightPos).applyMatrix4(this._rot);
    this._delta
      .set(
        Math.round(this._local.x / texel) * texel,
        Math.round(this._local.y / texel) * texel,
        this._local.z,
      )
      .sub(this._local)
      .applyMatrix4(this._rotInv);
    this._snappedAnchor.copy(this._anchor).add(this._delta);

    this.sun.target.position.copy(this._snappedAnchor);
    this.sun.position.copy(this._snappedAnchor).addScaledVector(this.sunDir, SUN_LIGHT_DISTANCE);
    this.sun.target.updateMatrixWorld();
  }
}
