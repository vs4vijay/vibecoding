import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "../src/render/cameraRig";
import { CONFIG } from "../src/config";

/** Rig with a real camera; three's math runs fine in node. */
function makeRig(): CameraRig {
  const camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fovBase,
    16 / 9,
    CONFIG.camera.near,
    CONFIG.camera.far,
  );
  return new CameraRig(camera);
}

describe("CameraRig death cam", () => {
  it("stays at the chase pose while unarmed, even across many ticks", () => {
    // Regression: tick() advanced deathPull from 0, so the death-cam pull
    // (up + back) engaged on every run and the chase view never settled.
    const rig = makeRig();
    for (let i = 0; i < 600; i++) {
      rig.tick(1 / 60);
      rig.follow(0, 100, 0, 1 / 60);
    }
    expect(rig.camera.position.y).toBeCloseTo(CONFIG.camera.offset.y, 3);
    expect(rig.camera.position.z).toBeCloseTo(100 - CONFIG.camera.offset.z, 3);
  });

  it("pulls up and back only after armDeathCam(), then holds", () => {
    const rig = makeRig();
    rig.armDeathCam();
    for (let i = 0; i < 600; i++) {
      rig.tick(1 / 60);
      rig.follow(0, 100, 0, 1 / 60);
    }
    // Fully pulled: +3.8 y over base 4.2, and 7 further back than the base 9.
    expect(rig.camera.position.y).toBeCloseTo(CONFIG.camera.offset.y + 3.8, 1);
    expect(rig.camera.position.z).toBeCloseTo(100 - CONFIG.camera.offset.z - 7, 1);
  });

  it("resetDeathCam() snaps to the run-start chase pose", () => {
    // Regression: on retry the camera swooped in from the previous run's
    // death position (hundreds of meters back), overflying the respawned car.
    const rig = makeRig();
    rig.follow(3, 900, 0, 1 / 60);
    for (let i = 0; i < 120; i++) {
      rig.tick(1 / 60);
      rig.follow(3, 900, 0, 1 / 60);
    }
    rig.resetDeathCam();
    expect(rig.camera.position.x).toBe(0);
    expect(rig.camera.position.y).toBeCloseTo(CONFIG.camera.offset.y, 5);
    expect(rig.camera.position.z).toBeCloseTo(-CONFIG.camera.offset.z, 5);
    // and it stays settled at the new run's start
    for (let i = 0; i < 60; i++) {
      rig.tick(1 / 60);
      rig.follow(0, 0, 0, 1 / 60);
    }
    expect(rig.camera.position.y).toBeCloseTo(CONFIG.camera.offset.y, 3);
    expect(rig.camera.position.z).toBeCloseTo(-CONFIG.camera.offset.z, 3);
  });
});
