import * as THREE from 'three';
/**
 * THE single source of terrain truth. Pure analytic function — imported by
 * both the simulation and the mesh builder; no noise libraries.
 */
export function heightAt(x, z) {
    return 1.2 * Math.sin(x * 0.08) * Math.cos(z * 0.06)
        + 0.6 * Math.sin((x + z) * 0.045)
        + 0.25 * Math.sin(x * 0.21 + z * 0.17);
}
/** Deterministic position hash in [0,1) — pure, drives color dithering. */
function hash2(x, z) {
    const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
}
const GRASS = 0x5a7a3a;
const DIRT = 0x7a6a4a;
const SNOW = 0xdfe6ea;
/** 120m plane, 128×128 segments, displaced by heightAt with banded colors. */
export function buildTerrainMesh() {
    const geo = new THREE.PlaneGeometry(120, 120, 128, 128);
    geo.rotateX(-Math.PI / 2); // lie flat so vertex x/z map straight to heightAt
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const h = heightAt(x, z);
        pos.setY(i, h);
        const base = h < 0.4 ? GRASS : h > 1.8 ? SNOW : DIRT;
        c.setHex(base);
        const dither = 0.92 + 0.16 * hash2(x, z); // ±8% lightness
        colors[i * 3] = c.r * dither;
        colors[i * 3 + 1] = c.g * dither;
        colors[i * 3 + 2] = c.b * dither;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
