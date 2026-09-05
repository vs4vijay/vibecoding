import * as THREE from "three";
import { CONFIG } from "../config";

export type GameScene = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
};

/**
 * True when the viewport is portrait-ish; drives the wider fov base in both
 * resize paths so orientation changes reframe instead of cropping.
 */
const isPortrait = (aspect: number): boolean => aspect < 1;

/** Renderer, dusk-lit scene with fog + gradient sky dome, and the game camera. */
export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(new THREE.Color(CONFIG.world.duskColor), 1);
  // Cap at DPR 2: beyond that fill-rate cost swamps phones without a
  // visible sharpness gain.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // updateStyle MUST stay true: the buffer is width*dpr, and without an
  // explicit CSS size the canvas lays out at buffer size — on retina (dpr 2)
  // that's 2x the window, showing a zoomed top-left crop of the frame.
  renderer.setSize(window.innerWidth, window.innerHeight, true);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a160c, 60, 160);

  // Inverted sky dome with a vertex-color gradient: zenith 0x1a1030 -> horizon 0xff7733.
  // Parented to the camera so the dome always surrounds the player; fog disabled so
  // the gradient survives past the fog far plane.
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0x1a1030);
  const horizon = new THREE.Color(0xff7733);
  const mix = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 400, 0, 1);
    mix.copy(horizon).lerp(zenith, t);
    colors[i * 3] = mix.r;
    colors[i * 3 + 1] = mix.g;
    colors[i * 3 + 2] = mix.b;
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  scene.add(new THREE.HemisphereLight(0x33224a, 0x140b06, 0.7));
  const sun = new THREE.DirectionalLight(0xff8844, 1.2);
  sun.position.set(-40, 18, -60);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(
    // Aspect-compensated base: portrait gets a wider lens so the road stays
    // framed; the rig's speed kick lerps up from whatever base this returns.
    window.innerWidth / window.innerHeight < 1 ? 74 : CONFIG.camera.fovBase,
    window.innerWidth / window.innerHeight,
    CONFIG.camera.near,
    CONFIG.camera.far,
  );
  camera.add(sky);
  scene.add(camera);

  const onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.fov = isPortrait(aspect) ? 74 : CONFIG.camera.fovBase;
    camera.updateProjectionMatrix();
  };
  // visualViewport fires on rotate/split-view where window.resize can lag or
  // skip; listen to both and let idempotent updates absorb duplicates.
  window.visualViewport?.addEventListener("resize", onResize);
  window.addEventListener("resize", onResize);

  return { scene, camera, renderer };
}
