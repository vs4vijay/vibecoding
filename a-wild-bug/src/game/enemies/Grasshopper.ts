import * as THREE from "three";
import { clamp } from "../util/MathX";

/**
 * The patrol grasshopper — fully procedural, no model files. Built like the
 * ant (ellipsoid body parts + world-space 2-segment legs placed analytically
 * each pose), but the silhouette is authored for menace: elongated deep-bodied
 * frame, the classic grasshopper Z on the powerful hind legs, folded tegmina
 * along the back, big striped compound eyes with baked catchlights, and long
 * sweeping antennae.
 *
 * The pose is a PURE function of `HopperPoseInput` (clocks + blends driven by
 * the AI in fixed steps), so pinned shots snap deterministically and live play
 * damps nothing inside the visual layer.
 */

export interface HopperPoseInput {
  /** Ground-contact (or airborne) root position. */
  pos: THREE.Vector3;
  yaw: number;
  planarSpeed: number;
  grounded: boolean;
  /** 0..1 squash (hop windup / landing absorb). */
  squash: number;
  /** 0..1 airborne blend (legs tuck → hind-leg kick). */
  airBlend: number;
  /** Nose pitch while airborne (rises nose-up, falls nose-down). */
  airPitch: number;
  /** 0..1 reared-up telegraph / snatch pose. */
  rear: number;
  /** 0..1 dizzy blend + seconds since stun began. */
  stun: number;
  stunClock: number;
  /** Walk-cycle phase clock (advanced by the AI at gait frequency). */
  gaitTime: number;
  /** Idle/animation clock. */
  anim: number;
  /** 0..1 wing flutter (hop). */
  wingFlutter: number;
  /** 0..1 stolen grain visible in the mandibles. */
  carry: number;
  /** 0..1 chewing (grain shrinking toward gone). 0..1 remaining. */
  eat: number;
  /** Head look offset (radians, clamped by the AI). */
  headYaw: number;
}

// --- proportions -------------------------------------------------------------
// Root at the ground, +Z forward, +X left. ~2.4x the ant.

const BODY = {
  thoraxY: 0.165,
  femurLen: 0.27,
  tibiaLen: 0.3,
  tarsusLen: 0.05,
  frontFemur: 0.05,
  frontTibia: 0.075,
} as const;

/** Front/mid leg config in root space (+X left, +Z forward). */
const SMALL_LEGS = [
  { side: 1, hip: [0.036, 0.12, 0.15] as const, rest: [0.075, 0, 0.185] as const, offset: 0.0 },
  { side: -1, hip: [-0.036, 0.12, 0.15] as const, rest: [-0.075, 0, 0.185] as const, offset: 0.5 },
  { side: 1, hip: [0.044, 0.13, 0.02] as const, rest: [0.095, 0, 0.03] as const, offset: 0.5 },
  { side: -1, hip: [-0.044, 0.13, 0.02] as const, rest: [-0.095, 0, 0.03] as const, offset: 0.0 },
] as const;

const SWING_FRAC = 0.44;

export class Grasshopper {
  readonly group = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legsGroup = new THREE.Group();
  private readonly abdomen: THREE.Mesh;
  private readonly wings: THREE.Mesh[] = [];
  private readonly antennaJoints: THREE.Group[] = [];
  private readonly hindAnchors: THREE.Object3D[] = [];
  private readonly smallAnchors: THREE.Object3D[] = [];
  private readonly smallLegParts: { femur: THREE.Mesh; tibia: THREE.Mesh; foot: THREE.Mesh }[] = [];
  private readonly hindParts: { femur: THREE.Mesh; tibia: THREE.Mesh; tarsus: THREE.Mesh; knee: THREE.Mesh }[] = [];
  private readonly carryGrain: THREE.Mesh;
  private readonly blob: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly starAlphaAttr: THREE.BufferAttribute;

