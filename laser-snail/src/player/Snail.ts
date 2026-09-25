import * as THREE from 'three';

/** Options for building the Turbo mascot mesh. */
export interface SnailOptions {
  /** Uniform scale applied to the whole snail. Defaults to 1. */
  scale?: number;
  /** Shell base color. Defaults to deep indigo. */
  shellColor?: number;
  /** Neon glow color used for the shell rim and the eyes. Defaults to electric cyan. */
  glowColor?: number;
  /** Body and eye-stalk color. Defaults to teal. */
  bodyColor?: number;
}

/** The Turbo mascot: named parts plus an idle animation hook. */
export interface Snail {
  /**
   * Root group. External code owns its transform (world position, facing) —
   * the idle animation only ever touches an inner subgroup, so the two never
   * fight over the same transform when this becomes the player mesh.
   */
  group: THREE.Group;
  /** Shell assembly (spiral torus + emissive rim); wobbles during idle. */
  shell: THREE.Group;
  /** Body capsule. */
  body: THREE.Mesh;
  /** Eye-stalk pair with glowing tips. */
  eyeStalks: THREE.Group;
  /** Advances the idle animation (bob, sway, shell wobble) by `dt` seconds. */
  update(dt: number): void;
  /**
   * Kicks the shell-cannon spin (the Phase 3 "muzzle juice"): the shell
   * spins up like a rotated barrel and coast-decays back to idle. Call
   * once per shot; `strength` 0..~1.5 scales the kick.
   */
  spinShell(strength?: number): void;
  /** Flash of the muzzle glow at the shell's bore (fades in ~0.12 s). */
  flashMuzzle(): void;
  /**
   * Landing squash: compresses the body down and out, springing back over
   * ~0.3 s. Call once on touchdown; `strength` 0..~1.5 scales it.
   */
  squash(strength?: number): void;
  /**
   * Launch stretch: snaps the body tall and thin (jump-pod liftoff), then
   * spring-decays like the squash. Call once at launch.
   */
  stretch(strength?: number): void;
}

// Palette defaults: neon accents on a dark background, per the art spec.
const DEFAULT_SHELL_COLOR = 0x2b3a9e;
const DEFAULT_GLOW_COLOR = 0x3ff2ff;
const DEFAULT_BODY_COLOR = 0x0f7f8c;

/**
 * Builds the Turbo snail entirely from primitives — no external assets.
 * Parts are named so later phases can attach gameplay effects (shell cannon,
 * speed trail, hit squash) to specific sub-objects.
 */
