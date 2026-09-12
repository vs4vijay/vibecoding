// src/render3d/materials.ts
// PBR material library for the world. All materials cached; shader-driven
// animation (lava veins, foliage sway, illusory shimmer, crystal pulse) is
// advanced per-frame via updateMaterialTime() — called from WorldView.update.
import * as THREE from "three";
import { pbrSet, lavaEmissiveTexture } from "./textures";

export type MatName =
  | "ground" | "groundTop" | "brick" | "lava" | "tree" | "illusory" | "spikes"
  | "backdrop" | "treeTrunk" | "crystal" | "bone";

// Shared time uniforms (advanced once per frame for every animated material).
const lavaTime = { value: 0 };
const swayTime = { value: 0 };
const illusoryTime = { value: 0 };

const cache = new Map<MatName, THREE.Material>();

/** Standard PBR material wired to a full procedural texture set. */
function pbrStandard(
  kind: string,
  opts: Omit<THREE.MeshStandardMaterialParameters, "normalScale"> & { normalScale?: number } = {},
): THREE.MeshStandardMaterial {
  const set = pbrSet(kind);
  const { normalScale, ...rest } = opts;
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    aoMap: set.aoMap ?? null,
    roughness: 1.0,
    metalness: 0.02,
    ...rest,
  });
  if (normalScale !== undefined) mat.normalScale.set(normalScale, normalScale);
  return mat;
}

