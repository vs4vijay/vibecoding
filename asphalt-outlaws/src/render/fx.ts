// OWNER: Agent D. Lightweight particle system for gameplay juice. Contract
// per .plan.md §5. Do not change signatures.

export type BurstName =
  | "sparks"
  | "dust"
  | "smoke"
  | "stars"
  | "debris"
  | "speedlines";

type Kind = BurstName | "snow";

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Gravity px/s^2 (bursts only). */
  gy: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  rot: number;
  vr: number;
  age: number;
  hue: string;
  alpha: number;
  /** Snow sinus drift phase + amplitude. */
  phase: number;
  driftAmp: number;
  /** Screen bounds for snow wrap-around (0 = never wrap). */
  wrapW: number;
  wrapH: number;
}

export interface EmitOpts {
  count?: number;
  hue?: string;
}

const MAX_PARTICLES = 600;
const SNOW_TARGET = 120;

const SPARK_HUES = ["#ffd23c", "#ff9b2e", "#ff5b2e"];
const DUST_HUES = ["#c9a86a", "#b09358"];
const SMOKE_HUES = ["#8a8a92", "#6f6f78"];
const STAR_HUES = ["#ffd23c", "#ffe98a"];
const DEBRIS_HUES = ["#2a2a33", "#1c1c24", "#3a3a44"];

export class ParticleSystem {
  private readonly rng: { next(): number } | null;
  private parts: Particle[] = [];

  constructor(rng?: { next(): number }) {
    this.rng = rng ?? null;
  }

  /** Random source: injected rng in tests, Math.random in the browser. */
  private r(): number {
    const rng = this.rng;
    return rng ? rng.next() : Math.random();
  }

  private defaultCount(name: BurstName): number {
    switch (name) {
      case "sparks":
        return 8 + Math.floor(this.r() * 7);
      case "dust":
        return 6 + Math.floor(this.r() * 5);
      case "smoke":
        return 4 + Math.floor(this.r() * 3);
      case "stars":
        return 8;
      case "debris":
        return 6;
      case "speedlines":
        return 10;
    }
  }

  private push(p: Particle): void {
    this.parts.push(p);
  }

  /** Keep the pool bounded; drop the oldest. */
  private trim(): void {
    if (this.parts.length > MAX_PARTICLES) {
      this.parts.splice(0, this.parts.length - MAX_PARTICLES);
    }
  }

