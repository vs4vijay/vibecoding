import * as THREE from "three";

/**
 * Time-of-day owner. t in [0, 1]: 0 = dawn, 0.5 = noon, 1 = dusk.
 * M1 pins the time per shot; M2 drives it from the quota timer via
 * setTime()/advance(). All derived values are recomputed eagerly so consumers
 * (Sky, lights, fog, exposure) can just read the public fields each frame.
 */
export class DayCycle {
  /** Simulated day length in seconds when auto-advancing (M2 will tune). */
  dayLength = 480;
  autoAdvance = false;

  private t = 0.2;

  // Derived, recomputed on every time change:
  readonly sunDir = new THREE.Vector3(0, 1, 0); // unit vector pointing TO the sun
  readonly sunColor = new THREE.Color();
  sunIntensity = 2.4;
  readonly hemiSkyColor = new THREE.Color();
  readonly hemiGroundColor = new THREE.Color();
  hemiIntensity = 0.7;
  readonly zenithColor = new THREE.Color();
  readonly horizonColor = new THREE.Color(); // also the fog color
  readonly groundHazeColor = new THREE.Color();
  readonly rimColor = new THREE.Color();
  readonly rimDir = new THREE.Vector3();
  rimIntensity = 0.4;
  fogNear = 10;
  fogFar = 80;
  exposure = 1.05;

  /** Color ramps keyed by time-of-day. Stops: [t, hex]. */
  private static readonly SUN = [
    [0.0, 0xff8f3a], [0.12, 0xffc27a], [0.3, 0xffe6bc], [0.5, 0xfff7e8],
    [0.72, 0xffdd9e], [0.88, 0xff8a38], [1.0, 0xff6226],
  ] as const;
  private static readonly SUN_I = [[0.0, 1.1], [0.15, 2.4], [0.5, 3.0], [0.85, 2.1], [1.0, 1.5]] as const;
  private static readonly ZENITH = [
    [0.0, 0x4a6fa8], [0.25, 0x4d8cc9], [0.5, 0x3f88d8], [0.75, 0x5179b4], [0.9, 0x6d5a9e], [1.0, 0x463672],
  ] as const;
  private static readonly HORIZON = [
    [0.0, 0xf5c488], [0.2, 0xf2d9a6], [0.5, 0xb4d8ea], [0.78, 0xd8b98a], [0.92, 0xf29a52], [1.0, 0xd96a36],
  ] as const;
  private static readonly HAZE = [
    [0.0, 0xc8a878], [0.2, 0xb2c49c], [0.5, 0x94b8c8], [0.85, 0xb08054], [1.0, 0x9c5a34],
  ] as const;
  private static readonly HEMI_SKY = [
    [0.0, 0x9cb4cc], [0.25, 0xa8c8e8], [0.5, 0xb0d4f0], [0.85, 0xc09890], [1.0, 0x9a7a90],
  ] as const;
  private static readonly HEMI_GROUND = [
    [0.0, 0x5e4c30], [0.5, 0x4c6c2e], [1.0, 0x6c4626],
  ] as const;
  private static readonly HEMI_I = [[0.0, 0.7], [0.5, 1.0], [1.0, 0.74]] as const;
  private static readonly RIM = [
    [0.0, 0xffc090], [0.3, 0xa8ccff], [0.6, 0x9cc4ff], [0.85, 0xffb070], [1.0, 0xff8a50],
  ] as const;
  private static readonly EXPOSURE = [[0.0, 1.0], [0.5, 1.1], [1.0, 1.04]] as const;
  private static readonly FOG_FAR = [[0.0, 118], [0.5, 130], [1.0, 62]] as const;

  getTime(): number {
    return this.t;
  }

  setTime(t: number): void {
    this.t = THREE.MathUtils.clamp(t, 0, 1);
    this.recompute();
  }

  /** Advances time when auto-advance is on; M1 keeps it pinned. */
  advance(dt: number): void {
    if (!this.autoAdvance) return;
    this.setTime(this.t + dt / this.dayLength);
  }

  private recompute(): void {
    const t = this.t;
    const day = Math.sin(t * Math.PI); // 0 at dawn/dusk, 1 at noon

    // Sun arc: azimuth sweeps east→west, elevation peaks at noon.
    const elev = 0.05 + Math.pow(day, 1.35) * 1.15;
    const azim = THREE.MathUtils.lerp(-2.35, 2.35, t);
    this.sunDir.set(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize();

    rampColor(DayCycle.SUN, t, this.sunColor);
    this.sunIntensity = rampNum(DayCycle.SUN_I, t);
    rampColor(DayCycle.ZENITH, t, this.zenithColor);
    rampColor(DayCycle.HORIZON, t, this.horizonColor);
    rampColor(DayCycle.HAZE, t, this.groundHazeColor);
    rampColor(DayCycle.HEMI_SKY, t, this.hemiSkyColor);
    rampColor(DayCycle.HEMI_GROUND, t, this.hemiGroundColor);
    this.hemiIntensity = rampNum(DayCycle.HEMI_I, t);
    rampColor(DayCycle.RIM, t, this.rimColor);
    this.rimIntensity = 0.3 + (1 - day) * 0.7;
    // Rim comes from the sky side opposite the sun at midday, but swings
    // around toward the sun itself at dawn/dusk — a low sun IS the rim light,
    // so backlit hero shots get a visible edge highlight on the shell.
    const rimAz = azim + Math.PI * (0.72 - 0.5 * day);
    this.rimDir.set(Math.cos(0.38) * Math.cos(rimAz), Math.sin(0.38), Math.cos(0.38) * Math.sin(rimAz)).normalize();
    this.fogNear = 14;
    this.fogFar = rampNum(DayCycle.FOG_FAR, t);
    this.exposure = rampNum(DayCycle.EXPOSURE, t);
  }
}

type ColorStop = readonly [number, number];
type NumStop = readonly [number, number];

function rampColor(stops: readonly ColorStop[], t: number, out: THREE.Color): void {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const f = THREE.MathUtils.clamp((t - a[0]) / Math.max(1e-5, b[0] - a[0]), 0, 1);
  const ca = new THREE.Color(a[1]);
  const cb = new THREE.Color(b[1]);
  out.copy(ca).lerp(cb, f);
}

function rampNum(stops: readonly NumStop[], t: number): number {
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const f = THREE.MathUtils.clamp((t - a[0]) / Math.max(1e-5, b[0] - a[0]), 0, 1);
  return THREE.MathUtils.lerp(a[1], b[1], f);
}
