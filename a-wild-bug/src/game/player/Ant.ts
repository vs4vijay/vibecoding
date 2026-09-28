import * as THREE from "three";
import { clamp, damp } from "../util/MathX";

/**
 * Pip — a fully procedural ant (no model files). The gait is the true ant
 * diagonal tripod: legs L1+R2+L3 swing while R1+L2+R3 stand, phase-offset sine
 * stepping with feet planted during stance and a parabolic swing arc. Feet are
 * computed ANALYTICALLY each frame from (gaitTime, velocity, rest offsets), so
 * the cycle is stateless, teleport-safe and deterministic for pinned shots.
 * Legs reach/step over terrain via 2-bone IK against the ground sampler.
 */
export interface AntVisualState {
  pos: THREE.Vector3;
  yaw: number;
  planarSpeed: number;
  forwardAccel: number;
  turnRate: number;
  grounded: boolean;
  groundY: number;
}

const GAIT = {
  swingFrac: 0.42, // fraction of the cycle spent in swing (tripod airtime)
  baseFreq: 2.0,
  freqPerSpeed: 2.7,
  maxFreq: 11,
  baseLift: 0.02,
  liftPerSpeed: 0.012,
} as const;

// Per-leg config in root space (+X left, +Z forward). gaitOffset 0 = tripod A
// (L1, R2, L3), 0.5 = tripod B (R1, L2, R3). Feet sit comparatively close to
// the body — a narrow ant stance, not a splayed spider one.
const LEGS = [
  { side: 1, hip: [0.044, 0.095, 0.05], rest: [0.098, 0, 0.068], offset: 0.0 },
  { side: -1, hip: [-0.044, 0.095, 0.0], rest: [-0.105, 0, 0.0], offset: 0.5 },
  { side: 1, hip: [0.044, 0.095, -0.05], rest: [0.1, 0, -0.072], offset: 0.0 },
  { side: -1, hip: [-0.044, 0.095, 0.05], rest: [-0.098, 0, 0.068], offset: 0.5 },
  { side: 1, hip: [0.044, 0.095, 0.0], rest: [0.105, 0, 0.0], offset: 0.0 },
  { side: -1, hip: [-0.044, 0.095, -0.05], rest: [-0.1, 0, -0.072], offset: 0.5 },
] as const;

const FEMUR_LEN = 0.082;
const TIBIA_LEN = 0.132;

export class Ant {
  /** Wrapper added to the scene: `root` carries position+yaw, legs live in
   *  world space under the untouched wrapper so IK coordinates stay clean. */
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly legsGroup = new THREE.Group();
  gaitTime = 0;
  frozen = false;
  /** Grain carry point above the head (ForageLoop/CarriedGrain attach here). */
  readonly carryAnchor = new THREE.Group();

  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly abdomen: THREE.Mesh;
  private readonly antennaSegs: THREE.Group[] = [];
  private readonly hipAnchors: THREE.Object3D[] = [];
  private readonly mandibles: THREE.Mesh[] = [];
  private carryShadow: THREE.Mesh | null = null;
  private carrying = false;
  private carryBlend = 0;

  private readonly legParts: {
    femur: THREE.Mesh;
    tibia: THREE.Mesh;
    knee: THREE.Mesh;
    foot: THREE.Mesh;
  }[] = [];

  private readonly blob: THREE.Mesh;
  private readonly groundSampler: (x: number, z: number) => number;

  // Smoothed pose state.
  private antTime = 0;
  private pitch = 0;
  private roll = 0;
  private airBlend = 0;

  // Scratch.
  private readonly _rest = new THREE.Vector3();
  private readonly _target = new THREE.Vector3();
  private readonly _hip = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _pole = new THREE.Vector3();
  private readonly _velDir = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private readonly _euler = new THREE.Euler(0, 0, 0, "XYZ");