export function createSnail(options: SnailOptions = {}): Snail {
  const shellColor = options.shellColor ?? DEFAULT_SHELL_COLOR;
  const glowColor = options.glowColor ?? DEFAULT_GLOW_COLOR;
  const bodyColor = options.bodyColor ?? DEFAULT_BODY_COLOR;

  const group = new THREE.Group();
  group.name = 'snail';

  // Inner group carries the idle animation; outer `group` stays under the
  // owner's control.
  const visual = new THREE.Group();
  visual.name = 'snail-visual';
  group.add(visual);

  // -- Body: capsule lying along z, head toward -z (Three.js "forward"). --
  const bodyGeometry = new THREE.CapsuleGeometry(0.3, 0.95, 8, 24);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    emissive: new THREE.Color(bodyColor).multiplyScalar(0.25),
    roughness: 0.45,
    metalness: 0.15,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'snail-body';
  body.rotation.x = -Math.PI / 2; // capsule axis y → z, top of capsule becomes the head
  body.position.y = 0.3; // radius 0.3 → the foot rests exactly on y = 0
  visual.add(body);

  // -- Eye stalks with emissive tips. --
  const eyeStalks = new THREE.Group();
  eyeStalks.name = 'snail-eye-stalks';
  visual.add(eyeStalks);

  const stalkGeometry = new THREE.CylinderGeometry(0.03, 0.05, 0.34, 8);
  const stalkMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.5,
    metalness: 0.1,
  });
  const eyeGeometry = new THREE.SphereGeometry(0.075, 16, 12);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: glowColor }); // unlit → always glows

  for (const side of [-1, 1] as const) {
    const stalk = new THREE.Mesh(stalkGeometry, stalkMaterial);
    stalk.name = `snail-eye-stalk-${side < 0 ? 'left' : 'right'}`;
    stalk.position.set(side * 0.12, 0.45, -0.55);
    stalk.rotation.set(-0.55, 0, -side * 0.35); // lean forward and outward
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = `snail-eye-${side < 0 ? 'left' : 'right'}`;
    eye.position.y = 0.21; // at the stalk tip, in stalk-local space
    stalk.add(eye);
    eyeStalks.add(stalk);
  }

  // -- Shell: torus "spiral" on the back, traced by a glowing outer rim. --
  const shell = new THREE.Group();
  shell.name = 'snail-shell';
  shell.position.set(0, 0.72, 0.28);
  visual.add(shell);

  const shellMesh = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.3, 20, 48),
    new THREE.MeshStandardMaterial({
      color: shellColor,
      emissive: new THREE.Color(shellColor).multiplyScalar(0.35),
      roughness: 0.35,
      metalness: 0.35,
    }),
  );
  shellMesh.name = 'snail-shell-spiral';
  shellMesh.rotation.y = Math.PI / 2; // spiral plane faces sideways, like a real snail

  const shellRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.045, 8, 64), // sits right on the shell's outer edge
    new THREE.MeshBasicMaterial({ color: glowColor }),
  );
  shellRim.name = 'snail-shell-rim';
  shellRim.rotation.y = Math.PI / 2;

  shell.add(shellMesh, shellRim);

  // -- Muzzle glow: a small emissive bead at the shell's bore, flashed on fire.
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 2.6, 2.8), // overdriven white-cyan → bloom
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  muzzle.name = 'snail-muzzle';
  muzzle.position.set(0, 0.78, -0.5); // front-top, where the cannon mouths
  muzzle.visible = false;
  visual.add(muzzle);

  group.scale.setScalar(options.scale ?? 1);

  // -- Idle animation: gentle bob, lazy sway, shell wobble, sniffing stalks. --
  // Phase 3 juice rides the same tick: the shell-cannon spin (decaying) and
  // the muzzle flash (a fast fade) layer on top of the idle wobble.
  // Phase 4 adds the landing squash / launch stretch: two opposing spring
  // energies applied to the inner visual's scale (the outer group stays
  // under the Controller's transform ownership).
  let elapsed = 0;
  let spinEnergy = 0;
  let spinPhase = 0;
  let muzzleFlash = 0;
  let squashEnergy = 0; // > 0 = flattened (landing)
  let stretchEnergy = 0; // > 0 = elongated (liftoff)

  const update = (dt: number): void => {
    elapsed += dt;
    visual.position.y = Math.sin(elapsed * 2.2) * 0.07;
    visual.rotation.z = Math.sin(elapsed * 1.1) * 0.05;
    shell.rotation.z = Math.sin(elapsed * 1.4) * 0.16 + spinPhase;
    shell.rotation.x = Math.sin(elapsed * 0.9) * 0.12;
    eyeStalks.rotation.x = Math.sin(elapsed * 2.2 + 0.6) * 0.08;

    if (spinEnergy > 0.0005) {
      spinEnergy *= Math.exp(-3.2 * dt);
      spinPhase += spinEnergy * 26 * dt;
    } else {
      spinEnergy = 0;
    }

    if (muzzleFlash > 0) {
      muzzleFlash = Math.max(0, muzzleFlash - dt * 8);
      muzzle.visible = true;
      const material = muzzle.material as THREE.MeshBasicMaterial;
      material.opacity = muzzleFlash;
      muzzle.scale.setScalar(0.6 + muzzleFlash * 0.9);
    } else {
      muzzle.visible = false;
    }

    if (squashEnergy > 0.0005 || stretchEnergy > 0.0005) {
      squashEnergy *= Math.exp(-6.5 * dt);
      stretchEnergy *= Math.exp(-6.5 * dt);
      const squash = squashEnergy - stretchEnergy;
      // Volume-ish trade: flatten → widen, stretch → pinch.
      visual.scale.set(1 + 0.32 * squash, 1 - 0.45 * squash, 1 + 0.32 * squash);
    } else {
      squashEnergy = 0;
      stretchEnergy = 0;
      visual.scale.set(1, 1, 1);
    }
  };

  return {
    group,
    shell,
    body,
    eyeStalks,
    update,
    spinShell(strength = 1): void {
      spinEnergy = Math.min(1.6, spinEnergy + strength);
    },
    flashMuzzle(): void {
      muzzleFlash = 1;
    },
    squash(strength = 1): void {
      squashEnergy = Math.min(1.5, squashEnergy + strength);
    },
    stretch(strength = 1): void {
      stretchEnergy = Math.min(1.5, stretchEnergy + strength);
    },
  };
}