export function getMaterial(name: MatName): THREE.Material {
  const hit = cache.get(name);
  if (hit) return hit;
  let mat: THREE.Material;
  switch (name) {
    case "ground": {
      mat = pbrStandard("rock", { vertexColors: true, roughness: 0.96, metalness: 0.02, normalScale: 1.1, aoMapIntensity: 1.15 });
      break;
    }
    case "groundTop": {
      mat = pbrStandard("moss", { vertexColors: true, roughness: 0.95, metalness: 0, normalScale: 0.8 });
      break;
    }
    case "brick": {
      mat = pbrStandard("brick", { vertexColors: true, roughness: 0.86, metalness: 0.02, normalScale: 1.3, aoMapIntensity: 1.1 });
      break;
    }
    case "treeTrunk": {
      mat = pbrStandard("bark", { vertexColors: true, roughness: 0.92, metalness: 0, normalScale: 1.1 });
      break;
    }
    case "bone": {
      mat = pbrStandard("gold", { color: 0xd9cdb2, roughness: 0.6, metalness: 0.02, normalScale: 0.6 });
      break;
    }
    case "tree": {
      // Foliage clumps: GPU sway baked into the vertex stage via an aSway
      // attribute (0 at the branch base → 1 at the tips).
      mat = pbrStandard("moss", { vertexColors: true, roughness: 0.95, metalness: 0, normalScale: 0.9 });
      const foliage = mat as THREE.MeshStandardMaterial;
      foliage.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = swayTime;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aSway;")
          .replace("#include <begin_vertex>", [
            "vec3 transformed = vec3( position );",
            "float sw = aSway;",
            "transformed.x += sin( uTime * 1.15 + position.y * 1.6 + position.x * 2.7 ) * 0.055 * sw;",
            "transformed.z += cos( uTime * 0.85 + position.y * 2.1 + position.z * 1.9 ) * 0.045 * sw;",
          ].join("\n"));
      };
      foliage.customProgramCacheKey = () => "dave-foliage-sway";
      break;
    }
    case "lava": {
      const crust = pbrSet("lava");
      mat = new THREE.MeshStandardMaterial({
        map: crust.map,
        normalMap: crust.normalMap,
        roughnessMap: crust.roughnessMap,
        roughness: 1.0,
        metalness: 0.05,
        emissive: 0xffffff,
        emissiveMap: lavaEmissiveTexture(),
        emissiveIntensity: 2.0,
      });
      const lava = mat as THREE.MeshStandardMaterial;
      lava.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = lavaTime;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <begin_vertex>", [
            "vec3 transformed = vec3( position );",
            "float wv = sin( uTime * 1.6 + position.x * 3.4 + position.y * 2.2 ) * 0.028",
            "       + sin( uTime * 2.7 + position.z * 6.1 ) * 0.014;",
            "transformed += normal * wv;",
          ].join("\n"));
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uTime;")
          .replace("#include <emissivemap_fragment>", [
            "#ifdef USE_EMISSIVEMAP",
            "  vec4 lavaA = texture2D( emissiveMap, vEmissiveMapUv + vec2( uTime * 0.012, uTime * 0.005 ) );",
            "  vec4 lavaB = texture2D( emissiveMap, vEmissiveMapUv * 1.9 + vec2( -uTime * 0.008, uTime * 0.004 ) );",
            "  float pulse = 0.82 + 0.18 * sin( uTime * 1.9 + vEmissiveMapUv.x * 11.0 + vEmissiveMapUv.y * 8.0 );",
            "  totalEmissiveRadiance *= ( lavaA.rgb + lavaB.rgb * 0.55 ) * pulse * 1.6;",
            "#endif",
          ].join("\n"));
      };
      lava.customProgramCacheKey = () => "dave-lava";
      break;
    }
    case "illusory": {
      // Fake wall: fresnel-driven translucency with a slow inner shimmer.
      mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: illusoryTime,
          uColor: { value: new THREE.Color(0x9adfff) },
          uDeep: { value: new THREE.Color(0x16414f) },
        },
        vertexShader: [
          "varying vec3 vWorld;",
          "varying vec3 vNormalW;",
          "void main() {",
          "  vec4 wp = modelMatrix * vec4( position, 1.0 );",
          "  vWorld = wp.xyz;",
          "  vNormalW = normalize( mat3( modelMatrix ) * normal );",
          "  gl_Position = projectionMatrix * viewMatrix * wp;",
          "}",
        ].join("\n"),
        fragmentShader: [
          "uniform float uTime;",
          "uniform vec3 uColor;",
          "uniform vec3 uDeep;",
          "varying vec3 vWorld;",
          "varying vec3 vNormalW;",
          "void main() {",
          "  vec3 V = normalize( cameraPosition - vWorld );",
          "  vec3 N = normalize( vNormalW );",
          "  float ndv = abs( dot( N, V ) );",
          "  float fres = pow( 1.0 - ndv, 2.4 );",
          "  float band = 0.5 + 0.5 * sin( vWorld.y * 6.0 - uTime * 1.25 + sin( vWorld.x * 4.0 + uTime * 0.55 ) * 1.8 );",
          "  float spark = smoothstep( 0.86, 1.0, 0.5 + 0.5 * sin( vWorld.x * 14.0 + vWorld.y * 19.0 - uTime * 2.2 ) * sin( vWorld.z * 9.0 + uTime ) );",
          "  vec3 col = mix( uDeep, uColor, 0.25 + 0.75 * fres );",
          "  col += uColor * band * 0.10 + vec3( 0.55, 0.95, 1.0 ) * spark * 0.5;",
          "  float alpha = 0.14 + fres * 0.6 + band * 0.06 + spark * 0.12;",
          "  gl_FragColor = vec4( col, alpha );",
          "  #include <tonemapping_fragment>",
          "  #include <colorspace_fragment>",
          "}",
        ].join("\n"),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      break;
    }
    case "spikes": {
      mat = pbrStandard("metal", { roughness: 0.34, metalness: 0.82, normalScale: 0.9, aoMapIntensity: 1.0 });
      break;
    }
    case "crystal": {
      mat = new THREE.MeshStandardMaterial({
        color: 0x0b2830,
        emissive: 0x3fd6e6,
        emissiveIntensity: 1.6,
        roughness: 0.18,
        metalness: 0.1,
      });
      break;
    }
    case "backdrop": {
      // Unlit silhouette material for parallax layers: vertical gradient tint
      // (per-layer via cloned uniforms) + scene fog for depth falloff.
      mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
          THREE.UniformsLib.fog,
          {
            uTop: { value: new THREE.Color(0x1e4250) },
            uBottom: { value: new THREE.Color(0x10242e) },
            uYLo: { value: -16 },
            uYHi: { value: 4 },
          },
        ]),
        vertexShader: [
          "#include <fog_pars_vertex>",
          "varying float vY;",
          "void main() {",
          "  vY = position.y;",
          "  vec4 wp = modelMatrix * vec4( position, 1.0 );",
          "  vec4 mvPosition = viewMatrix * wp;",
          "  gl_Position = projectionMatrix * mvPosition;",
          "  #include <fog_vertex>",
          "}",
        ].join("\n"),
        fragmentShader: [
          "#include <fog_pars_fragment>",
          "uniform vec3 uTop;",
          "uniform vec3 uBottom;",
          "uniform float uYLo;",
          "uniform float uYHi;",
          "varying float vY;",
          "void main() {",
          "  float g = smoothstep( uYLo, uYHi, vY );",
          "  vec3 col = mix( uBottom, uTop, g );",
          "  gl_FragColor = vec4( col, 1.0 );",
          "  #include <fog_fragment>",
          "  #include <tonemapping_fragment>",
          "  #include <colorspace_fragment>",
          "}",
        ].join("\n"),
        fog: true,
        side: THREE.DoubleSide,
      });
      break;
    }
  }
  cache.set(name, mat);
  return mat;
}

/** Advance every shader-driven animation. Call once per frame (WorldView.update). */
export function updateMaterialTime(t: number): void {
  lavaTime.value = t;
  swayTime.value = t;
  illusoryTime.value = t;
  const crystal = cache.get("crystal");
  if (crystal) {
    (crystal as THREE.MeshStandardMaterial).emissiveIntensity =
      1.55 + 0.5 * Math.sin(t * 2.1) + 0.18 * Math.sin(t * 3.63);
  }
}
