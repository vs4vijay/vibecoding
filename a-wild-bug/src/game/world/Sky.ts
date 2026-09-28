import * as THREE from "three";
import { DayCycle } from "./DayCycle";

/**
 * Gradient sky dome with an HDR sun disc. The dome shares one ShaderMaterial
 * between the main scene and a private scene used for PMREM environment
 * capture, so the IBL always matches what the camera sees.
 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly envScene = new THREE.Scene();

  private readonly uniforms = {
    uZenith: { value: new THREE.Color(0x3f88d8) },
    uHorizon: { value: new THREE.Color(0xb4d8ea) },
    uGroundHaze: { value: new THREE.Color(0x94b8c8) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff7e8) },
  };

  private static readonly VERT = /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  private static readonly FRAG = /* glsl */ `
    varying vec3 vDir;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uGroundHaze;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
      col = mix(uGroundHaze, col, smoothstep(-0.14, 0.02, h));
      float cosA = dot(d, normalize(uSunDir));
      float glow = pow(clamp(cosA, 0.0, 1.0), 5.0) * 0.18 + pow(clamp(cosA, 0.0, 1.0), 48.0) * 0.5;
      float disc = smoothstep(0.99935, 0.99975, cosA);
      col += uSunColor * glow;
      col += uSunColor * disc * 6.0; // HDR → feeds bloom
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader: Sky.VERT,
      fragmentShader: Sky.FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const geo = new THREE.SphereGeometry(380, 40, 20);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    const envDome = new THREE.Mesh(geo, material);
    envDome.frustumCulled = false;
    this.envScene.add(envDome);
  }

  sync(day: DayCycle): void {
    this.uniforms.uZenith.value.copy(day.zenithColor);
    this.uniforms.uHorizon.value.copy(day.horizonColor);
    this.uniforms.uGroundHaze.value.copy(day.groundHazeColor);
    this.uniforms.uSunDir.value.copy(day.sunDir);
    this.uniforms.uSunColor.value.copy(day.sunColor);
  }
}
