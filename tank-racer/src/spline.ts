// Pure Catmull-Rom closed-loop math — no framework imports so it stays testable.

export interface Vec2 {
  x: number;
  z: number;
}

/** Precomputed dense sampling of the loop for fast closest-point lookups. */
export interface ClosestTable {
  points: Vec2[];
  /** Parameter t (0..1) of each sample. */
  ts: number[];
}

/**
 * Point on the closed Catmull-Rom loop at parameter t (wraps 0..1).
 * Each segment between control points i and i+1 is one slice of t.
 */
export function getPoint(points: Vec2[], t: number): Vec2 {
  const n = points.length;
  const scaled = ((t % 1) + 1) % 1 * n;
  const i = Math.floor(scaled);
  const u = scaled - i;
  const p0 = points[(i - 1 + n) % n];
  const p1 = points[i];
  const p2 = points[(i + 1) % n];
  const p3 = points[(i + 2) % n];

  const u2 = u * u;
  const u3 = u2 * u;
  // Standard Catmull-Rom (centripetal-free uniform variant) basis
  const a = 2 * u3 - 3 * u2 + 1;
  const b = u3 - 2 * u2 + u;
  const c = -2 * u3 + 3 * u2;
  const d = u3 - u2;

  return {
    x: a * p1.x + b * (p2.x - p0.x) * 0.5 + c * p2.x + d * (p3.x - p1.x) * 0.5,
    z: a * p1.z + b * (p2.z - p0.z) * 0.5 + c * p2.z + d * (p3.z - p1.z) * 0.5,
  };
}

/** Unit tangent (not normalized here; normalize by caller if needed). */
export function getTangent(points: Vec2[], t: number): Vec2 {
  // Central difference on the curve — robust for closed loops.
  const e = 1e-4;
  const a = getPoint(points, t - e);
  const b = getPoint(points, t + e);
  return { x: b.x - a.x, z: b.z - a.z };
}

/** Build a sample table for closest-point queries. */
export function buildClosestTable(points: Vec2[], samples = 1000): ClosestTable {
  const tablePoints: Vec2[] = new Array(samples);
  const ts: number[] = new Array(samples);
  for (let s = 0; s < samples; s++) {
    const t = s / samples;
    tablePoints[s] = getPoint(points, t);
    ts[s] = t;
  }
  return { points: tablePoints, ts };
}

/** Closest sampled point on the spline to an XZ position. */
export function closestOnSpline(
  table: ClosestTable,
  x: number,
  z: number,
): { t: number; distSq: number } {
  let best = 0;
  let bestDistSq = Infinity;
  const pts = table.points;
  for (let s = 0; s < pts.length; s++) {
    const dx = pts[s].x - x;
    const dz = pts[s].z - z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = s;
    }
  }
  return { t: table.ts[best], distSq: bestDistSq };
}
