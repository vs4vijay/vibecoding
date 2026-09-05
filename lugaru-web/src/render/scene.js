import * as THREE from 'three';
import { buildTerrainMesh } from '../world/terrain';
const SKY = 0xbcd6e4;
/** Renderer + fog/sky + lights (2048 shadowmap sun, ±40 bounds) + terrain. */
export function createScene(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 40, 110);
    const hemiLight = new THREE.HemisphereLight(0xdfeaff, 0x5a5140, 0.55);
    scene.add(hemiLight);
    const sunLight = new THREE.DirectionalLight(0xfff2d9, 1.35);
    sunLight.position.set(30, 48, 18);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    const cam = sunLight.shadow.camera;
    cam.left = -40;
    cam.right = 40;
    cam.top = 40;
    cam.bottom = -40;
    cam.near = 1;
    cam.far = 160;
    scene.add(sunLight);
    scene.add(buildTerrainMesh());
    return { renderer, scene, sunLight, hemiLight };
}
