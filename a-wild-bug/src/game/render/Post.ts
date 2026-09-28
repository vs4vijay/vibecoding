import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createGradePass } from "./GradePass";

/**
 * RenderPass → storybook grade → UnrealBloom (subtle) → SMAA → OutputPass.
 * OutputPass stays last so tone mapping + sRGB conversion happen once, on the
 * final buffer (SMAA deliberately runs in linear-sRGB, as its docs require).
 * The grade deliberately runs BEFORE bloom: a ShaderPass sampling bloom's
 * HalfFloat output is the one buffer combination software rasterizers
 * (SwiftShader) mis-sample, painting a full-height black band — and glow added
 * after the vignette is more correct anyway (halos should not be dimmed).
 */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const grade = createGradePass();
  composer.addPass(grade);
  const size = renderer.getSize(new THREE.Vector2());
  grade.uniforms.uTexel.value.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y));

  // Tight radius + high threshold: the HDR sun disc blooms as a compact halo
  // instead of a screen-wide filter wash.
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.85);
  composer.addPass(bloom);

  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());

  const pixelRatio = renderer.getPixelRatio();
  composer.setPixelRatio(pixelRatio);
  composer.setSize(window.innerWidth, window.innerHeight);
  return composer;
}
