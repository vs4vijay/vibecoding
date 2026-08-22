import "./style.css";
import * as THREE from "three";
import { CONFIG } from "./config";

const DUSK_COLOR = "#2a2333";

export function boot(): void {
  if (typeof document === "undefined") return;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(new THREE.Color(DUSK_COLOR), 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    2000,
  );

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);

  let last = performance.now();
  let frames = 0;
  let elapsed = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, CONFIG.sim.maxFrameDt);
    last = now;
    frames++;
    elapsed += dt;
    if (elapsed >= 1) {
      console.log(`fps: ${frames}`);
      frames = 0;
      elapsed = 0;
    }
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (typeof document !== "undefined") boot();