  /** Spawn a burst at logical-canvas coords. */
  emit(name: BurstName, x: number, y: number, opts?: EmitOpts): void {
    const count = opts?.count ?? this.defaultCount(name);
    for (let i = 0; i < count; i++) {
      const hue = opts?.hue;
      switch (name) {
        case "sparks": {
          const ang = this.r() * Math.PI * 2;
          const sp = 120 + this.r() * 220;
          const life = 0.25 + this.r() * 0.25;
          this.push({
            kind: name, x, y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 70, gy: 640,
            life, maxLife: life,
            size: 2 + this.r() * 2.5, grow: 0, rot: 0, vr: 0, age: 0,
            hue: hue ?? SPARK_HUES[Math.floor(this.r() * SPARK_HUES.length)] ?? "#ffd23c",
            alpha: 1, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
        case "dust": {
          const life = 0.5 + this.r() * 0.4;
          this.push({
            kind: name, x, y,
            vx: (this.r() - 0.5) * 120, vy: -(5 + this.r() * 30), gy: 0,
            life, maxLife: life,
            size: 6 + this.r() * 7, grow: 22 + this.r() * 12, rot: 0, vr: 0, age: 0,
            hue: hue ?? DUST_HUES[Math.floor(this.r() * DUST_HUES.length)] ?? "#c9a86a",
            alpha: 0.5, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
        case "smoke": {
          const life = 0.6 + this.r() * 0.5;
          this.push({
            kind: name, x, y,
            vx: (this.r() - 0.5) * 40, vy: -(40 + this.r() * 55), gy: 0,
            life, maxLife: life,
            size: 7 + this.r() * 7, grow: 24, rot: 0, vr: 0, age: 0,
            hue: hue ?? SMOKE_HUES[Math.floor(this.r() * SMOKE_HUES.length)] ?? "#8a8a92",
            alpha: 0.42, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
        case "stars": {
          const ang = -Math.PI / 2 + (this.r() - 0.5) * 2.2;
          const sp = 150 + this.r() * 130;
          const life = 0.5 + this.r() * 0.3;
          this.push({
            kind: name, x, y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, gy: 520,
            life, maxLife: life,
            size: 5 + this.r() * 4, grow: 0,
            rot: this.r() * Math.PI * 2, vr: (this.r() - 0.5) * 12, age: 0,
            hue: hue ?? STAR_HUES[Math.floor(this.r() * STAR_HUES.length)] ?? "#ffd23c",
            alpha: 1, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
        case "debris": {
          const ang = -Math.PI / 2 + (this.r() - 0.5) * 2.6;
          const sp = 90 + this.r() * 150;
          const life = 0.45 + this.r() * 0.4;
          this.push({
            kind: name, x, y,
            vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, gy: 760,
            life, maxLife: life,
            size: 4 + this.r() * 5, grow: 0,
            rot: this.r() * Math.PI, vr: (this.r() - 0.5) * 24, age: 0,
            hue: hue ?? DEBRIS_HUES[Math.floor(this.r() * DEBRIS_HUES.length)] ?? "#2a2a33",
            alpha: 1, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
        case "speedlines": {
          const life = 0.07 + this.r() * 0.09;
          const dir = this.r() < 0.5 ? -1 : 1;
          this.push({
            kind: name, x, y,
            vx: dir * (900 + this.r() * 600), vy: 0, gy: 0,
            life, maxLife: life,
            size: 40 + this.r() * 50, grow: 0, rot: 0, vr: 0, age: 0,
            hue: hue ?? "#f5ead6",
            alpha: 0.35, phase: 0, driftAmp: 0, wrapW: 0, wrapH: 0,
          });
          break;
        }
      }
    }
    this.trim();
  }

  /** Screen-space ambient weather (snow) falling continuously. */
  emitAmbientSnow(width: number, height: number, _dt: number): void {
    let snow = 0;
    for (const p of this.parts) if (p.kind === "snow") snow++;
    // First fill spreads across the whole screen; after clear() it reseeds the
    // same way. Steady state needs no spawns: step() wraps flakes at the bottom.
    if (snow >= SNOW_TARGET) return;
    const want = Math.min(SNOW_TARGET - snow, 160);
    for (let i = 0; i < want; i++) {
      this.push({
        kind: "snow",
        x: this.r() * width, y: this.r() * height,
        vx: 0, vy: 45 + this.r() * 70, gy: 0,
        life: 1, maxLife: 1,
        size: 1.6 + this.r() * 2.2, grow: 0, rot: 0, vr: 0, age: 0,
        hue: "#ffffff",
        alpha: 0.45 + this.r() * 0.4,
        phase: this.r() * Math.PI * 2,
        driftAmp: 18 + this.r() * 30,
        wrapW: width, wrapH: height,
      });
    }
  }

  step(dt: number): void {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]!;
      p.age += dt;
      if (p.kind === "snow") {
        p.x += Math.sin(p.age * 1.7 + p.phase) * p.driftAmp * dt;
        p.y += p.vy * dt;
        if (p.wrapH > 0 && p.y > p.wrapH + 14) {
          p.y = -14;
          p.x = this.r() * (p.wrapW || 1280);
        }
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        parts.splice(i, 1);
        continue;
      }
      p.vy += p.gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.size += p.grow * dt;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) parts.splice(i, 1);
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      const frac = Math.max(0, Math.min(1, p.life / p.maxLife));
      const a = p.kind === "snow" ? p.alpha : p.alpha * frac;
      if (a <= 0) continue;
      g.save();
      g.globalAlpha = a;
      switch (p.kind) {
        case "sparks": {
          g.strokeStyle = p.hue;
          g.lineWidth = Math.max(1, p.size);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          g.stroke();
          break;
        }
        case "dust":
        case "smoke":
        case "snow": {
          g.fillStyle = p.hue;
          g.beginPath();
          g.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
          g.fill();
          break;
        }
        case "stars": {
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.hue;
          g.beginPath();
          g.moveTo(p.size, 0);
          g.lineTo(0, p.size);
          g.lineTo(-p.size, 0);
          g.lineTo(0, -p.size);
          g.closePath();
          g.fill();
          break;
        }
        case "debris": {
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillStyle = p.hue;
          g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          break;
        }
        case "speedlines": {
          g.strokeStyle = p.hue;
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.size, p.y);
          g.stroke();
          break;
        }
      }
      g.restore();
    }
  }

  clear(): void {
    this.parts = [];
  }

  get count(): number {
    return this.parts.length;
  }

  /** True while every live particle has finite coordinates (NaN guard). */
  get finite(): boolean {
    for (const p of this.parts) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    }
    return true;
  }
}