  // Scratch.
  private readonly _hip = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _rest = new THREE.Vector3();
  private readonly _target = new THREE.Vector3();
  private readonly _knee = new THREE.Vector3();
  private readonly _pole = new THREE.Vector3();
  private readonly _foot = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);
  private static readonly _sv1 = new THREE.Vector3();

  constructor(
    grainGeo: THREE.BufferGeometry,
    grainMat: THREE.Material,
    private readonly groundSampler: (x: number, z: number) => number,
  ) {
    // Global albedo trim: under the meadow's 2.4-intensity sun + sky IBL the
    // authored olive family blew out to cream on sun-facing surfaces (the
    // hind femurs read as white straws). 0.55 lands the whole animal in the
    // shell family — verified against stills at 1.0 / 0.55 / 0.35 / 0.22.
    const DIM = 0.55;
    const dim = (hex: number): number => {
      const c = new THREE.Color(hex).multiplyScalar(DIM);
      return c.getHex();
    };
    const shell = new THREE.MeshPhysicalMaterial({
      color: dim(0x7d8144),
      roughness: 0.6,
      roughnessMap: Grasshopper.roughnessTex,
      metalness: 0,
      clearcoat: 0.24,
      clearcoatRoughness: 0.55,
      envMapIntensity: 0.6,
    });
    const shellDark = new THREE.MeshPhysicalMaterial({
      color: dim(0x5c6130),
      roughness: 0.66,
      roughnessMap: Grasshopper.roughnessTex,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.55,
    });
    const bellyMat = new THREE.MeshStandardMaterial({ color: dim(0xa8a75e), roughness: 0.78 });
    const legMat = new THREE.MeshStandardMaterial({ color: dim(0x6d7038), roughness: 0.68 });
    const legBanded = new THREE.MeshStandardMaterial({
      color: dim(0xffffff),
      vertexColors: true,
      roughness: 0.66,
    });
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: dim(0xffffff),
      vertexColors: true,
      roughness: 0.26,
      metalness: 0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.25,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: dim(0xffffff),
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    // --- Thorax + pronotum saddle ---
    const thorax = new THREE.Mesh(Grasshopper.ellipsoid, shell);
    thorax.scale.set(0.056, 0.054, 0.13);
    thorax.position.set(0, BODY.thoraxY, 0.01);
    this.body.add(thorax);

    const saddle = new THREE.Mesh(Grasshopper.ellipsoid, shellDark);
    saddle.scale.set(0.064, 0.05, 0.1);
    saddle.position.set(0, BODY.thoraxY + 0.032, 0.055);
    saddle.rotation.x = -0.12;
    this.body.add(saddle);

    // Belly keel so the underside is not a flat shadow void.
    const belly = new THREE.Mesh(Grasshopper.ellipsoid, bellyMat);
    belly.scale.set(0.045, 0.03, 0.12);
    belly.position.set(0, BODY.thoraxY - 0.032, -0.01);
    this.body.add(belly);

    // --- Head ---
    this.body.add(this.head);
    this.head.position.set(0, BODY.thoraxY + 0.008, 0.165);
    const skull = new THREE.Mesh(Grasshopper.ellipsoid, shell);
    skull.scale.set(0.044, 0.043, 0.05);
    skull.rotation.x = -0.12;
    this.head.add(skull);
    const face = new THREE.Mesh(Grasshopper.ellipsoid, shellDark);
    face.scale.set(0.036, 0.036, 0.02);
    face.position.set(0, -0.004, 0.04);
    face.rotation.x = -0.35;
    this.head.add(face);

    for (const side of [-1, 1]) {
      // Big striped compound eyes wrapping the skull sides.
      const eye = new THREE.Mesh(Grasshopper.eyeGeo, eyeMat);
      eye.scale.set(0.021, 0.03, 0.033);
      eye.position.set(side * 0.034, 0.008, 0.004);
      eye.rotation.z = side * 0.38;
      eye.rotation.y = side * 0.3;
      this.head.add(eye);

      // Baked catchlight so the eyes never read dead. ONE glint, small and
      // high on the eye: the old pair of dots dominated the dark eye ball and
      // read as googly toy eyes in the hero close-up (the eye material's own
      // clearcoat specular carries the wet read).
      const glint = new THREE.Mesh(Grasshopper.glintGeo, Grasshopper.glintMat);
      glint.scale.setScalar(0.0042);
      glint.position.set(side * 0.044, 0.02, 0.028);
      this.head.add(glint);

      // Mouth palps.
      const palp = new THREE.Mesh(Grasshopper.palpGeo, legMat);
      palp.scale.setScalar(0.9);
      palp.position.set(side * 0.016, -0.026, 0.042);
      palp.rotation.set(0.7, side * 0.25, 0);
      this.head.add(palp);

      // Antennae: 4 slim segments sweeping back, animated with lag.
      const segLens = [0.075, 0.07, 0.062, 0.055];
      let parent: THREE.Object3D = this.head;
      for (let sgi = 0; sgi < 4; sgi++) {
        const joint = new THREE.Group();
        if (sgi === 0) {
          joint.position.set(side * 0.016, 0.032, 0.005);
          joint.rotation.set(1.5, side * -0.28, side * 0.3);
        } else {
          joint.position.y = segLens[sgi - 1];
          const bead = new THREE.Mesh(Grasshopper.beadGeo, legMat);
          bead.scale.setScalar(0.0038);
          joint.add(bead);
        }
        const seg = new THREE.Mesh(Grasshopper.antennaGeo, legMat);
        seg.scale.y = segLens[sgi];
        seg.position.y = segLens[sgi] / 2;
        joint.add(seg);
        parent.add(joint);
        parent = joint;
        this.antennaJoints.push(joint);
      }
    }

    // --- Abdomen (segmented banding) + folded wings ---
    this.abdomen = new THREE.Mesh(Grasshopper.abdomenGeo, new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.64,
      roughnessMap: Grasshopper.roughnessTex,
      clearcoat: 0.18,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.5,
    }));
    this.abdomen.scale.set(0.052, 0.05, 0.17);
    this.abdomen.position.set(0, BODY.thoraxY - 0.004, -0.235);
    this.abdomen.rotation.x = 0.1;
    this.body.add(this.abdomen);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(Grasshopper.wingGeo, wingMat);
      // Raised just proud of the saddle hump so the folded tegmina read as a
      // seam down the back (at +0.058 they were buried inside the saddle
      // mesh and the animal had no wing line at all).
      wing.position.set(side * 0.02, BODY.thoraxY + 0.088, -0.09);
      wing.rotation.set(0.06, side * 0.05, 0);
      this.body.add(wing);
      this.wings.push(wing);
    }

    // --- Hind legs (the classic Z) — hip anchors ride with the body ---
    for (const side of [-1, 1]) {
      const anchor = new THREE.Object3D();
      anchor.position.set(side * 0.048, BODY.thoraxY - 0.01, -0.115);
      this.body.add(anchor);
      this.hindAnchors.push(anchor);
      const coxa = new THREE.Mesh(Grasshopper.beadGeo, legMat);
      coxa.scale.setScalar(0.023); // covers the femur's hip end (radius 0.022)
      anchor.add(coxa);

      const femur = new THREE.Mesh(Grasshopper.femurGeo, legBanded);
      const tibia = new THREE.Mesh(Grasshopper.tibiaGeo, legMat);
      const tarsus = new THREE.Mesh(Grasshopper.tarsusGeo, legMat);
      const knee = new THREE.Mesh(Grasshopper.beadGeo, legMat);
      knee.scale.setScalar(0.0125); // caps the femur→tibia joint
      this.legsGroup.add(femur, tibia, tarsus, knee);
      this.hindParts.push({ femur, tibia, tarsus, knee });
    }

    // --- Front + mid legs (small, quick-stepping) ---
    for (const leg of SMALL_LEGS) {
      const anchor = new THREE.Object3D();
      anchor.position.set(leg.hip[0], leg.hip[1], leg.hip[2]);
      this.body.add(anchor);
      this.smallAnchors.push(anchor);
      const femur = new THREE.Mesh(Grasshopper.smallFemurGeo, legMat);
      const tibia = new THREE.Mesh(Grasshopper.smallTibiaGeo, legMat);
      const foot = new THREE.Mesh(Grasshopper.beadGeo, legMat);
      foot.scale.setScalar(0.0042);
      this.legsGroup.add(femur, tibia, foot);
      this.smallLegParts.push({ femur, tibia, foot });
    }

    // --- Stolen grain carried in the mandibles ---
    this.carryGrain = new THREE.Mesh(grainGeo, grainMat);
    this.carryGrain.position.set(0, -0.012, 0.052);
    this.carryGrain.rotation.x = -Math.PI / 2 + 0.35;
    this.carryGrain.scale.setScalar(1.15);
    this.carryGrain.visible = false;
    this.carryGrain.castShadow = true;
    this.head.add(this.carryGrain);

    // --- Contact shadow ---
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 0.72),
      new THREE.MeshBasicMaterial({
        map: Grasshopper.blobTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.34,
      }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;

    // --- Dizzy stars ---
    const starPos = new Float32Array(6 * 3);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.starAlphaAttr = new THREE.BufferAttribute(new Float32Array(6).fill(0), 1);
    starGeo.setAttribute("aAlpha", this.starAlphaAttr);
    this.stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 700 } },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vA;
          uniform float uScale;
          void main() {
            vA = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 0.08 * uScale / max(0.05, -mv.z);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            vec2 d = gl_PointCoord - 0.5;
            // 4-ray sparkle: bright cross over a soft core.
            float core = smoothstep(0.24, 0.02, length(d));
            float rays = pow(max(0.0, 1.0 - abs(d.x) * 7.0), 2.0) * pow(max(0.0, 1.0 - abs(d.y) * 1.6), 1.2)
                       + pow(max(0.0, 1.0 - abs(d.y) * 7.0), 2.0) * pow(max(0.0, 1.0 - abs(d.x) * 1.6), 1.2);
            float a = clamp(core + rays * 0.85, 0.0, 1.0) * vA;
            if (a < 0.01) discard;
            gl_FragColor = vec4(1.0, 0.93, 0.55, a);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.stars.frustumCulled = false;
    this.stars.renderOrder = 6;

    this.root.add(this.body);
    this.root.add(this.blob);
    // The dizzy stars ride the ROOT: parented to the group (which sits at the
    // world origin) the orbit rendered at (0, 0.4, 0), nine units from the
    // animal — the stunned shot showed no stars at all.
    this.root.add(this.stars);
    this.group.add(this.root);
    this.group.add(this.legsGroup);

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.blob) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** Viewport attenuation for the dizzy stars (call on resize). */
  setPointScale(heightPx: number): void {
    (this.stars.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx * 1.1;
  }

  // --- the pose ----------------------------------------------------------------

  /** Star orbit radius / height above the root. */
  private static readonly STARS = { r: 0.14, y: 0.4, speed: 2.6, count: 6 } as const;

  pose(s: HopperPoseInput): void {
    const stun = s.stun;
    this.root.position.copy(s.pos);
    this.root.rotation.y = s.yaw + Math.sin(s.stunClock * 2.1) * 0.22 * stun;

    // --- Body: terrain alignment + squash + rear + air pitch + dizzy sway ---
    const fwdX = Math.sin(s.yaw);
    const fwdZ = Math.cos(s.yaw);
    const hF = this.groundSampler(s.pos.x + fwdX * 0.18, s.pos.z + fwdZ * 0.18);
    const hB = this.groundSampler(s.pos.x - fwdX * 0.18, s.pos.z - fwdZ * 0.18);
    const hL = this.groundSampler(s.pos.x + fwdZ * 0.13, s.pos.z - fwdX * 0.13);
    const hR = this.groundSampler(s.pos.x - fwdZ * 0.13, s.pos.z + fwdX * 0.13);
    const terrainPitch = -Math.atan2(hF - hB, 0.36) * 0.6;
    const terrainRoll = Math.atan2(hL - hR, 0.26) * 0.45;

    const speedF = clamp(s.planarSpeed / 1.2, 0, 1);
    const bob = Math.sin(s.gaitTime * Math.PI * 4) * 0.008 * speedF * (1 - s.airBlend);
    const breathe = 1 + Math.sin(s.anim * 1.9) * 0.012 * (1 - s.stun);
    const rear = s.rear;

    this.body.position.y = bob - s.squash * 0.032;
    this.body.scale.set(1 + s.squash * 0.05, (1 - s.squash * 0.16) * breathe, 1 + s.squash * 0.04);
    this.body.rotation.x = terrainPitch - rear * 0.5 + s.airPitch + Math.sin(s.stunClock * 3.2) * 0.07 * stun;
    this.body.rotation.z =
      terrainRoll +
      Math.sin(s.gaitTime * Math.PI * 2) * 0.03 * speedF +
      Math.sin(s.stunClock * 3.1) * 0.17 * stun;
    this.body.rotation.y = Math.sin(s.stunClock * 1.7) * 0.1 * stun;

    // Head: look offset, lift while rearing, loll while dizzy.
    this.head.rotation.y = s.headYaw;
    this.head.rotation.x = -rear * 0.34 + Math.sin(s.anim * 1.4) * 0.02 + clamp(s.airPitch * 0.5, -0.3, 0.3);
    this.head.rotation.z = Math.sin(s.stunClock * 3.2 + 1.1) * 0.34 * stun;

    // Abdomen breathes; tenses while rearing (tip dips).
    this.abdomen.rotation.x = 0.1 + rear * 0.22 - s.airBlend * 0.14;
    this.abdomen.scale.set(0.052, 0.05 * breathe, 0.17 * breathe);

    // Wings: folded tight along the back; flutter hard during the hop; droop
    // when dizzy (geometry is baked back-pointing — see wingGeo).
    const flutter = s.wingFlutter;
    for (let i = 0; i < this.wings.length; i++) {
      const side = i === 0 ? -1 : 1;
      const w = this.wings[i];
      w.rotation.z = Math.sin(s.anim * 46) * 0.09 * flutter + Math.sin(s.stunClock * 5.1) * 0.08 * stun;
      w.rotation.x = 0.06 + flutter * 0.2 + stun * 0.16;
      w.position.y = BODY.thoraxY + 0.088 + flutter * 0.012;
      w.rotation.y = side * (0.05 + flutter * 0.06);
    }

    // Antennae: idle sweep → swept back at speed → droop while stunned.
    for (let i = 0; i < this.antennaJoints.length; i++) {
      const side = i < 4 ? -1 : 1;
      const seg = i % 4;
      const j = this.antennaJoints[i];
      if (seg === 0) {
        // Threads sweep forward-up from the forehead (the old 2.35 base hung
        // them down over the mouth like palps); speed lifts them, stun droops.
        const base = 1.5 - clamp(s.planarSpeed * 0.14, 0, 0.32) + rear * 0.18 + stun * 0.7;
        j.rotation.x = base + Math.sin(s.anim * 1.6 + side * 0.8) * 0.09;
        j.rotation.z = side * (0.3 - stun * 0.34) + Math.sin(s.anim * 1.1 + side) * 0.07;
        j.rotation.y = side * (-0.28 + Math.sin(s.anim * 0.9 + side * 0.5) * 0.12);
      } else if (seg === 1) {
        j.rotation.x = -0.22 + Math.sin(s.anim * 2.1 + side * 1.3) * 0.06;
        j.rotation.z = side * -0.12;
      } else {
        j.rotation.x = -0.14 + Math.sin(s.anim * 2.4 - seg * 0.9 + side) * 0.07;
        j.rotation.z = side * -0.08;
      }
    }

    // Carried grain + chewing shrink.
    this.carryGrain.visible = s.carry > 0.02;
    const chew = 1 - s.eat * 0.9;
    this.carryGrain.scale.setScalar(1.15 * clamp(s.carry, 0, 1) * chew);
    this.carryGrain.rotation.x = -Math.PI / 2 + 0.35 + Math.sin(s.anim * 9) * 0.12 * s.eat;

    // --- Hind legs: authored Z, posed by elevation/yaw angles ---
    const strideSwing = clamp(s.planarSpeed * 0.16, 0, 0.24);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const anchor = this.hindAnchors[i];
      anchor.getWorldPosition(this._hip);
      const groundY = this.groundSampler(this._hip.x, this._hip.z);

      // Blend between pose keys: rest ↔ walk ↔ windup/land ↔ air kick.
      const ph = (s.gaitTime + (i === 0 ? 0.0 : 0.5)) % 1;
      const swing = Math.sin(ph * Math.PI * 2) * strideSwing * (1 - s.airBlend) * (1 - s.squash);
      // Resting Z: the femur lies along the FLANK (slightly raised, knee just
      // above the back line at the abdomen tip), tibia folding down under it —
      // the classic folded saltatorial leg. The old key (elev 0.35, back 0.55)
      // swung the femur up past the spine so it read as twin horns on the
      // back in the hero still.
      let femurElev = 0.18 + swing; // rad above horizontal
      let femurBack = 0.92;
      let tibiaElev = -1.35;
      let tibiaFwd = 0.35;
      // Windup / land absorb: fold the Z tight.
      femurElev += s.squash * 0.42;
      tibiaElev -= s.squash * 0.5;
      tibiaFwd += s.squash * 0.3;
      // Rear telegraph: cock the legs.
      femurElev += rear * 0.18;
      // Air: the kick — femur and tibia extend into one line streaming back,
      // slightly below the body (−0.9 elevation folded the femur down-forward
      // so the hop read as two dangling stilt tubes from behind).
      femurElev += s.airBlend * (-0.45);
      femurBack += s.airBlend * 0.18;
      tibiaElev += s.airBlend * (1.2);
      tibiaFwd += s.airBlend * (-1.45);
      // Dizzy slack.
      femurElev -= stun * 0.22;
      tibiaElev += stun * 0.3;

      const dirF = this._dir
        .set(side * (0.07 + s.airBlend * 0.3), Math.sin(femurElev), -Math.cos(femurElev) * femurBack)
        .normalize();
      const knee = this._knee.copy(this._hip).addScaledVector(dirF, BODY.femurLen);

      const dirT = this._target
        .set(side * (0.1 + s.airBlend * 0.35), Math.sin(tibiaElev), Math.cos(tibiaElev) * tibiaFwd)
        .normalize();
      // Own scratch: placeSegment() works through _sv1, so holding `foot`
      // there let the femur placement corrupt the tibia/tarsus endpoints
      // (tibias stretched frames-long, tarsuses dumped at the origin).
      const foot = this._foot.copy(knee).addScaledVector(dirT, BODY.tibiaLen);
      if (s.grounded) foot.y = Math.max(foot.y, groundY - 0.004);

      const parts = this.hindParts[i];
      Grasshopper.placeSegment(parts.femur, this._hip, knee);
      parts.knee.position.copy(knee);
      Grasshopper.placeSegment(parts.tibia, knee, foot);
      const toe = this._rest.set(foot.x, Math.max(groundY, foot.y - 0.028), foot.z + 0.035);
      Grasshopper.placeSegment(parts.tarsus, foot, toe);
    }

    // --- Front/mid legs: 2-bone IK like the ant's, quick steps ---
    const v = s.planarSpeed;
    const stride = 0.5 * v * 0.16;
    const lift = 0.014 + v * 0.006;
    const speedGate = clamp(v / 0.12, 0, 1) * (1 - s.airBlend) * (1 - stun);
    this._q.setFromEuler(_euler.set(0, s.yaw, 0));
    for (let i = 0; i < SMALL_LEGS.length; i++) {
      const leg = SMALL_LEGS[i];
      const anchor = this.smallAnchors[i];
      anchor.getWorldPosition(this._hip);

      this._rest.set(leg.rest[0], 0, leg.rest[2]).applyMatrix4(this.root.matrixWorld);
      this._rest.y = this.groundSampler(this._rest.x, this._rest.z);
      const target = this._target.copy(this._rest);

      const phase = (s.gaitTime + leg.offset) % 1;
      if (v > 0.05) {
        const velDirX = Math.sin(s.yaw);
        const velDirZ = Math.cos(s.yaw);
        let fore = 0;
        let liftNow = 0;
        if (phase < SWING_FRAC) {
          const u = phase / SWING_FRAC;
          const eased = u * u * (3 - 2 * u);
          fore = -stride + eased * 2 * stride;
          liftNow = Math.sin(u * Math.PI) * lift;
        } else {
          fore = stride - v * (phase - SWING_FRAC) * 0.16;
        }
        target.x += velDirX * fore * speedGate;
        target.z += velDirZ * fore * speedGate;
        target.y += liftNow * speedGate;
      }

      // Tuck while airborne; reach forward-up while rearing.
      if (s.airBlend > 0.001) {
        this._knee.set(leg.rest[0] * 0.55, 0.075, leg.rest[2] * 0.75).applyMatrix4(this.root.matrixWorld);
        target.lerp(this._knee, s.airBlend);
      }
      if (rear > 0.001) {
        const fwdX2 = Math.sin(s.yaw);
        const fwdZ2 = Math.cos(s.yaw);
        // The rear key is a ROOT-LOCAL offset (like the air tuck above): it
        // must go through the root's world matrix or the foot target collapses
        // to the world origin and the tibia stretches across the whole frame.
        this._knee
          .set(leg.rest[0] + fwdX2 * 0.07, 0.05 + rear * 0.09, leg.rest[2] + fwdZ2 * 0.07)
          .applyMatrix4(this.root.matrixWorld);
        target.lerp(this._knee, rear);
      }

      // 2-bone IK, knees up and slightly outward.
      const dir = this._dir.subVectors(target, this._hip);
      let dist = dir.length();
      const maxReach = BODY.frontFemur + BODY.frontTibia - 0.004;
      if (dist > maxReach) dist = maxReach;
      dir.normalize();
      const cosA = clamp(
        (BODY.frontFemur * BODY.frontFemur + dist * dist - BODY.frontTibia * BODY.frontTibia) /
          (2 * BODY.frontFemur * dist),
        -1,
        1,
      );
      const a1 = Math.acos(cosA);
      const pole = this._pole.set(leg.side * 0.45, 1.0, 0).applyQuaternion(this._q);
      pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-6) pole.set(0, 1, 0);
      pole.normalize();
      const knee = this._knee
        .copy(dir)
        .multiplyScalar(Math.cos(a1) * BODY.frontFemur)
        .addScaledVector(pole, Math.sin(a1) * BODY.frontFemur)
        .add(this._hip);

      const parts = this.smallLegParts[i];
      Grasshopper.placeSegment(parts.femur, this._hip, knee);
      Grasshopper.placeSegment(parts.tibia, knee, target);
      parts.foot.position.copy(target);
    }

    // --- Contact shadow ---
    const height = Math.max(0, s.pos.y - this.groundSampler(s.pos.x, s.pos.z));
    this.blob.position.set(0, -s.pos.y + this.groundSampler(s.pos.x, s.pos.z) + 0.016, 0);
    this.blob.rotation.z = -s.yaw;
    const fade = 1 - clamp(height / 1.4, 0, 1);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.34 * fade;
    this.blob.scale.setScalar(1 + height * 0.5);
    this.blob.visible = fade > 0.02;

    // --- Dizzy stars: orbit above the head, fade with the stun ---
    const starPos = this.stars.geometry.getAttribute("position") as THREE.BufferAttribute;
    const on = stun > 0.04;
    this.stars.visible = on;
    if (on) {
      const alpha = Math.min(1, stun * 1.6) * (0.75 + 0.25 * Math.sin(s.stunClock * 7.3));
      for (let i = 0; i < Grasshopper.STARS.count; i++) {
        const a = s.stunClock * Grasshopper.STARS.speed + (i / Grasshopper.STARS.count) * Math.PI * 2;
        const wob = Math.sin(a * 2 + 1.3) * 0.018;
        starPos.setXYZ(
          i,
          Math.cos(a) * Grasshopper.STARS.r,
          Grasshopper.STARS.y + wob + Math.cos(a * 2) * 0.02,
          Math.sin(a) * Grasshopper.STARS.r * 0.55,
        );
        this.starAlphaAttr.setX(i, alpha);
      }
      starPos.needsUpdate = true;
      this.starAlphaAttr.needsUpdate = true;
    }
  }

  /** Orient a unit-length cylinder (origin at top, extends -Y) from→to. */
  private static placeSegment(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
    mesh.position.copy(from);
    const dir = Grasshopper._sv1.subVectors(to, from);
    const len = Math.max(dir.length(), 1e-5);
    mesh.scale.y = len;
    mesh.quaternion.setFromUnitVectors(Grasshopper.DOWN, dir.multiplyScalar(1 / len));
  }

  // --- shared geometry / materials ---------------------------------------------

  private static ellipsoid = new THREE.SphereGeometry(1, 18, 13);
  private static readonly glintGeo = new THREE.SphereGeometry(1, 6, 5);
  private static readonly glintMat = new THREE.MeshBasicMaterial({ color: 0xfff3d2 });
  // 14x10 segments: at hero-shot range the old 8x6 beads showed hard facets
  // and the leg joints read as mechanical hex nuts on the flank.
  private static readonly beadGeo = new THREE.SphereGeometry(1, 14, 10);
  private static readonly palpGeo = new THREE.ConeGeometry(0.005, 0.018, 5).rotateX(Math.PI / 2);
  private static readonly antennaGeo = new THREE.CylinderGeometry(0.002, 0.0028, 1, 4).translate(0, 0.5, 0);
  private static readonly femurGeo = Grasshopper.buildFemurGeo();
  private static readonly tibiaGeo = new THREE.CylinderGeometry(0.0062, 0.0038, 1, 6).translate(0, -0.5, 0);
  private static readonly tarsusGeo = new THREE.CylinderGeometry(0.0032, 0.0024, 1, 5).translate(0, -0.5, 0);
  private static readonly smallFemurGeo = new THREE.CylinderGeometry(0.005, 0.0065, 1, 5).translate(0, -0.5, 0);
  private static readonly smallTibiaGeo = new THREE.CylinderGeometry(0.0028, 0.004, 1, 5).translate(0, -0.5, 0);

  /** Compound eye: warm amber horizontal stripe banded into vertex colors. */
  private static eyeGeo = (() => {
    const geo = new THREE.SphereGeometry(1, 14, 11);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const dark = new THREE.Color(0x241a10);
    const amber = new THREE.Color(0x8a5a22);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const stripe = Math.exp(-Math.pow(y / 0.38, 2));
      c.copy(dark).lerp(amber, stripe * 0.85);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  })();

  /** Abdomen with segment creases baked into vertex colors (olive, darker
   *  than the thorax so the tail reads as one piece with the shell) and a
   *  tapered rear so it never reads as a detached pale egg. */
  private static abdomenGeo = (() => {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      // Taper the rear half toward the tip (a real abdomen narrows; the blunt
      // sphere end read as an egg slung behind the thorax).
      const taper = 1 - 0.42 * Math.pow(Math.max(0, -z), 1.4);
      pos.setX(i, pos.getX(i) * taper);
      pos.setY(i, pos.getY(i) * (0.7 + 0.3 * taper));
      const crease = 0.5 + 0.5 * Math.sin(z * 22 + 0.6);
      const broad = 0.5 + 0.5 * Math.sin(z * 9 + 2.2);
      // Matched to the shell family (thorax albedo ≈ 0.5). NOTE: these scalar
      // shades must be tagged SRGBColorSpace — setRGB defaults to linear, and
      // untagged values rendered the tail ~2× brighter than authored (the
      // "pale banana" read). The up-facing top is shaded darker still: a fat
      // up-facing ellipse catches the full sun and reads as a pale blanket.
      const shade = (0.34 - Math.pow(crease, 2) * 0.12) * (1 - 0.35 * Math.max(0, pos.getY(i)));
      c.setRGB(shade, shade * (0.93 - 0.1 * broad), shade * (0.52 - 0.14 * broad), THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  })();

  /** Hind femur with the dark herringbone chevrons of a real shank. Thick at
   *  the hip (the saltatorial muscle), tapering hard to the knee. */
  private static buildFemurGeo(): THREE.BufferGeometry {
    const geo = new THREE.CylinderGeometry(0.011, 0.022, 1, 7).translate(0, -0.5, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i); // 0 at hip → 1 at knee
      const chev = 0.5 + 0.5 * Math.sin(t * 26);
      // Deep olive so the shank stays in the shell family even under the full
      // 2.4-intensity sun. SRGBColorSpace tag: untagged scalars read as linear
      // and rendered the femurs as pale cream tubes (see abdomenGeo note).
      const shade = 0.4 - Math.pow(chev, 2.4) * 0.18;
      c.setRGB(shade, shade * 0.92, shade * 0.52, THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }

  /** Folded tegmen: long leaf lying along the BACK (baked: shape length →
   *  −Z), with lengthwise vein streaks in vertex colors. Without the bake the
   *  leaf's length ran LATERALLY — two side fins instead of folded wings. */
  private static wingGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.028);
    s.quadraticCurveTo(0.18, 0.036, 0.34, 0.004);
    s.quadraticCurveTo(0.16, -0.03, 0, -0.024);
    s.quadraticCurveTo(-0.05, 0, 0, 0.028);
    const geo = new THREE.ShapeGeometry(s, 10);
    geo.rotateX(-Math.PI / 2); // stand the profile up: width → Z
    geo.rotateY(Math.PI / 2);  // length → −Z (points back over the abdomen)
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i); // length axis after the bake
      const x = pos.getX(i);
      const veins = 0.72 + 0.28 * Math.sin(-z * 60 + x * 4);
      const pale = THREE.MathUtils.smoothstep(-z, 0.12, 0.34);
      // Tegmina sit a touch darker than the shell; SRGB tag (see abdomenGeo
      // note — untagged scalars rendered the wings as pale blankets).
      c.setRGB(0.3 * veins + 0.08 * pale, 0.29 * veins + 0.09 * pale, 0.17 * veins + 0.1 * pale, THREE.SRGBColorSpace);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  })();

  private static roughnessTex = Grasshopper.buildRoughness();

  private static buildRoughness(): THREE.Texture {
    const size = 128;
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
        // Duller, blotchier chitin than the ant's brushed shell — the hard
        // low-sheen carapace read comes from these coarse patches.
        const blotch = hash(x >> 2, y >> 2) * 0.6 + hash(x >> 1, y) * 0.4;
        const v = 0.58 + blotch * 0.38;
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

  private static blobTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "rgba(0,0,0,0.8)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.38)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
}

// (module scratch — placed after the class so statics above stay tidy)
const _euler = new THREE.Euler(0, 0, 0, "XYZ");