  constructor(groundSampler: (x: number, z: number) => number) {
    this.groundSampler = groundSampler;

    // Chitin carries a procedural roughness map (micro-scratch variance) so
    // the shell reads as brushed insect cuticle, not polished plastic.
    const chitin = new THREE.MeshPhysicalMaterial({
      color: 0x8a4f22,
      roughness: 0.56,
      roughnessMap: Ant.chitinRoughness,
      metalness: 0,
      clearcoat: 0.5,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.85,
    });
    const chitinDark = new THREE.MeshPhysicalMaterial({
      color: 0x76411c,
      roughness: 0.6,
      roughnessMap: Ant.chitinRoughness,
      metalness: 0,
      clearcoat: 0.45,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.8,
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x74491f,
      roughness: 0.62,
      roughnessMap: Ant.chitinRoughness,
      metalness: 0,
    });
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0d0b10,
      roughness: 0.24,
      roughnessMap: Ant.eyeRoughness,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.3,
    });

    // --- Body ---
    const thorax = new THREE.Mesh(Ant.ellipsoidGeo(), chitinDark);
    thorax.scale.set(0.047, 0.04, 0.058);
    thorax.position.y = 0.1;
    this.body.add(thorax);

    // The head group rides on the body (bob/lean) ahead of the thorax.
    this.body.add(this.head);
    this.head.position.set(0, 0.114, 0.125);
    this.head.rotation.x = 0.02;
    const headMesh = new THREE.Mesh(Ant.ellipsoidGeo(), chitin);
    // Slightly flattened/widened so the skull is not a plain egg; carried
    // ahead of the thorax on a visible neck so the face always reads.
    headMesh.scale.set(0.042, 0.033, 0.048);
    this.head.add(headMesh);

    // Clypeus: the low face plate above the mandibles that gives ants their
    // blunt "front" — the head no longer reads as a featureless egg.
    const clypeus = new THREE.Mesh(Ant.jointGeo, chitinDark);
    clypeus.scale.set(0.019, 0.01, 0.012);
    clypeus.position.set(0, -0.008, 0.045);
    clypeus.rotation.x = 0.35;
    this.head.add(clypeus);

    for (const side of [-1, 1]) {
      // Wall-eyed: eyes tucked toward the skull plane so a frontal view shows
      // foreshortened ellipses instead of two full floating spheres.
      const eye = new THREE.Mesh(Ant.eyeGeo, eyeMat);
      eye.scale.set(0.024, 0.027, 0.018);
      eye.position.set(side * 0.03, 0.014, 0.02);
      this.head.add(eye);

      // Baked catchlight so the eyes read even when the head is in shade.
      const glint = new THREE.Mesh(Ant.glintGeo, Ant.glintMat);
      glint.scale.setScalar(0.0042);
      glint.position.set(side * 0.026, 0.027, 0.033);
      this.head.add(glint);

      const mandible = new THREE.Mesh(Ant.mandibleGeo, chitinDark);
      mandible.position.set(side * 0.013, -0.018, 0.046);
      mandible.rotation.set(0.35, side * -0.4, side * 0.25);
      this.head.add(mandible);
      this.mandibles.push(mandible);
    }

    // Antennae: 3 jointed segments each, elbowed (scape up-and-out, flagellum
    // bending forward), animated with phase lag. Small spheres at the elbow
    // keep the joint from reading as a hard tube kink.
    const segLens = [0.05, 0.046, 0.042];
    for (const side of [-1, 1]) {
      let parent: THREE.Object3D = this.head;
      const segs: THREE.Group[] = [];
      for (let s = 0; s < 3; s++) {
        const joint = new THREE.Group();
        if (s === 0) {
          joint.position.set(side * 0.014, 0.03, 0.034);
        } else {
          joint.position.y = segLens[s - 1];
          // Elbow beads at the scape/flagellum junctions.
          const bead = new THREE.Mesh(Ant.jointGeo, legMat);
          bead.scale.setScalar(s === 1 ? 0.006 : 0.005);
          joint.add(bead);
        }
        const seg = new THREE.Mesh(Ant.segGeo, legMat);
        seg.scale.y = segLens[s];
        seg.position.y = segLens[s] / 2;
        joint.add(seg);
        parent.add(joint);
        parent = joint;
        segs.push(joint);
      }
      this.antennaSegs.push(...segs);
    }

    // Grain carry point: seated at the mouth — the seed's base lands between
    // the mandible tips (tips ≈ body y 0.10, z 0.20 once rotated up), with
    // the seed leaning back against the head crown instead of balancing on it.
    this.carryAnchor.position.set(0, 0.16, 0.175);
    this.body.add(this.carryAnchor);

    // Contact-occlusion patch under the carried grain: a soft dark ellipse on
    // the head crown so the seed visibly rests against the ant, not the air.
    this.carryShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.095, 0.064),
      new THREE.MeshBasicMaterial({
        map: Ant.blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.carryShadow.rotation.x = -Math.PI / 2 + 0.38;
    this.carryShadow.position.set(0, 0.15, 0.148);
    this.carryShadow.renderOrder = 2;
    this.carryShadow.visible = false;
    this.body.add(this.carryShadow);

    const petiole = new THREE.Mesh(Ant.jointGeo, chitinDark);
    petiole.scale.setScalar(0.016);
    petiole.position.set(0, 0.098, -0.062);
    this.body.add(petiole);

    this.abdomen = new THREE.Mesh(Ant.abdomenGeo(), Ant.abdomenMat);
    this.abdomen.scale.set(0.054, 0.047, 0.086);
    this.abdomen.position.set(0, 0.098, -0.138);
    this.abdomen.rotation.x = 0.14;
    this.body.add(this.abdomen);

    // Hip anchors ride with the body (bob/lean), feet do not.
    for (const leg of LEGS) {
      const anchor = new THREE.Object3D();
      anchor.position.set(leg.hip[0], leg.hip[1], leg.hip[2]);
      this.body.add(anchor);
      this.hipAnchors.push(anchor);
      const coxa = new THREE.Mesh(Ant.jointGeo, legMat);
      coxa.scale.setScalar(0.0095);
      anchor.add(coxa);
    }

    // Soft contact-shadow blob that stays on the ground while jumping.
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(0.52, 0.38),
      new THREE.MeshBasicMaterial({
        map: Ant.blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.32,
      }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    this.blob.receiveShadow = false;

    this.root.add(this.body);
    this.root.add(this.blob);
    this.legsGroup.add(this.buildLegs(legMat));
    this.group.add(this.root);
    this.group.add(this.legsGroup);

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.blob && o !== this.carryShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  private buildLegs(mat: THREE.MeshStandardMaterial): THREE.Group {
    const legs = new THREE.Group();
    for (let i = 0; i < LEGS.length; i++) {
      const femur = new THREE.Mesh(Ant.femurGeo, mat);
      const tibia = new THREE.Mesh(Ant.tibiaGeo, mat);
      const knee = new THREE.Mesh(Ant.jointGeo, mat);
      knee.scale.setScalar(0.007);
      const foot = new THREE.Mesh(Ant.footGeo, mat);
      foot.scale.setScalar(0.0055);
      legs.add(femur, tibia, knee, foot);
      this.legParts.push({ femur, tibia, knee, foot });
    }
    return legs;
  }

  get gaitPhase(): number {
    return this.gaitTime % 1;
  }

  /** Idle-animation clock (read by the carried-grain bob). */
  get clock(): number {
    return this.antTime;
  }

  setGaitTime(t: number): void {
    this.gaitTime = t;
  }

  /** Mandibles spread and head lifts while hauling a grain overhead. */
  setCarrying(on: boolean): void {
    this.carrying = on;
  }

  /** Pins the idle-animation clock (deterministic shots). */
  setClock(t: number): void {
    this.antTime = t;
  }

  /** Recomputes pose without smoothing lag (used right after teleports). */
  snapPose(state: AntVisualState): void {
    this.update(0, state);
    this.airBlend = state.grounded ? 0 : 1;
  }

  update(dt: number, s: AntVisualState): void {
    // antTime drives idle sway/breathing; freeze with the gait so pinned
    // shots are deterministic.
    if (!this.frozen) {
      this.antTime += dt;
      const freq = clamp(GAIT.baseFreq + s.planarSpeed * GAIT.freqPerSpeed, GAIT.baseFreq, GAIT.maxFreq);
      this.gaitTime += freq * dt;
    }

    this.root.position.copy(s.pos);
    this.root.rotation.y = s.yaw;

    // --- Body pose ---
    const speedFactor = THREE.MathUtils.smoothstep(s.planarSpeed, 0.05, 0.35);
    const idle = 1 - speedFactor;
    const bob = Math.sin(this.gaitTime * Math.PI * 4) * 0.005 * speedFactor;

    // Terrain alignment (pitch from front/back samples, roll from sides).
    const fwdX = Math.sin(s.yaw);
    const fwdZ = Math.cos(s.yaw);
    const hF = this.groundSampler(s.pos.x + fwdX * 0.12, s.pos.z + fwdZ * 0.12);
    const hB = this.groundSampler(s.pos.x - fwdX * 0.12, s.pos.z - fwdZ * 0.12);
    const hL = this.groundSampler(s.pos.x + fwdZ * 0.1, s.pos.z - fwdX * 0.1);
    const hR = this.groundSampler(s.pos.x - fwdZ * 0.1, s.pos.z + fwdX * 0.1);
    const pitchTarget = -Math.atan2(hF - hB, 0.24) * 0.55 - clamp(s.forwardAccel * 0.012, -0.1, 0.14);
    const rollTarget =
      Math.atan2(hL - hR, 0.2) * 0.4 + clamp(-s.turnRate * 0.028, -0.16, 0.16) + Math.sin(this.antTime * 0.9) * 0.022 * idle;

    // dt === 0 (snapPose) snaps straight to the target pose — no history from
    // pre-shot frames leaks into pinned captures.
    if (dt <= 0) {
      this.pitch = pitchTarget;
      this.roll = rollTarget;
      this.airBlend = s.grounded ? 0 : 1;
    } else {
      this.pitch = damp(this.pitch, pitchTarget, 10, dt);
      this.roll = damp(this.roll, rollTarget, 10, dt);
      this.airBlend = damp(this.airBlend, s.grounded ? 0 : 1, 8, dt);
    }

    this.body.position.y = bob + Math.sin(this.antTime * 1.35) * 0.0016 * idle;
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.head.rotation.y = clamp(s.turnRate * 0.05, -0.35, 0.35);
    // Carrying: head tips up proudly, mandibles rotate up ~0.3 rad to cradle
    // the seed's base, and the occlusion patch fades in on the crown.
    this.carryBlend = dt <= 0 ? (this.carrying ? 1 : 0) : damp(this.carryBlend, this.carrying ? 1 : 0, 9, dt);
    const carry = this.carryBlend;
    this.head.rotation.x = 0.02 - carry * 0.14 + clamp(-s.forwardAccel * 0.004, -0.06, 0.08);
    for (let i = 0; i < this.mandibles.length; i++) {
      const side = i === 0 ? -1 : 1;
      const m = this.mandibles[i];
      m.rotation.x = 0.35 - carry * 0.3;
      m.rotation.y = side * (-0.4 + carry * 0.34);
      m.rotation.z = side * (0.25 + carry * 0.3);
    }
    if (this.carryShadow) {
      this.carryShadow.visible = carry > 0.02;
      (this.carryShadow.material as THREE.MeshBasicMaterial).opacity = 0.36 * carry;
    }
    const breathe = 1 + Math.sin(this.antTime * 2.3) * 0.016;
    this.abdomen.scale.set(0.054, 0.047 * breathe, 0.086 * breathe);

    // --- Antennae: idle sway + streamline back at speed, segment lag.
    // Elbow plan: seg0 (scape) splays outward and leans forward, seg1 bends
    // the flagellum forward, seg2 continues the arc — the classic ant "elbow".
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? -1 : 1;
      for (let seg = 0; seg < 3; seg++) {
        const idx = side * 3 + seg;
        const joint = this.antennaSegs[idx];
        if (seg === 0) {
          // Scape: out-and-forward feeler, laid back a touch at speed.
          joint.rotation.z = -sgn * 0.42;
          joint.rotation.y =
            sgn * 0.35 + Math.sin(this.antTime * 1.7 + side * 0.9) * 0.16 * (0.4 + idle);
          joint.rotation.x =
            0.95 - clamp(s.planarSpeed * 0.055, 0, 0.24) + Math.sin(this.antTime * 2.2 + side * 0.5) * 0.08;
        } else if (seg === 1) {
          // The elbow: strong forward bend off the scape.
          joint.rotation.x = 0.95 + Math.sin(this.antTime * 2.5 + side * 1.3) * 0.08;
          joint.rotation.y = sgn * -0.15;
          joint.rotation.z = Math.sin(this.antTime * 2.5 - seg * 0.85 + side * 1.3) * 0.06;
        } else {
          joint.rotation.x = 0.3 + Math.sin(this.antTime * 2.9 - seg * 1.2) * 0.09;
          joint.rotation.z = Math.sin(this.antTime * 2.5 - seg * 0.85 + side * 1.3) * 0.08;
        }
      }
    }

    // --- Feet + IK ---
    this.root.updateMatrixWorld(true);
    this._euler.set(0, s.yaw, 0);
    this._q.setFromEuler(this._euler);

    const freq = clamp(GAIT.baseFreq + s.planarSpeed * GAIT.freqPerSpeed, GAIT.baseFreq, GAIT.maxFreq);
    const T = 1 / freq;
    const stanceT = (1 - GAIT.swingFrac) * T;
    const v = s.planarSpeed;
    const stride = 0.5 * v * stanceT;
    const lift = GAIT.baseLift + v * GAIT.liftPerSpeed;
    const speedGate = THREE.MathUtils.smoothstep(v, 0.04, 0.12); // snap feet to rest when stopped

    if (v > 0.05) {
      this._velDir.set(Math.sin(s.yaw), 0, Math.cos(s.yaw)); // controller aligns yaw to velocity
    } else {
      this._velDir.set(0, 0, 0);
    }

    for (let i = 0; i < LEGS.length; i++) {
      const leg = LEGS[i];
      const phase = (this.gaitTime + leg.offset) % 1;

      // Rest foot position in world (root space: no bob, feet stay planted).
      this._rest.set(leg.rest[0], 0, leg.rest[2]).applyMatrix4(this.root.matrixWorld);
      this._rest.y = this.groundSampler(this._rest.x, this._rest.z);

      const target = this._target.copy(this._rest);
      if (v > 0.05) {
        let fore: number;
        let liftNow = 0;
        if (phase < GAIT.swingFrac) {
          const u = phase / GAIT.swingFrac;
          const eased = u * u * (3 - 2 * u);
          fore = -stride + eased * 2 * stride;
          liftNow = Math.sin(u * Math.PI) * lift;
        } else {
          fore = stride - v * (phase - GAIT.swingFrac) * T;
        }
        target.addScaledVector(this._velDir, fore * speedGate);
        target.y += liftNow * speedGate;
      }

      // In the air the legs tuck up under the body.
      if (this.airBlend > 0.001) {
        this._hip.set(leg.rest[0] * 0.85, 0.05, leg.rest[2] * 0.9).applyMatrix4(this.root.matrixWorld);
        target.lerp(this._hip, this.airBlend);
      }

      // 2-bone IK: hip → knee → foot with an up-and-outward pole.
      const anchor = this.hipAnchors[i];
      anchor.getWorldPosition(this._hip);
      const dir = this._dir.subVectors(target, this._hip);
      let dist = dir.length();
      const maxReach = FEMUR_LEN + TIBIA_LEN - 0.002;
      if (dist > maxReach) dist = maxReach;
      dir.normalize();

      const cosA = clamp((FEMUR_LEN * FEMUR_LEN + dist * dist - TIBIA_LEN * TIBIA_LEN) / (2 * FEMUR_LEN * dist), -1, 1);
      const a1 = Math.acos(cosA);
      // Knees point UP like a true ant (near-vertical pole, slight outward
      // bias) — not out-and-up like a spider.
      const pole = this._pole.set(leg.side * 0.3, 1.0, 0).applyQuaternion(this._q);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-6) pole.set(0, 1, 0);
      pole.normalize();

      const knee = this._rest.copy(dir).multiplyScalar(Math.cos(a1) * FEMUR_LEN).addScaledVector(pole, Math.sin(a1) * FEMUR_LEN).add(this._hip);

      const parts = this.legParts[i];
      Ant.placeSegment(parts.femur, this._hip, knee);
      parts.knee.position.copy(knee);
      Ant.placeSegment(parts.tibia, knee, target);
      parts.foot.position.copy(target);
    }

    // --- Contact shadow ---
    const height = Math.max(0, s.pos.y - s.groundY);
    this.blob.position.set(0, s.groundY - s.pos.y + 0.014, 0);
    this.blob.rotation.z = -s.yaw; // cancel the root yaw so the ellipse stays axis-aligned
    const fade = 1 - clamp(height / 1.2, 0, 1);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.32 * fade;
    this.blob.scale.setScalar(1 + height * 0.6);
    this.blob.visible = fade > 0.02;
  }

  /** Orient a unit-length cylinder mesh (origin at top, extends -Y) from→to. */
  private static placeSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    mesh.position.copy(from);
    const dir = Ant._staticV1.subVectors(to, from);
    const len = Math.max(dir.length(), 1e-5);
    mesh.scale.y = len;
    mesh.quaternion.setFromUnitVectors(Ant.DOWN, dir.multiplyScalar(1 / len));
  }

  private static readonly DOWN = new THREE.Vector3(0, -1, 0);
  private static readonly _staticV1 = new THREE.Vector3();

  // --- Shared geometries / materials ---

  private static ellipsoidGeo(): THREE.BufferGeometry {
    return new THREE.SphereGeometry(1, 20, 14);
  }
  private static readonly eyeGeo = new THREE.SphereGeometry(1, 12, 10);
  private static readonly glintGeo = new THREE.SphereGeometry(1, 6, 5);
  private static readonly glintMat = new THREE.MeshBasicMaterial({ color: 0xfff6e8 });
  private static readonly jointGeo = new THREE.SphereGeometry(1, 8, 6);
  private static readonly footGeo = new THREE.SphereGeometry(1, 6, 5);
  private static readonly mandibleGeo = new THREE.ConeGeometry(0.008, 0.034, 6).rotateX(Math.PI / 2);
  private static readonly segGeo = new THREE.CylinderGeometry(0.0032, 0.0045, 1, 5).translate(0, 0.5, 0);
  private static readonly femurGeo = new THREE.CylinderGeometry(0.008, 0.005, 1, 6).translate(0, -0.5, 0);
  private static readonly tibiaGeo = new THREE.CylinderGeometry(0.005, 0.0024, 1, 6).translate(0, -0.5, 0);

  /** Abdomen with chitin banding baked into vertex colors: a dark crease
   *  between segments plus a broader, warmer secondary tone band so the shell
   *  never reads as one glossy bead. */
  private static abdomenGeo(): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const band = 0.5 + 0.5 * Math.sin(z * 14 + 1.2); // segment creases
      const band2 = 0.5 + 0.5 * Math.sin(z * 8.2 + 3.4); // broad tone bands
      const shade = 1 - Math.pow(band, 3) * 0.36;
      // Darker bands pull toward warm red-brown instead of plain gray.
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade * (0.9 - 0.14 * band2);
      colors[i * 3 + 2] = shade * (0.78 - 0.16 * band2);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  /** Fine brushed-cuticle noise for roughness maps (green channel). */
  private static chitinRoughness = Ant.buildChitinRoughness();

  /** High-frequency facet noise for the cornea — a faint compound-eye read. */
  private static eyeRoughness = Ant.buildEyeRoughness();

  private static buildEyeRoughness(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    const hash = (x: number, y: number) => {
      let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 2387658965) + 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 2px ommatidia lattice: each facet one roughness step, thin dark rims.
        const cx = x >> 1;
        const cy = y >> 1;
        const facet = 0.55 + 0.45 * hash(cx * 7 + 1, cy * 7 + 3);
        const rim = x % 2 === 0 || y % 2 === 0 ? 0.82 : 1.0;
        const v = Math.min(1, facet * rim);
        const b = Math.round(v * 255);
        const i = (y * size + x) * 4;
        img.data[i] = b;
        img.data[i + 1] = b;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
  }

  private static abdomenMat = new THREE.MeshPhysicalMaterial({
    color: 0x9c5c26,
    vertexColors: true,
    roughness: 0.64,
    roughnessMap: Ant.chitinRoughness,
    metalness: 0,
    clearcoat: 0.4,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.7,
  });

  private static buildChitinRoughness(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    // Deterministic hash noise — same texture every run.
    const hash = (x: number, y: number) => {
      let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 2387658965) + 1442695041) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Two scales of streaky noise + speckle, biased bright (≈0.75 mean) so
        // material roughness values act as the variance ceiling.
        const streak = hash(x * 3 + (y >> 2), y) * 0.5 + hash(x, y >> 1) * 0.5;
        const speck = hash(x, y);
        const v = Math.min(1, 0.62 + streak * 0.3 + (speck - 0.5) * 0.16);
        const b = Math.round(v * 255);
        img.data[(y * size + x) * 4] = b;
        img.data[(y * size + x) * 4 + 1] = b;
        img.data[(y * size + x) * 4 + 2] = b;
        img.data[(y * size + x) * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    return tex;
  }

  /** Soft elliptical contact-shadow sprite. */
  private static blobTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.4)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}
